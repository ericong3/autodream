import { useState } from 'react';
import { FileText } from 'lucide-react';
import { useStore } from '../store';
import { LoanCaseStatus } from '../types';
import LoanCaseDetail from './LoanCaseDetail';

const STATUS_COLORS: Record<string, string> = {
  pending:        'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
  under_review:   'bg-blue-500/15 text-blue-300 border-blue-500/30',
  approved:       'bg-green-500/15 text-green-300 border-green-500/30',
  rejected:       'bg-red-500/15 text-red-300 border-red-500/30',
  need_more_info: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  appeal:         'bg-purple-500/15 text-purple-300 border-purple-500/30',
  withdrawn:      'bg-gray-500/15 text-gray-400 border-gray-500/30',
  cancelled:      'bg-gray-500/15 text-gray-400 border-gray-500/30',
};

const STATUS_LABELS: Record<string, string> = {
  pending:        'Pending',
  under_review:   'Under Review',
  approved:       'Approved',
  rejected:       'Rejected',
  need_more_info: 'More Info Needed',
  appeal:         'Appeal',
  withdrawn:      'Withdrawn',
  cancelled:      'Cancelled',
};

const FILTER_TABS: { value: 'active' | 'all' | LoanCaseStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'appeal', label: 'Appeal' },
  { value: 'approved', label: 'Approved' },
  { value: 'all', label: 'All' },
];

export default function BankerDashboard() {
  const currentUser = useStore(s => s.currentUser)!;
  const users = useStore(s => s.users);
  const customers = useStore(s => s.customers);
  const cars = useStore(s => s.cars);
  const loanCases = useStore(s => s.loanCases);
  const loanCaseDocuments = useStore(s => s.loanCaseDocuments);
  const loanCaseActivities = useStore(s => s.loanCaseActivities);

  const [filter, setFilter] = useState<'active' | 'all' | LoanCaseStatus>('active');
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);

  const myCases = loanCases
    .filter(c => c.bankerId === currentUser.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const ACTIVE_STATUSES: LoanCaseStatus[] = ['pending', 'under_review', 'need_more_info'];
  const filteredCases = myCases.filter(c => {
    if (filter === 'active') return ACTIVE_STATUSES.includes(c.status as LoanCaseStatus);
    if (filter === 'all') return true;
    return c.status === filter;
  });

  const selectedCase = loanCases.find(c => c.id === selectedCaseId) ?? null;

  const pendingCount = myCases.filter(c => ACTIVE_STATUSES.includes(c.status as LoanCaseStatus)).length;
  const appealCount = myCases.filter(c => c.status === 'appeal').length;

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-display font-bold text-white">My Case Queue</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          {pendingCount} active · {appealCount > 0 ? `${appealCount} appeal${appealCount !== 1 ? 's' : ''} · ` : ''}{myCases.length} total
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
        {FILTER_TABS.map(tab => (
          <button
            key={tab.value}
            onClick={() => setFilter(tab.value)}
            className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
              filter === tab.value
                ? 'bg-gold-gradient text-obsidian-950'
                : 'bg-obsidian-700/60 text-gray-400 hover:text-white border border-obsidian-400/30'
            }`}
          >
            {tab.label}
            {tab.value === 'active' && pendingCount > 0 && (
              <span className="ml-1.5 bg-obsidian-900/50 text-gold-300 px-1.5 py-0.5 rounded-full text-[10px]">
                {pendingCount}
              </span>
            )}
            {tab.value === 'appeal' && appealCount > 0 && (
              <span className="ml-1.5 bg-obsidian-900/50 text-purple-300 px-1.5 py-0.5 rounded-full text-[10px]">
                {appealCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Cases */}
      {filteredCases.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <FileText size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No cases in this category.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredCases.map(lc => {
            const salesman = users.find(u => u.id === lc.salesmanId);
            const customer = customers.find(c => c.id === lc.customerId);
            const car = cars.find(c => c.id === lc.carId);
            const docs = loanCaseDocuments.filter(d => d.caseId === lc.id);
            const lastActivity = loanCaseActivities
              .filter(a => a.caseId === lc.id)
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
            const isNew = lc.status === 'pending' || lc.status === 'appeal';

            return (
              <button
                key={lc.id}
                onClick={() => setSelectedCaseId(lc.id)}
                className="w-full text-left card-glass rounded-2xl border border-obsidian-400/20 p-4 space-y-2.5 hover:border-gold-500/20 active:scale-[0.99] transition-all"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {isNew && (
                        <span className="w-1.5 h-1.5 rounded-full bg-gold-400 shadow-[0_0_6px_rgba(234,184,32,0.7)] shrink-0" />
                      )}
                      <span className="text-white font-semibold text-sm truncate">{customer?.name ?? salesman?.name ?? 'Unknown'}</span>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_COLORS[lc.status] ?? ''}`}>
                        {STATUS_LABELS[lc.status] ?? lc.status}
                      </span>
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-sky-500/15 text-sky-300 border-sky-500/30">
                        {lc.bank}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400">RM {lc.loanAmount.toLocaleString()} · {docs.length} doc{docs.length !== 1 ? 's' : ''}{car ? ` · ${car.year} ${car.make} ${car.model}` : ''}</p>
                    <p className="text-[11px] text-gray-500">via {salesman?.name ?? 'Unknown salesman'}</p>
                  </div>
                  <span className="text-[10px] text-gray-500 shrink-0">
                    {new Date(lc.createdAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })}
                  </span>
                </div>

                {lastActivity && (
                  <div className="bg-obsidian-700/30 rounded-xl px-3 py-2">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wide font-medium mb-0.5">
                      {lastActivity.type === 'instruction' ? 'Last Instruction' :
                       lastActivity.type === 'remark' ? 'Last Remark' : 'Last Update'}
                    </p>
                    <p className="text-xs text-gray-300 line-clamp-1">{lastActivity.content}</p>
                  </div>
                )}

                {/* Docs preview */}
                {docs.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {docs.slice(0, 4).map(doc => (
                      <div key={doc.id} className="flex items-center gap-1 bg-obsidian-700/40 rounded-lg px-2 py-1">
                        <FileText size={10} className="text-gold-400" />
                        <span className="text-[10px] text-gray-400 max-w-[80px] truncate">{doc.fileName}</span>
                      </div>
                    ))}
                    {docs.length > 4 && (
                      <span className="text-[10px] text-gray-500">+{docs.length - 4} more</span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Case Detail Modal */}
      {selectedCase && (
        <LoanCaseDetail
          loanCase={selectedCase}
          onClose={() => setSelectedCaseId(null)}
        />
      )}
    </div>
  );
}
