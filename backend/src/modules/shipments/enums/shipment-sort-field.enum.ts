/** Fields `GET /shipments` can be sorted by (`?sortBy=`). */
export enum ShipmentSortField {
  CREATED_AT = 'createdAt',
  UPDATED_AT = 'updatedAt',
  CODE = 'code',
  CUSTOMER_NAME = 'customerName',
  COST = 'cost',
}
