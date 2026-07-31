import { Payslip, User } from '../types';

// Approximate percentage-based Malaysian statutory calculations — EPF/SOCSO/EIS
// actually use banded lookup tables with specific cut-off amounts, not pure
// percentages, so these are a reasonable starting figure to review/adjust on
// the payslip form, not an authoritative number for government submission.
// Wage base = Basic Salary + Allowance only (excludes commission/bonus, which
// is the common treatment, though this varies by employer — adjust manually
// if yours differs).
export function calcEpfEmployee(wage: number): number {
  return Math.round(wage * 0.11 * 100) / 100;
}
export function calcEpfEmployer(wage: number): number {
  const rate = wage <= 5000 ? 0.13 : 0.12;
  return Math.round(wage * rate * 100) / 100;
}
export function calcSocsoEmployee(wage: number): number {
  return Math.round(Math.min(wage, 6000) * 0.005 * 100) / 100;
}
export function calcSocsoEmployer(wage: number): number {
  return Math.round(Math.min(wage, 6000) * 0.0175 * 100) / 100;
}
export function calcEisEmployee(wage: number): number {
  return Math.round(Math.min(wage, 6000) * 0.002 * 100) / 100;
}
export function calcEisEmployer(wage: number): number {
  return Math.round(Math.min(wage, 6000) * 0.002 * 100) / 100;
}

// PCB (Monthly Tax Deduction) — a rougher approximation than even the
// EPF/SOCSO/EIS estimates above: real PCB depends on marital status, number
// of children, zakat, and cumulative YTD income, none of which is tracked
// per staff member here. This assumes single/no-dependents and applies the
// resident individual progressive tax schedule to (annualized gross taxable
// pay − EPF relief − personal relief), then divides back to a monthly
// figure. Treat this purely as a starting number to review — PCB is the
// deduction most likely to need manual correction against an actual LHDN
// PCB calculation or payroll software output.
const RESIDENT_TAX_BRACKETS: { upTo: number; rate: number }[] = [
  { upTo: 5_000, rate: 0 },
  { upTo: 20_000, rate: 0.01 },
  { upTo: 35_000, rate: 0.03 },
  { upTo: 50_000, rate: 0.06 },
  { upTo: 70_000, rate: 0.11 },
  { upTo: 100_000, rate: 0.19 },
  { upTo: 400_000, rate: 0.25 },
  { upTo: 600_000, rate: 0.26 },
  { upTo: 2_000_000, rate: 0.28 },
  { upTo: Infinity, rate: 0.30 },
];

function annualTaxFromChargeableIncome(chargeable: number): number {
  let tax = 0;
  let lower = 0;
  for (const bracket of RESIDENT_TAX_BRACKETS) {
    if (chargeable <= lower) break;
    tax += (Math.min(chargeable, bracket.upTo) - lower) * bracket.rate;
    lower = bracket.upTo;
  }
  return tax;
}

// grossTaxable = basic + commission + bonus + allowance for the month (all
// cash pay is taxable, unlike EPF/SOCSO/EIS which commonly exclude commission).
export function calcPcbTax(grossTaxable: number, monthlyEpfEmployee: number): number {
  const annualGross = grossTaxable * 12;
  const annualEpfRelief = Math.min(monthlyEpfEmployee * 12, 4_000);
  const personalRelief = 9_000;
  const chargeable = Math.max(0, annualGross - annualEpfRelief - personalRelief);
  const annualTax = annualTaxFromChargeableIncome(chargeable);
  return Math.round((annualTax / 12) * 100) / 100;
}

// Mirrors the reference format: Employee ID "ADU-0007" + period "2026-05" ->
// Payslip No "ADU-2026-05-0007". Falls back to a plain concatenation if the
// employee ID isn't in the expected "PREFIX-0000" shape.
export function generatePayslipNo(employeeId: string, year: string, month: string): string {
  const parts = employeeId.split('-');
  if (parts.length === 2) return `${parts[0]}-${year}-${month}-${parts[1]}`;
  return `${employeeId}-${year}-${month}`;
}

