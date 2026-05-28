import { useState, useMemo, useEffect } from 'react';
import { FileText } from 'lucide-react';
import { useStore } from '../store';
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
  pending:        'New Submission',
  under_review:   'Submitted',
  approved:       'Approved',
  rejected:       'Rejected',
  need_more_info: 'More Info Needed',
  appeal:         'Appeal',
  withdrawn:      'Withdrawn',
  cancelled:      'Cancelled',
};

const FILTER_TABS: { value: 'new' | 'submitted' | 'approved' | 'rejected' | 'appeal' | 'cancelled'; label: string }[] = [
  { value: 'new',       label: 'New Case' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'approved',  label: 'Approved' },
  { value: 'rejected',  label: 'Rejected' },
  { value: 'appeal',    label: 'Appeal' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function BankerDashboard() {
  const currentUser = useStore(s => s.currentUser)!;
  const users = useStore(s => s.users);
  const customers = useStore(s => s.customers);
  const cars = useStore(s => s.cars);
  const loanCases = useStore(s => s.loanCases);
  const loanCaseDocuments = useStore(s => s.loanCaseDocuments);
  const loanCaseActivities = useStore(s => s.loanCaseActivities);

  const VALID_FILTERS = ['new', 'submitted', 'approved', 'rejected', 'appeal', 'cancelled'] as const;
  const [filter, setFilter] = useState<typeof VALID_FILTERS[number]>(() => {
    const saved = localStorage.getItem('banker_filter');
    return (VALID_FILTERS as readonly string[]).includes(saved ?? '') ? saved as typeof VALID_FILTERS[number] : 'new';
  });
  useEffect(() => { localStorage.setItem('banker_filter', filter); }, [filter]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);

  const myCases = useMemo(() =>
    loanCases
      .filter(c => c.bankerId === currentUser.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [loanCases, currentUser.id]
  );

  const filteredCases = useMemo(() => myCases.filter(c => {
    if (filter === 'new')       return c.status === 'pending';
    if (filter === 'submitted') return c.status === 'under_review' || c.status === 'need_more_info';
    if (filter === 'approved')  return c.status === 'approved';
    if (filter === 'rejected')  return c.status === 'rejected';
    if (filter === 'appeal')    return c.status === 'appeal';
    if (filter === 'cancelled') return c.status === 'cancelled' || c.status === 'withdrawn';
    return false;
  }), [myCases, filter]);

  // Group filtered cases by customer — one card per customer
  const caseGroups = useMemo(() => {
    const seen = new Set<string>();
    const groups: typeof filteredCases[] = [];
    for (const lc of filteredCases) {
      if (!seen.has(lc.customerId)) {
        seen.add(lc.customerId);
        groups.push(filteredCases.filter(c => c.customerId === lc.customerId));
      }
    }
    return groups;
  }, [filteredCases]);

  // When a card is clicked, find all myCases for that customer (all banks) for the popup
  const selectedCase = loanCases.find(c => c.id === selectedCaseId) ?? null;
  const selectedGroupCases = selectedCase
    ? myCases.filter(c => c.customerId === selectedCase.customerId)
    : null;

  const newCaseCount = myCases.filter(c => c.status === 'pending').length;
  const appealCount  = myCases.filter(c => c.status === 'appeal').length;

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-display font-bold text-white">My Case Queue</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          {newCaseCount} new · {appealCount > 0 ? `${appealCount} appeal${appealCount !== 1 ? 's' : ''} · ` : ''}{myCases.length} total
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
            {tab.value === 'new' && newCaseCount > 0 && (
              <span className="ml-1.5 bg-obsidian-900/50 text-gold-300 px-1.5 py-0.5 rounded-full text-[10px]">
                {newCaseCount}
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
      {caseGroups.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <FileText size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No cases in this category.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {caseGroups.map(group => {
            const first = group[0];
            const salesman = users.find(u => u.id === first.salesmanId);
            const customer = customers.find(c => c.id === first.customerId);
            const car = cars.find(c => c.id === first.carId);
            // Aggregate docs across all cases in the group
            const allDocs = loanCaseDocuments.filter(d => group.some(lc => lc.id === d.caseId));
            // Latest activity across all cases in the group
            const lastActivity = loanCaseActivities
              .filter(a => group.some(lc => lc.id === a.caseId))
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
            const isNew = group.some(lc => lc.status === 'pending' || lc.status === 'appeal');

            return (
              <button
                key={first.customerId}
                onClick={() => setSelectedCaseId(first.id)}
                className="w-full text-left card-glass rounded-2xl border border-obsidian-400/20 p-4 space-y-2.5 hover:border-gold-500/20 active:scale-[0.99] transition-all"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {isNew && (
                        <span className="w-1.5 h-1.5 rounded-full bg-gold-400 shadow-[0_0_6px_rgba(234,184,32,0.7)] shrink-0" />
                      )}
                      <span className="text-white font-semibold text-sm truncate">{customer?.name ?? salesman?.name ?? 'Unknown'}</span>
                      {/* Bank badges, then status — shared if all same, paired if different */}
                      {(() => {
                        const allSameStatus = group.every(lc => lc.status === first.status);
                        if (allSameStatus) {
                          return (
                            <>
                              {group.map(lc => (
                                <span key={lc.id} className="text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-sky-500/15 text-sky-300 border-sky-500/30">
                                  {lc.bank}
                                </span>
                              ))}
                              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_COLORS[first.status] ?? ''}`}>
                                {STATUS_LABELS[first.status] ?? first.status}
                              </span>
                            </>
                          );
                        }
                        return group.map(lc => (
                          <span key={lc.id} className="flex items-center gap-1">
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-sky-500/15 text-sky-300 border-sky-500/30">
                              {lc.bank}
                            </span>
                            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_COLORS[lc.status] ?? ''}`}>
                              {STATUS_LABELS[lc.status] ?? lc.status}
                            </span>
                          </span>
                        ));
                      })()}
                    </div>
                    <p className="text-xs text-gray-400">RM {first.loanAmount.toLocaleString()} · {allDocs.length} doc{allDocs.length !== 1 ? 's' : ''}{car ? ` · ${car.year} ${car.make} ${car.model}` : ''}</p>
                    <p className="text-[11px] text-gray-500">via {salesman?.name ?? 'Unknown salesman'}</p>
                  </div>
                  <span className="text-[10px] text-gray-500 shrink-0">
                    {new Date(first.createdAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })}
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
                {allDocs.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {allDocs.slice(0, 4).map(doc => (
                      <div key={doc.id} className="flex items-center gap-1 bg-obsidian-700/40 rounded-lg px-2 py-1">
                        <FileText size={10} className="text-gold-400" />
                        <span className="text-[10px] text-gray-400 max-w-[80px] truncate">{doc.fileName}</span>
                      </div>
                    ))}
                    {allDocs.length > 4 && (
                      <span className="text-[10px] text-gray-500">+{allDocs.length - 4} more</span>
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
          groupCases={selectedGroupCases ?? undefined}
          onClose={() => setSelectedCaseId(null)}
        />
      )}
    </div>
  );
}
