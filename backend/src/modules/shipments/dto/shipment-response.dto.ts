import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PageResponse } from '../../../common/dto/page-response.dto';
import { TimeWindowResponse } from '../../../common/dto/time-window.dto';
import { DeliveryPointStatus } from '../../../common/enums/delivery-point-status.enum';
import { DeliveryPointType } from '../../../common/enums/delivery-point-type.enum';
import { Page } from '../../../common/utils/pagination.util';
import { ShipmentStatus } from '../enums/shipment-status.enum';
import { DeliveryInfo } from '../schemas/delivery-info.schema';
import { Shipment } from '../schemas/shipment.schema';

export class DeliveryInfoResponse {
  @ApiProperty({ example: 1 })
  sequence!: number;

  @ApiProperty({
    description: 'ULID of the Location.',
    example: '01M5HJ2FXJ9RYWMT6YT7YX9KH7',
  })
  locationId!: string;

  @ApiProperty({ enum: DeliveryPointType, enumName: 'DeliveryPointType' })
  type!: DeliveryPointType;

  @ApiProperty({ type: TimeWindowResponse })
  appointment!: TimeWindowResponse;

  @ApiProperty({ type: TimeWindowResponse })
  actualWindow!: TimeWindowResponse;

  @ApiProperty({ enum: DeliveryPointStatus, enumName: 'DeliveryPointStatus' })
  status!: DeliveryPointStatus;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  metadata?: Record<string, unknown>;
}

/** A Shipment as returned by the API: public ULID `id`, no `_id` or `deletedAt`. */
export class ShipmentResponse {
  @ApiProperty({
    description: 'Public ULID.',
    example: '01M5HK7Q3V4N8C2D6E9F0G1H2J',
  })
  id!: string;

  @ApiProperty({ example: 'S-0001-1026' })
  code!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'ULID of the parent shipment; `null` for a root shipment.',
  })
  parentId!: string | null;

  @ApiPropertyOptional({
    example: 'Cong ty TNHH ABC',
    description: 'Set on a root shipment (booking).',
  })
  customerName?: string;

  @ApiPropertyOptional({
    example: 47500,
    description:
      'Booking price in whole VND; set on a root shipment (booking).',
  })
  cost?: number;

  @ApiProperty({ type: [String] })
  itemIds!: string[];

  @ApiProperty({ type: [DeliveryInfoResponse] })
  deliveryInfos!: DeliveryInfoResponse[];

  @ApiProperty({ enum: ShipmentStatus, enumName: 'ShipmentStatus' })
  status!: ShipmentStatus;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  metadata?: Record<string, unknown>;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

/** One page of `GET /shipments`. */
export class ShipmentPageResponse extends PageResponse {
  @ApiProperty({ type: [ShipmentResponse] })
  items!: ShipmentResponse[];
}

export function toShipmentPageResponse(
  page: Page<Shipment>,
): ShipmentPageResponse {
  return { ...page, items: page.items.map(toShipmentResponse) };
}

export function toShipmentResponse(shipment: Shipment): ShipmentResponse {
  return {
    id: shipment.id,
    code: shipment.code,
    parentId: shipment.parentId,
    customerName: shipment.customerName,
    cost: shipment.cost,
    itemIds: shipment.itemIds,
    deliveryInfos: shipment.deliveryInfos.map(toDeliveryInfoResponse),
    status: shipment.status,
    metadata: shipment.metadata,
    createdAt: shipment.createdAt,
    updatedAt: shipment.updatedAt,
  };
}

function toDeliveryInfoResponse(info: DeliveryInfo): DeliveryInfoResponse {
  return {
    sequence: info.sequence,
    locationId: info.locationId,
    type: info.type,
    appointment: { from: info.appointment.from, to: info.appointment.to },
    actualWindow: { from: info.actualWindow.from, to: info.actualWindow.to },
    status: info.status,
    metadata: info.metadata,
  };
}
