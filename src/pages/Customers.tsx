import React, { useState, useMemo } from 'react';
import { Plus, Users, MessageCircle, AlertCircle, Edit2, Trash2, ChevronRight, Car, Phone, User, ArrowRight, Banknote, CalendarCheck, X, Mail, Briefcase } from 'lucide-react';
import { useStore } from '../store';
import { Customer } from '../types';
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
  const [sidebarView, setSidebarView] = useState<'options' | 'car_select' | 'loan'>('options');
  const [loanForm, setLoanForm] = useState({ banks: [] as string[], dealPrice: '', notes: '', carId: '' });

  // Loan status management modal (for loan_submitted leads)

  // Detail drawer
  const [detailLead, setDetailLead] = useState<Customer | null>(null);

  const myCustomers = useMemo(() =>
    customers
      .filter(c => isDirector || c.assignedSalesId === currentUser?.id)
      .map(c => STAGE_ORDER.includes(c.leadStatus) ? c : { ...c, leadStatus: 'contacted' as Customer['leadStatus'] }),
    [customers, isDirector, currentUser]
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
    if (editTarget) {
      updateCustomer(editTarget.id, { ...form });
    } else {
      addCustomer({ id: generateId(), ...form, createdAt: new Date().toISOString() });
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
    const interestedCar = cars.find(car => car.id === c.interestedCarId);
    setLoanForm({ banks: [], dealPrice: String(interestedCar?.sellingPrice ?? ''), notes: '', carId: c.interestedCarId ?? '' });
  };

  const closeSidebar = () => {
    setSidebarLead(null);
    setSidebarView('options');
  };

  const handleFollowUp = () => {
    if (!sidebarLead) return;
    updateCustomer(sidebarLead.id, { leadStatus: 'follow_up' });
    closeSidebar();
  };

  const handleProceedLoan = () => {
    if (!sidebarLead) return;
    updateCustomer(sidebarLead.id, {
      leadStatus: 'loan_submitted',
      loanStatus: 'submitted',
      loanBankSubmitted: loanForm.banks.join(', '),
      interestedCarId: loanForm.carId || sidebarLead.interestedCarId,
      dealPrice: loanForm.dealPrice ? Number(loanForm.dealPrice) : sidebarLead.dealPrice,
      notes: loanForm.notes
        ? (sidebarLead.notes ? sidebarLead.notes + '\n' + loanForm.notes : loanForm.notes)
        : sidebarLead.notes,
    });
    closeSidebar();
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
        title={sidebarView === 'car_select' ? 'Select Car' : sidebarView === 'loan' ? 'Loan Submission' : 'Next Step'}
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
                  onClick={() => setSidebarView('car_select')}
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
                  onClick={() => setSidebarView('loan')}
                  disabled={!loanForm.carId}
                  className="w-full bg-green-500 hover:bg-green-400 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2.5 rounded-lg text-sm font-medium transition-colors"
                >
                  Continue to Loan Submission
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
        <div className="flex gap-3 mt-5">
          <button onClick={() => { setShowModal(false); setEditTarget(null); }} className="flex-1 px-4 py-2.5 btn-ghost rounded-lg text-sm">Cancel</button>
          <button onClick={handleSubmit} className="flex-1 btn-gold px-4 py-2.5 rounded-lg text-sm">
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
        <div className="flex gap-3 mt-5">
          <button onClick={() => { setShowTdModal(false); setTdCustomer(null); }} className="flex-1 px-4 py-2.5 btn-ghost rounded-lg text-sm">Cancel</button>
          <button onClick={handleSaveTd} disabled={!tdForm.date || !tdForm.time} className="flex-1 btn-gold disabled:opacity-50 px-4 py-2.5 rounded-lg text-sm">Save to Calendar</button>
        </div>
      </Modal>
    </div>
  );
}
