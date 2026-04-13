import React, { useState, useMemo, useRef } from 'react';
import { Plus, Users, MessageCircle, AlertCircle, Edit2, Trash2, ChevronRight, Car, Phone, User, ArrowRight, Banknote, CalendarCheck, X, Mail, Briefcase, CheckCircle, XCircle, Camera, FileText, ClipboardList } from 'lucide-react';
import { useStore } from '../store';
import { Customer, LoanApplication, TradeIn } from '../types';
import Modal from '../components/Modal';
import { generateId, formatRM } from '../utils/format';

const LEAD_STATUS_LABELS: Record<Customer['leadStatus'], string> = {
  contacted: 'Contacted',
  test_drive: 'Test Drive',
  follow_up: 'Follow Up',
  loan_submitted: 'Loan Submitted',
};

const SOURCE_LABELS: Record<Customer['source'], string> = {
  walk_in: 'Walk-in',
  referral: 'Referral',
  online: 'Online',
  repeat: 'Repeat',
  fb_marketplace: 'FB Marketplace',
  mudah: 'Mudah',
  fb_page: 'FB Page',
};

function inputCls(error?: string) {
  return `input ${error ? '!border-red-500/50' : ''}`;
}

function FormField({ label, children, error, className }: { label: string; children: React.ReactNode; error?: string; className?: string }) {
  return (
    <div className={className}>
      <label className="block text-gray-300 text-xs font-medium mb-1.5">{label}</label>
      {children}
      {error && <p className="text-red-400 text-xs mt-1 flex items-center gap-1"><AlertCircle size={12} />{error}</p>}
    </div>
  );
}

const LEAD_STAGES: Array<Customer['leadStatus'] | 'all'> = ['all', 'contacted', 'test_drive', 'follow_up'];

const LOAN_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  not_started: { label: 'Pending',  color: 'text-gray-400' },
  submitted:   { label: 'Submitted', color: 'text-yellow-400' },
  approved:    { label: 'Approved',  color: 'text-green-400' },
  rejected:    { label: 'Rejected',  color: 'text-red-400' },
};
const STAGE_ORDER: Customer['leadStatus'][] = ['contacted', 'test_drive', 'follow_up', 'loan_submitted'];

const STAGE_COLORS: Record<Customer['leadStatus'], { dot: string; text: string; line: string }> = {
  contacted:     { dot: 'bg-blue-400',   text: 'text-blue-400',   line: 'bg-blue-400' },
  test_drive:    { dot: 'bg-yellow-400', text: 'text-yellow-400', line: 'bg-yellow-400' },
  follow_up:     { dot: 'bg-gold-400',   text: 'text-gold-400',   line: 'bg-gold-400' },
  loan_submitted:{ dot: 'bg-green-400',  text: 'text-green-400',  line: 'bg-green-400' },
};

const BANKS = ['Maybank', 'Public Bank', 'CIMB', 'HLB', 'Aeon Credit', 'Chailease', 'Toyota Capital'];

const emptyForm = {
  name: '', ic: '', phone: '', email: '', employer: '', monthlySalary: 0,
  source: 'walk_in' as Customer['source'],
  leadStatus: 'contacted' as Customer['leadStatus'],
  interestedCarId: '', assignedSalesId: '', notes: '', followUpDate: '',
  followUpRemark: '',
  dealPrice: 0, loanStatus: 'not_started' as Customer['loanStatus'], loanBankSubmitted: '',
};

