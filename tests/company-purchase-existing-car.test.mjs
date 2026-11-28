import test from 'node:test';
import assert from 'node:assert/strict';
import { existingCarPurchaseFields } from '../src/lib/companyPurchases.ts';
import { validateCompanyPurchase } from '../server/usedCar/companyCarPurchases.mjs';

// A car already in stock, as the app turns it back into a row: who took the photos is a list.
const stockCar = {
  id: '1790224700068-uo0k3nwz9', make: 'Mazda', model: '6', variant: '2.2L Diesel', colour: 'White', status: 'available',
  car_plate: 'VRL9442', year: 2018, mileage: 1, condition: 'good', transmission: 'auto', purchase_price: 32050,
  photo_taken_by: ['user-1'], checklist_items: [{ id: 'cl-0', label: 'Wash', checked: true }], notes: '', is_recon: false,
};
const body = (car) => ({ scope: 'investor_finance', action: 'register_company_car', car, sellerName: 'Carsome Sdn Bhd', lenderCents: 0, requestId: 'company_purchase_request_01' });

test('Record purchase on a stock car sends only the details the server checks', () => {
  assert.throws(() => validateCompanyPurchase(body(stockCar)), /Check the car details/);
  const sent = existingCarPurchaseFields(stockCar);
  assert.deepEqual(Object.keys(sent).sort(), ['colour', 'id', 'make', 'model', 'purchase_price', 'status']);
  assert.equal(validateCompanyPurchase(body(sent)).car.purchase_price, 32050);
});

test('missing details are left out, not sent as empty', () => {
  assert.deepEqual(existingCarPurchaseFields({ id: 'a', make: 'Toyota', model: undefined, colour: null }), { id: 'a', make: 'Toyota' });
});
