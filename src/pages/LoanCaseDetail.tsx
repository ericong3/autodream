import { useState, useEffect } from 'react';
import { X, FileText, Download, ChevronDown, Loader2, User, Car as CarIcon, CreditCard, Send } from 'lucide-react';
import { useStore } from '../store';
import { supabase } from '../lib/supabase';
import { LoanCase, LoanCaseStatus } from '../types';
import { toast } from '../utils/toast';
import { notifyUsers } from '../utils/notify';

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

const BANKER_STATUS_OPTIONS: { value: LoanCaseStatus; label: string }[] = [
  { value: 'pending',        label: 'New Submission' },
  { value: 'under_review',   label: 'Submitted to Bank' },
  { value: 'need_more_info', label: 'Need More Info' },
  { value: 'approved',       label: 'Approved' },
  { value: 'rejected',       label: 'Rejected' },
];

interface Props {
  loanCase: LoanCase;
  groupCases?: LoanCase[];
  onClose: () => void;
}

export default function LoanCaseDetail({ loanCase, groupCases, onClose }: Props) {
  const currentUser = useStore(s => s.currentUser)!;
  const users = useStore(s => s.users);
  const customers = useStore(s => s.customers);
  const cars = useStore(s => s.cars);
  const loanCaseDocuments = useStore(s => s.loanCaseDocuments);
  const loanCaseActivities = useStore(s => s.loanCaseActivities);
  const updateLoanCase = useStore(s => s.updateLoanCase);
  const addLoanCaseActivity = useStore(s => s.addLoanCaseActivity);

  // When opened from a grouped card: 'details' tab or a case ID
  const showTabs = (groupCases?.length ?? 0) > 0;
  const [activeTab, setActiveTab] = useState<'details' | string>(
    showTabs ? 'details' : loanCase.id
  );
  const activeCaseId = activeTab === 'details' ? loanCase.id : activeTab;
  const activeCase = groupCases?.find(c => c.id === activeCaseId) ?? loanCase;

  const isBanker   = currentUser.role === 'banker';
  const isSalesman = currentUser.role === 'salesperson';

  // Aggregate docs across all cases in the group (for Details tab)
  const allGroupCases = groupCases ?? [loanCase];
  const allGroupDocs = loanCaseDocuments.filter(d => allGroupCases.some(lc => lc.id === d.caseId));
  const allApplicantDocs = allGroupDocs.filter(d => d.type === 'applicant');
  const allGuarantorDocs = allGroupDocs.filter(d => d.type === 'guarantor');

  const activities = loanCaseActivities
    .filter(a => a.caseId === activeCase.id)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const salesman = users.find(u => u.id === activeCase.salesmanId);
  const banker = users.find(u => u.id === activeCase.bankerId);
  const customer = customers.find(c => c.id === activeCase.customerId);
  const car = cars.find(c => c.id === activeCase.carId);

  const [newStatus, setNewStatus] = useState<LoanCaseStatus>(activeCase.status as LoanCaseStatus);
  const [remark, setRemark] = useState('');
  const [instruction, setInstruction] = useState('');
  const [saving, setSaving] = useState(false);
  const [applicantInterviewOpen, setApplicantInterviewOpen] = useState(false);
  const [guarantorInterviewOpen, setGuarantorInterviewOpen] = useState(false);
  const [reply, setReply] = useState('');
  const [replySending, setReplySending] = useState(false);

  // Reset form state when switching tabs
  useEffect(() => {
    setNewStatus(activeCase.status as LoanCaseStatus);
    setRemark('');
    setInstruction('');
    setReply('');
    setApplicantInterviewOpen(false);
    setGuarantorInterviewOpen(false);
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  async function downloadDoc(filePath: string, fileName: string) {
    const { data, error } = await supabase.storage.from('loan-documents').createSignedUrl(filePath, 60);
    if (error || !data) { toast.error('Failed to get download link'); return; }
    const a = document.createElement('a');
    a.href = data.signedUrl;
    a.download = fileName;
    a.target = '_blank';
    a.click();
  }

  async function handleSave() {
    if (!isBanker) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const prevStatus = activeCase.status;

      // Status change
      if (newStatus !== prevStatus) {
        await updateLoanCase(activeCase.id, { status: newStatus });
        await addLoanCaseActivity({
          id: crypto.randomUUID(),
          caseId: activeCase.id,
          userId: currentUser.id,
          userName: currentUser.name,
          userRole: currentUser.role,
          type: 'status_change',
          content: `Status changed to ${STATUS_LABELS[newStatus]}`,
          oldStatus: prevStatus,
          newStatus,
          createdAt: now,
        });
      }

      // Remark
      if (remark.trim()) {
        await addLoanCaseActivity({
          id: crypto.randomUUID(),
          caseId: activeCase.id,
          userId: currentUser.id,
          userName: currentUser.name,
          userRole: currentUser.role,
          type: 'remark',
          content: remark.trim(),
          createdAt: now,
        });
        setRemark('');
      }

      // Instruction
      if (instruction.trim()) {
        await addLoanCaseActivity({
          id: crypto.randomUUID(),
          caseId: activeCase.id,
          userId: currentUser.id,
          userName: currentUser.name,
          userRole: currentUser.role,
          type: 'instruction',
          content: instruction.trim(),
          createdAt: now,
        });
        setInstruction('');
      }

      toast.success('Updated');
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to update');
    } finally {
      setSaving(false);
    }
  }

  async function handleReply() {
    if (!reply.trim()) return;
    setReplySending(true);
    try {
      await addLoanCaseActivity({
        id: crypto.randomUUID(),
        caseId: activeCase.id,
        userId: currentUser.id,
        userName: currentUser.name,
        userRole: currentUser.role,
        type: 'remark',
        content: reply.trim(),
        createdAt: new Date().toISOString(),
      });
      setReply('');
      notifyUsers(
        [activeCase.bankerId],
        `Reply from ${currentUser.name}`,
        reply.trim(),
        '/banker-dashboard',
      );
      toast.success('Reply sent');
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to send');
    } finally {
      setReplySending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[500] flex items-end md:items-center justify-center bg-black/70 backdrop-blur-sm"
      style={{ paddingTop: 'env(safe-area-inset-top, 44px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-gradient-to-b from-obsidian-800 to-obsidian-900 border border-obsidian-400/20 rounded-t-3xl md:rounded-2xl shadow-2xl flex flex-col"
        style={{ height: 'calc(100dvh - env(safe-area-inset-top, 44px) - env(safe-area-inset-bottom, 0px))' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-0 shrink-0">
          <div className="flex items-start justify-between gap-2 pb-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-white font-semibold">{customer?.name ?? salesman?.name}</h2>
                {activeTab !== 'details' && (
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_COLORS[activeCase.status] ?? ''}`}>
                    {STATUS_LABELS[activeCase.status] ?? activeCase.status}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                {car ? `${car.year} ${car.make} ${car.model}` : ''}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                RM {activeCase.loanAmount.toLocaleString()} · {salesman?.name} → {banker?.name}
              </p>
              <p className="text-[10px] text-gray-500 mt-0.5">
                {new Date(activeCase.createdAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
            <button onClick={onClose} className="p-2 rounded-full bg-obsidian-700/60 text-gray-400 hover:text-white shrink-0">
              <X size={16} />
            </button>
          </div>

          {/* Tab bar — Details + bank tabs, only when opened from grouped card */}
          {showTabs ? (
            <div className="flex items-center gap-0 border-t border-obsidian-400/20 -mx-5 px-5 overflow-x-auto">
              <button
                onClick={() => setActiveTab('details')}
                className={`shrink-0 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
                  activeTab === 'details'
                    ? 'border-gold-400 text-gold-300'
                    : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}
              >
                Details
              </button>
              {(groupCases ?? []).map(lc => (
                <button
                  key={lc.id}
                  onClick={() => setActiveTab(lc.id)}
                  className={`shrink-0 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
                    activeTab === lc.id
                      ? 'border-gold-400 text-gold-300'
                      : 'border-transparent text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {lc.bank}
                </button>
              ))}
            </div>
          ) : (
            <div className="border-t border-obsidian-400/20 -mx-5" />
          )}
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Details tab — customer, car, loan overview */}
          {activeTab === 'details' && (
            <>
              {/* Customer */}
              <section className="rounded-2xl border border-obsidian-400/30 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 bg-obsidian-700/40 border-b border-obsidian-400/20">
                  <div className="p-1 rounded-lg bg-obsidian-600/50">
                    <User size={13} className="text-gold-300" />
                  </div>
                  <span className="text-sm font-semibold text-white">Customer</span>
                </div>
                <div className="px-4 py-3 space-y-2.5">
                  {[
                    { label: 'Name',           value: customer?.name },
                    { label: 'IC',             value: customer?.ic },
                    { label: 'Phone',          value: customer?.phone },
                    { label: 'Email',          value: customer?.email },
                    { label: 'Employer',       value: customer?.employer },
                    { label: 'Monthly Salary', value: customer?.monthlySalary != null ? `RM ${customer.monthlySalary.toLocaleString()}` : undefined },
                  ].filter(r => r.value).map(r => (
                    <div key={r.label} className="flex items-start justify-between gap-3">
                      <span className="text-xs text-gray-500 shrink-0">{r.label}</span>
                      <span className="text-xs text-gray-200 text-right">{r.value}</span>
                    </div>
                  ))}
                </div>
              </section>

              {/* Applicant */}
              {(loanCase.applicantInterviewText || allApplicantDocs.length > 0) && (
                <section className="rounded-2xl border border-blue-500/40 overflow-hidden shadow-[0_0_0_1px_rgba(59,130,246,0.08)]">
                  <div className="flex items-center gap-2 px-4 py-3 bg-blue-500/10 border-b border-blue-500/20">
                    <div className="p-1 rounded-lg bg-blue-500/15">
                      <User size={13} className="text-blue-300" />
                    </div>
                    <span className="text-sm font-semibold text-white">Applicant</span>
                    <span className="ml-auto text-[11px] text-gray-500">{allApplicantDocs.length} doc{allApplicantDocs.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="divide-y divide-blue-500/15">
                    {loanCase.applicantInterviewText && (
                      <div>
                        <button
                          onClick={() => setApplicantInterviewOpen(o => !o)}
                          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-blue-500/5 transition-colors"
                        >
                          <span className="text-xs text-blue-300/80 font-medium">Interview Form</span>
                          <ChevronDown size={14} className={`text-blue-400/50 transition-transform ${applicantInterviewOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {applicantInterviewOpen && (
                          <pre className="text-xs text-gray-300 whitespace-pre-wrap font-sans leading-relaxed px-4 pb-4 max-h-52 overflow-y-auto">
                            {loanCase.applicantInterviewText}
                          </pre>
                        )}
                      </div>
                    )}
                    {allApplicantDocs.length > 0 && (
                      <div className="px-4 py-3 space-y-2">
                        {allApplicantDocs.map(doc => (
                          <button
                            key={doc.id}
                            onClick={() => downloadDoc(doc.filePath, doc.fileName)}
                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-obsidian-700/40 border border-obsidian-400/20 hover:border-gold-500/30 transition-colors text-left"
                          >
                            <FileText size={13} className="text-gold-400 shrink-0" />
                            <span className="text-xs text-gray-200 truncate flex-1">{doc.fileName}</span>
                            <Download size={12} className="text-gray-500 shrink-0" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* Guarantor */}
              {(loanCase.guarantorInterviewText || allGuarantorDocs.length > 0) && (
                <section className="rounded-2xl border border-purple-500/40 overflow-hidden shadow-[0_0_0_1px_rgba(168,85,247,0.08)]">
                  <div className="flex items-center gap-2 px-4 py-3 bg-purple-500/10 border-b border-purple-500/20">
                    <div className="p-1 rounded-lg bg-purple-500/15">
                      <User size={13} className="text-purple-300" />
                    </div>
                    <span className="text-sm font-semibold text-white">Guarantor</span>
                    <span className="ml-auto text-[11px] text-gray-500">{allGuarantorDocs.length} doc{allGuarantorDocs.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="divide-y divide-purple-500/15">
                    {loanCase.guarantorInterviewText && (
                      <div>
                        <button
                          onClick={() => setGuarantorInterviewOpen(o => !o)}
                          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-purple-500/5 transition-colors"
                        >
                          <span className="text-xs text-purple-300/80 font-medium">Interview Form</span>
                          <ChevronDown size={14} className={`text-purple-400/50 transition-transform ${guarantorInterviewOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {guarantorInterviewOpen && (
                          <pre className="text-xs text-gray-300 whitespace-pre-wrap font-sans leading-relaxed px-4 pb-4 max-h-52 overflow-y-auto">
                            {loanCase.guarantorInterviewText}
                          </pre>
                        )}
                      </div>
                    )}
                    {allGuarantorDocs.length > 0 && (
                      <div className="px-4 py-3 space-y-2">
                        {allGuarantorDocs.map(doc => (
                          <button
                            key={doc.id}
                            onClick={() => downloadDoc(doc.filePath, doc.fileName)}
                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-obsidian-700/40 border border-obsidian-400/20 hover:border-gold-500/30 transition-colors text-left"
                          >
                            <FileText size={13} className="text-gold-400 shrink-0" />
                            <span className="text-xs text-gray-200 truncate flex-1">{doc.fileName}</span>
                            <Download size={12} className="text-gray-500 shrink-0" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* Vehicle */}
              {car && (
                <section className="rounded-2xl border border-obsidian-400/30 overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-3 bg-obsidian-700/40 border-b border-obsidian-400/20">
                    <div className="p-1 rounded-lg bg-obsidian-600/50">
                      <CarIcon size={13} className="text-gold-300" />
                    </div>
                    <span className="text-sm font-semibold text-white">Vehicle</span>
                  </div>
                  <div className="px-4 py-3 space-y-2.5">
                    {[
                      { label: 'Car',           value: `${car.year} ${car.make} ${car.model}${car.variant ? ` ${car.variant}` : ''}` },
                      { label: 'Plate',         value: car.carPlate },
                      { label: 'Colour',        value: car.colour },
                      { label: 'Transmission',  value: car.transmission === 'auto' ? 'Automatic' : 'Manual' },
                      { label: 'Selling Price', value: `RM ${car.sellingPrice.toLocaleString()}` },
                    ].filter(r => r.value).map(r => (
                      <div key={r.label} className="flex items-start justify-between gap-3">
                        <span className="text-xs text-gray-500 shrink-0">{r.label}</span>
                        <span className="text-xs text-gray-200 text-right">{r.value}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Submission */}
              <section className="rounded-2xl border border-obsidian-400/30 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 bg-obsidian-700/40 border-b border-obsidian-400/20">
                  <div className="p-1 rounded-lg bg-obsidian-600/50">
                    <CreditCard size={13} className="text-gold-300" />
                  </div>
                  <span className="text-sm font-semibold text-white">Submission</span>
                </div>
                <div className="px-4 py-3 space-y-2.5">
                  {[
                    { label: 'Loan Amount',  value: `RM ${loanCase.loanAmount.toLocaleString()}` },
                    { label: 'Submitted by', value: salesman?.name },
                    { label: 'Date',         value: new Date(loanCase.createdAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' }) },
                  ].filter(r => r.value).map(r => (
                    <div key={r.label} className="flex items-start justify-between gap-3">
                      <span className="text-xs text-gray-500 shrink-0">{r.label}</span>
                      <span className="text-xs text-gray-200 text-right">{r.value}</span>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}

          {/* Bank tab — case status */}
          {activeTab !== 'details' && (
            <section className="rounded-2xl border border-obsidian-400/30 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 bg-obsidian-700/40 border-b border-obsidian-400/20">
                <span className="text-sm font-semibold text-white">Case Status</span>
                <span className={`ml-auto text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${STATUS_COLORS[activeCase.status] ?? ''}`}>
                  {STATUS_LABELS[activeCase.status] ?? activeCase.status}
                </span>
              </div>
              <div className="px-4 py-3">
                <p className="text-xs text-gray-500">
                  {activeCase.status === 'pending'        && 'Waiting for banker to review and submit to bank.'}
                  {activeCase.status === 'under_review'   && 'Submitted to bank. Awaiting bank decision.'}
                  {activeCase.status === 'need_more_info' && 'More information required from the salesman.'}
                  {activeCase.status === 'approved'       && 'Bank has approved this case.'}
                  {activeCase.status === 'rejected'       && 'Bank has rejected this case.'}
                  {activeCase.status === 'appeal'         && 'Salesman has filed an appeal.'}
                  {activeCase.status === 'withdrawn'      && 'This case has been withdrawn.'}
                  {activeCase.status === 'cancelled'      && 'This case has been cancelled.'}
                </p>
              </div>
            </section>
          )}

          {/* Activity Timeline */}
          {activeTab !== 'details' && activities.length > 0 && (
            <section className="space-y-2">
              <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Activity</p>
              <div className="space-y-2">
                {activities.map(act => {
                  const isBankerAct = act.userRole === 'banker';
                  const dotColor =
                    act.type === 'status_change' ? 'bg-gold-400' :
                    act.type === 'instruction'   ? 'bg-orange-400' :
                    isBankerAct                  ? 'bg-blue-400' : 'bg-emerald-400';
                  const labelColor =
                    act.type === 'status_change' ? 'text-gold-400' :
                    act.type === 'instruction'   ? 'text-orange-400' :
                    isBankerAct                  ? 'text-blue-400' : 'text-emerald-400';
                  const label =
                    act.type === 'status_change' ? 'Status' :
                    act.type === 'instruction'   ? 'Instruction' :
                    isBankerAct                  ? 'Remark' : 'Reply';
                  return (
                    <div key={act.id} className="flex gap-3">
                      <div className="flex flex-col items-center shrink-0">
                        <div className={`w-2 h-2 rounded-full mt-1.5 ${dotColor}`} />
                        <div className="w-px flex-1 bg-obsidian-400/20 mt-1" />
                      </div>
                      <div className="pb-3 flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[11px] font-medium text-white">{act.userName}</span>
                          <span className="text-[10px] text-gray-500">·</span>
                          <span className={`text-[10px] font-semibold uppercase tracking-wide ${labelColor}`}>
                            {label}
                          </span>
                          <span className="text-[10px] text-gray-500 ml-auto">
                            {new Date(act.createdAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        {act.content && (
                          <p className="text-xs text-gray-300 mt-0.5 leading-relaxed">{act.content}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Banker Actions */}
          {activeTab !== 'details' && isBanker && !['withdrawn', 'cancelled'].includes(activeCase.status) && (
            <section className="space-y-3 border-t border-obsidian-400/20 pt-4">
              <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Update Case</p>

              {/* Status */}
              <div className="space-y-1.5">
                <label className="text-xs text-gray-500">Status</label>
                <div className="relative">
                  <select
                    value={newStatus}
                    onChange={e => setNewStatus(e.target.value as LoanCaseStatus)}
                    className="w-full bg-obsidian-700 border border-obsidian-500/50 rounded-xl px-3 py-2.5 text-white text-sm appearance-none pr-8 focus:outline-none focus:border-gold-500/50"
                  >
                    {BANKER_STATUS_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>

              {/* Remark */}
              <div className="space-y-1.5">
                <label className="text-xs text-gray-500">Remarks (reason / decision)</label>
                <textarea
                  value={remark}
                  onChange={e => setRemark(e.target.value)}
                  placeholder="Enter remarks…"
                  rows={3}
                  className="w-full bg-obsidian-700 border border-obsidian-500/50 rounded-xl px-3 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-gold-500/50 resize-none"
                />
              </div>

              {/* Instruction */}
              <div className="space-y-1.5">
                <label className="text-xs text-gray-500">Instructions (request remaining documents)</label>
                <textarea
                  value={instruction}
                  onChange={e => setInstruction(e.target.value)}
                  placeholder="e.g. Please provide 3 months payslip…"
                  rows={3}
                  className="w-full bg-obsidian-700 border border-obsidian-500/50 rounded-xl px-3 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-gold-500/50 resize-none"
                />
              </div>

              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gold-gradient text-obsidian-950 font-bold text-sm disabled:opacity-50 active:opacity-80 transition-opacity shadow-gold-sm"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : null}
                {saving ? 'Saving…' : 'Save Update'}
              </button>
            </section>
          )}

          {/* Salesman reply */}
          {activeTab !== 'details' && isSalesman && !['withdrawn', 'cancelled'].includes(activeCase.status) && (
            <section className="space-y-3 border-t border-obsidian-400/20 pt-4">
              <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Reply to Banker</p>
              <textarea
                value={reply}
                onChange={e => setReply(e.target.value)}
                placeholder="Type your message…"
                rows={3}
                className="w-full bg-obsidian-700 border border-obsidian-500/50 rounded-xl px-3 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-gold-500/50 resize-none"
              />
              <button
                onClick={handleReply}
                disabled={replySending || !reply.trim()}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gold-gradient text-obsidian-950 font-bold text-sm disabled:opacity-50 active:opacity-80 transition-opacity shadow-gold-sm"
              >
                {replySending ? <Loader2 size={15} className="animate-spin" /> : <Send size={14} />}
                {replySending ? 'Sending…' : 'Send Reply'}
              </button>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
