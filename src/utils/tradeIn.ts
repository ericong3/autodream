import { Car, CashWorkOrder, LoanWorkOrder, RepairJob } from '../types';
import { generateId } from './format';

// Shared by every place a deal's trade-in can be created or edited (initial
// work order submission in Customers.tsx, and CarDetail's Edit Deal modal) —
// a pure builder so all of them produce the exact same car shape, rather than
// each reimplementing (and inevitably drifting from) this logic.
//
// 'trade_in' mode uses the agreed trade-in value as-is (final, doesn't
// change). 'swap' mode's price here is only a rough starting estimate —
// repair cost and commission on the deal it's settling aren't necessarily
// finalized yet at this point — and gets recalculated automatically once
// that deal is actually delivered (see handleDeliverySubmit in CarDetail).
export function buildTradeInCar(opts: {
  sourceCar?: Car;
  wo: Pick<CashWorkOrder | LoanWorkOrder,
    'hasTradeIn' | 'tradeInMode' | 'tradeInPlate' | 'tradeInMake' | 'tradeInModel' | 'tradeInVariant' |
    'tradeInYear' | 'tradeInColour' | 'tradeInMileage' | 'tradeInCondition' | 'tradeInPrice' |
    'settlementFigure' | 'tradeInPhotos'
  >;
  customerName: string;
  repairs: RepairJob[];
}): Car {
  const { sourceCar, wo, customerName, repairs } = opts;
  const mode = wo.tradeInMode ?? 'trade_in';
  let estimatedPurchasePrice = wo.tradeInPrice;
  if (mode === 'swap' && sourceCar) {
    const repairCost = repairs.filter(r => r.carId === sourceCar.id && r.status === 'done').reduce((s, r) => s + (r.actualCost ?? r.totalCost), 0);
    const miscCost = (sourceCar.miscCosts ?? []).reduce((s, m) => s + m.amount, 0);
    const effectiveFloor = sourceCar.priceFloor ?? sourceCar.sellingPrice;
    const commission = (sourceCar.isStaffSale || sourceCar.waiveCommission) ? 0
      : (sourceCar.consignment || sourceCar.sellingPrice < effectiveFloor) ? 1000 : 1500;
    estimatedPurchasePrice = (sourceCar.purchasePrice ?? 0) + repairCost + miscCost + commission;
  }
  return {
    id: generateId(),
    make: wo.tradeInMake || 'Unknown',
    model: wo.tradeInModel || 'Unknown',
    variant: wo.tradeInVariant || undefined,
    year: wo.tradeInYear ?? new Date().getFullYear(),
    carPlate: wo.tradeInPlate || undefined,
    colour: wo.tradeInColour || 'Unknown',
    mileage: wo.tradeInMileage ?? 0,
    condition: wo.tradeInCondition ?? 'good',
    transmission: 'auto',
    purchasePrice: estimatedPurchasePrice,
    sellingPrice: 0,
    status: 'coming_soon',
    dateAdded: new Date().toISOString().slice(0, 10),
    photos: wo.tradeInPhotos,
    photo: wo.tradeInPhotos[0],
    comingSoonType: 'trade_in',
    tradeInSourceCarId: sourceCar?.id,
    settlementAmount: wo.settlementFigure || undefined,
    notes: `Trade-in from ${customerName}'s ${sourceCar ? `${sourceCar.year} ${sourceCar.make} ${sourceCar.model}` : 'deal'}`
      + (mode === 'swap' ? ' — swap, price finalizes when that deal is delivered' : ''),
  };
}
