import { useState } from 'react';
import { X, FileText, Download, ChevronDown, Loader2 } from 'lucide-react';
import { useStore } from '../store';
import { supabase } from '../lib/supabase';
import { LoanCase, LoanCaseStatus } from '../types';
import { toast } from '../utils/toast';

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

const BANKER_STATUS_OPTIONS: { value: LoanCaseStatus; label: string }[] = [
  { value: 'under_review',   label: 'Under Review' },
  { value: 'approved',       label: 'Approved' },
  { value: 'rejected',       label: 'Rejected' },
  { value: 'need_more_info', label: 'Need More Info' },
];

interface Props {
  loanCase: LoanCase;
  onClose: () => void;
}

export default function LoanCaseDetail({ loanCase, onClose }: Props) {
  const currentUser = useStore(s => s.currentUser)!;
  const users = useStore(s => s.users);
  const customers = useStore(s => s.customers);
  const cars = useStore(s => s.cars);
  const loanCaseDocuments = useStore(s => s.loanCaseDocuments);
  const loanCaseActivities = useStore(s => s.loanCaseActivities);
  const updateLoanCase = useStore(s => s.updateLoanCase);
  const addLoanCaseActivity = useStore(s => s.addLoanCaseActivity);

  const isBanker = currentUser.role === 'banker';

  const docs = loanCaseDocuments.filter(d => d.caseId === loanCase.id);
  const applicantDocs = docs.filter(d => d.type === 'applicant');
  const guarantorDocs = docs.filter(d => d.type === 'guarantor');
  const activities = loanCaseActivities
    .filter(a => a.caseId === loanCase.id)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const salesman = users.find(u => u.id === loanCase.salesmanId);
  const banker = users.find(u => u.id === loanCase.bankerId);
  const customer = customers.find(c => c.id === loanCase.customerId);
  const car = cars.find(c => c.id === loanCase.carId);

  const [newStatus, setNewStatus] = useState<LoanCaseStatus>(loanCase.status as LoanCaseStatus);
  const [remark, setRemark] = useState('');
  const [instruction, setInstruction] = useState('');
  const [saving, setSaving] = useState(false);

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
      const prevStatus = loanCase.status;

      // Status change
      if (newStatus !== prevStatus) {
        await updateLoanCase(loanCase.id, { status: newStatus });
        await addLoanCaseActivity({
          id: crypto.randomUUID(),
          caseId: loanCase.id,
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
          caseId: loanCase.id,
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
          caseId: loanCase.id,
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/70 backdrop-blur-sm"
      style={{ paddingTop: 'env(safe-area-inset-top, 44px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-gradient-to-b from-obsidian-800 to-obsidian-900 border border-obsidian-400/20 rounded-t-3xl md:rounded-2xl shadow-2xl flex flex-col"
        style={{ maxHeight: 'calc(100dvh - env(safe-area-inset-top, 44px) - env(safe-area-inset-bottom, 0px))' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-obsidian-400/20 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-white font-semibold">{loanCase.bank}</h2>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_COLORS[loanCase.status] ?? ''}`}>
                {STATUS_LABELS[loanCase.status] ?? loanCase.status}
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              {customer?.name ?? salesman?.name}{car ? ` · ${car.year} ${car.make} ${car.model}` : ''}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              RM {loanCase.loanAmount.toLocaleString()} · {salesman?.name} → {banker?.name}
            </p>
            <p className="text-[10px] text-gray-500 mt-0.5">
              {new Date(loanCase.createdAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full bg-obsidian-700/60 text-gray-400 hover:text-white">
            <X size={16} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Documents */}
          {(applicantDocs.length > 0 || guarantorDocs.length > 0) && (
            <section className="space-y-2">
              <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Documents</p>
              {applicantDocs.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-gray-500">Applicant</p>
                  {applicantDocs.map(doc => (
                    <button
                      key={doc.id}
                      onClick={() => downloadDoc(doc.filePath, doc.fileName)}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-obsidian-700/40 border border-obsidian-400/20 hover:border-gold-500/30 transition-colors text-left"
                    >
                      <FileText size={14} className="text-gold-400 shrink-0" />
                      <span className="text-xs text-gray-200 truncate flex-1">{doc.fileName}</span>
                      <Download size={12} className="text-gray-500 shrink-0" />
                    </button>
                  ))}
                </div>
              )}
              {guarantorDocs.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-gray-500 mt-2">Guarantor</p>
                  {guarantorDocs.map(doc => (
                    <button
                      key={doc.id}
                      onClick={() => downloadDoc(doc.filePath, doc.fileName)}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-obsidian-700/40 border border-obsidian-400/20 hover:border-gold-500/30 transition-colors text-left"
                    >
                      <FileText size={14} className="text-gold-400 shrink-0" />
                      <span className="text-xs text-gray-200 truncate flex-1">{doc.fileName}</span>
                      <Download size={12} className="text-gray-500 shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Interview Forms */}
          {loanCase.applicantInterviewText && (
            <section className="space-y-2">
              <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Applicant Interview</p>
              <pre className="text-xs text-gray-300 whitespace-pre-wrap bg-obsidian-700/30 rounded-xl px-3 py-3 border border-obsidian-400/20 font-sans leading-relaxed max-h-48 overflow-y-auto">
                {loanCase.applicantInterviewText}
              </pre>
            </section>
          )}
          {loanCase.guarantorInterviewText && (
            <section className="space-y-2">
              <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Guarantor Interview</p>
              <pre className="text-xs text-gray-300 whitespace-pre-wrap bg-obsidian-700/30 rounded-xl px-3 py-3 border border-obsidian-400/20 font-sans leading-relaxed max-h-48 overflow-y-auto">
                {loanCase.guarantorInterviewText}
              </pre>
            </section>
          )}

          {/* Activity Timeline */}
          {activities.length > 0 && (
            <section className="space-y-2">
              <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Activity</p>
              <div className="space-y-2">
                {activities.map(act => (
                  <div key={act.id} className="flex gap-3">
                    <div className="flex flex-col items-center shrink-0">
                      <div className={`w-2 h-2 rounded-full mt-1.5 ${
                        act.type === 'status_change' ? 'bg-gold-400' :
                        act.type === 'instruction' ? 'bg-orange-400' : 'bg-blue-400'
                      }`} />
                      <div className="w-px flex-1 bg-obsidian-400/20 mt-1" />
                    </div>
                    <div className="pb-3 flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] font-medium text-white">{act.userName}</span>
                        <span className="text-[10px] text-gray-500">·</span>
                        <span className={`text-[10px] font-semibold uppercase tracking-wide ${
                          act.type === 'status_change' ? 'text-gold-400' :
                          act.type === 'instruction' ? 'text-orange-400' : 'text-blue-400'
                        }`}>
                          {act.type === 'status_change' ? 'Status' : act.type === 'instruction' ? 'Instruction' : 'Remark'}
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
                ))}
              </div>
            </section>
          )}

          {/* Banker Actions */}
          {isBanker && !['withdrawn', 'cancelled', 'approved'].includes(loanCase.status) && (
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
        </div>
      </div>
    </div>
  );
}
