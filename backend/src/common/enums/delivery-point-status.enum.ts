/** Processing state of a point: Shipment `deliveryInfos` and Route `stops`. */
export enum DeliveryPointStatus {
  PENDING = 'PENDING',
  ARRIVED = 'ARRIVED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  SKIPPED = 'SKIPPED',
}
