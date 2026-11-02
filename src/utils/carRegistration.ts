export const RECON_COMMISSION_DEFAULT = 2000;

export function registrationCommission(isRecon: boolean, amount: number | undefined, canEdit: boolean): number | undefined {
  if (!isRecon) return undefined;
  if (!canEdit) return RECON_COMMISSION_DEFAULT;
  if (amount == null || !Number.isFinite(amount) || amount < 0 || amount > 100000 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001) {
    throw new Error('Enter a commission from RM0 to RM100,000 with at most 2 decimal places.');
  }
  return amount;
}
