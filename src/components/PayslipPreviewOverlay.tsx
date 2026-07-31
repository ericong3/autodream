import { createPortal } from 'react-dom';
import { Printer } from 'lucide-react';
import PayslipDocument from './PayslipDocument';
import { Payslip, User } from '../types';

// Portaled to document.body (not just a plain fixed div in-tree) because an
// ancestor page wrapper animates in with a transform, which would otherwise
// confine position:fixed children to that ancestor's box instead of the
// viewport. Print CSS hides everything except #payslip-print-area so only
// the payslip itself ends up on the printed page/PDF.
export default function PayslipPreviewOverlay({ payslip, employee, ytd, onClose }: {
  payslip: Payslip;
  employee: User;
  ytd: { grossPay: number; deductions: number; netPay: number };
  onClose: () => void;
}) {
  return createPortal(
    <>
      <div className="fixed inset-0 z-[600] bg-black/80 flex items-start justify-center overflow-y-auto py-8" onClick={onClose}>
        <div onClick={(e) => e.stopPropagation()} className="space-y-3">
          <div className="flex items-center justify-end gap-2 max-w-[850px] mx-auto no-print">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-500/20 border border-sky-500/40 text-sky-300 text-sm font-medium hover:bg-sky-500/30"
            >
              <Printer size={14} />Print / Save as PDF
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-obsidian-700 border border-obsidian-400/60 text-gray-300 text-sm hover:text-white"
            >
              Close
            </button>
          </div>
          <div id="payslip-print-area" className="rounded-xl overflow-hidden shadow-2xl">
            <PayslipDocument payslip={payslip} employee={employee} ytd={ytd} />
          </div>
        </div>
      </div>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #payslip-print-area, #payslip-print-area * { visibility: visible; }
          #payslip-print-area { position: absolute; top: 0; left: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>
    </>,
    document.body
  );
}
