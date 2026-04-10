import { useState, useMemo } from 'react';
import { Calculator, Info } from 'lucide-react';
import { formatRM } from '../utils/format';

const PRESET_RATES = [2.45, 2.8, 3.0, 3.5, 4.0];
const PRESET_TENURES = [5, 7, 9];

const BANK_RATES = [
  { bank: 'Maybank', rate: 2.8 },
  { bank: 'Public Bank', rate: 2.8 },
  { bank: 'CIMB', rate: 3.0 },
  { bank: 'HLB', rate: 3.0 },
  { bank: 'Aeon Credit', rate: 3.5 },
  { bank: 'Chailease', rate: 3.8 },
];

function inputCls() {
  return 'w-full bg-obsidian-700/60 border border-obsidian-400/60 text-white placeholder-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-gold-500 transition-colors';
}

export default function LoanCalculator() {
  const [carPrice, setCarPrice] = useState(50000);
  const [downPaymentPct, setDownPaymentPct] = useState(10);
  const [interestRate, setInterestRate] = useState(2.8);
  const [tenure, setTenure] = useState(9);

  const results = useMemo(() => {
    if (carPrice <= 0 || tenure <= 0 || interestRate <= 0) return null;
    const downPayment = (carPrice * downPaymentPct) / 100;
    const principal = carPrice - downPayment;
    if (principal <= 0) return null;
    // Malaysian flat rate hire purchase formula
    const totalInterest = principal * (interestRate / 100) * tenure;
    const totalPayable = principal + totalInterest;
    const monthly = totalPayable / (tenure * 12);
    return { downPayment, principal, totalInterest, totalPayable, monthly };
  }, [carPrice, downPaymentPct, interestRate, tenure]);

  const downPaymentRM = (carPrice * downPaymentPct) / 100;

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-white text-xl font-bold flex items-center gap-2">
          <Calculator size={22} className="text-gold-400" />
          Loan Calculator
        </h1>
        <p className="text-gray-500 text-sm mt-0.5">Malaysian hire purchase — flat rate method</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Inputs */}
        <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card p-5 space-y-5">
          <h2 className="text-white font-semibold text-sm">Loan Details</h2>

          <div>
            <label className="block text-gray-300 text-xs font-medium mb-1.5">Car Price (RM)</label>
            <input
              type="number"
              className={inputCls()}
              value={carPrice}
              onChange={e => setCarPrice(Number(e.target.value))}
              min={1000}
            />
          </div>

          <div>
            <label className="block text-gray-300 text-xs font-medium mb-2">
              Down Payment: <span className="text-gold-400">{downPaymentPct}%</span> = <span className="text-white">{formatRM(downPaymentRM)}</span>
            </label>
            <input
              type="range"
              min={0} max={50} step={5}
              value={downPaymentPct}
              onChange={e => setDownPaymentPct(Number(e.target.value))}
              className="w-full accent-cyan-400"
            />
            <div className="flex justify-between text-gray-600 text-xs mt-1">
              {[0, 10, 20, 30, 40, 50].map(v => <span key={v}>{v}%</span>)}
            </div>
          </div>

          <div>
            <label className="block text-gray-300 text-xs font-medium mb-1.5">Annual Interest Rate (%)</label>
            <input
              type="number"
              step={0.1}
              min={0.1}
              className={inputCls()}
              value={interestRate}
              onChange={e => setInterestRate(Number(e.target.value))}
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {PRESET_RATES.map(r => (
                <button
                  key={r}
                  onClick={() => setInterestRate(r)}
                  className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                    interestRate === r ? 'bg-gold-500 border-gold-500 text-white' : 'border-obsidian-400/60 text-gray-500 hover:text-white hover:border-[#3C321E]'
                  }`}
                >
                  {r}%
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-gray-300 text-xs font-medium mb-2">Loan Tenure</label>
            <div className="flex gap-2">
              {PRESET_TENURES.map(t => (
                <button
                  key={t}
                  onClick={() => setTenure(t)}
                  className={`flex-1 py-2.5 text-sm rounded-lg border font-medium transition-colors ${
                    tenure === t ? 'bg-gold-500 border-gold-500 text-white' : 'bg-obsidian-700/60 border-obsidian-400/60 text-gray-400 hover:text-white hover:border-[#3C321E]'
                  }`}
                >
                  {t} yrs
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="space-y-3">
          {results ? (
            <>
              <div className="bg-gold-500/10 border border-gold-500/30 rounded-xl p-5 text-center">
                <p className="text-gray-400 text-xs mb-1">Monthly Instalment</p>
                <p className="text-4xl font-bold text-gold-400">{formatRM(Math.round(results.monthly))}</p>
                <p className="text-gray-500 text-xs mt-1">per month · {tenure} years · {tenure * 12} payments</p>
              </div>

              <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card p-4 space-y-3">
                {[
                  { label: 'Car Price', value: formatRM(carPrice) },
                  { label: 'Down Payment', value: formatRM(Math.round(results.downPayment)), sub: `${downPaymentPct}%` },
                  { label: 'Loan Principal', value: formatRM(Math.round(results.principal)) },
                  { label: 'Total Interest', value: formatRM(Math.round(results.totalInterest)), color: 'text-orange-400' },
                  { label: 'Total Payable', value: formatRM(Math.round(results.totalPayable)), color: 'text-yellow-400', bold: true },
                ].map(row => (
                  <div key={row.label} className={`flex justify-between items-center ${row.bold ? 'border-t border-obsidian-400/60 pt-3 mt-1' : ''}`}>
                    <span className="text-gray-400 text-sm">{row.label}</span>
                    <div className="text-right">
                      <span className={`text-sm font-semibold ${row.color ?? 'text-white'}`}>{row.value}</span>
                      {row.sub && <span className="text-gray-600 text-xs ml-1">({row.sub})</span>}
                    </div>
                  </div>
                ))}
              </div>

              {/* Bank reference rates */}
              <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card p-4">
                <p className="text-gray-500 text-xs font-medium mb-3 flex items-center gap-1.5">
                  <Info size={12} />Typical Bank Rates (tap to apply)
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {BANK_RATES.map(b => {
                    const bMonthly = results
                      ? (results.principal + results.principal * (b.rate / 100) * tenure) / (tenure * 12)
                      : 0;
                    return (
                      <button
                        key={b.bank}
                        onClick={() => setInterestRate(b.rate)}
                        className={`text-left p-2.5 rounded-lg border transition-colors ${
                          interestRate === b.rate
                            ? 'border-gold-500/50 bg-gold-500/10'
                            : 'border-obsidian-400/60 hover:border-[#3C321E] bg-[#161410]'
                        }`}
                      >
                        <p className="text-white text-xs font-medium">{b.bank}</p>
                        <p className="text-gray-500 text-xs mt-0.5">{b.rate}% · {formatRM(Math.round(bMonthly))}/mo</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-48 text-gray-600 text-sm bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card">
              Enter valid loan details to see results
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
