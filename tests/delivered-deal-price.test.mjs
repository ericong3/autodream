import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const ts = createRequire(import.meta.url)('typescript');
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/utils/deliveredDealPrice.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module, exports: module.exports });
const price = module.exports.deliveredDealPrice;
test('legacy zero cash work order and final deal use the saved Noah price', () => {
  const car = { sellingPrice: 121000, finalDeal: { dealPrice: 0 } };
  const wo = { sellingPrice: 0, discount: 0 };
  assert.equal(price(car, wo).netPrice, 121000);
  assert.equal(price(car, wo).netPrice - 113000 - 1000, 7000);
  assert.equal(wo.sellingPrice, 0);
});
test('valid cash and loan prices retain discounts, including a fully discounted deal', () => {
  const car = { sellingPrice: 121000, finalDeal: { dealPrice: 115000 } };
  assert.equal(price(car, { sellingPrice: 120000, discount: 3000 }).netPrice, 117000);
  assert.equal(price(car, { sellingPrice: 120000, discount: 120000 }).netPrice, 0);
});
test('fallback final-deal price is already net and never discounted twice', () => {
  assert.equal(price({ sellingPrice: 121000, finalDeal: { dealPrice: 115000 } }, { sellingPrice: 0, discount: 6000 }).netPrice, 115000);
});
test('missing prices and invalid legacy placeholders use the remaining saved price', () => {
  assert.equal(price({ sellingPrice: 121000 }).netPrice, 121000);
  assert.equal(price({ sellingPrice: 121000, finalDeal: { dealPrice: NaN } }, { sellingPrice: NaN }).netPrice, 121000);
  assert.equal(price({ sellingPrice: 0, finalDeal: { dealPrice: 0 } }).netPrice, 0);
});
