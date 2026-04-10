import { useState, useMemo } from 'react';
import { ChevronRight, Car, Calendar, Phone } from 'lucide-react';
import { useStore } from '../store';
import { Customer } from '../types';
import { formatRM } from '../utils/format';

const PIPELINE_STAGES: { key: Customer['leadStatus']; label: string; color: string; bg: string; border: string }[] = [
  { key: 'contacted',      label: 'Contacted',      color: 'text-blue-400',   bg: 'bg-blue-500/10',   border: 'border-blue-500/30' },
  { key: 'test_drive',     label: 'Test Drive',     color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30' },
  { key: 'follow_up',      label: 'Follow Up',      color: 'text-gold-400',   bg: 'bg-gold-500/10',   border: 'border-gold-500/30' },
  { key: 'loan_submitted', label: 'Loan Submitted', color: 'text-green-400',  bg: 'bg-green-500/10',  border: 'border-green-500/30' },
];

const STAGE_ORDER: Customer['leadStatus'][] = ['contacted', 'test_drive', 'follow_up', 'loan_submitted'];

const LOAN_STATUS_BADGE: Record<string, string> = {
  submitted: 'bg-yellow-500/20 text-yellow-400',
  approved: 'bg-green-500/20 text-green-400',
  rejected: 'bg-red-500/20 text-red-400',
};

export default function SalesPipeline() {
  const customers = useStore((s) => s.customers);
  const cars = useStore((s) => s.cars);
  const users = useStore((s) => s.users);
  const currentUser = useStore((s) => s.currentUser);
  const updateCustomer = useStore((s) => s.updateCustomer);

  const isDirector = currentUser?.role === 'director';
  const [salesFilter, setSalesFilter] = useState<string>(isDirector ? 'all' : (currentUser?.id ?? ''));

  const visibleCustomers = useMemo(() =>
    customers.filter(c => salesFilter === 'all' || c.assignedSalesId === salesFilter),
    [customers, salesFilter]
  );

  const salespeople = users.filter(u => u.role === 'salesperson');

  const getCarName = (carId?: string) => {
    if (!carId) return null;
    const car = cars.find(c => c.id === carId);
    return car ? `${car.year} ${car.make} ${car.model}` : null;
  };

  const getFollowUpStatus = (date?: string) => {
    if (!date) return null;
    const today = new Date().toISOString().split('T')[0];
    if (date < today) return 'overdue';
    if (date === today) return 'today';
    return 'upcoming';
  };

  const advanceStage = (customer: Customer) => {
    const idx = STAGE_ORDER.indexOf(customer.leadStatus);
    if (idx < STAGE_ORDER.length - 1) {
      updateCustomer(customer.id, { leadStatus: STAGE_ORDER[idx + 1] });
    }
  };

  const activeCount = visibleCustomers.length;
  const inFollowUp = visibleCustomers.filter(c => c.leadStatus === 'follow_up').length;
  const inLoanSubmitted = visibleCustomers.filter(c => c.leadStatus === 'loan_submitted').length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-white text-xl font-bold">Sales Pipeline</h1>
          <p className="text-gray-500 text-sm mt-0.5">{activeCount} active leads</p>
        </div>
        {isDirector && (
          <select
            value={salesFilter}
            onChange={e => setSalesFilter(e.target.value)}
            className="input py-2"
          >
            <option value="all">All Salespeople</option>
            {salespeople.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total Leads',     value: activeCount,      color: 'text-gold-400' },
          { label: 'Follow Up',       value: inFollowUp,       color: 'text-gold-400' },
          { label: 'Loan Submitted',  value: inLoanSubmitted,  color: 'text-green-400' },
        ].map(s => (
          <div key={s.label} className="card-surface rounded-xl p-4 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-gray-500 text-xs mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Kanban Board */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {PIPELINE_STAGES.map(stage => {
          const stageCustomers = visibleCustomers.filter(c => c.leadStatus === stage.key);
          const canAdvance = stage.key !== 'follow_up' && stage.key !== 'loan_submitted';
          return (
            <div key={stage.key} className="flex-shrink-0 w-60">
              <div className={`flex items-center justify-between px-3 py-2 rounded-lg border mb-3 ${stage.bg} ${stage.border}`}>
                <span className={`text-sm font-semibold ${stage.color}`}>{stage.label}</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${stage.bg} ${stage.color} border ${stage.border}`}>
                  {stageCustomers.length}
                </span>
              </div>
              <div className="space-y-2">
                {stageCustomers.length === 0 ? (
                  <div className="border border-dashed border-obsidian-400/40 rounded-xl p-4 text-center text-obsidian-300/30 text-xs">
                    No leads
                  </div>
                ) : stageCustomers.map(c => {
                  const carName = getCarName(c.interestedCarId);
                  const fuStatus = getFollowUpStatus(c.followUpDate);
                  return (
                    <div key={c.id} className="bg-card-gradient border border-obsidian-400/70 rounded-xl p-3 space-y-2 hover:border-obsidian-300/60 hover:shadow-card transition-all">
                      <div>
                        <p className="text-white text-sm font-medium truncate">{c.name}</p>
                        <p className="text-gray-500 text-xs flex items-center gap-1 mt-0.5">
                          <Phone size={10} />{c.phone}
                        </p>
                      </div>
                      {carName && (
                        <p className="text-gold-400 text-xs flex items-center gap-1 truncate">
                          <Car size={10} />{carName}
                        </p>
                      )}
                      {c.dealPrice ? (
                        <p className="text-gray-400 text-xs font-medium">{formatRM(c.dealPrice)}</p>
                      ) : null}
                      {c.monthlySalary ? (
                        <p className="text-gray-600 text-xs">Salary: {formatRM(c.monthlySalary)}/mo</p>
                      ) : null}
                      {c.followUpDate && (
                        <p className={`text-xs flex items-center gap-1 ${
                          fuStatus === 'overdue' ? 'text-red-400' :
                          fuStatus === 'today' ? 'text-yellow-400' : 'text-gray-600'
                        }`}>
                          <Calendar size={10} />
                          {fuStatus === 'overdue' ? 'Overdue' :
                            fuStatus === 'today' ? 'Today' :
                            new Date(c.followUpDate).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })}
                        </p>
                      )}
                      {c.loanStatus && c.loanStatus !== 'not_started' && LOAN_STATUS_BADGE[c.loanStatus] && (
                        <span className={`text-xs px-1.5 py-0.5 rounded ${LOAN_STATUS_BADGE[c.loanStatus]}`}>
                          {c.loanStatus.charAt(0).toUpperCase() + c.loanStatus.slice(1)}{c.loanBankSubmitted ? ` · ${c.loanBankSubmitted}` : ''}
                        </span>
                      )}
                      {canAdvance && (
                        <button
                          onClick={() => advanceStage(c)}
                          className="w-full flex items-center justify-center gap-1 text-xs text-gray-600 hover:text-gold-400 hover:bg-gold-500/10 py-1 rounded-lg transition-colors border border-[#2C2415] hover:border-gold-500/30"
                        >
                          Advance <ChevronRight size={11} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

    </div>
  );
}
