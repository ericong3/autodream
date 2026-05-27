import { useState } from 'react';
import { FileText, CheckCircle, MessageSquare } from 'lucide-react';
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

// Card border accent — visual urgency at a glance
const CARD_ACCENT: Record<string, string> = {
  approved:       'border-green-500/60',
  need_more_info: 'border-orange-500/50',
  rejected:       'border-red-500/40',
  appeal:         'border-purple-500/30',
  under_review:   'border-blue-500/20',
  pending:        'border-obsidian-400/20',
  withdrawn:      'border-obsidian-400/10',
  cancelled:      'border-obsidian-400/10',
};

// Contextual guidance strip shown on the card
const STATUS_GUIDANCE: Record<string, { icon: string; text: string; cls: string }> = {
  approved:       { icon: '🎉', text: 'Approved! Tap below to confirm the deal with your customer.', cls: 'bg-green-500/10 border-green-500/20 text-green-300' },
  rejected:       { icon: '❌', text: 'Banker rejected this case. You can file an appeal if you disagree.', cls: 'bg-red-500/10 border-red-500/20 text-red-300' },
  need_more_info: { icon: '📋', text: 'Banker needs more information. Open the case to upload documents or write a reply.', cls: 'bg-orange-500/10 border-orange-500/20 text-orange-300' },
  appeal:         { icon: '🔁', text: 'Appeal submitted. Waiting for the banker to respond.', cls: 'bg-purple-500/10 border-purple-500/20 text-purple-300' },
  under_review:   { icon: '👀', text: 'Banker is reviewing your case. No action needed yet.', cls: 'bg-blue-500/10 border-blue-500/20 text-blue-300' },
  pending:        { icon: '⏳', text: 'Submitted. Waiting for banker to begin review.', cls: 'bg-yellow-500/10 border-yellow-500/20 text-yellow-300' },
};

// Sort: action-required cases float to top
const STATUS_SORT: Record<string, number> = {
  approved: 0, need_more_info: 1, rejected: 2,
  appeal: 3, under_review: 4, pending: 5,
  withdrawn: 6, cancelled: 7,
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
    .sort((a, b) => {
      const statusDiff = (STATUS_SORT[a.status] ?? 9) - (STATUS_SORT[b.status] ?? 9);
      if (statusDiff !== 0) return statusDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

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
            const docs = loanCaseDocuments.filter(d => d.caseId === lc.id);
            const lastBankerMessage = loanCaseActivities
              .filter(a => a.caseId === lc.id && (a.type === 'remark' || a.type === 'instruction') && a.userRole === 'banker')
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

            const canWithdraw = ['pending', 'under_review'].includes(lc.status);
            const canAppeal   = lc.status === 'rejected';
            const needsReply  = lc.status === 'need_more_info';
            const canConfirmDeal = lc.status === 'approved';
            const isTerminal  = ['withdrawn', 'cancelled'].includes(lc.status);

            const guidance = STATUS_GUIDANCE[lc.status];
            const cardBorder = CARD_ACCENT[lc.status] ?? 'border-obsidian-400/20';

            return (
              <div
                key={lc.id}
                className={`card-glass rounded-2xl border ${cardBorder} p-4 space-y-3`}
              >
                {/* Top row */}
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
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

                {/* Banker's latest message — highlighted when action is needed */}
                {lastBankerMessage && (
                  <div className={`rounded-xl px-3 py-2 border ${
                    needsReply
                      ? 'bg-orange-500/10 border-orange-500/20'
                      : 'bg-obsidian-700/40 border-transparent'
                  }`}>
                    <p className={`text-[11px] font-semibold uppercase tracking-wide mb-0.5 ${needsReply ? 'text-orange-400' : 'text-gray-400'}`}>
                      {lastBankerMessage.type === 'instruction' ? 'Banker Instruction' : 'Banker Remark'}
                    </p>
                    <p className="text-xs text-gray-200 line-clamp-3">{lastBankerMessage.content}</p>
                  </div>
                )}

                {/* Status guidance — what this means and what to do */}
                {guidance && !isTerminal && (
                  <div className={`rounded-xl px-3 py-2 border flex items-start gap-2 ${guidance.cls}`}>
                    <span className="text-sm shrink-0 mt-0.5">{guidance.icon}</span>
                    <p className="text-xs leading-relaxed">{guidance.text}</p>
                  </div>
                )}

                {/* Action buttons */}
                {needsReply ? (
                  <button
                    onClick={() => setSelectedCaseId(lc.id)}
                    className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-orange-500/15 border border-orange-500/30 text-orange-300 text-xs font-semibold hover:bg-orange-500/20 transition-colors touch-manipulation"
                  >
                    <MessageSquare size={12} />Open Case — Upload Docs / Reply
                  </button>
                ) : canConfirmDeal ? (
                  <div className="space-y-2">
                    <button
                      onClick={() => navigate(`/customers?id=${lc.customerId}`)}
                      className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-green-500/20 border border-green-500/40 text-green-300 text-sm font-bold hover:bg-green-500/25 transition-colors touch-manipulation"
                    >
                      <CheckCircle size={14} />Confirm Deal — Go to Customer
                    </button>
                    <button
                      onClick={() => setSelectedCaseId(lc.id)}
                      className="w-full py-1.5 rounded-xl border border-obsidian-400/30 text-gray-400 text-xs font-medium hover:text-gray-200 transition-colors touch-manipulation"
                    >
                      View Case Details
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedCaseId(lc.id)}
                      className="flex-1 py-1.5 rounded-xl border border-obsidian-400/40 text-gray-300 text-xs font-medium hover:border-gold-500/40 hover:text-gold-300 transition-colors touch-manipulation"
                    >
                      View Details
                    </button>
                    {canAppeal && (
                      <button
                        onClick={() => handleAppeal(lc.id)}
                        className="px-3 py-1.5 rounded-xl bg-purple-500/15 border border-purple-500/30 text-purple-300 text-xs font-semibold touch-manipulation"
                      >
                        Appeal
                      </button>
                    )}
                    {canWithdraw && (
                      <button
                        onClick={() => handleWithdraw(lc.id)}
                        className="px-3 py-1.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold touch-manipulation"
                      >
                        Withdraw
                      </button>
                    )}
                  </div>
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