export default function Customers() {
  const customers = useStore((s) => s.customers);
  const cars = useStore((s) => s.cars);
  const users = useStore((s) => s.users);
  const currentUser = useStore((s) => s.currentUser);
  const addCustomer = useStore((s) => s.addCustomer);
  const updateCustomer = useStore((s) => s.updateCustomer);
  const deleteCustomer = useStore((s) => s.deleteCustomer);
  const addTestDrive = useStore((s) => s.addTestDrive);
  const testDrives = useStore((s) => s.testDrives);

  const isDirector = currentUser?.role === 'director';

  const todayStr = new Date().toISOString().slice(0, 10);

  // Tab
  const [tab, setTab] = useState<'leads' | 'loan'>('leads');

  // Director view toggle: 'all' | 'own' | salesperson userId
  const [directorView, setDirectorView] = useState<'all' | 'own' | string>('all');

  // Filters
  const [statusFilter, setStatusFilter] = useState<Customer['leadStatus'] | 'all'>('all');
  const [sourceFilter, setSourceFilter] = useState<Customer['source'] | 'all'>('all');
  const [search, setSearch] = useState('');

  // Add/Edit modal
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<Customer | null>(null);
  const [form, setForm] = useState({ ...emptyForm, assignedSalesId: currentUser?.id ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Test drive scheduling modal
  const [showTdModal, setShowTdModal] = useState(false);
  const [tdCustomer, setTdCustomer] = useState<Customer | null>(null);
  const [tdForm, setTdForm] = useState({ carId: '', date: '', time: '', notes: '' });

  // Next-step modal (for test_drive leads)
  const [sidebarLead, setSidebarLead] = useState<Customer | null>(null);
  const [sidebarView, setSidebarView] = useState<'options' | 'car_select' | 'loan' | 'cash'>('options');
  const [sidebarCashFlow, setSidebarCashFlow] = useState(false);
  const [loanForm, setLoanForm] = useState({ banks: [] as string[], dealPrice: '', notes: '', carId: '' });
  const [cashForm, setCashForm] = useState({ dealPrice: '', notes: '' });

  // Loan status management modal (for loan_submitted leads)

  // Bank status management modal
  const [bankModal, setBankModal] = useState<Customer | null>(null);
  const [bankStatuses, setBankStatuses] = useState<LoanApplication[]>([]);
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});

  // Final deal wizard
  type FinalDealStep = 1 | 2 | 3;
  const [finalDealModal, setFinalDealModal] = useState<Customer | null>(null);
  const [finalDealStep, setFinalDealStep] = useState<FinalDealStep>(1);
  const emptyTradeIn: TradeIn = {
    make: '', model: '', year: new Date().getFullYear(), carPlate: '', colour: '',
    mileage: 0, condition: 'good', outstandingLoan: 0, offeredValue: 0, damages: '', photos: [],
  };
  const [finalDealForm, setFinalDealForm] = useState({
    approvedBank: '', dealPrice: '', hasTradeIn: false, tradeIn: { ...emptyTradeIn },
  });
  const tradeInPhotoRef = useRef<HTMLInputElement>(null);

  // Detail drawer
  const [detailLead, setDetailLead] = useState<Customer | null>(null);

  const myCustomers = useMemo(() =>
    customers
      .filter(c => {
        if (!isDirector) return c.assignedSalesId === currentUser?.id;
        if (directorView === 'all') return true;
        if (directorView === 'own') return c.assignedSalesId === currentUser?.id;
        return c.assignedSalesId === directorView;
      })
      .map(c => STAGE_ORDER.includes(c.leadStatus) ? c : { ...c, leadStatus: 'contacted' as Customer['leadStatus'] }),
    [customers, isDirector, currentUser, directorView]
  );

  const todayTestDrives = useMemo(() =>
    testDrives.filter(td =>
      td.scheduledAt.startsWith(todayStr) &&
      td.status === 'scheduled' &&
      (isDirector || td.salesId === currentUser?.id)
    ), [testDrives, todayStr, isDirector, currentUser]);

  const leadsFiltered = useMemo(() => myCustomers.filter(c => {
    if (c.leadStatus === 'loan_submitted') return false;
    const matchStatus = statusFilter === 'all' || c.leadStatus === statusFilter;
    const matchSource = sourceFilter === 'all' || c.source === sourceFilter;
    const matchSearch = !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search);
    return matchStatus && matchSource && matchSearch;
  }), [myCustomers, statusFilter, sourceFilter, search]);

  const loanFiltered = useMemo(() => myCustomers.filter(c => {
    if (c.leadStatus !== 'loan_submitted') return false;
    const matchSource = sourceFilter === 'all' || c.source === sourceFilter;
    const matchSearch = !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search);
    return matchSource && matchSearch;
  }), [myCustomers, sourceFilter, search]);

  const salespeople = users.filter(u => u.role === 'salesperson' || u.role === 'director');
  const getSalesName = (salesId: string) => users.find(u => u.id === salesId)?.name ?? salesId;
  const getCar = (id?: string) => cars.find(c => c.id === id);

  const statusCounts = useMemo(() => {
    const leads = myCustomers.filter(c => c.leadStatus !== 'loan_submitted');
    const counts: Partial<Record<Customer['leadStatus'] | 'all', number>> = { all: leads.length };
    leads.forEach(c => { counts[c.leadStatus] = (counts[c.leadStatus] ?? 0) + 1; });
    return counts;
  }, [myCustomers]);

  // ── Add/Edit ──────────────────────────────────────────────
  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Required';
    if (!form.phone.trim()) e.phone = 'Required';
    if (!form.assignedSalesId) e.assignedSalesId = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    const payload = { ...form, followUpRemark: form.followUpRemark || undefined };
    if (editTarget) {
      updateCustomer(editTarget.id, payload);
    } else {
      addCustomer({ id: generateId(), ...payload, createdAt: new Date().toISOString() });
    }
    setShowModal(false);
    setEditTarget(null);
    setForm({ ...emptyForm, assignedSalesId: currentUser?.id ?? '' });
    setErrors({});
  };

  const openEdit = (c: Customer) => {
    setEditTarget(c);
    setForm({
      name: c.name, ic: c.ic ?? '', phone: c.phone, email: c.email ?? '',
      employer: c.employer ?? '', monthlySalary: c.monthlySalary ?? 0,
      source: c.source, leadStatus: c.leadStatus, interestedCarId: c.interestedCarId ?? '',
      assignedSalesId: c.assignedSalesId, notes: c.notes ?? '', followUpDate: c.followUpDate ?? '',
      followUpRemark: c.followUpRemark ?? '',
      dealPrice: c.dealPrice ?? 0, loanStatus: c.loanStatus ?? 'not_started', loanBankSubmitted: c.loanBankSubmitted ?? '',
    });
    setErrors({});
    setShowModal(true);
  };

  const openAdd = () => {
    setEditTarget(null);
    setForm({ ...emptyForm, assignedSalesId: currentUser?.id ?? '' });
    setErrors({});
    setShowModal(true);
  };

  // ── WhatsApp ──────────────────────────────────────────────
  const handleWhatsApp = (phone: string, name: string) => {
    let clean = phone.replace(/[\s\-()+]/g, '');
    if (clean.startsWith('0')) clean = '6' + clean;
    const msg = encodeURIComponent(`Hi ${name}, this is ${currentUser?.name} from AutoDream. Just reaching out to follow up with you!`);
    window.open(`https://wa.me/${clean}?text=${msg}`, '_blank');
  };

  // ── Test Drive scheduling ─────────────────────────────────
  const openTdSchedule = (c: Customer) => {
    setTdCustomer(c);
    setTdForm({ carId: c.interestedCarId ?? '', date: '', time: '', notes: '' });
    setShowTdModal(true);
  };

  const handleSaveTd = () => {
    if (!tdCustomer || !tdForm.date || !tdForm.time) return;
    const scheduledAt = `${tdForm.date}T${tdForm.time}`;
    addTestDrive({
      id: generateId(),
      customerId: tdCustomer.id,
      carId: tdForm.carId,
      scheduledAt,
      status: 'scheduled',
      notes: tdForm.notes || undefined,
      salesId: tdCustomer.assignedSalesId || (currentUser?.id ?? ''),
      createdAt: new Date().toISOString(),
    });
    updateCustomer(tdCustomer.id, { leadStatus: 'test_drive' });
    setShowTdModal(false);
    setTdCustomer(null);
  };

  // ── Next-step sidebar ─────────────────────────────────────
  const openSidebar = (c: Customer) => {
    setSidebarLead(c);
    setSidebarView('options');
    setSidebarCashFlow(false);
    const interestedCar = cars.find(car => car.id === c.interestedCarId);
    setLoanForm({ banks: [], dealPrice: String(interestedCar?.sellingPrice ?? ''), notes: '', carId: c.interestedCarId ?? '' });
    setCashForm({ dealPrice: String(interestedCar?.sellingPrice ?? ''), notes: '' });
  };

  const closeSidebar = () => {
    setSidebarLead(null);
    setSidebarView('options');
    setSidebarCashFlow(false);
  };

  const handleFollowUp = () => {
    if (!sidebarLead) return;
    updateCustomer(sidebarLead.id, { leadStatus: 'follow_up' });
    closeSidebar();
  };

  const handleProceedLoan = () => {
    if (!sidebarLead) return;
    const newApplications: LoanApplication[] = loanForm.banks.map(b => ({ bank: b, status: 'submitted' }));
    updateCustomer(sidebarLead.id, {
      leadStatus: 'loan_submitted',
      loanStatus: 'submitted',
      loanBankSubmitted: loanForm.banks.join(', '),
      loanApplications: newApplications,
      interestedCarId: loanForm.carId || sidebarLead.interestedCarId,
      dealPrice: loanForm.dealPrice ? Number(loanForm.dealPrice) : sidebarLead.dealPrice,
      notes: loanForm.notes
        ? (sidebarLead.notes ? sidebarLead.notes + '\n' + loanForm.notes : loanForm.notes)
        : sidebarLead.notes,
    });
    closeSidebar();
  };

  const handleCashDeal = () => {
    if (!sidebarLead) return;
    const dealPrice = Number(cashForm.dealPrice);
    const car = getCar(loanForm.carId || sidebarLead.interestedCarId);
    const hasDiscount = car ? dealPrice < car.sellingPrice : false;
    updateCustomer(sidebarLead.id, {
      leadStatus: 'loan_submitted',
      loanStatus: 'approved',
      loanBankSubmitted: 'Cash',
      loanApplications: [{ bank: 'Cash', status: 'approved' }],
      interestedCarId: loanForm.carId || sidebarLead.interestedCarId,
      dealPrice,
      notes: cashForm.notes
        ? (sidebarLead.notes ? sidebarLead.notes + '\n' + cashForm.notes : cashForm.notes)
        : sidebarLead.notes,
    });
    if (car) {
      const updateCar = useStore.getState().updateCar;
      updateCar(car.id, {
        status: 'deal_pending',
        finalDeal: {
          submittedBy: currentUser?.name ?? '',
          submittedAt: new Date().toISOString(),
          dealPrice,
          bank: 'Cash',
          approvalStatus: hasDiscount ? 'pending' : 'approved',
          approvedBy: hasDiscount ? undefined : currentUser?.name,
          approvedAt: hasDiscount ? undefined : new Date().toISOString(),
        },
      });
    }
    closeSidebar();
  };

  // ── Bank status modal ─────────────────────────────────────
  const openBankModal = (c: Customer) => {
    const apps = c.loanApplications?.length
      ? c.loanApplications
      : (c.loanBankSubmitted ?? '').split(',').filter(Boolean).map(b => ({ bank: b.trim(), status: 'submitted' as const }));
    setBankStatuses(apps);
    setRejectReason({});
    setBankModal(c);
  };

  const handleSaveBankStatuses = () => {
    if (!bankModal) return;
    const anyApproved = bankStatuses.some(a => a.status === 'approved');
    const allResolved = bankStatuses.every(a => a.status !== 'submitted');
    const overallStatus: Customer['loanStatus'] = anyApproved ? 'approved' : allResolved ? 'rejected' : 'submitted';
    updateCustomer(bankModal.id, { loanApplications: bankStatuses, loanStatus: overallStatus });
    setBankModal(null);
  };

  const toggleBankStatus = (bank: string, newStatus: 'approved' | 'rejected') => {
    setBankStatuses(prev => prev.map(a => {
      if (a.bank !== bank) return a;
      if (a.status === newStatus) return { ...a, status: 'submitted' }; // toggle off
      return { ...a, status: newStatus, rejectionReason: newStatus === 'rejected' ? (rejectReason[bank] ?? '') : undefined };
    }));
  };

  // ── Final deal wizard ─────────────────────────────────────
  const openFinalDeal = (c: Customer) => {
    const approvedBank = c.loanApplications?.find(a => a.status === 'approved')?.bank ?? '';
    const car = getCar(c.interestedCarId);
    setFinalDealForm({
      approvedBank,
      dealPrice: String(c.dealPrice ?? car?.sellingPrice ?? ''),
      hasTradeIn: !!c.tradeIn,
      tradeIn: c.tradeIn ? { ...c.tradeIn } : { ...emptyTradeIn },
    });
    setFinalDealStep(1);
    setFinalDealModal(c);
  };

  const handleTradeInPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = ev => {
        const url = ev.target?.result as string;
        setFinalDealForm(prev => ({
          ...prev,
          tradeIn: { ...prev.tradeIn, photos: [...prev.tradeIn.photos, url].slice(0, 5) },
        }));
      };
      reader.readAsDataURL(file);
    });
    if (e.target) e.target.value = '';
  };

  const handleFinalDealSubmit = () => {
    if (!finalDealModal) return;
    const car = getCar(finalDealModal.interestedCarId);
    const dealPrice = Number(finalDealForm.dealPrice);
    const hasDiscount = car ? dealPrice < car.sellingPrice : false;

    // Update customer trade-in and finalize
    updateCustomer(finalDealModal.id, {
      tradeIn: finalDealForm.hasTradeIn ? finalDealForm.tradeIn : undefined,
      dealPrice,
      loanStatus: 'approved',
    });

    // Push final deal to car
    if (car) {
      const updateCar = useStore.getState().updateCar;
      updateCar(car.id, {
        status: 'deal_pending',
        finalDeal: {
          submittedBy: currentUser?.name ?? '',
          submittedAt: new Date().toISOString(),
          dealPrice,
          bank: finalDealForm.approvedBank,
          approvalStatus: hasDiscount ? 'pending' : 'approved',
          approvedBy: hasDiscount ? undefined : currentUser?.name,
          approvedAt: hasDiscount ? undefined : new Date().toISOString(),
        },
      });
    }

    setFinalDealModal(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card p-1">
          <button
            onClick={() => { setTab('leads'); setStatusFilter('all'); }}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'leads' ? 'bg-gold-500 text-white shadow' : 'text-gray-400 hover:text-white'}`}
          >
            Leads <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${tab === 'leads' ? 'bg-white/20' : 'bg-[#2C2415]'}`}>{myCustomers.filter(c => c.leadStatus !== 'loan_submitted').length}</span>
          </button>
          <button
            onClick={() => { setTab('loan'); setStatusFilter('all'); }}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'loan' ? 'bg-green-500 text-white shadow' : 'text-gray-400 hover:text-white'}`}
          >
            Loan <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${tab === 'loan' ? 'bg-white/20' : 'bg-[#2C2415]'}`}>{myCustomers.filter(c => c.leadStatus === 'loan_submitted').length}</span>
          </button>
        </div>
        {tab === 'leads' && (
          <button onClick={openAdd} className="flex items-center gap-2 btn-gold px-4 py-2.5 rounded-lg text-sm">
            <Plus size={16} />New Lead
          </button>
        )}
      </div>

      {/* Director view toggle */}
      {isDirector && (
        <div className="flex gap-2 items-center">
          {(['all', 'own', 'salesman'] as const).map(opt => (
            <button
              key={opt}
              onClick={() => {
                if (opt === 'salesman') {
                  // default to first salesperson if none selected yet
                  const firstSales = salespeople.find(u => u.role === 'salesperson');
                  if (!['all', 'own'].includes(directorView)) return; // already on a salesman
                  if (firstSales) setDirectorView(firstSales.id);
                } else {
                  setDirectorView(opt);
                }
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                (opt === 'all' && directorView === 'all') ||
                (opt === 'own' && directorView === 'own') ||
                (opt === 'salesman' && !['all', 'own'].includes(directorView))
                  ? 'bg-gold-500/15 border-gold-500/50 text-gold-400'
                  : 'bg-[#0F0E0C] border-obsidian-400/50 text-gray-500 hover:text-gray-300 hover:border-obsidian-400'
              }`}
            >
              {opt === 'all' ? 'All Leads' : opt === 'own' ? 'My Leads' : 'Salesman\'s Lead'}
            </button>
          ))}

          {/* Salesman dropdown — shown when "Salesman's Lead" is active */}
          {!['all', 'own'].includes(directorView) && (
            <select
              value={directorView}
              onChange={e => setDirectorView(e.target.value)}
              className="input text-xs py-1.5 px-3 rounded-lg border-gold-500/40 text-gold-400 bg-gold-500/10"
            >
              {salespeople.filter(u => u.role === 'salesperson').map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Today's Agenda Banner */}
      {todayTestDrives.length > 0 && (
        <div className="flex items-center gap-3 bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-4 py-3">
          <div className="w-8 h-8 rounded-lg bg-yellow-500/20 flex items-center justify-center shrink-0">
            <Car size={16} className="text-yellow-400" />
          </div>
          <div>
            <p className="text-yellow-400 text-sm font-semibold">{todayTestDrives.length} Test Drive{todayTestDrives.length > 1 ? 's' : ''} Today</p>
            <p className="text-yellow-400/60 text-xs">scheduled for today</p>
          </div>
        </div>
      )}

      {tab === 'leads' && (<>
        {/* Status filter cards */}
        <div className="grid grid-cols-4 gap-2">
          {LEAD_STAGES.map(s => {
            const count = statusCounts[s] ?? 0;
            const isActive = statusFilter === s;
            const label = s === 'all' ? 'All' : LEAD_STATUS_LABELS[s as Customer['leadStatus']];
            const color = s === 'all'
              ? { text: 'text-white', border: 'border-gold-500', bg: 'bg-gold-500/10', dot: '' }
              : ({
                  contacted:     { text: 'text-blue-400',   border: 'border-blue-500/60',   bg: 'bg-blue-500/10',   dot: 'bg-blue-400' },
                  test_drive:    { text: 'text-yellow-400', border: 'border-yellow-500/60', bg: 'bg-yellow-500/10', dot: 'bg-yellow-400' },
                  follow_up:     { text: 'text-gold-400',   border: 'border-gold-500/60',   bg: 'bg-gold-500/10',   dot: 'bg-gold-400' },
                  loan_submitted:{ text: 'text-green-400',  border: 'border-green-500/60',  bg: 'bg-green-500/10',  dot: 'bg-green-400' },
                } as Record<string, { text: string; border: string; bg: string; dot: string }>)[s] ?? { text: 'text-gray-400', border: 'border-gray-500/60', bg: 'bg-gray-500/10', dot: 'bg-gray-400' };
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-xl p-3 text-left border transition-all ${isActive ? `${color.bg} ${color.border}` : 'bg-[#0F0E0C] border-obsidian-400/60 hover:border-[#3C321E]'}`}
              >
                <p className={`text-xl font-bold ${isActive ? color.text : 'text-white'}`}>{count}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  {s !== 'all' && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? (color as any).dot : 'bg-gray-600'}`} />}
                  <p className={`text-xs truncate ${isActive ? color.text : 'text-gray-500'}`}>{label}</p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Search + source filter */}
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Search by name or phone..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 input rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-gold-500 transition-colors"
          />
          <select
            value={sourceFilter}
            onChange={e => setSourceFilter(e.target.value as Customer['source'] | 'all')}
            className="input rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-gold-500 transition-colors"
          >
            <option value="all">All Sources</option>
            <option value="walk_in">Walk-in</option>
            <option value="referral">Referral</option>
            <option value="fb_marketplace">FB Marketplace</option>
            <option value="fb_page">FB Page</option>
            <option value="mudah">Mudah</option>
            <option value="online">Online</option>
            <option value="repeat">Repeat Customer</option>
          </select>
          {(statusFilter !== 'all' || sourceFilter !== 'all' || search) && (
            <button
              onClick={() => { setStatusFilter('all'); setSourceFilter('all'); setSearch(''); }}
              className="px-3 py-2.5 text-xs text-gray-500 hover:text-white border border-obsidian-400/60 hover:border-[#3C321E] rounded-lg transition-colors whitespace-nowrap"
            >
              Clear
            </button>
          )}
        </div>

        {/* Leads list */}
        {leadsFiltered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Users size={40} className="text-gray-600 mb-3" />
            <p className="text-gray-400">No leads found</p>
          </div>
        ) : (
          <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card divide-y divide-obsidian-400/60">
            {leadsFiltered.map(c => {
              const currentIdx = STAGE_ORDER.indexOf(c.leadStatus);
              const canAdvance = currentIdx < STAGE_ORDER.length - 1;
              const nextStage = canAdvance ? STAGE_ORDER[currentIdx + 1] : null;
              const col = STAGE_COLORS[c.leadStatus];
              const isTestDrive = c.leadStatus === 'test_drive';

              return (
                <div key={c.id} className="flex items-center gap-3 px-4 py-3 hover:bg-obsidian-700/50 transition-colors cursor-pointer" onClick={() => setDetailLead(c)}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-white text-sm font-medium">{c.name}</span>
                      <span className="text-gray-600 text-xs hidden sm:inline">{c.phone}</span>
                      <span className="text-gray-700 text-xs px-1.5 py-0.5 bg-[#2C2415] rounded hidden md:inline">{SOURCE_LABELS[c.source]}</span>
                      {isDirector && <span className="text-gray-600 text-xs hidden lg:inline">{getSalesName(c.assignedSalesId)}</span>}
                    </div>
                    <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                      {STAGE_ORDER.filter(s => s !== 'loan_submitted').map((stage, idx) => (
                        <React.Fragment key={stage}>
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              if (stage === 'test_drive' && c.leadStatus !== 'test_drive') openTdSchedule(c);
                              else if (stage === 'follow_up' && c.leadStatus === 'test_drive') openSidebar(c);
                              else updateCustomer(c.id, { leadStatus: stage });
                            }}
                            title={LEAD_STATUS_LABELS[stage]}
                            className={`w-2 h-2 rounded-full transition-all hover:scale-125 ${
                              idx < currentIdx ? `${STAGE_COLORS[stage].dot} opacity-50` :
                              idx === currentIdx ? `${STAGE_COLORS[stage].dot}` :
                              'bg-[#3C321E]'
                            }`}
                          />
                          {idx < 2 && <div className={`h-px w-4 ${idx < currentIdx ? 'bg-gray-600' : 'bg-[#2C2415]'}`} />}
                        </React.Fragment>
                      ))}
                      <span className={`text-xs font-medium ml-2 ${col.text}`}>{LEAD_STATUS_LABELS[c.leadStatus]}</span>
                    </div>
                    <input
                      type="text"
                      defaultValue={c.followUpRemark ?? ''}
                      onBlur={e => {
                        const val = e.target.value.trim();
                        if (val !== (c.followUpRemark ?? '')) {
                          updateCustomer(c.id, { followUpRemark: val || undefined });
                        }
                      }}
                      onClick={e => e.stopPropagation()}
                      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      placeholder="Remark... (what to follow up?)"
                      className="mt-2 w-full text-xs bg-transparent border-b border-obsidian-400/40 hover:border-obsidian-400/70 focus:border-gold-500/60 text-gray-400 placeholder-gray-700 focus:text-gray-200 outline-none py-1 transition-colors"
                    />
                  </div>
                  <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                    {isTestDrive ? (
                      <button onClick={() => openSidebar(c)} className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-yellow-500/30 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 transition-colors">
                        Next Step <ArrowRight size={11} />
                      </button>
                    ) : canAdvance && nextStage && nextStage !== 'loan_submitted' ? (
                      <button
                        onClick={() => nextStage === 'test_drive' ? openTdSchedule(c) : updateCustomer(c.id, { leadStatus: nextStage })}
                        className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-obsidian-400/60 hover:bg-obsidian-600/60 transition-colors ${STAGE_COLORS[nextStage].text}`}
                      >
                        {LEAD_STATUS_LABELS[nextStage]} <ChevronRight size={11} />
                      </button>
                    ) : null}
                    <button onClick={() => handleWhatsApp(c.phone, c.name)} className="flex items-center gap-1 px-2 py-1.5 text-xs text-green-400 bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 hover:border-green-500/40 rounded-lg transition-colors">
                      <MessageCircle size={12} />WA
                    </button>
                    <button onClick={() => openEdit(c)} className="p-1.5 text-gray-600 hover:text-gold-400 hover:bg-obsidian-600/60 rounded-lg transition-colors">
                      <Edit2 size={14} />
                    </button>
                    <button onClick={() => { if (window.confirm('Delete this lead?')) deleteCustomer(c.id); }} className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </>)}

      {tab === 'loan' && (<>
        {/* Loan search */}
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Search by name or phone..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 input rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-gold-500 transition-colors"
          />
          <select
            value={sourceFilter}
            onChange={e => setSourceFilter(e.target.value as Customer['source'] | 'all')}
            className="input rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-gold-500 transition-colors"
          >
            <option value="all">All Sources</option>
            <option value="walk_in">Walk-in</option>
            <option value="referral">Referral</option>
            <option value="fb_marketplace">FB Marketplace</option>
            <option value="fb_page">FB Page</option>
            <option value="mudah">Mudah</option>
            <option value="online">Online</option>
            <option value="repeat">Repeat Customer</option>
          </select>
          {(sourceFilter !== 'all' || search) && (
            <button onClick={() => { setSourceFilter('all'); setSearch(''); }} className="px-3 py-2.5 text-xs text-gray-500 hover:text-white border border-obsidian-400/60 hover:border-[#3C321E] rounded-lg transition-colors whitespace-nowrap">Clear</button>
          )}
        </div>

        {/* Loan list */}
        {loanFiltered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Banknote size={40} className="text-gray-600 mb-3" />
            <p className="text-gray-400">No loan submissions yet</p>
            <p className="text-gray-600 text-xs mt-1">Leads move here automatically when marked as Loan Submitted</p>
          </div>
        ) : (
          <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card divide-y divide-obsidian-400/60">
            {loanFiltered.map(c => {
              const car = getCar(c.interestedCarId);
              const loanInfo = LOAN_STATUS_LABELS[c.loanStatus ?? 'not_started'];
              return (
                <div key={c.id} className="flex items-center gap-3 px-4 py-3 hover:bg-obsidian-700/50 transition-colors cursor-pointer" onClick={() => setDetailLead(c)}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-white text-sm font-medium">{c.name}</span>
                      <span className="text-gray-600 text-xs hidden sm:inline">{c.phone}</span>
                      {isDirector && <span className="text-gray-600 text-xs hidden lg:inline">{getSalesName(c.assignedSalesId)}</span>}
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                      {car && <span className="text-gray-400 text-xs">{car.year} {car.make} {car.model}</span>}
                      {c.loanBankSubmitted && <span className="text-gray-500 text-xs">{c.loanBankSubmitted}</span>}
                      {c.dealPrice ? <span className="text-gray-400 text-xs font-medium">{formatRM(c.dealPrice)}</span> : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                    {c.loanApplications?.some(a => a.status === 'approved') && (
                      <button
                        onClick={() => openFinalDeal(c)}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-gold-500/10 border border-gold-500/40 text-gold-400 hover:bg-gold-500/20 rounded-lg font-medium transition-colors"
                      >
                        <ClipboardList size={12} />Final Deal
                      </button>
                    )}
                    <button
                      onClick={() => openBankModal(c)}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-obsidian-700/60 border border-obsidian-400/60 text-gray-400 hover:text-white hover:border-obsidian-400 rounded-lg transition-colors"
                    >
                      <FileText size={12} />Banks
                    </button>
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${
                      loanInfo.label === 'Approved' ? 'bg-green-500/10 border-green-500/30 text-green-400' :
                      loanInfo.label === 'Rejected' ? 'bg-red-500/10 border-red-500/30 text-red-400' :
                      'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
                    }`}>{loanInfo.label}</span>
                    <button onClick={() => handleWhatsApp(c.phone, c.name)} className="flex items-center gap-1 px-2 py-1.5 text-xs text-green-400 bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 rounded-lg transition-colors">
                      <MessageCircle size={12} />WA
                    </button>
                    <button onClick={() => openEdit(c)} className="p-1.5 text-gray-600 hover:text-gold-400 hover:bg-obsidian-600/60 rounded-lg transition-colors">
                      <Edit2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </>)}

      {/* ── Lead Detail Drawer ────────────────────────── */}
      {detailLead && (
        <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setDetailLead(null)} />
      )}
      <div className={`fixed top-0 right-0 h-full w-full md:w-96 bg-[#0F0E0C] border-l border-obsidian-400/60 z-50 flex flex-col transition-transform duration-300 ${detailLead ? 'translate-x-0' : 'translate-x-full'}`}>
        {detailLead && (() => {
          const car = getCar(detailLead.interestedCarId);
          return (
            <>
              {/* Header */}
              <div className="flex items-center justify-between p-5 border-b border-obsidian-400/60">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm uppercase ${STAGE_COLORS[detailLead.leadStatus].dot} bg-opacity-20 border border-opacity-30 text-white`} style={{ background: 'rgba(6,182,212,0.15)', borderColor: 'rgba(6,182,212,0.3)' }}>
                    {detailLead.name.charAt(0)}
                  </div>
                  <div>
                    <p className="text-white font-semibold text-sm">{detailLead.name}</p>
                    <span className={`text-xs ${STAGE_COLORS[detailLead.leadStatus].text}`}>{LEAD_STATUS_LABELS[detailLead.leadStatus]}</span>
                  </div>
                </div>
                <button onClick={() => setDetailLead(null)} className="p-1.5 text-gray-500 hover:text-white hover:bg-obsidian-600/60 rounded-lg transition-colors">
                  <X size={16} />
                </button>
              </div>

              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                {/* Contact */}
                <div className="space-y-2">
                  <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">Contact</p>
                  <div className="bg-obsidian-700/60 border border-obsidian-400/70 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2.5">
                      <Phone size={13} className="text-gray-500 shrink-0" />
                      <span className="text-white text-sm">{detailLead.phone}</span>
                    </div>
                    {detailLead.email && (
                      <div className="flex items-center gap-2.5">
                        <Mail size={13} className="text-gray-500 shrink-0" />
                        <span className="text-white text-sm">{detailLead.email}</span>
                      </div>
                    )}
                    {detailLead.employer && (
                      <div className="flex items-center gap-2.5">
                        <Briefcase size={13} className="text-gray-500 shrink-0" />
                        <span className="text-white text-sm">{detailLead.employer}</span>
                        {!!detailLead.monthlySalary && <span className="text-gray-500 text-xs ml-1">· {formatRM(detailLead.monthlySalary)}/mo</span>}
                      </div>
                    )}
                  </div>
                </div>

                {/* Lead Info */}
                <div className="space-y-2">
                  <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">Lead Info</p>
                  <div className="bg-obsidian-700/60 border border-obsidian-400/70 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500 text-xs">Source</span>
                      <span className="text-white text-sm">{SOURCE_LABELS[detailLead.source]}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500 text-xs">Stage</span>
                      <span className={`text-sm font-medium ${STAGE_COLORS[detailLead.leadStatus].text}`}>{LEAD_STATUS_LABELS[detailLead.leadStatus]}</span>
                    </div>
                    {isDirector && (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500 text-xs">Assigned To</span>
                        <span className="text-white text-sm">{getSalesName(detailLead.assignedSalesId)}</span>
                      </div>
                    )}
                    {detailLead.followUpDate && (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500 text-xs">Follow-up Date</span>
                        <span className="text-white text-sm">{detailLead.followUpDate}</span>
                      </div>
                    )}
                    {detailLead.followUpRemark && (
                      <div>
                        <span className="text-gray-500 text-xs">Follow-up About</span>
                        <p className="text-white text-sm mt-1">{detailLead.followUpRemark}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Interested Car */}
                {car && (
                  <div className="space-y-2">
                    <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">Interested Car</p>
                    <div className="bg-obsidian-700/60 border border-obsidian-400/70 rounded-xl p-4 flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-gold-500/10 border border-gold-500/20 flex items-center justify-center shrink-0">
                        <Car size={16} className="text-gold-400" />
                      </div>
                      <div>
                        <p className="text-white text-sm font-medium">{car.year} {car.make} {car.model}</p>
                        <p className="text-gray-500 text-xs">{car.colour} · {car.sellingPrice > 0 ? formatRM(car.sellingPrice) : 'TBD'}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Loan Info */}
                {detailLead.loanStatus && detailLead.loanStatus !== 'not_started' && (
                  <div className="space-y-2">
                    <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">Loan</p>
                    <div className="bg-obsidian-700/60 border border-obsidian-400/70 rounded-xl p-4 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500 text-xs">Status</span>
                        <span className="text-green-400 text-sm capitalize">{detailLead.loanStatus}</span>
                      </div>
                      {detailLead.loanBankSubmitted && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-500 text-xs">Banks</span>
                          <span className="text-white text-sm text-right max-w-[60%]">{detailLead.loanBankSubmitted}</span>
                        </div>
                      )}
                      {!!detailLead.dealPrice && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-500 text-xs">Deal Price</span>
                          <span className="text-white text-sm">{formatRM(detailLead.dealPrice)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Notes */}
                {detailLead.notes && (
                  <div className="space-y-2">
                    <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">Notes</p>
                    <div className="bg-obsidian-700/60 border border-obsidian-400/70 rounded-xl p-4">
                      <p className="text-gray-300 text-sm whitespace-pre-wrap leading-relaxed">{detailLead.notes}</p>
                    </div>
                  </div>
                )}

                {/* Proceed to Loan — follow_up only */}
                {detailLead.leadStatus === 'follow_up' && (
                  <button
                    onClick={() => {
                      const interestedCar = cars.find(car => car.id === detailLead.interestedCarId);
                      setLoanForm({ banks: [], dealPrice: String(interestedCar?.sellingPrice ?? ''), notes: '', carId: detailLead.interestedCarId ?? '' });
                      setSidebarLead(detailLead);
                      setSidebarView('car_select');
                      setDetailLead(null);
                    }}
                    className="w-full flex items-center justify-center gap-2 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-400 py-2.5 rounded-xl text-sm font-medium transition-colors"
                  >
                    <Banknote size={15} />Loan
                  </button>
                )}
              </div>

              {/* Action Footer */}
              <div className="p-4 border-t border-obsidian-400/60 space-y-2">
                <button
                  onClick={() => handleWhatsApp(detailLead.phone, detailLead.name)}
                  className="w-full flex items-center justify-center gap-2 bg-green-500/10 hover:bg-green-500/20 border border-green-500/30 text-green-400 py-2.5 rounded-lg text-sm font-medium transition-colors"
                >
                  <MessageCircle size={15} />WhatsApp
                </button>
                <div className="grid grid-cols-2 gap-2">
                  {detailLead.leadStatus === 'contacted' && (
                    <button
                      onClick={() => { openTdSchedule(detailLead); setDetailLead(null); }}
                      className="flex items-center justify-center gap-1.5 border border-yellow-500/20 hover:bg-yellow-500/10 text-yellow-400 py-2.5 rounded-lg text-sm font-medium transition-colors"
                    >
                      <Car size={13} />Test Drive
                    </button>
                  )}
                  {detailLead.leadStatus === 'test_drive' && (
                    <button
                      onClick={() => { openSidebar(detailLead); setDetailLead(null); }}
                      className="flex items-center justify-center gap-1.5 border border-yellow-500/20 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 py-2.5 rounded-lg text-sm font-medium transition-colors"
                    >
                      Next Step <ArrowRight size={13} />
                    </button>
                  )}
                  <button
                    onClick={() => { openEdit(detailLead); setDetailLead(null); }}
                    className="flex items-center justify-center gap-1.5 border border-obsidian-400/60 hover:bg-obsidian-600/60 text-gold-400 py-2.5 rounded-lg text-sm font-medium transition-colors"
                  >
                    <Edit2 size={13} />Edit
                  </button>
                  <button
                    onClick={() => { if (window.confirm('Delete this lead?')) { deleteCustomer(detailLead.id); setDetailLead(null); } }}
                    className="flex items-center justify-center gap-1.5 border border-red-500/20 hover:bg-red-500/10 text-red-400 py-2.5 rounded-lg text-sm font-medium transition-colors"
                  >
                    <Trash2 size={13} />Delete
                  </button>
                </div>
              </div>
            </>
          );
        })()}
      </div>

      {/* ── Next Step Modal ────────────────────────────── */}
      <Modal
        isOpen={!!sidebarLead}
        onClose={closeSidebar}
        title={sidebarView === 'car_select' ? 'Select Car' : sidebarView === 'loan' ? 'Loan Submission' : sidebarView === 'cash' ? 'Cash Purchase' : 'Next Step'}
        maxWidth={sidebarView === 'car_select' ? 'max-w-lg' : 'max-w-sm'}
      >
        {sidebarLead && (
          <div className="space-y-4">
            {/* Customer info card — always visible */}
            <div className="bg-obsidian-700/60 border border-obsidian-400/70 rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-full bg-yellow-500/20 border border-yellow-500/30 flex items-center justify-center text-yellow-400 font-bold text-sm uppercase">
                  {sidebarLead.name.charAt(0)}
                </div>
                <div>
                  <p className="text-white font-medium text-sm">{sidebarLead.name}</p>
                  <p className="text-gray-500 text-xs">{SOURCE_LABELS[sidebarLead.source]}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-gray-400">
                <Phone size={11} className="text-gray-600" />
                {sidebarLead.phone}
              </div>
              {isDirector && (
                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                  <User size={11} className="text-gray-600" />
                  {getSalesName(sidebarLead.assignedSalesId)}
                </div>
              )}
              <div className="pt-1">
                <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                  Test Drive Done
                </span>
              </div>
            </div>

            {/* ── Step 1: Options ── */}
            {sidebarView === 'options' && (
              <>
                <p className="text-gray-400 text-sm">What would you like to do next with this lead?</p>

                <button
                  onClick={handleFollowUp}
                  className="w-full text-left bg-obsidian-700/60 hover:bg-obsidian-600/60 border border-obsidian-400/60 hover:border-gold-500/40 rounded-xl p-4 transition-all group"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-gold-500/10 border border-gold-500/20 flex items-center justify-center">
                        <CalendarCheck size={18} className="text-gold-400" />
                      </div>
                      <div>
                        <p className="text-white text-sm font-medium">Follow Up</p>
                        <p className="text-gray-500 text-xs mt-0.5">Continue nurturing this lead</p>
                      </div>
                    </div>
                    <ChevronRight size={16} className="text-gray-600 group-hover:text-gold-400 transition-colors" />
                  </div>
                </button>

                <button
                  onClick={() => { setSidebarCashFlow(false); setSidebarView('car_select'); }}
                  className="w-full text-left bg-obsidian-700/60 hover:bg-obsidian-600/60 border border-obsidian-400/60 hover:border-green-500/40 rounded-xl p-4 transition-all group"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center justify-center">
                        <Banknote size={18} className="text-green-400" />
                      </div>
                      <div>
                        <p className="text-white text-sm font-medium">Proceed with Loan</p>
                        <p className="text-gray-500 text-xs mt-0.5">Submit loan application now</p>
                      </div>
                    </div>
                    <ChevronRight size={16} className="text-gray-600 group-hover:text-green-400 transition-colors" />
                  </div>
                </button>

                <button
                  onClick={() => { setSidebarCashFlow(true); setSidebarView('car_select'); }}
                  className="w-full text-left bg-obsidian-700/60 hover:bg-obsidian-600/60 border border-obsidian-400/60 hover:border-purple-500/40 rounded-xl p-4 transition-all group"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                        <Banknote size={18} className="text-purple-400" />
                      </div>
                      <div>
                        <p className="text-white text-sm font-medium">Cash Purchase</p>
                        <p className="text-gray-500 text-xs mt-0.5">Customer paying in full cash</p>
                      </div>
                    </div>
                    <ChevronRight size={16} className="text-gray-600 group-hover:text-purple-400 transition-colors" />
                  </div>
                </button>
              </>
            )}

            {/* ── Step 2: Car Selection ── */}
            {sidebarView === 'car_select' && (
              <>
                <button
                  onClick={() => setSidebarView('options')}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-white transition-colors"
                >
                  ← Back
                </button>
                <p className="text-gray-400 text-sm">Select the car to submit for loan. You can change the car or keep the current one.</p>
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {cars.filter(c => c.status !== 'sold').map(c => {
                    const isSelected = loanForm.carId === c.id;
                    const statusColors: Record<string, string> = {
                      coming_soon: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
                      in_workshop: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
                      ready: 'text-gold-400 bg-gold-500/10 border-gold-500/20',
                      photo_complete: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
                      submitted: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
                      deal_pending: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
                      available: 'text-green-400 bg-green-500/10 border-green-500/20',
                      reserved: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
                    };
                    const statusLabels: Record<string, string> = {
                      coming_soon: 'Coming Soon', in_workshop: 'Workshop', ready: 'Ready',
                      photo_complete: 'Photo Done', submitted: 'Submitted', deal_pending: 'Deal Pending',
                      available: 'Available', reserved: 'Reserved',
                    };
                    return (
                      <button
                        key={c.id}
                        onClick={() => setLoanForm({ ...loanForm, carId: c.id, dealPrice: String(c.sellingPrice > 0 ? c.sellingPrice : '') })}
                        className={`w-full text-left rounded-xl p-3 border transition-all ${
                          isSelected
                            ? 'bg-green-500/10 border-green-500/40'
                            : 'bg-obsidian-700/60 border-obsidian-400/60 hover:border-[#3C321E]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className={`text-sm font-medium truncate ${isSelected ? 'text-green-300' : 'text-white'}`}>
                              {c.year} {c.make} {c.model}
                            </p>
                            <p className="text-gray-500 text-xs mt-0.5">{c.colour} · {c.sellingPrice > 0 ? formatRM(c.sellingPrice) : 'TBD'}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className={`text-xs px-2 py-0.5 rounded-full border ${statusColors[c.status] ?? 'text-gray-400 bg-gray-500/10 border-gray-500/20'}`}>
                              {statusLabels[c.status] ?? c.status}
                            </span>
                            {isSelected && <span className="text-green-400 text-xs font-medium">✓</span>}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => {
                    const car = getCar(loanForm.carId);
                    setCashForm(f => ({ ...f, dealPrice: String(car?.sellingPrice ?? f.dealPrice) }));
                    setSidebarView(sidebarCashFlow ? 'cash' : 'loan');
                  }}
                  disabled={!loanForm.carId}
                  className={`w-full disabled:opacity-50 disabled:cursor-not-allowed text-white py-2.5 rounded-lg text-sm font-medium transition-colors ${sidebarCashFlow ? 'bg-purple-600 hover:bg-purple-500' : 'bg-green-500 hover:bg-green-400'}`}
                >
                  {sidebarCashFlow ? 'Continue to Cash Deal' : 'Continue to Loan Submission'}
                </button>
              </>
            )}

            {/* ── Step 3: Loan Form ── */}
            {sidebarView === 'loan' && (() => {
              const selectedCar = getCar(loanForm.carId);
              return (
                <>
                  <button
                    onClick={() => setSidebarView('car_select')}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-white transition-colors"
                  >
                    ← Back
                  </button>

                  {selectedCar && (
                    <div className="flex items-center gap-3 bg-obsidian-700/60 border border-green-500/20 rounded-xl p-3">
                      <div className="w-8 h-8 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center justify-center shrink-0">
                        <Car size={15} className="text-green-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-white text-sm font-medium truncate">{selectedCar.year} {selectedCar.make} {selectedCar.model}</p>
                        <p className="text-gray-500 text-xs">{selectedCar.colour} · {selectedCar.sellingPrice > 0 ? formatRM(selectedCar.sellingPrice) : 'TBD'}</p>
                      </div>
                    </div>
                  )}

                  <div className="space-y-3">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-gray-300 text-xs font-medium">Bank</label>
                        {loanForm.banks.length > 0 && (
                          <span className="text-xs text-green-400">{loanForm.banks.length} selected</span>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {BANKS.map(b => {
                          const selected = loanForm.banks.includes(b);
                          return (
                            <button
                              key={b}
                              type="button"
                              onClick={() => {
                                const updated = selected
                                  ? loanForm.banks.filter(x => x !== b)
                                  : [...loanForm.banks, b];
                                setLoanForm({ ...loanForm, banks: updated });
                              }}
                              className={`px-2 py-2 rounded-lg text-xs font-medium border transition-colors text-center ${
                                selected
                                  ? 'bg-green-500/20 border-green-500/60 text-green-300'
                                  : 'bg-obsidian-700/60 border-obsidian-400/60 text-gray-400 hover:border-green-500/40 hover:text-gray-200'
                              }`}
                            >
                              {b}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <FormField label="Loan Amount (RM)">
                      <input
                        type="number"
                        className={inputCls()}
                        value={loanForm.dealPrice}
                        onChange={e => setLoanForm({ ...loanForm, dealPrice: e.target.value })}
                        placeholder="e.g. 45000"
                      />
                    </FormField>
                    <FormField label="Notes">
                      <textarea
                        className={`${inputCls()} h-20 resize-none`}
                        value={loanForm.notes}
                        onChange={e => setLoanForm({ ...loanForm, notes: e.target.value })}
                        placeholder="Any remarks about the loan..."
                      />
                    </FormField>
                  </div>

                  <button
                    onClick={handleProceedLoan}
                    disabled={loanForm.banks.length === 0}
                    className="w-full bg-green-500 hover:bg-green-400 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2.5 rounded-lg text-sm font-medium transition-colors"
                  >
                    Submit{loanForm.banks.length > 1 ? ` to ${loanForm.banks.length} Banks` : ' Loan'} & Move to Follow Up
                  </button>
                </>
              );
            })()}

            {/* ── Cash Purchase view ── */}
            {sidebarView === 'cash' && (() => {
              const selectedCar = getCar(loanForm.carId);
              const dealPrice = Number(cashForm.dealPrice) || 0;
              const hasDiscount = selectedCar ? dealPrice < selectedCar.sellingPrice : false;
              return (
                <>
                  <button onClick={() => setSidebarView('car_select')} className="flex items-center gap-1 text-xs text-gray-500 hover:text-white transition-colors">← Back</button>

                  {selectedCar && (
                    <div className="flex items-center gap-3 bg-obsidian-700/60 border border-purple-500/20 rounded-xl p-3">
                      <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0">
                        <Car size={15} className="text-purple-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-white text-sm font-medium truncate">{selectedCar.year} {selectedCar.make} {selectedCar.model}</p>
                        <p className="text-gray-500 text-xs">{selectedCar.colour} · {selectedCar.sellingPrice > 0 ? formatRM(selectedCar.sellingPrice) : 'TBD'}</p>
                      </div>
                    </div>
                  )}

                  <div className="space-y-3">
                    <FormField label="Cash Deal Price (RM)">
                      <input
                        type="number"
                        className={inputCls()}
                        value={cashForm.dealPrice}
                        onChange={e => setCashForm({ ...cashForm, dealPrice: e.target.value })}
                        placeholder="e.g. 45000"
                        autoFocus
                      />
                    </FormField>
                    {hasDiscount && dealPrice > 0 && (
                      <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2.5 text-xs text-amber-400">
                        <AlertCircle size={13} className="shrink-0 mt-0.5" />
                        <span>Discount of <strong>{formatRM(selectedCar!.sellingPrice - dealPrice)}</strong> from listed price — requires Director approval.</span>
                      </div>
                    )}
                    <FormField label="Notes">
                      <textarea
                        className={`${inputCls()} h-20 resize-none`}
                        value={cashForm.notes}
                        onChange={e => setCashForm({ ...cashForm, notes: e.target.value })}
                        placeholder="Any remarks about this cash deal..."
                      />
                    </FormField>
                  </div>

                  <button
                    onClick={handleCashDeal}
                    disabled={!cashForm.dealPrice}
                    className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2.5 rounded-lg text-sm font-medium transition-colors"
                  >
                    Confirm Cash Deal
                  </button>
                </>
              );
            })()}
          </div>
        )}
      </Modal>

      {/* Add/Edit Customer Modal */}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditTarget(null); }} title={editTarget ? 'Edit Customer' : 'New Customer'} maxWidth="max-w-lg">
        <div className="space-y-3">
          <FormField label="Full Name *" error={errors.name}>
            <input className={inputCls(errors.name)} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Ahmad Bin Ismail" autoFocus />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Phone *" error={errors.phone}>
              <input className={inputCls(errors.phone)} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+601X-XXXXXXX" />
            </FormField>
            <FormField label="Source">
              <select className={inputCls()} value={form.source} onChange={e => setForm({ ...form, source: e.target.value as Customer['source'] })}>
                <option value="walk_in">Walk-in</option>
                <option value="referral">Referral</option>
                <option value="fb_marketplace">FB Marketplace</option>
                <option value="fb_page">FB Page</option>
                <option value="mudah">Mudah</option>
                <option value="online">Online</option>
                <option value="repeat">Repeat Customer</option>
              </select>
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {editTarget && (
              <FormField label="Lead Status">
                <select className={inputCls()} value={form.leadStatus} onChange={e => setForm({ ...form, leadStatus: e.target.value as Customer['leadStatus'] })}>
                  {(['contacted', 'test_drive', 'follow_up'] as Customer['leadStatus'][]).map(s => (
                    <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </FormField>
            )}
            <FormField label="Interested Car" className={editTarget ? '' : 'col-span-2'}>
              <select className={inputCls()} value={form.interestedCarId} onChange={e => setForm({ ...form, interestedCarId: e.target.value })}>
                <option value="">— None —</option>
                {cars.filter(car => car.status !== 'sold').map(car => (
                  <option key={car.id} value={car.id}>
                    {car.carPlate ? `${car.carPlate} · ` : ''}{car.year} {car.make} {car.model}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          {isDirector && (
            <FormField label="Assigned Salesperson *" error={errors.assignedSalesId}>
              <select className={inputCls(errors.assignedSalesId)} value={form.assignedSalesId} onChange={e => setForm({ ...form, assignedSalesId: e.target.value })}>
                <option value="">— Select —</option>
                {salespeople.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </FormField>
          )}
          <FormField label="Notes">
            <textarea className={`${inputCls()} h-16 resize-none`} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Quick notes..." />
          </FormField>
        </div>
        <div className="flex justify-center gap-3 mt-5">
          <button onClick={() => { setShowModal(false); setEditTarget(null); }} className="px-6 py-2.5 btn-ghost rounded-lg text-sm">Cancel</button>
          <button onClick={handleSubmit} className="btn-gold px-6 py-2.5 rounded-lg text-sm">
            {editTarget ? 'Save Changes' : 'Add Customer'}
          </button>
        </div>
      </Modal>

      {/* Test Drive Scheduling Modal */}
      <Modal isOpen={showTdModal} onClose={() => { setShowTdModal(false); setTdCustomer(null); }} title="Schedule Test Drive" maxWidth="max-w-sm">
        {tdCustomer && (
          <div className="space-y-4">
            <div className="bg-obsidian-700/60 border border-obsidian-400/60 rounded-lg px-3 py-2.5">
              <p className="text-xs text-gray-500 mb-0.5">Customer</p>
              <p className="text-white text-sm font-medium">{tdCustomer.name}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Date *">
                <input type="date" className={inputCls()} value={tdForm.date} onChange={e => setTdForm({ ...tdForm, date: e.target.value })} autoFocus />
              </FormField>
              <FormField label="Time *">
                <input type="time" className={inputCls()} value={tdForm.time} onChange={e => setTdForm({ ...tdForm, time: e.target.value })} />
              </FormField>
            </div>
            <FormField label="Car">
              <select className={inputCls()} value={tdForm.carId} onChange={e => setTdForm({ ...tdForm, carId: e.target.value })}>
                <option value="">— Select car —</option>
                {cars.filter(car => car.status !== 'sold').map(car => (
                  <option key={car.id} value={car.id}>{car.year} {car.make} {car.model}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Notes">
              <textarea className={`${inputCls()} h-16 resize-none`} value={tdForm.notes} onChange={e => setTdForm({ ...tdForm, notes: e.target.value })} placeholder="Any notes..." />
            </FormField>
          </div>
        )}
        <div className="flex justify-center gap-3 mt-5">
          <button onClick={() => { setShowTdModal(false); setTdCustomer(null); }} className="px-6 py-2.5 btn-ghost rounded-lg text-sm">Cancel</button>
          <button onClick={handleSaveTd} disabled={!tdForm.date || !tdForm.time} className="btn-gold disabled:opacity-50 px-6 py-2.5 rounded-lg text-sm">Save to Calendar</button>
        </div>
      </Modal>

      {/* ── Bank Status Modal ─────────────────────────── */}
      <Modal isOpen={!!bankModal} onClose={() => setBankModal(null)} title="Update Bank Status" maxWidth="max-w-sm">
        {bankModal && (
          <div className="space-y-4">
            <div className="bg-obsidian-700/60 border border-obsidian-400/70 rounded-xl px-4 py-3">
              <p className="text-white text-sm font-medium">{bankModal.name}</p>
              <p className="text-gray-500 text-xs">{bankModal.phone}</p>
            </div>
            <div className="space-y-2">
              {bankStatuses.map(app => (
                <div key={app.bank} className="bg-obsidian-700/60 border border-obsidian-400/60 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-white text-sm font-medium">{app.bank}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                      app.status === 'approved' ? 'bg-green-500/10 border-green-500/30 text-green-400' :
                      app.status === 'rejected' ? 'bg-red-500/10 border-red-500/30 text-red-400' :
                      'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
                    }`}>
                      {app.status === 'approved' ? 'Approved' : app.status === 'rejected' ? 'Rejected' : 'Submitted'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => toggleBankStatus(app.bank, 'approved')}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        app.status === 'approved'
                          ? 'bg-green-500/20 border-green-500/50 text-green-300'
                          : 'border-obsidian-400/60 text-gray-500 hover:border-green-500/40 hover:text-green-400'
                      }`}
                    >
                      <CheckCircle size={12} />Approve
                    </button>
                    <button
                      onClick={() => toggleBankStatus(app.bank, 'rejected')}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        app.status === 'rejected'
                          ? 'bg-red-500/20 border-red-500/50 text-red-300'
                          : 'border-obsidian-400/60 text-gray-500 hover:border-red-500/40 hover:text-red-400'
                      }`}
                    >
                      <XCircle size={12} />Reject
                    </button>
                  </div>
                  {app.status === 'rejected' && (
                    <input
                      className="input text-xs w-full"
                      placeholder="Rejection reason (optional)..."
                      value={rejectReason[app.bank] ?? app.rejectionReason ?? ''}
                      onChange={e => {
                        setRejectReason(prev => ({ ...prev, [app.bank]: e.target.value }));
                        setBankStatuses(prev => prev.map(a => a.bank === app.bank ? { ...a, rejectionReason: e.target.value } : a));
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-center gap-3">
              <button onClick={() => setBankModal(null)} className="px-6 py-2.5 btn-ghost rounded-lg text-sm">Cancel</button>
              <button onClick={handleSaveBankStatuses} className="btn-gold px-6 py-2.5 rounded-lg text-sm">Save</button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Final Deal Wizard ─────────────────────────── */}
      <Modal
        isOpen={!!finalDealModal}
        onClose={() => setFinalDealModal(null)}
        title={finalDealStep === 1 ? 'Final Deal — Price' : finalDealStep === 2 ? 'Final Deal — Trade-in' : 'Deal Summary'}
        maxWidth="max-w-md"
      >
        {finalDealModal && (() => {
          const customer = finalDealModal;
          const car = getCar(customer.interestedCarId);
          const dealPrice = Number(finalDealForm.dealPrice) || 0;
          const hasDiscount = car ? dealPrice < car.sellingPrice : false;
          const discountAmt = car ? car.sellingPrice - dealPrice : 0;
          const ti = finalDealForm.tradeIn;
          const netTradeIn = ti.offeredValue - ti.outstandingLoan;

          return (
            <div className="space-y-4">

              {/* Step indicators */}
              <div className="flex items-center gap-2 mb-2">
                {[1, 2, 3].map(s => (
                  <React.Fragment key={s}>
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border ${
                      finalDealStep === s ? 'bg-gold-500 border-gold-500 text-white' :
                      finalDealStep > s ? 'bg-green-500/20 border-green-500/40 text-green-400' :
                      'bg-obsidian-700/60 border-obsidian-400/60 text-gray-600'
                    }`}>{s}</div>
                    {s < 3 && <div className={`flex-1 h-px ${finalDealStep > s ? 'bg-green-500/40' : 'bg-obsidian-400/40'}`} />}
                  </React.Fragment>
                ))}
              </div>

              {/* ── Step 1: Deal price ── */}
              {finalDealStep === 1 && (
                <>
                  {car && (
                    <div className="bg-obsidian-700/60 border border-obsidian-400/70 rounded-xl p-3">
                      <p className="text-xs text-gray-500 mb-1">Car</p>
                      <p className="text-white text-sm font-medium">{car.year} {car.make} {car.model}</p>
                      <p className="text-gray-400 text-xs">Listed at {formatRM(car.sellingPrice)}</p>
                    </div>
                  )}
                  <div>
                    <label className="block text-gray-300 text-xs font-medium mb-1.5">Approved Bank</label>
                    <select
                      className="input w-full"
                      value={finalDealForm.approvedBank}
                      onChange={e => setFinalDealForm(f => ({ ...f, approvedBank: e.target.value }))}
                    >
                      <option value="">— Select bank —</option>
                      {customer.loanApplications?.filter(a => a.status === 'approved').map(a => (
                        <option key={a.bank} value={a.bank}>{a.bank}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-gray-300 text-xs font-medium mb-1.5">Final Deal Price (RM)</label>
                    <input
                      type="number"
                      className="input w-full"
                      value={finalDealForm.dealPrice}
                      onChange={e => setFinalDealForm(f => ({ ...f, dealPrice: e.target.value }))}
                      placeholder="e.g. 45000"
                    />
                  </div>
                  {hasDiscount && dealPrice > 0 && (
                    <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2.5 text-xs text-amber-400">
                      <AlertCircle size={13} className="shrink-0 mt-0.5" />
                      <span>Discount of <strong>{formatRM(discountAmt)}</strong> from listed price. This deal requires <strong>Director approval</strong>.</span>
                    </div>
                  )}
                  <button
                    onClick={() => setFinalDealStep(2)}
                    disabled={!finalDealForm.approvedBank || !finalDealForm.dealPrice}
                    className="w-full btn-gold py-2.5 rounded-lg text-sm disabled:opacity-50"
                  >
                    Next — Trade-in
                  </button>
                </>
              )}

              {/* ── Step 2: Trade-in ── */}
              {finalDealStep === 2 && (
                <>
                  <div className="flex items-center justify-between">
                    <button onClick={() => setFinalDealStep(1)} className="text-xs text-gray-500 hover:text-white">← Back</button>
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-obsidian-700/60 border border-obsidian-400/60 rounded-xl">
                    <Car size={16} className="text-gray-500 shrink-0" />
                    <div>
                      <p className="text-white text-sm">Does this customer have a trade-in?</p>
                    </div>
                    <button
                      onClick={() => setFinalDealForm(f => ({ ...f, hasTradeIn: !f.hasTradeIn, tradeIn: f.hasTradeIn ? { ...emptyTradeIn } : f.tradeIn }))}
                      className={`ml-auto shrink-0 w-10 h-6 rounded-full border transition-colors relative ${
                        finalDealForm.hasTradeIn ? 'bg-gold-500 border-gold-500' : 'bg-obsidian-500 border-obsidian-400/60'
                      }`}
                    >
                      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow ${
                        finalDealForm.hasTradeIn ? 'translate-x-4' : 'translate-x-0.5'
                      }`} />
                    </button>
                  </div>

                  {finalDealForm.hasTradeIn && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-gray-300 text-xs font-medium mb-1">Make</label>
                          <input className="input" value={ti.make} onChange={e => setFinalDealForm(f => ({ ...f, tradeIn: { ...f.tradeIn, make: e.target.value } }))} placeholder="Toyota" />
                        </div>
                        <div>
                          <label className="block text-gray-300 text-xs font-medium mb-1">Model</label>
                          <input className="input" value={ti.model} onChange={e => setFinalDealForm(f => ({ ...f, tradeIn: { ...f.tradeIn, model: e.target.value } }))} placeholder="Vios" />
                        </div>
                        <div>
                          <label className="block text-gray-300 text-xs font-medium mb-1">Year</label>
                          <input type="number" className="input" value={ti.year} onChange={e => setFinalDealForm(f => ({ ...f, tradeIn: { ...f.tradeIn, year: Number(e.target.value) } }))} />
                        </div>
                        <div>
                          <label className="block text-gray-300 text-xs font-medium mb-1">Plate</label>
                          <input className="input" value={ti.carPlate} onChange={e => setFinalDealForm(f => ({ ...f, tradeIn: { ...f.tradeIn, carPlate: e.target.value } }))} placeholder="WXX 1234" />
                        </div>
                        <div>
                          <label className="block text-gray-300 text-xs font-medium mb-1">Colour</label>
                          <input className="input" value={ti.colour} onChange={e => setFinalDealForm(f => ({ ...f, tradeIn: { ...f.tradeIn, colour: e.target.value } }))} placeholder="Silver" />
                        </div>
                        <div>
                          <label className="block text-gray-300 text-xs font-medium mb-1">Mileage (km)</label>
                          <input type="number" className="input" value={ti.mileage || ''} onChange={e => setFinalDealForm(f => ({ ...f, tradeIn: { ...f.tradeIn, mileage: Number(e.target.value) } }))} />
                        </div>
                        <div>
                          <label className="block text-gray-300 text-xs font-medium mb-1">Outstanding Loan (RM)</label>
                          <input type="number" className="input" value={ti.outstandingLoan || ''} onChange={e => setFinalDealForm(f => ({ ...f, tradeIn: { ...f.tradeIn, outstandingLoan: Number(e.target.value) } }))} placeholder="0" />
                        </div>
                        <div>
                          <label className="block text-gray-300 text-xs font-medium mb-1">Offered Value (RM)</label>
                          <input type="number" className="input" value={ti.offeredValue || ''} onChange={e => setFinalDealForm(f => ({ ...f, tradeIn: { ...f.tradeIn, offeredValue: Number(e.target.value) } }))} placeholder="0" />
                        </div>
                      </div>
                      {finalDealForm.hasTradeIn && ti.offeredValue > 0 && (
                        <div className={`text-xs px-3 py-2 rounded-lg border ${netTradeIn >= 0 ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
                          Net trade-in: {netTradeIn >= 0 ? '+' : ''}{formatRM(netTradeIn)}
                          {netTradeIn < 0 && ' (customer still owes settlement)'}
                        </div>
                      )}
                      <div>
                        <label className="block text-gray-300 text-xs font-medium mb-1">Damage Report</label>
                        <textarea
                          className="input h-20 resize-none w-full"
                          value={ti.damages}
                          onChange={e => setFinalDealForm(f => ({ ...f, tradeIn: { ...f.tradeIn, damages: e.target.value } }))}
                          placeholder="Describe visible damages, dents, scratches..."
                        />
                      </div>
                      <div>
                        <label className="block text-gray-300 text-xs font-medium mb-1">Photos ({ti.photos.length}/5)</label>
                        <div className="flex flex-wrap gap-2">
                          {ti.photos.map((p, i) => (
                            <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-obsidian-400/60">
                              <img src={p} alt="" className="w-full h-full object-cover" />
                              <button
                                onClick={() => setFinalDealForm(f => ({ ...f, tradeIn: { ...f.tradeIn, photos: f.tradeIn.photos.filter((_, j) => j !== i) } }))}
                                className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 flex items-center justify-center text-white"
                              >
                                <X size={9} />
                              </button>
                            </div>
                          ))}
                          {ti.photos.length < 5 && (
                            <button
                              onClick={() => tradeInPhotoRef.current?.click()}
                              className="w-16 h-16 rounded-lg border border-dashed border-obsidian-400/60 flex flex-col items-center justify-center text-gray-600 hover:text-gray-400 hover:border-obsidian-400 transition-colors"
                            >
                              <Camera size={16} />
                              <span className="text-[10px] mt-0.5">Add</span>
                            </button>
                          )}
                        </div>
                        <input ref={tradeInPhotoRef} type="file" accept="image/*" multiple className="hidden" onChange={handleTradeInPhoto} />
                      </div>
                    </div>
                  )}

                  <button onClick={() => setFinalDealStep(3)} className="w-full btn-gold py-2.5 rounded-lg text-sm">
                    Next — Summary
                  </button>
                </>
              )}

              {/* ── Step 3: Summary ── */}
              {finalDealStep === 3 && (
                <>
                  <div className="flex items-center justify-between">
                    <button onClick={() => setFinalDealStep(2)} className="text-xs text-gray-500 hover:text-white">← Back</button>
                    <span className="text-xs text-gray-500">Review before submitting</span>
                  </div>

                  <div className="space-y-3">
                    {/* Customer */}
                    <div className="bg-obsidian-700/60 border border-obsidian-400/70 rounded-xl p-3">
                      <p className="text-gray-500 text-xs mb-2 font-medium uppercase tracking-wide">Customer</p>
                      <p className="text-white text-sm font-medium">{customer.name}</p>
                      <p className="text-gray-400 text-xs">{customer.phone}</p>
                    </div>

                    {/* Car & Pricing */}
                    <div className="bg-obsidian-700/60 border border-obsidian-400/70 rounded-xl p-3 space-y-2.5">
                      <p className="text-gray-500 text-xs mb-1 font-medium uppercase tracking-wide">Deal</p>
                      {car && (
                        <div className="flex justify-between items-center">
                          <span className="text-gray-400 text-xs">Car</span>
                          <span className="text-white text-sm">{car.year} {car.make} {car.model}</span>
                        </div>
                      )}
                      {car && (
                        <div className="flex justify-between items-center">
                          <span className="text-gray-400 text-xs">Listed Price</span>
                          <span className="text-gray-300 text-sm">{formatRM(car.sellingPrice)}</span>
                        </div>
                      )}
                      <div className="flex justify-between items-center">
                        <span className="text-gray-400 text-xs">Deal Price</span>
                        <span className="text-white text-sm font-semibold">{formatRM(dealPrice)}</span>
                      </div>
                      {hasDiscount && (
                        <div className="flex justify-between items-center">
                          <span className="text-amber-400 text-xs">Discount</span>
                          <span className="text-amber-400 text-sm font-medium">-{formatRM(discountAmt)} ⚠ Director Approval</span>
                        </div>
                      )}
                      <div className="flex justify-between items-center pt-1 border-t border-obsidian-400/40">
                        <span className="text-gray-400 text-xs">Approved Bank</span>
                        <span className="text-green-400 text-sm font-medium">{finalDealForm.approvedBank}</span>
                      </div>
                    </div>

                    {/* Trade-in */}
                    {finalDealForm.hasTradeIn && ti.make && (
                      <div className="bg-obsidian-700/60 border border-obsidian-400/70 rounded-xl p-3 space-y-2.5">
                        <p className="text-gray-500 text-xs mb-1 font-medium uppercase tracking-wide">Trade-in</p>
                        <div className="flex justify-between">
                          <span className="text-gray-400 text-xs">Car</span>
                          <span className="text-white text-sm">{ti.year} {ti.make} {ti.model} · {ti.carPlate}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400 text-xs">Offered Value</span>
                          <span className="text-white text-sm">{formatRM(ti.offeredValue)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400 text-xs">Outstanding Loan</span>
                          <span className="text-white text-sm">-{formatRM(ti.outstandingLoan)}</span>
                        </div>
                        <div className="flex justify-between pt-1 border-t border-obsidian-400/40">
                          <span className="text-gray-400 text-xs">Net Trade-in</span>
                          <span className={`text-sm font-semibold ${netTradeIn >= 0 ? 'text-green-400' : 'text-red-400'}`}>{netTradeIn >= 0 ? '+' : ''}{formatRM(netTradeIn)}</span>
                        </div>
                        {ti.damages && (
                          <div>
                            <p className="text-gray-500 text-xs mb-1">Damages</p>
                            <p className="text-gray-300 text-xs leading-relaxed">{ti.damages}</p>
                          </div>
                        )}
                        {ti.photos.length > 0 && (
                          <div className="flex gap-1.5 flex-wrap">
                            {ti.photos.map((p, i) => (
                              <img key={i} src={p} alt="" className="w-14 h-14 rounded-lg object-cover border border-obsidian-400/60" />
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Effective price */}
                    {finalDealForm.hasTradeIn && ti.offeredValue > 0 && (
                      <div className="bg-gold-500/10 border border-gold-500/30 rounded-xl p-3 flex justify-between items-center">
                        <span className="text-gold-400 text-sm">Effective Price</span>
                        <span className="text-gold-300 text-base font-bold">{formatRM(Math.max(0, dealPrice - netTradeIn))}</span>
                      </div>
                    )}
                  </div>

                  <button onClick={handleFinalDealSubmit} className="w-full btn-gold py-2.5 rounded-lg text-sm font-medium">
                    {hasDiscount ? 'Submit for Director Approval' : 'Confirm Final Deal'}
                  </button>
                </>
              )}
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
