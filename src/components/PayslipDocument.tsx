import { Phone, Globe, MapPin } from 'lucide-react';
import { Payslip, User } from '../types';
import { formatRM } from '../utils/format';
import { COMPANY_INFO } from '../utils/payslip';

const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-[13px]">
      <span className="text-gray-500 tracking-wide">{label}</span>
      <span className="text-gray-900 font-semibold text-right">{value}</span>
    </div>
  );
}

function LineItem({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex items-center justify-between py-1 text-[13px]">
      <span className="text-gray-700">{label}</span>
      <span className="text-gray-900 font-medium">{value == null ? '-' : value.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
    </div>
  );
}

export default function PayslipDocument({ payslip: p, employee, ytd }: {
  payslip: Payslip;
  employee: User;
  ytd: { grossPay: number; deductions: number; netPay: number };
}) {
  const totalEarnings = p.basicSalary + p.salesCommission + p.performanceBonus + p.allowance;
  const totalDeductions = p.epfEmployee + p.socsoEmployee + p.eisEmployee + p.pcbTax + p.otherDeduction;
  const netPay = totalEarnings - totalDeductions;
  const totalEmployerContrib = p.epfEmployer + p.socsoEmployer + p.eisEmployer;
  const gold = '#B8860B';
  const heading = { color: gold, fontFamily: "'Cinzel', serif" };

  return (
    <div className="bg-white text-gray-900 p-7 w-full max-w-[850px] mx-auto" style={{ fontFamily: "'Outfit', sans-serif" }}>
      {/* Header */}
      <div className="flex items-start justify-between pb-3 border-b" style={{ borderColor: '#e5d9c0' }}>
        <img src="/logo.png?v=3" alt="AutoDream" className="h-20 object-contain object-left" />
        <div className="text-right">
          <h1 className="text-3xl font-normal tracking-[0.15em] text-gray-800" style={{ fontFamily: "'Cinzel', serif" }}>PAYSLIP</h1>
          <div className="h-[2px] w-16 ml-auto mt-1.5" style={{ backgroundColor: gold }} />
        </div>
      </div>

      {/* Employee + pay info */}
      <div className="grid grid-cols-2 gap-8 py-3">
        <div className="space-y-1">
          <Row label="EMPLOYEE NAME" value={employee.name} />
          <Row label="EMPLOYEE ID" value={employee.employeeId ?? '-'} />
          <Row label="DESIGNATION" value={employee.position ?? '-'} />
          <Row label="DEPARTMENT" value={employee.department ?? '-'} />
          <Row label="JOINING DATE" value={employee.joiningDate ? fmtDate(employee.joiningDate) : '-'} />
        </div>
        <div className="space-y-1">
          <Row label="PAY PERIOD" value={`${fmtDate(p.payPeriodStart)} - ${fmtDate(p.payPeriodEnd)}`} />
          <Row label="PAY DATE" value={fmtDate(p.payDate)} />
          <Row label="PAYSLIP NO." value={p.payslipNo} />
          <Row label="PAYMENT METHOD" value={p.paymentMethod} />
        </div>
      </div>

      {/* Earnings / Deductions */}
      <div className="grid grid-cols-2 gap-8 py-3 border-t" style={{ borderColor: '#e5d9c0' }}>
        <div>
          <div className="flex items-center justify-between border-b pb-1.5 mb-1" style={{ borderColor: gold }}>
            <span className="text-xs font-bold tracking-wider" style={heading}>EARNINGS</span>
            <span className="text-[10px] text-gray-500 uppercase">Amount (RM)</span>
          </div>
          <LineItem label="Basic Salary" value={p.basicSalary} />
          <LineItem label="Sales Commission" value={p.salesCommission} />
          <LineItem label="Performance Bonus" value={p.performanceBonus} />
          <LineItem label="Allowance" value={p.allowance} />
          <div className="flex items-center justify-between pt-1.5 mt-1.5 border-t" style={{ borderColor: '#e5d9c0' }}>
            <span className="text-xs font-bold tracking-wide" style={heading}>TOTAL EARNINGS</span>
            <span className="font-bold text-gray-900">RM {totalEarnings.toLocaleString('en-MY', { minimumFractionDigits: 2 })}</span>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between border-b pb-1.5 mb-1" style={{ borderColor: gold }}>
            <span className="text-xs font-bold tracking-wider" style={heading}>DEDUCTIONS</span>
            <span className="text-[10px] text-gray-500 uppercase">Amount (RM)</span>
          </div>
          {p.onProbation ? (
            <p className="text-xs text-gray-500 italic py-1.5">On probation — EPF / SOCSO / EIS not yet declared.</p>
          ) : (
            <>
              <LineItem label="EPF (Employee)" value={p.epfEmployee} />
              <LineItem label="SOCSO" value={p.socsoEmployee} />
              <LineItem label="EIS" value={p.eisEmployee} />
            </>
          )}
          <LineItem label="PCB / Tax" value={p.pcbTax} />
          <LineItem label="Other Deduction" value={p.otherDeduction > 0 ? p.otherDeduction : null} />
          <div className="flex items-center justify-between pt-1.5 mt-1.5 border-t" style={{ borderColor: '#e5d9c0' }}>
            <span className="text-xs font-bold tracking-wide" style={heading}>TOTAL DEDUCTIONS</span>
            <span className="font-bold text-gray-900">RM {totalDeductions.toLocaleString('en-MY', { minimumFractionDigits: 2 })}</span>
          </div>
        </div>
      </div>

      {/* Net pay */}
      <div className="flex items-center justify-between rounded-lg border-2 px-6 py-2.5 my-2" style={{ borderColor: gold }}>
        <span className="text-sm font-bold tracking-wider" style={heading}>NET PAY</span>
        <span className="text-2xl font-bold text-gray-900">RM {formatRM(netPay).replace('RM', '').trim()}</span>
      </div>

      {/* YTD + Employer contribution */}
      <div className="grid grid-cols-2 gap-8 py-3 border-t" style={{ borderColor: '#e5d9c0' }}>
        <div>
          <p className="text-xs font-bold tracking-wider mb-1" style={heading}>YEAR TO DATE SUMMARY</p>
          <LineItem label="YTD Gross Pay" value={ytd.grossPay} />
          <LineItem label="YTD Deductions" value={ytd.deductions} />
          <LineItem label="YTD Net Pay" value={ytd.netPay} />
        </div>
        <div>
          <p className="text-xs font-bold tracking-wider mb-1" style={heading}>EMPLOYER CONTRIBUTION</p>
          <LineItem label="EPF (Employer)" value={p.onProbation ? null : p.epfEmployer} />
          <LineItem label="SOCSO (Employer)" value={p.onProbation ? null : p.socsoEmployer} />
          <LineItem label="EIS (Employer)" value={p.onProbation ? null : p.eisEmployer} />
          <div className="flex items-center justify-between pt-1.5 mt-1.5 border-t" style={{ borderColor: '#e5d9c0' }}>
            <span className="text-xs font-bold tracking-wide" style={heading}>TOTAL</span>
            <span className="font-bold text-gray-900">RM {(p.onProbation ? 0 : totalEmployerContrib).toLocaleString('en-MY', { minimumFractionDigits: 2 })}</span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-end justify-between pt-3 border-t" style={{ borderColor: '#e5d9c0' }}>
        <div>
          <p className="italic text-base" style={heading}>Thank you!</p>
          <p className="text-xs text-gray-500 mt-0.5">We appreciate your dedication and contribution to AutoDream.</p>
        </div>
        <div className="text-right">
          <div className="border-t border-gray-400 w-40 mb-1" />
          <p className="text-xs" style={heading}>Authorised By</p>
          <p className="text-sm font-semibold text-gray-800">AutoDream Used Car</p>
        </div>
      </div>

      <div className="flex items-center justify-center gap-6 flex-wrap pt-2.5 mt-2.5 border-t text-[11px] text-gray-500" style={{ borderColor: '#e5d9c0' }}>
        <span className="flex items-center gap-1.5"><MapPin size={12} style={{ color: gold }} />{COMPANY_INFO.address}</span>
        <span className="flex items-center gap-1.5"><Phone size={12} style={{ color: gold }} />{COMPANY_INFO.phone}</span>
        <span className="flex items-center gap-1.5"><Globe size={12} style={{ color: gold }} />{COMPANY_INFO.website}</span>
        <span>{COMPANY_INFO.social}</span>
      </div>
    </div>
  );
}
