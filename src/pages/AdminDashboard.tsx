import { useState, useMemo, useRef } from 'react';
import { CreditCard, FileText, CheckCircle, Clock, ClipboardCheck, Fingerprint, Contact, Upload } from 'lucide-react';
import { useStore } from '../store';
import LoanCaseDetail from './LoanCaseDetail';
import { formatRM } from '../utils/format';
import { supabase } from '../lib/supabase';

const LOAN_STATUS_COLORS: Record<string, string> = {
  pending:        'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
  under_review:   'bg-blue-500/15 text-blue-300 border-blue-500/30',
  approved:       'bg-green-500/15 text-green-300 border-green-500/30',
  rejected:       'bg-red-500/15 text-red-300 border-red-500/30',
  need_more_info: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  appeal:         'bg-purple-500/15 text-purple-300 border-purple-500/30',
  withdrawn:      'bg-gray-500/15 text-gray-400 border-gray-500/30',
  cancelled:      'bg-gray-500/15 text-gray-400 border-gray-500/30',
};

const LOAN_STATUS_LABELS: Record<string, string> = {
  pending:        'New',
  under_review:   'Submitted',
  approved:       'Approved',
  rejected:       'Rejected',
  need_more_info: 'More Info',
  appeal:         'Appeal',
  withdrawn:      'Withdrawn',
  cancelled:      'Cancelled',
};

type TabType = 'loans' | 'payments' | 'intake';

