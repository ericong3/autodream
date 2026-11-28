// Registration fields shared by new-car and price-pending purchase forms.
export const REGISTRATION_KEYS = new Set(['id', 'make', 'model', 'variant', 'car_plate', 'colour', 'condition', 'transmission', 'notes', 'current_location',
 'assigned_salesperson', 'photo_taken_by', 'source_salesman', 'source_type', 'external_salesman_id', 'source_salesman_id', 'coming_soon_type',
 'panel_dealer_id', 'shipment_id', 'year', 'mileage', 'purchase_price', 'selling_price', 'price_floor', 'sales_commission', 'source_commission',
 'intake_commission', 'panel_charge_amount', 'green_card', 'thumbprint_done', 'intake_complete', 'is_recon', 'is_staff_sale', 'waive_commission',
 'seller_thumbprint_saved', 'date_added', 'car_in_date', 'status', 'photo', 'photos', 'checklist_items']);

// Record purchase on a car already in stock: the server only sets its price, seller and lender,
// and keeps the rest of the car as saved. Send just the details it checks, so a field kept in
// another shape (who took the photos is a list) cannot block the save.
export const EXISTING_PURCHASE_KEYS = ['id', 'make', 'model', 'colour', 'status', 'purchase_price'] as const;
export function existingCarPurchaseFields(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(EXISTING_PURCHASE_KEYS.map((k) => [k, row[k]]).filter(([, v]) => v !== undefined && v !== null));
}
