import React, { useState, useMemo } from 'react';
import { Plus, Users, MessageCircle, AlertCircle, Edit2, Trash2, ChevronRight, Car, Phone, User, ArrowRight, Banknote, CalendarCheck, Landmark } from 'lucide-react';
import { useStore } from '../store';
import { Customer, LoanApplication } from '../types';
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
  return `w-full bg-[#111d35] border ${error ? 'border-red-500/50' : 'border-[#1a2a4a]'} text-white placeholder-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500 transition-colors`;
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

const LEAD_STAGES: Array<Customer['leadStatus'] | 'all'> = ['all', 'contacted', 'test_drive', 'follow_up', 'loan_submitted'];
const STAGE_ORDER: Customer['leadStatus'][] = ['contacted', 'test_drive', 'follow_up', 'loan_submitted'];

const STAGE_COLORS: Record<Customer['leadStatus'], { dot: string; text: string; line: string }> = {
  contacted:     { dot: 'bg-blue-400',   text: 'text-blue-400',   line: 'bg-blue-400' },
  test_drive:    { dot: 'bg-yellow-400', text: 'text-yellow-400', line: 'bg-yellow-400' },
  follow_up:     { dot: 'bg-cyan-400',   text: 'text-cyan-400',   line: 'bg-cyan-400' },
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

  const isDirector = currentUser?.role === 'director';

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
  const [loanStatusLead, setLoanStatusLead] = useState<Customer | null>(null);
  const [loanApps, setLoanApps] = useState<LoanApplication[]>([]);

  const myCustomers = useMemo(() =>
    customers
      .filter(c => isDirector || c.assignedSalesId === currentUser?.id)
      .map(c => STAGE_ORDER.includes(c.leadStatus) ? c : { ...c, leadStatus: 'contacted' as Customer['leadStatus'] }),
    [customers, isDirector, currentUser]
  );

  const filtered = useMemo(() => myCustomers.filter(c => {
    const matchStatus = statusFilter === 'all' || c.leadStatus === statusFilter;
    const matchSource = sourceFilter === 'all' || c.source === sourceFilter;
    const matchSearch = !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search);
    return matchStatus && matchSource && matchSearch;
  }), [myCustomers, statusFilter, sourceFilter, search]);

  const salespeople = users.filter(u => u.role === 'salesperson' || u.role === 'director');
  const getSalesName = (salesId: string) => users.find(u => u.id === salesId)?.name ?? salesId;
  const getCar = (id?: string) => cars.find(c => c.id === id);

  const statusCounts = useMemo(() => {
    const counts: Partial<Record<Customer['leadStatus'] | 'all', number>> = { all: myCustomers.length };
    myCustomers.forEach(c => { counts[c.leadStatus] = (counts[c.leadStatus] ?? 0) + 1; });
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
        <div>
          <h1 className="text-white text-xl font-bold">Leads</h1>
          <p className="text-gray-500 text-sm mt-0.5">{myCustomers.length} total leads</p>
        </div>
        <button onClick={openAdd} className="flex items-center gap-2 bg-cyan-500 hover:bg-cyan-400 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors shadow-lg shadow-cyan-500/20">
          <Plus size={16} />New Lead
        </button>
      </div>

      {/* Status filter cards */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        {LEAD_STAGES.map(s => {
          const count = statusCounts[s] ?? 0;
          const isActive = statusFilter === s;
          const label = s === 'all' ? 'All' : LEAD_STATUS_LABELS[s as Customer['leadStatus']];
          const color = s === 'all'
            ? { text: 'text-white', border: 'border-cyan-500', bg: 'bg-cyan-500/10', dot: '' }
            : {
                contacted:      { text: 'text-blue-400',   border: 'border-blue-500/60',   bg: 'bg-blue-500/10',   dot: 'bg-blue-400' },
                test_drive:     { text: 'text-yellow-400', border: 'border-yellow-500/60', bg: 'bg-yellow-500/10', dot: 'bg-yellow-400' },
                follow_up:      { text: 'text-cyan-400',   border: 'border-cyan-500/60',   bg: 'bg-cyan-500/10',   dot: 'bg-cyan-400' },
                loan_submitted: { text: 'text-green-400',  border: 'border-green-500/60',  bg: 'bg-green-500/10',  dot: 'bg-green-400' },
              }[s as Customer['leadStatus']] ?? { text: 'text-gray-400', border: 'border-gray-500/60', bg: 'bg-gray-500/10', dot: 'bg-gray-400' };
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-xl p-3 text-left border transition-all ${isActive ? `${color.bg} ${color.border}` : 'bg-[#0d1526] border-[#1a2a4a] hover:border-[#2a3a5a]'}`}
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
          className="flex-1 bg-[#0d1526] border border-[#1a2a4a] text-white placeholder-gray-600 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-cyan-500 transition-colors"
        />
        <select
          value={sourceFilter}
          onChange={e => setSourceFilter(e.target.value as Customer['source'] | 'all')}
          className="bg-[#0d1526] border border-[#1a2a4a] text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500 transition-colors"
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
            className="px-3 py-2.5 text-xs text-gray-500 hover:text-white border border-[#1a2a4a] hover:border-[#2a3a5a] rounded-lg transition-colors whitespace-nowrap"
          >
            Clear
          </button>
        )}
      </div>

      {/* Leads list */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Users size={40} className="text-gray-600 mb-3" />
          <p className="text-gray-400">No leads found</p>
        </div>
      ) : (
        <div className="bg-[#0d1526] border border-[#1a2a4a] rounded-xl divide-y divide-[#1a2a4a]">
          {filtered.map(c => {
            const currentIdx = STAGE_ORDER.indexOf(c.leadStatus);
            const canAdvance = currentIdx < STAGE_ORDER.length - 1;
            const nextStage = canAdvance ? STAGE_ORDER[currentIdx + 1] : null;
            const col = STAGE_COLORS[c.leadStatus];
            const isTestDrive = c.leadStatus === 'test_drive';

            return (
              <div key={c.id} className="flex items-center gap-3 px-4 py-3 hover:bg-[#111d35] transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-white text-sm font-medium">{c.name}</span>
                    <span className="text-gray-600 text-xs hidden sm:inline">{c.phone}</span>
                    <span className="text-gray-700 text-xs px-1.5 py-0.5 bg-[#1a2a4a] rounded hidden md:inline">{SOURCE_LABELS[c.source]}</span>
                    {isDirector && <span className="text-gray-600 text-xs hidden lg:inline">{getSalesName(c.assignedSalesId)}</span>}
                  </div>
                  {/* Progress dots */}
                  <div className="flex items-center gap-1 mt-1.5">
                    {STAGE_ORDER.map((stage, idx) => (
                      <React.Fragment key={stage}>
                        <button
                          onClick={() => {
                            if (stage === 'test_drive' && c.leadStatus !== 'test_drive') openTdSchedule(c);
                            else if ((stage === 'follow_up' || stage === 'loan_submitted') && c.leadStatus === 'test_drive') openSidebar(c);
                            else updateCustomer(c.id, { leadStatus: stage });
                          }}
                          title={LEAD_STATUS_LABELS[stage]}
                          className={`w-2 h-2 rounded-full transition-all hover:scale-125 ${
                            idx < currentIdx ? `${STAGE_COLORS[stage].dot} opacity-50` :
                            idx === currentIdx ? `${STAGE_COLORS[stage].dot}` :
                            'bg-[#2a3a5a]'
                          }`}
                        />
                        {idx < STAGE_ORDER.length - 1 && (
                          <div className={`h-px w-4 ${idx < currentIdx ? 'bg-gray-600' : 'bg-[#1a2a4a]'}`} />
                        )}
                      </React.Fragment>
                    ))}
                    <span className={`text-xs font-medium ml-2 ${col.text}`}>
                      {LEAD_STATUS_LABELS[c.leadStatus]}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {isTestDrive ? (
                    <button
                      onClick={() => openSidebar(c)}
                      className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-yellow-500/30 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 transition-colors"
                    >
                      Next Step <ArrowRight size={11} />
                    </button>
                  ) : canAdvance && nextStage && nextStage !== 'loan_submitted' ? (
                    <button
                      onClick={() => nextStage === 'test_drive' ? openTdSchedule(c) : updateCustomer(c.id, { leadStatus: nextStage })}
                      className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-[#1a2a4a] hover:bg-[#1a2a4a] transition-colors ${STAGE_COLORS[nextStage].text}`}
                    >
                      {LEAD_STATUS_LABELS[nextStage]} <ChevronRight size={11} />
                    </button>
                  ) : null}
                  <button onClick={() => handleWhatsApp(c.phone, c.name)} className="p-1.5 text-gray-600 hover:text-green-400 hover:bg-green-500/10 rounded-lg transition-colors">
                    <MessageCircle size={14} />
                  </button>
                  <button onClick={() => openEdit(c)} className="p-1.5 text-gray-600 hover:text-cyan-400 hover:bg-[#1a2a4a] rounded-lg transition-colors">
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
            <div className="bg-[#111d35] border border-[#1a2a4a] rounded-xl p-4 space-y-2">
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
                  className="w-full text-left bg-[#111d35] hover:bg-[#1a2a4a] border border-[#1a2a4a] hover:border-cyan-500/40 rounded-xl p-4 transition-all group"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                        <CalendarCheck size={18} className="text-cyan-400" />
                      </div>
                      <div>
                        <p className="text-white text-sm font-medium">Follow Up</p>
                        <p className="text-gray-500 text-xs mt-0.5">Continue nurturing this lead</p>
                      </div>
                    </div>
                    <ChevronRight size={16} className="text-gray-600 group-hover:text-cyan-400 transition-colors" />
                  </div>
                </button>

                <button
                  onClick={() => setSidebarView('car_select')}
                  className="w-full text-left bg-[#111d35] hover:bg-[#1a2a4a] border border-[#1a2a4a] hover:border-green-500/40 rounded-xl p-4 transition-all group"
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
                      ready: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
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
                            : 'bg-[#111d35] border-[#1a2a4a] hover:border-[#2a3a5a]'
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
                    <div className="flex items-center gap-3 bg-[#111d35] border border-green-500/20 rounded-xl p-3">
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
                                  : 'bg-[#111d35] border-[#1a2a4a] text-gray-400 hover:border-green-500/40 hover:text-gray-200'
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
            <FormField label="Lead Status">
              <select className={inputCls()} value={form.leadStatus} onChange={e => setForm({ ...form, leadStatus: e.target.value as Customer['leadStatus'] })}>
                {(['contacted', 'test_drive', 'follow_up'] as Customer['leadStatus'][]).map(s => (
                  <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Interested Car">
              <select className={inputCls()} value={form.interestedCarId} onChange={e => setForm({ ...form, interestedCarId: e.target.value })}>
                <option value="">— None —</option>
                {cars.filter(car => car.status !== 'sold').map(car => (
                  <option key={car.id} value={car.id}>{car.year} {car.make} {car.model}</option>
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
          <button onClick={() => { setShowModal(false); setEditTarget(null); }} className="flex-1 px-4 py-2.5 border border-[#1a2a4a] text-gray-400 hover:text-white rounded-lg text-sm transition-colors">Cancel</button>
          <button onClick={handleSubmit} className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
            {editTarget ? 'Save Changes' : 'Add Customer'}
          </button>
        </div>
      </Modal>

      {/* Test Drive Scheduling Modal */}
      <Modal isOpen={showTdModal} onClose={() => { setShowTdModal(false); setTdCustomer(null); }} title="Schedule Test Drive" maxWidth="max-w-sm">
        {tdCustomer && (
          <div className="space-y-4">
            <div className="bg-[#111d35] border border-[#1a2a4a] rounded-lg px-3 py-2.5">
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
          <button onClick={() => { setShowTdModal(false); setTdCustomer(null); }} className="flex-1 px-4 py-2.5 border border-[#1a2a4a] text-gray-400 hover:text-white rounded-lg text-sm transition-colors">Cancel</button>
          <button onClick={handleSaveTd} disabled={!tdForm.date || !tdForm.time} className="flex-1 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">Save to Calendar</button>
        </div>
      </Modal>
    </div>
  );
}
