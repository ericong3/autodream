// Banks whose bankers actually log into the app and work loan cases.
// Loan-case notifications (banker remarks, status changes, "banker is waiting"
// reminders, etc.) only make sense for these banks. Cases with any other bank
// stay in the app but send no notifications. Add a bank here once its banker
// starts using the app.
export const BANKS_WITH_BANKER_PORTAL = ['Aeon', 'Chailease', 'Toyota Capital'] as const;

const normalise = (bank: string) => bank.toLowerCase().replace(/[^a-z0-9]/g, '');

export function bankHasBankerPortal(bank: string | null | undefined): boolean {
  if (!bank) return false;
  const b = normalise(bank);
  return BANKS_WITH_BANKER_PORTAL.some(allowed => b.startsWith(normalise(allowed)));
}