export default function AdminDashboard() {
  const currentUser = useStore(s => s.currentUser)!;
  const cars = useStore(s => s.cars);
  const payments = useStore(s => s.payments);
  const updatePayment = useStore(s => s.updatePayment);
  const updateCar = useStore(s => s.updateCar);
  const users = useStore(s => s.users);
  const customers = useStore(s => s.customers);
  const loanCases = useStore(s => s.loanCases);
  const loanCaseDocuments = useStore(s => s.loanCaseDocuments);
  const loanCaseActivities = useStore(s => s.loanCaseActivities);

  const [tab, setTab] = useState<TabType>('loans');
  const [intakeFilter, setIntakeFilter] = useState<'pending' | 'done'>('pending');
  const greenCardInputRef = useRef<HTMLInputElement>(null);
  const [greenCardTargetId, setGreenCardTargetId] = useState<string | null>(null);
  const [uploadingGreenCardId, setUploadingGreenCardId] = useState<string | null>(null);
  const [selectedBank, setSelectedBank] = useState<string | null>(null);
  const [loanFilter, setLoanFilter] = useState<'new' | 'submitted' | 'approved' | 'rejected' | 'appeal' | 'cancelled'>('new');
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [paymentFilter, setPaymentFilter] = useState<'pending' | 'done'>('pending');
  const [markingId, setMarkingId] = useState<string | null>(null);

  const myBanks = currentUser.banks ?? [];
  const activeBank = selectedBank ?? myBanks[0] ?? null;

  // ── Loan submissions ──────────────────────────────────────────
  const allMyCases = useMemo(() =>
    loanCases
      .filter(c => myBanks.includes(c.bank))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [loanCases, myBanks]
  );

  const newCountByBank = useMemo(() => {
    const map: Record<string, number> = {};
    for (const bank of myBanks) {
      map[bank] = allMyCases.filter(c => c.bank === bank && c.status === 'pending').length;
    }
    return map;
  }, [allMyCases, myBanks]);

  const myCases = useMemo(() =>
    activeBank ? allMyCases.filter(c => c.bank === activeBank) : [],
    [allMyCases, activeBank]
  );

  const filteredLoanCases = useMemo(() => myCases.filter(c => {
    if (loanFilter === 'new')       return c.status === 'pending';
    if (loanFilter === 'submitted') return c.status === 'under_review' || c.status === 'need_more_info';
    if (loanFilter === 'approved')  return c.status === 'approved';
    if (loanFilter === 'rejected')  return c.status === 'rejected';
    if (loanFilter === 'appeal')    return c.status === 'appeal';
    if (loanFilter === 'cancelled') return c.status === 'cancelled' || c.status === 'withdrawn';
    return false;
  }), [myCases, loanFilter]);

  const caseGroups = useMemo(() => {
    const seen = new Set<string>();
    const groups: typeof filteredLoanCases[] = [];
    for (const lc of filteredLoanCases) {
      if (!seen.has(lc.customerId)) {
        seen.add(lc.customerId);
        groups.push(filteredLoanCases.filter(c => c.customerId === lc.customerId));
      }
    }
    return groups;
  }, [filteredLoanCases]);

  const selectedCase = loanCases.find(c => c.id === selectedCaseId) ?? null;
  const selectedGroupCases = selectedCase ? allMyCases.filter(c => c.customerId === selectedCase.customerId) : null;
  const newCaseCount = allMyCases.filter(c => c.status === 'pending').length;
  const appealCount  = myCases.filter(c => c.status === 'appeal').length;

  // ── Payments ──────────────────────────────────────────────────
  const repairPayments = useMemo(() =>
    payments
      .filter(p => p.type === 'repair' || p.type === 'misc_cost')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [payments]
  );

  const pendingPayments = repairPayments.filter(p => p.status === 'pending');
  const donePayments    = repairPayments.filter(p => p.status === 'transferred');

  const handleMarkPaid = async (id: string) => {
    setMarkingId(id);
    await updatePayment(id, { status: 'transferred', transferredAt: new Date().toISOString() });
    setMarkingId(null);
  };

  // ── Intake checklist (own stock only — consignment is the other party's responsibility;
  // delivered cars are already gone, no need to keep chasing their paperwork) ──
  const ownStockCars = useMemo(() =>
    cars
      .filter(c => !c.consignment && c.status !== 'delivered')
      .sort((a, b) => new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime()),
    [cars]
  );
  const intakePendingCars = ownStockCars.filter(c => !c.intakeComplete);
  const intakeDoneCars    = ownStockCars.filter(c => c.intakeComplete);
  const daysInStock = (dateAdded: string) => Math.floor((Date.now() - new Date(dateAdded).getTime()) / 86400000);

  const compressImage = (file: File, maxWidth = 900, quality = 0.78): Promise<Blob> =>
    new Promise((resolve) => {
      const img = document.createElement('img');
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => resolve(blob ?? file), 'image/jpeg', quality);
      };
      img.src = url;
    });

  const uploadGreenCard = async (file: File, carId: string) => {
    setUploadingGreenCardId(carId);
    try {
      const compressed = await compressImage(file);
      const path = `greencards/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
      const { error } = await supabase.storage.from('car-photos').upload(path, compressed, { contentType: 'image/jpeg' });
      if (error) throw new Error(error.message);
      const { data } = supabase.storage.from('car-photos').getPublicUrl(path);
      await updateCar(carId, { greenCard: data.publicUrl });
    } finally {
      setUploadingGreenCardId(null);
    }
  };

  const LOAN_FILTER_TABS = [
    { value: 'new' as const,       label: 'New' },
    { value: 'submitted' as const, label: 'Submitted' },
    { value: 'approved' as const,  label: 'Approved' },
    { value: 'rejected' as const,  label: 'Rejected' },
    { value: 'appeal' as const,    label: 'Appeal' },
    { value: 'cancelled' as const, label: 'Cancelled' },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-display font-bold text-white">Admin Dashboard</h1>
        {myBanks.length > 0 && (
          <p className="text-xs text-gray-400 mt-0.5">{myBanks.join(' · ')}</p>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-2 border-b border-obsidian-400/30 pb-0">
        {myBanks.length > 0 && (
          <button
            onClick={() => setTab('loans')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === 'loans' ? 'border-gold-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
          >
            <FileText size={14} />
            Loan Submissions
            {newCaseCount > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${tab === 'loans' ? 'bg-gold-500/20 text-gold-300' : 'bg-obsidian-600 text-gray-400'}`}>
                {newCaseCount}
              </span>
            )}
          </button>
        )}
        <button
          onClick={() => setTab('payments')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === 'payments' ? 'border-gold-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
        >
          <CreditCard size={14} />
          Payments
          {pendingPayments.length > 0 && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${tab === 'payments' ? 'bg-gold-500/20 text-gold-300' : 'bg-red-500/30 text-red-400'}`}>
              {pendingPayments.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('intake')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === 'intake' ? 'border-gold-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
        >
          <ClipboardCheck size={14} />
          Intake Checklist
          {intakePendingCars.length > 0 && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${tab === 'intake' ? 'bg-gold-500/20 text-gold-300' : 'bg-red-500/30 text-red-400'}`}>
              {intakePendingCars.length}
            </span>
          )}
        </button>
      </div>

      {/* ── Loan Submissions tab ── */}
      {tab === 'loans' && myBanks.length > 0 && (
        <div className="space-y-3">
          {myBanks.length === 1 ? (
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-widest text-gray-500">Bank</span>
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-sky-500/20 text-sky-300 border border-sky-500/30">
                {myBanks[0]}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
              {myBanks.map(bank => {
                const isActive = bank === activeBank;
                const count = newCountByBank[bank] ?? 0;
                return (
                  <button
                    key={bank}
                    onClick={() => { setSelectedBank(bank); setLoanFilter('new'); }}
                    className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                      isActive
                        ? 'bg-sky-500/20 border-sky-500/40 text-sky-300'
                        : 'bg-obsidian-700/60 border-obsidian-400/30 text-gray-400 hover:text-white'
                    }`}
                  >
                    {bank}
                    {count > 0 && (
                      <span className="bg-gold-500/30 text-gold-300 px-1.5 py-0.5 rounded-full text-[10px] font-bold">{count}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
            {LOAN_FILTER_TABS.map(t => (
              <button
                key={t.value}
                onClick={() => setLoanFilter(t.value)}
                className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                  loanFilter === t.value
                    ? 'bg-gold-gradient text-obsidian-950'
                    : 'bg-obsidian-700/60 text-gray-400 hover:text-white border border-obsidian-400/30'
                }`}
              >
                {t.label}
                {t.value === 'new' && (newCountByBank[activeBank ?? ''] ?? 0) > 0 && (
                  <span className="ml-1.5 bg-obsidian-900/50 text-gold-300 px-1.5 py-0.5 rounded-full text-[10px]">{newCountByBank[activeBank ?? ''] ?? 0}</span>
                )}
                {t.value === 'appeal' && appealCount > 0 && (
                  <span className="ml-1.5 bg-obsidian-900/50 text-purple-300 px-1.5 py-0.5 rounded-full text-[10px]">{appealCount}</span>
                )}
              </button>
            ))}
          </div>

          {caseGroups.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <FileText size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">No cases in this category.</p>
            </div>
          ) : caseGroups.map(group => {
            const first = group[0];
            const salesman = users.find(u => u.id === first.salesmanId);
            const customer = customers.find(c => c.id === first.customerId);
            const car = cars.find(c => c.id === first.carId);
            const allDocs = loanCaseDocuments.filter(d => group.some(lc => lc.id === d.caseId));
            const lastActivity = loanCaseActivities
              .filter(a => group.some(lc => lc.id === a.caseId))
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
            const isNew = group.some(lc => lc.status === 'pending' || lc.status === 'appeal');

            return (
              <button
                key={first.customerId}
                onClick={() => setSelectedCaseId(first.id)}
                className="w-full text-left bg-obsidian-800/60 border border-obsidian-400/20 rounded-2xl p-4 space-y-2.5 hover:border-gold-500/20 active:scale-[0.99] transition-all"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {isNew && <span className="w-1.5 h-1.5 rounded-full bg-gold-400 shadow-[0_0_6px_rgba(234,184,32,0.7)] shrink-0" />}
                      <span className="text-white font-semibold text-sm truncate">{customer?.name ?? 'Unknown'}</span>
                      {group.map(lc => (
                        <span key={lc.id} className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${LOAN_STATUS_COLORS[lc.status] ?? ''}`}>{LOAN_STATUS_LABELS[lc.status] ?? lc.status}</span>
                      ))}
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
                    <p className="text-[10px] text-gray-500 uppercase tracking-wide font-medium mb-0.5">Last Update</p>
                    <p className="text-xs text-gray-300 line-clamp-1">{lastActivity.content}</p>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Payments tab ── */}
      {tab === 'payments' && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <button
              onClick={() => setPaymentFilter('pending')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${paymentFilter === 'pending' ? 'bg-gold-gradient text-obsidian-950' : 'bg-obsidian-700/60 text-gray-400 border border-obsidian-400/30 hover:text-white'}`}
            >
              Pending {pendingPayments.length > 0 && `(${pendingPayments.length})`}
            </button>
            <button
              onClick={() => setPaymentFilter('done')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${paymentFilter === 'done' ? 'bg-gold-gradient text-obsidian-950' : 'bg-obsidian-700/60 text-gray-400 border border-obsidian-400/30 hover:text-white'}`}
            >
              Paid {donePayments.length > 0 && `(${donePayments.length})`}
            </button>
          </div>

          {(paymentFilter === 'pending' ? pendingPayments : donePayments).length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <CreditCard size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">{paymentFilter === 'pending' ? 'No pending payments.' : 'No paid payments yet.'}</p>
            </div>
          ) : (paymentFilter === 'pending' ? pendingPayments : donePayments).map(p => {
            const car = cars.find(c => c.id === p.carId);
            return (
              <div key={p.id} className="bg-obsidian-800/60 border border-obsidian-400/30 rounded-xl p-4 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${p.type === 'repair' ? 'bg-orange-500/20 text-orange-400' : 'bg-purple-500/20 text-purple-400'}`}>
                      {p.type === 'repair' ? 'Repair' : 'Misc'}
                    </span>
                    <span className="text-white text-sm font-medium truncate">{p.recipientName}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">{p.description}</p>
                  {car && <p className="text-[11px] text-gray-600 mt-0.5">{car.year} {car.make} {car.model}{car.carPlate ? ` · ${car.carPlate}` : ''}</p>}
                  {p.transferredAt && <p className="text-[11px] text-green-500 mt-0.5">Paid {new Date(p.transferredAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}</p>}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-white font-semibold text-sm">{formatRM(p.amount)}</span>
                  {paymentFilter === 'pending' && (
                    <button
                      onClick={() => handleMarkPaid(p.id)}
                      disabled={markingId === p.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 transition-colors disabled:opacity-50"
                    >
                      {markingId === p.id ? <Clock size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                      Mark Paid
                    </button>
                  )}
                  {paymentFilter === 'done' && <CheckCircle size={16} className="text-green-500" />}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Intake Checklist tab ── */}
      {tab === 'intake' && (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">Own stock only — physical green card + eAuto thumbprint from the previous owner, prepared at intake.</p>
          <div className="flex gap-2">
            <button
              onClick={() => setIntakeFilter('pending')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${intakeFilter === 'pending' ? 'bg-gold-gradient text-obsidian-950' : 'bg-obsidian-700/60 text-gray-400 border border-obsidian-400/30 hover:text-white'}`}
            >
              Pending {intakePendingCars.length > 0 && `(${intakePendingCars.length})`}
            </button>
            <button
              onClick={() => setIntakeFilter('done')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${intakeFilter === 'done' ? 'bg-gold-gradient text-obsidian-950' : 'bg-obsidian-700/60 text-gray-400 border border-obsidian-400/30 hover:text-white'}`}
            >
              Done {intakeDoneCars.length > 0 && `(${intakeDoneCars.length})`}
            </button>
          </div>

          {(intakeFilter === 'pending' ? intakePendingCars : intakeDoneCars).length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <ClipboardCheck size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">{intakeFilter === 'pending' ? 'Nothing outstanding — all own stock is squared away.' : 'No cars fully checked off yet.'}</p>
            </div>
          ) : (intakeFilter === 'pending' ? intakePendingCars : intakeDoneCars).map(c => {
            const readyToComplete = !!c.greenCard && !!c.thumbprintDone;
            return (
            <div key={c.id} className="bg-obsidian-800/60 border border-obsidian-400/30 rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-white text-sm font-medium truncate">{c.year} {c.make} {c.model}{c.carPlate ? ` · ${c.carPlate}` : ''}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">{daysInStock(c.dateAdded)}d in stock</p>
              </div>
              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                {c.greenCard ? (
                  <a
                    href={c.greenCard}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border bg-green-500/20 text-green-400 border-green-500/30"
                  >
                    <Contact size={12} /> Green Card
                  </a>
                ) : (
                  <button
                    onClick={() => { setGreenCardTargetId(c.id); greenCardInputRef.current?.click(); }}
                    disabled={uploadingGreenCardId === c.id}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border bg-obsidian-700/60 text-gray-400 border-obsidian-400/30 hover:text-white transition-colors disabled:opacity-50"
                  >
                    <Upload size={12} /> {uploadingGreenCardId === c.id ? 'Uploading…' : 'Upload Green Card'}
                  </button>
                )}
                <button
                  onClick={() => updateCar(c.id, { thumbprintDone: !c.thumbprintDone })}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${c.thumbprintDone ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-obsidian-700/60 text-gray-400 border-obsidian-400/30 hover:text-white'}`}
                >
                  <Fingerprint size={12} /> eAuto Thumbprint
                </button>
                {c.intakeComplete ? (
                  <button
                    onClick={() => updateCar(c.id, { intakeComplete: false })}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border bg-obsidian-700/60 text-gray-400 border-obsidian-400/30 hover:text-white transition-colors"
                  >
                    <CheckCircle size={12} /> Reopen
                  </button>
                ) : readyToComplete && (
                  <button
                    onClick={() => updateCar(c.id, { intakeComplete: true })}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border bg-gold-gradient text-obsidian-950 border-transparent"
                  >
                    <CheckCircle size={12} /> Complete
                  </button>
                )}
              </div>
            </div>
            );
          })}
          <input
            ref={greenCardInputRef}
            type="file"
            accept="image/*,.pdf"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              const carId = greenCardTargetId;
              e.target.value = '';
              if (!file || !carId) return;
              await uploadGreenCard(file, carId);
            }}
          />
        </div>
      )}

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
