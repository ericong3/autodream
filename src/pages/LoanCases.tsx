import { useState } from 'react';
import { FileText, CheckCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { toast } from '../utils/toast';
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

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_COLORS[status] ?? 'bg-gray-500/15 text-gray-400 border-gray-500/30'}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export default function LoanCases() {
  const currentUser = useStore(s => s.currentUser)!;
  const users = useStore(s => s.users);
  const customers = useStore(s => s.customers);
  const loanCases = useStore(s => s.loanCases);
  const loanCaseDocuments = useStore(s => s.loanCaseDocuments);
  const loanCaseActivities = useStore(s => s.loanCaseActivities);
  const addLoanCaseActivity = useStore(s => s.addLoanCaseActivity);
  const updateLoanCase = useStore(s => s.updateLoanCase);

  const navigate = useNavigate();
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);

  const myCases = loanCases
    .filter(c => c.salesmanId === currentUser.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const selectedCase = loanCases.find(c => c.id === selectedCaseId) ?? null;

  async function handleWithdraw(caseId: string) {
    const lc = loanCases.find(c => c.id === caseId);
    if (!lc) return;
    await updateLoanCase(caseId, { status: 'withdrawn' });
    await addLoanCaseActivity({
      id: crypto.randomUUID(),
      caseId,
      userId: currentUser.id,
      userName: currentUser.name,
      userRole: currentUser.role,
      type: 'status_change',
      content: 'Case withdrawn by salesman',
      oldStatus: lc.status,
      newStatus: 'withdrawn',
      createdAt: new Date().toISOString(),
    });
    toast.info('Case withdrawn');
  }

  async function handleAppeal(caseId: string) {
    const lc = loanCases.find(c => c.id === caseId);
    if (!lc) return;
    await updateLoanCase(caseId, { status: 'appeal' });
    await addLoanCaseActivity({
      id: crypto.randomUUID(),
      caseId,
      userId: currentUser.id,
      userName: currentUser.name,
      userRole: currentUser.role,
      type: 'status_change',
      content: 'Salesman filed an appeal',
      oldStatus: lc.status,
      newStatus: 'appeal',
      createdAt: new Date().toISOString(),
    });
    toast.success('Appeal submitted');
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-display font-bold text-white">Loan Submissions</h1>
        <p className="text-xs text-gray-400 mt-0.5">{myCases.length} case{myCases.length !== 1 ? 's' : ''} · submit from a customer record</p>
      </div>

      {/* Cases List */}
      {myCases.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <FileText size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No cases submitted yet.</p>
          <p className="text-xs mt-1">Tap "New Case" to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {myCases.map(lc => {
            const banker = users.find(u => u.id === lc.bankerId);
            const customer = customers.find(c => c.id === lc.customerId);
            const canWithdraw = ['pending', 'under_review'].includes(lc.status);
            const canAppeal = ['rejected', 'need_more_info'].includes(lc.status);
            const canConfirmDeal = lc.status === 'approved';
            const docs = loanCaseDocuments.filter(d => d.caseId === lc.id);
            const lastActivity = loanCaseActivities
              .filter(a => a.caseId === lc.id)
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

            return (
              <div
                key={lc.id}
                className="card-glass rounded-2xl border border-obsidian-400/20 p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-white font-semibold text-sm">{customer?.name ?? 'Unknown customer'}</span>
                      <StatusBadge status={lc.status} />
                    </div>
                    <p className="text-xs text-gray-400">{lc.bank} · {banker?.name ?? 'Unknown banker'}</p>
                    <p className="text-xs text-gray-500">RM {lc.loanAmount.toLocaleString()} · {docs.length} doc{docs.length !== 1 ? 's' : ''}</p>
                  </div>
                  <span className="text-[10px] text-gray-500 shrink-0">
                    {new Date(lc.createdAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </div>

                {lastActivity && lastActivity.type !== 'status_change' && (
                  <div className="bg-obsidian-700/40 rounded-xl px-3 py-2">
                    <p className="text-[11px] text-gray-400 font-medium uppercase tracking-wide mb-0.5">
                      {lastActivity.type === 'instruction' ? 'Instruction' : 'Remark'}
                    </p>
                    <p className="text-xs text-gray-200 line-clamp-2">{lastActivity.content}</p>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedCaseId(lc.id)}
                    className="flex-1 py-1.5 rounded-xl border border-obsidian-400/40 text-gray-300 text-xs font-medium hover:border-gold-500/40 hover:text-gold-300 transition-colors"
                  >
                    View Details
                  </button>
                  {canAppeal && (
                    <button
                      onClick={() => handleAppeal(lc.id)}
                      className="px-3 py-1.5 rounded-xl bg-purple-500/15 border border-purple-500/30 text-purple-300 text-xs font-semibold"
                    >
                      Appeal
                    </button>
                  )}
                  {canWithdraw && (
                    <button
                      onClick={() => handleWithdraw(lc.id)}
                      className="px-3 py-1.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold"
                    >
                      Withdraw
                    </button>
                  )}
                </div>
                {canConfirmDeal && (
                  <button
                    onClick={() => navigate(`/customers?id=${lc.customerId}`)}
                    className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-green-500/15 border border-green-500/30 text-green-300 text-xs font-semibold hover:bg-green-500/20 transition-colors"
                  >
                    <CheckCircle size={12} />Confirm Deal — go to customer
                  </button>
                )}
              </div>
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
