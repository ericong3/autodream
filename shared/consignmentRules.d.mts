export type IncomingConsignmentInput={terms:'fixed_amount'|'profit_split';capitalCents:number;netProfitCents:number;lenderCents?:number;dealerBasisPoints?:number;fixedAmountCents?:number};
export type IncomingConsignmentResult={terms:'fixed_amount'|'profit_split';dealerBasisPoints:number|null;capitalCents:number;fixedAmountCents:number|null;netProfitCents:number;lenderCents:number;dealerProfitCents:number;dealerLossCents:number;dealerGrossCents:number;dealerBalanceCents:number;dealerPayableCents:number;dealerOwesCompanyCents:number;companyResultCents:number};
export function settleIncomingConsignment(input:IncomingConsignmentInput):IncomingConsignmentResult;
export function consignmentBasisPoints(percent:number):number;
export function reviewConsignmentPayout(input:{recordedCents:number;calculatedCents:number|null;paidCents?:number}):{requiresReview:boolean;recordedCents:number;calculatedCents:number|null;remainingRecordedCents:number;overpaidCents:number|null};
