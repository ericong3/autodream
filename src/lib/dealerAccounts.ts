// Dealer accounts: a consignment dealer linked to an investor account, and
// unpaid dealer payouts locked as investment. Requests reuse the investor
// request/retry helpers with scope 'dealer_accounts'.
import { investorRequest } from './investorFinance';

export const DEALER_SCOPE = { scope: 'dealer_accounts' } as const;

export type DealerCar = {
  carId: string; make: string; model: string; year: number | null; plate: string | null; photo: string | null; status: string;
  dateAdded: string | null; sellingPriceCents: number; moneyReceived: boolean; terms: Record<string, unknown> | null; deliveredAt: string | null; hasPayout: boolean;
  variant: string | null; colour: string | null; mileage: number | null; transmission: string | null; notes: string | null; photos: string[];
  repairCents: number; miscCents: number; editable: boolean;
};
export type DealerPayout = {
  paymentId: string; carId: string | null; status: string; createdAt: string | null; transferredAt: string | null; replaced: boolean;
  amountCents: number; paidCents: number; convertedCents: number; balanceCents: number;
};
export type DealerConversion = { id: string; amountCents: number; convertedOn: string; note: string; createdAt: string; actorName: string; allocations: { paymentId: string; amountCents: number }[] };
export type DealerTotals = {
  payoutCents: number; paidCents: number; convertedCents: number; owedCents: number;
  carsInStock: number; carsDelivered: number; deliveredWithoutPayout: number; deliveredNotDisbursed: number;
};
export type DealerView = {
  dealer: { id: string; name: string; bankName: string | null; accountHolder: string | null; accountEnding: string } | null;
  investor: { potId: string; name: string; linkedAt: string } | null;
  cars: DealerCar[]; payouts: DealerPayout[]; conversions: DealerConversion[]; totals: DealerTotals;
};
export type DealerListItem = { id: string; name: string; potId: string | null; investorName: string | null; cars: number };
export type DealerList = { dealers: DealerListItem[]; investors: { potId: string; name: string; linkedDealerId: string | null }[] };

export const dealerRequest = <T,>(action: string, data: Record<string, unknown> = {}) => investorRequest<T>(action, { ...DEALER_SCOPE, ...data });

export const DEALER_CAR_STATUS: Record<string, string> = {
  available: 'In stock', coming_soon: 'Coming soon', in_workshop: 'In workshop', ready: 'Ready', photo_complete: 'Photos done', submitted: 'Submitted',
  reserved: 'Reserved', deal_pending: 'Deal pending', sold: 'Sold', delivered: 'Delivered',
};
export const dealerCarStatus = (s: string) => DEALER_CAR_STATUS[s] ?? s.replace(/_/g, ' ');
export const termsLabel = (t: Record<string, unknown> | null) => {
  if (!t || !t.terms) return 'Terms not set';
  if (t.terms === 'fixed_amount') return 'Fixed amount';
  if (t.terms === 'profit_split') return `${Number(t.splitPercent ?? 0)}% profit split`;
  return String(t.terms).replace(/_/g, ' ');
};