// One payslip per person per month — "generating" is idempotent. If one
// already exists for this period, callers should show/reprint it rather
// than creating another; that's what actually caused the duplicate-row mess
// this replaced (repeated clicks each creating a brand new record).
export function findExistingPayslip(payslips: Payslip[], userId: string, month: string): Payslip | undefined {
  return payslips.find((p) => p.userId === userId && p.payPeriodStart.startsWith(month));
}

// Shared calc used by both the director's generation form (pre-fill, still
// editable there) and self-service generation (used as-is, no editing —
// self-declared deductions would let someone influence their own net pay).
// Never sets onProbation — that's an employer decision, not something
// self-service exposes.
export function computePayslipDraft(opts: {
  user: User;
  month: string; // 'YYYY-MM'
  salesCommission: number; // caller computes from cars/customers for this user+month
}): Pick<Payslip,
  'userId' | 'payPeriodStart' | 'payPeriodEnd' |
  'basicSalary' | 'salesCommission' | 'performanceBonus' | 'allowance' |
  'epfEmployee' | 'socsoEmployee' | 'eisEmployee' | 'pcbTax' | 'otherDeduction' |
  'epfEmployer' | 'socsoEmployer' | 'eisEmployer'
> {
  const { user, month, salesCommission } = opts;
  const isFullTime = user.employmentType === 'full_time';
  const basicSalary = isFullTime ? (user.basicSalary ?? 0) : 0;
  const allowance = isFullTime ? (user.allowance ?? 0) : 0;
  const boostActive = isFullTime && !!user.temporaryBoost && !!user.temporaryBoostUntil && month <= user.temporaryBoostUntil;
  const performanceBonus = isFullTime ? (user.salaryIncrement ?? 0) + (boostActive ? user.temporaryBoost! : 0) : 0;
  const wage = basicSalary + allowance;
  const grossTaxable = basicSalary + salesCommission + performanceBonus + allowance;
  const epfEmployee = calcEpfEmployee(wage);
  const [year, monthNum] = month.split('-');
  return {
    userId: user.id,
    payPeriodStart: `${month}-01`,
    payPeriodEnd: new Date(Number(year), Number(monthNum), 0).toISOString().slice(0, 10),
    basicSalary, salesCommission, performanceBonus, allowance,
    epfEmployee,
    socsoEmployee: calcSocsoEmployee(wage),
    eisEmployee: calcEisEmployee(wage),
    epfEmployer: calcEpfEmployer(wage),
    socsoEmployer: calcSocsoEmployer(wage),
    eisEmployer: calcEisEmployer(wage),
    pcbTax: calcPcbTax(grossTaxable, epfEmployee),
    otherDeduction: 0,
  };
}

// YTD for a payslip is frozen to periods up through that payslip's own
// month, not every payslip that happens to share the calendar year —
// reprinting an earlier month's payslip after later ones exist must still
// show that earlier month's YTD, not totals pulled forward from later months.
export function computeYtdForPayslip(payslips: Payslip[], userId: string, uptoPayPeriodStart: string) {
  const year = uptoPayPeriodStart.slice(0, 4);
  const relevant = payslips.filter(
    (p) => p.userId === userId && p.payPeriodStart.startsWith(year) && p.payPeriodStart <= uptoPayPeriodStart
  );
  const grossPay = relevant.reduce((s, p) => s + p.basicSalary + p.salesCommission + p.performanceBonus + p.allowance, 0);
  const deductions = relevant.reduce((s, p) => s + p.epfEmployee + p.socsoEmployee + p.eisEmployee + p.pcbTax + p.otherDeduction, 0);
  return { grossPay, deductions, netPay: grossPay - deductions };
}

export const COMPANY_INFO = {
  name: 'AutoDream',
  tagline: 'PREMIUM USED CARS',
  address: 'Green Heights Royal Richmond, 93250 Kuching, Sarawak.',
  phone: '014-399 6235',
  website: 'www.autodream.com.my',
  social: 'autodream.kch',
};
