import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DeliveryPointStatus } from '../../common/enums/delivery-point-status.enum';
import { DeliveryPointType } from '../../common/enums/delivery-point-type.enum';
import { LocationsService } from '../locations/locations.service';
import { Location } from '../locations/schemas/location.schema';
import { DeliveryInfo } from '../shipments/schemas/delivery-info.schema';
import { Shipment } from '../shipments/schemas/shipment.schema';
import { matchProvince, ProvinceMatch, ProvinceRecord } from './province-match';
import { Province } from './schemas/province.schema';

/** What booking gets back after routing has run. */
export interface RoutingResult {
  shipment: Shipment;
  /**
   * Why the original pickup and drop-off were left unchanged.
   * Absent when the hubs were inserted.
   */
  routingStoppedReason?: string;
}

type EndpointLabel = 'pickup' | 'dropoff';

/**
 * Inserts cross-dock hubs into a booked root shipment (docs/business-workflows.md §5).
 * Province comparison lives in `province-match.ts`. This service decides the path
 * and saves it. It does not create Items, child shipments, Routes, or DockTasks.
 */
@Injectable()
export class RoutingService {
  constructor(
    @InjectModel(Shipment.name)
    private readonly shipmentModel: Model<Shipment>,
    @InjectModel(Province.name)
    private readonly provinceModel: Model<Province>,
    private readonly locationsService: LocationsService,
  ) {}

  async route(shipment: Shipment): Promise<RoutingResult> {
    const ordered = [...shipment.deliveryInfos].sort(
      (left, right) => left.sequence - right.sequence,
    );
    const pickupInfo = ordered.find(
      (info) => info.type === DeliveryPointType.PICKUP,
    );
    const dropoffInfo = ordered.find(
      (info) => info.type === DeliveryPointType.DROPOFF,
    );
    if (!pickupInfo || !dropoffInfo) {
      return {
        shipment,
        routingStoppedReason: 'shipment has no pickup and drop-off',
      };
    }

    // Only address.province is compared. City, postal code, and the city
    // collection are not read.
    const [pickup, dropoff, provinces, crossDocks] = await Promise.all([
      this.locationsService.findById(pickupInfo.locationId),
      this.locationsService.findById(dropoffInfo.locationId),
      this.provinceModel.find().lean<Province[]>().exec(),
      this.locationsService.findActiveCrossDocks(),
    ]);

    const pickupMatch = matchProvince(pickup.address.province, provinces);
    const dropoffMatch = matchProvince(dropoff.address.province, provinces);
    const problems = [
      provinceProblem('pickup', pickupMatch),
      provinceProblem('dropoff', dropoffMatch),
    ].filter((problem): problem is string => problem !== undefined);

    const transitLocationIds = transitStops(
      pickupMatch,
      dropoffMatch,
      crossDocks,
      provinces,
      problems,
    );
    if (problems.length > 0) {
      return { shipment, routingStoppedReason: problems.join('; ') };
    }

    const deliveryInfos = [
      pickupInfo,
      ...transitLocationIds.map(transitPoint),
      dropoffInfo,
    ].map((info, index) => ({ ...info, sequence: index + 1 }));

    return {
      shipment: await this.saveDeliveryInfos(shipment.id, deliveryInfos),
    };
  }

  private async saveDeliveryInfos(
    shipmentId: string,
    deliveryInfos: DeliveryInfo[],
  ): Promise<Shipment> {
    const doc = await this.shipmentModel.findOne({
      id: shipmentId,
      deletedAt: null,
    });
    if (!doc) {
      throw new Error(
        `Shipment ${shipmentId} was not found when routing tried to save it`,
      );
    }
    doc.deliveryInfos = deliveryInfos;
    await doc.save();
    return doc.toObject();
  }
}

/**
 * Hub location ids for the path, or pushes the reason onto `problems` and
 * returns nothing. A province is usable only when exactly one active
 * cross-dock resolves to it. The same province contributes its hub once.
 */
function transitStops(
  pickupMatch: ProvinceMatch,
  dropoffMatch: ProvinceMatch,
  crossDocks: readonly Location[],
  provinces: readonly ProvinceRecord[],
  problems: string[],
): string[] {
  if (
    problems.length > 0 ||
    pickupMatch.kind !== 'matched' ||
    dropoffMatch.kind !== 'matched'
  ) {
    return [];
  }

  const pickupHubs = hubsForProvince(
    pickupMatch.province.id,
    crossDocks,
    provinces,
  );
  const sameProvince = pickupMatch.province.id === dropoffMatch.province.id;
  if (sameProvince) {
    if (pickupHubs.length !== 1) {
      problems.push(
        `province "${provinceLabel(pickupMatch.province)}" has ${pickupHubs.length} cross-docks`,
      );
      return [];
    }
    return [pickupHubs[0].id];
  }

  const dropoffHubs = hubsForProvince(
    dropoffMatch.province.id,
    crossDocks,
    provinces,
  );
  if (pickupHubs.length !== 1) {
    problems.push(
      `pickup province "${provinceLabel(pickupMatch.province)}" has ${pickupHubs.length} cross-docks`,
    );
  }
  if (dropoffHubs.length !== 1) {
    problems.push(
      `dropoff province "${provinceLabel(dropoffMatch.province)}" has ${dropoffHubs.length} cross-docks`,
    );
  }
  if (pickupHubs.length !== 1 || dropoffHubs.length !== 1) {
    return [];
  }
  return [pickupHubs[0].id, dropoffHubs[0].id];
}

function provinceProblem(
  label: EndpointLabel,
  match: ProvinceMatch,
): string | undefined {
  if (match.kind === 'empty') {
    return `${label} has no province`;
  }
  if (match.kind === 'none') {
    return `${label} province "${match.text}" matches no province`;
  }
  if (match.kind === 'ambiguous') {
    return `${label} province "${match.text}" matches more than one province`;
  }
  return undefined;
}

function provinceLabel(province: ProvinceRecord): string {
  return province.name.en || province.name.local || province.id;
}

/**
 * ACTIVE cross-docks whose own `address.province` resolves to this province.
 * A dock with no province, or with an ambiguous one, is not a candidate.
 */
function hubsForProvince(
  provinceId: string,
  crossDocks: readonly Location[],
  provinces: readonly ProvinceRecord[],
): Location[] {
  return crossDocks.filter((dock) => {
    const match = matchProvince(dock.address.province, provinces);
    return match.kind === 'matched' && match.province.id === provinceId;
  });
}

/** A hub stop. No appointment is invented; both windows stay empty. */
function transitPoint(locationId: string): DeliveryInfo {
  return {
    sequence: 0,
    locationId,
    type: DeliveryPointType.TRANSIT,
    appointment: { from: null, to: null },
    actualWindow: { from: null, to: null },
    status: DeliveryPointStatus.PENDING,
  };
}
