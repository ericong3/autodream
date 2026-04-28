import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Plus, Users, MessageCircle, AlertCircle, Edit2, Trash2, ChevronRight, Car, Phone, ArrowRight, Banknote, CalendarCheck, X, Mail, Briefcase, CheckCircle, XCircle, Camera, ClipboardList, Truck, Upload, Lock, Skull, Clock, RotateCcw } from 'lucide-react';
import { useStore } from '../store';
import { Customer, LoanApplication, LoanSubmission, CashWorkOrder, LoanWorkOrder, WorkOrderItem, BANKS, PostSaleChecklist } from '../types';
import Modal from '../components/Modal';
import DeleteConfirmModal from '../components/DeleteConfirmModal';
import { generateId, formatRM } from '../utils/format';
import { supabase } from '../lib/supabase';

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
  const addPersonalReminder = useStore((s) => s.addPersonalReminder);

  const isDirector = currentUser?.role === 'director';
  const isAdmin = currentUser?.role === 'admin';
  const isDirectorOrAdmin = isDirector || isAdmin;

  // ── Stale lead helpers ────────────────────────────────────
  const getDaysSinceAction = (c: Customer) => {
    const ref = c.lastActionAt ?? c.createdAt;
    return Math.floor((Date.now() - new Date(ref).getTime()) / 86400000);
  };
  const isStale = (c: Customer) => !c.isDead && getDaysSinceAction(c) >= 7;

  const todayStr = new Date().toISOString().slice(0, 10);

  // Tab
  const [tab, setTab] = useState<'leads' | 'loan' | 'confirmed' | 'bin'>('leads');
  const [binMonth, setBinMonth] = useState(() => new Date().toISOString().slice(0, 7));

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

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);

  // Test drive scheduling modal
  const [showTdModal, setShowTdModal] = useState(false);
  const [tdCustomer, setTdCustomer] = useState<Customer | null>(null);
  const [tdForm, setTdForm] = useState({ carId: '', date: '', time: '', notes: '' });

  // Next-step modal (for test_drive leads)
  const [sidebarLead, setSidebarLead] = useState<Customer | null>(null);
  const [sidebarView, setSidebarView] = useState<'options' | 'car_select' | 'loan' | 'cash'>('options');
  const [sidebarCashFlow, setSidebarCashFlow] = useState(false);
  const [loanForm, setLoanForm] = useState({ dealPrice: '', carId: '' });
  const [cashForm, setCashForm] = useState({ dealPrice: '', notes: '' });

  // Work order overlay
  const [workOrderCustomer, setWorkOrderCustomer] = useState<Customer | null>(null);
  const [workOrderCarId, setWorkOrderCarId] = useState('');
  const emptyWorkOrder = {
    sellingPrice: 0, insurance: 0, bankProduct: 0,
    additionalItems: [] as WorkOrderItem[],
    bookingFee: 0, downpayment: 0, discount: 0,
    loanAmount: 0, approvedBank: '',
    customerName: '', customerIc: '', customerPhone: '', customerEmail: '', customerAddress: '',
    hasTradeIn: false,
    tradeInPhotos: [] as string[], greenCardPhoto: '',
    tradeInPlate: '', tradeInMake: '', tradeInModel: '', tradeInVariant: '',
    tradeInPrice: 0, settlementFigure: 0,
  };
  const [woForm, setWoForm] = useState({ ...emptyWorkOrder });
  const [workOrderType, setWorkOrderType] = useState<'cash' | 'loan'>('cash');
  const tiPhotoRef = useRef<HTMLInputElement>(null);
  const gcPhotoRef = useRef<HTMLInputElement>(null);

  const [bankStatuses, setBankStatuses] = useState<LoanApplication[]>([]);


  // Detail drawer
  const [detailLead, setDetailLead] = useState<Customer | null>(null);
  const [detailTab, setDetailTab] = useState<'details' | 'calculation' | 'postsale'>('details');
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);
  const [deliveryPhotoUrl, setDeliveryPhotoUrl] = useState('');
  const [deliveryUploading, setDeliveryUploading] = useState(false);
  const deliveryPhotoRef = useRef<HTMLInputElement>(null);
  const [expandedBank, setExpandedBank] = useState<string | null>(null);
  const [addBankInput, setAddBankInput] = useState('');
  useEffect(() => {
    if (!detailLead) { setExpandedBank(null); setAddBankInput(''); return; }
    const apps = detailLead.loanApplications?.length
      ? detailLead.loanApplications
      : (detailLead.loanBankSubmitted ?? '').split(',').filter(Boolean).map(b => ({ bank: b.trim(), status: 'submitted' as const }));
    setBankStatuses(apps);
    setExpandedBank(null);
  }, [detailLead?.id]);

  const myCustomers = useMemo(() =>
    customers
      .filter(c => {
        if (!isDirectorOrAdmin) return c.assignedSalesId === currentUser?.id;
        if (directorView === 'all') return true;
        if (directorView === 'own') return c.assignedSalesId === currentUser?.id;
        return c.assignedSalesId === directorView;
      })
      .map(c => STAGE_ORDER.includes(c.leadStatus) ? c : { ...c, leadStatus: 'contacted' as Customer['leadStatus'] }),
    [customers, isDirectorOrAdmin, currentUser, directorView]
  );

  const todayTestDrives = useMemo(() =>
    testDrives.filter(td =>
      td.scheduledAt.startsWith(todayStr) &&
      td.status === 'scheduled' &&
      (isDirector || td.salesId === currentUser?.id)
    ), [testDrives, todayStr, isDirector, currentUser]);

  const leadsFiltered = useMemo(() => myCustomers.filter(c => {
    if (c.cashWorkOrder || c.loanWorkOrder) return false; // moved to Confirmed
    if (c.leadStatus === 'loan_submitted') return false;
    if (c.isDead) return false;
    const matchStatus = statusFilter === 'all' || c.leadStatus === statusFilter;
    const matchSource = sourceFilter === 'all' || c.source === sourceFilter;
    const matchSearch = !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search);
    return matchStatus && matchSource && matchSearch;
  }), [myCustomers, statusFilter, sourceFilter, search]);

  const deadLeads = useMemo(() => myCustomers.filter(c =>
    c.isDead && !c.cashWorkOrder && !c.loanWorkOrder && c.leadStatus !== 'loan_submitted' &&
    (!search || c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search))
  ), [myCustomers, search]);

  const loanFiltered = useMemo(() => myCustomers.filter(c => {
    if (c.cashWorkOrder || c.loanWorkOrder) return false; // moved to Confirmed
    if (c.leadStatus !== 'loan_submitted') return false;
    if (c.isTrashed) return false;
    const matchSource = sourceFilter === 'all' || c.source === sourceFilter;
    const matchSearch = !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search);
    return matchSource && matchSearch;
  }), [myCustomers, sourceFilter, search]);

  const trashedFiltered = useMemo(() => myCustomers.filter(c => {
    if (!c.isTrashed) return false;
    const matchMonth = !binMonth || (c.trashedAt ?? '').startsWith(binMonth);
    const matchSearch = !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search);
    return matchMonth && matchSearch;
  }), [myCustomers, binMonth, search]);

  const confirmedFiltered = useMemo(() => myCustomers.filter(c => {
    if (c.delivered) return false; // delivered = archived in History
    const hasWorkOrder = !!(c.cashWorkOrder || c.loanWorkOrder);
    const legacyConfirmed = !!c.dealPrice && !!cars.find(x => x.id === c.interestedCarId)?.finalDeal;
    if (!hasWorkOrder && !legacyConfirmed) return false;
    const matchSearch = !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search);
    return matchSearch;
  }), [myCustomers, cars, search]);

  const salespeople = users.filter(u => u.role === 'salesperson' || u.role === 'director' || u.role === 'admin');
  const getSalesName = (salesId: string) => users.find(u => u.id === salesId)?.name ?? salesId;
  const getCar = (id?: string) => cars.find(c => c.id === id);

  const statusCounts = useMemo(() => {
    const leads = myCustomers.filter(c => !c.cashWorkOrder && !c.loanWorkOrder && c.leadStatus !== 'loan_submitted' && !c.isDead);
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
    const now = new Date().toISOString();
    const payload = { ...form, followUpRemark: form.followUpRemark || undefined };
    if (editTarget) {
      updateCustomer(editTarget.id, { ...payload, lastActionAt: now });
    } else {
      addCustomer({ id: generateId(), ...payload, lastActionAt: now, createdAt: now });
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

  // ── Revert ────────────────────────────────────────────────
  const handleRevert = async (c: Customer) => {
    const { cars: allCars, updateCar } = useStore.getState();
    const car = allCars.find(x => x.id === c.interestedCarId);
    if (c.loanWorkOrder) {
      // Confirmed (loan) → Loan tab: clear work order, keep loan_submitted
      updateCustomer(c.id, { loanWorkOrder: undefined, dealPrice: 0 });
      await supabase.from('customers').update({ loan_work_order: null, deal_price: 0 }).eq('id', c.id);
      if (car) {
        updateCar(car.id, { status: 'available', finalDeal: undefined });
        await supabase.from('cars').update({ status: 'available', final_deal: null }).eq('id', car.id);
      }
    } else if (c.cashWorkOrder) {
      // Confirmed (cash) → Leads: clear work order, reset to follow_up
      updateCustomer(c.id, { cashWorkOrder: undefined, dealPrice: 0, leadStatus: 'follow_up', loanStatus: 'not_started', loanBankSubmitted: '', loanApplications: [] });
      await supabase.from('customers').update({ cash_work_order: null, deal_price: 0 }).eq('id', c.id);
      if (car) {
        updateCar(car.id, { status: 'available', finalDeal: undefined });
        await supabase.from('cars').update({ status: 'available', final_deal: null }).eq('id', car.id);
      }
    } else if (c.leadStatus === 'loan_submitted') {
      // Loan tab → Leads: reset status and loan data
      updateCustomer(c.id, { leadStatus: 'follow_up', loanStatus: 'not_started', loanBankSubmitted: '', loanApplications: [], dealPrice: 0 });
    } else if (c.leadStatus === 'follow_up') {
      updateCustomer(c.id, { leadStatus: 'test_drive' });
    } else if (c.leadStatus === 'test_drive') {
      updateCustomer(c.id, { leadStatus: 'contacted' });
    }
    setDetailLead(null);
  };

  const getRevertLabel = (c: Customer): string | null => {
    if (c.loanWorkOrder) return 'Revert to Loan';
    if (c.cashWorkOrder) return 'Revert to Leads';
    if (c.leadStatus === 'loan_submitted') return 'Revert to Follow Up';
    if (c.leadStatus === 'follow_up') return 'Revert to Test Drive';
    if (c.leadStatus === 'test_drive') return 'Revert to Contacted';
    return null;
  };

  // ── Delivery ──────────────────────────────────────────────
  const handleDeliveryConfirm = async (c: Customer) => {
    const { cars: allCars, repairs: allRepairs, updateCar } = useStore.getState();
    const car = allCars.find(x => x.id === c.interestedCarId);
    // Commission auto-calc: profit = selling - purchase - repairs; RM 2k if > 12k else RM 1k
    const wo = c.loanWorkOrder ?? c.cashWorkOrder;
    const dealPrice = wo ? (wo.sellingPrice - (wo.discount ?? 0)) : (car?.sellingPrice ?? 0);
    const purchasePrice = car?.purchasePrice ?? 0;
    const repairTotal = allRepairs.filter(r => r.carId === c.interestedCarId).reduce((s, r) => s + (r.actualCost ?? r.totalCost), 0);
    const netProfit = dealPrice - purchasePrice - repairTotal;
    const commission = netProfit > 12000 ? 2000 : 1000;

    updateCustomer(c.id, {
      delivered: true,
      deliveredAt: new Date().toISOString(),
      deliveryPhoto: deliveryPhotoUrl || undefined,
      commission,
      lastActionAt: new Date().toISOString(),
    });
    // Auto-update car: sold + deliveryCollected
    if (car) {
      updateCar(car.id, { status: 'delivered', deliveryCollected: true, deliveryPhoto: deliveryPhotoUrl || undefined });
    }
    setShowDeliveryModal(false);
    setDeliveryPhotoUrl('');
    setDetailLead(null);
  };

  // ── Dead Lead ─────────────────────────────────────────────
  const handleMarkDead = async (c: Customer) => {
    const now = new Date().toISOString();
    updateCustomer(c.id, { isDead: true, deadAt: now });
    setDetailLead(null);
  };

  const handleReviveLead = async (c: Customer) => {
    updateCustomer(c.id, { isDead: false, deadAt: undefined, lastActionAt: new Date().toISOString() });
    setDetailLead(null);
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
    setLoanForm({ dealPrice: String(interestedCar?.sellingPrice ?? ''), carId: c.interestedCarId ?? '' });
    setCashForm({ dealPrice: String(interestedCar?.sellingPrice ?? ''), notes: '' });
  };

  const closeSidebar = () => {
    setSidebarLead(null);
    setSidebarView('options');
    setSidebarCashFlow(false);
  };

  const handleFollowUp = () => {
    if (!sidebarLead) return;
    updateCustomer(sidebarLead.id, { leadStatus: 'follow_up', lastActionAt: new Date().toISOString() });
    closeSidebar();
  };

  const handleProceedLoan = () => {
    if (!sidebarLead) return;
    updateCustomer(sidebarLead.id, {
      leadStatus: 'loan_submitted',
      loanStatus: 'submitted',
      interestedCarId: loanForm.carId || sidebarLead.interestedCarId,
      dealPrice: loanForm.dealPrice ? Number(loanForm.dealPrice) : sidebarLead.dealPrice,
      lastActionAt: new Date().toISOString(),
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

  // ── Work order ────────────────────────────────────────────
  const handleWoPhoto = (e: React.ChangeEvent<HTMLInputElement>, field: 'tradeIn' | 'greenCard') => {
    const files = Array.from(e.target.files ?? []);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = ev => {
        const url = ev.target?.result as string;
        if (field === 'tradeIn') {
          setWoForm(f => ({ ...f, tradeInPhotos: [...f.tradeInPhotos, url] }));
        } else {
          setWoForm(f => ({ ...f, greenCardPhoto: url }));
        }
      };
      reader.readAsDataURL(file);
    });
    if (e.target) e.target.value = '';
  };

  const handleWorkOrderSubmit = () => {
    if (!workOrderCustomer) return;
    const car = getCar(workOrderCarId);
    const totalFinalDeal = woForm.sellingPrice - woForm.discount;
    const hasDiscount = car ? woForm.sellingPrice < car.sellingPrice : false;

    const workOrder: CashWorkOrder = {
      carId: workOrderCarId,
      sellingPrice: woForm.sellingPrice,
      insurance: woForm.insurance,
      bankProduct: woForm.bankProduct,
      additionalItems: woForm.additionalItems,
      bookingFee: woForm.bookingFee,
      downpayment: woForm.downpayment,
      discount: woForm.discount,
      customerName: woForm.customerName,
      customerIc: woForm.customerIc,
      customerPhone: woForm.customerPhone,
      customerEmail: woForm.customerEmail,
      customerAddress: woForm.customerAddress,
      hasTradeIn: woForm.hasTradeIn,
      tradeInPhotos: woForm.tradeInPhotos,
      greenCardPhoto: woForm.greenCardPhoto,
      tradeInPlate: woForm.tradeInPlate,
      tradeInMake: woForm.tradeInMake,
      tradeInModel: woForm.tradeInModel,
      tradeInVariant: woForm.tradeInVariant,
      tradeInPrice: woForm.tradeInPrice,
      settlementFigure: woForm.settlementFigure,
      submittedBy: currentUser?.name ?? '',
      createdAt: new Date().toISOString(),
    };

    updateCustomer(workOrderCustomer.id, {
      leadStatus: 'loan_submitted',
      loanStatus: 'approved',
      loanBankSubmitted: 'Cash',
      loanApplications: [{ bank: 'Cash', status: 'approved' }],
      interestedCarId: workOrderCarId,
      dealPrice: totalFinalDeal,
      cashWorkOrder: workOrder,
    });

    if (car) {
      const updateCar = useStore.getState().updateCar;
      updateCar(car.id, {
        status: 'deal_pending',
        finalDeal: {
          submittedBy: currentUser?.name ?? '',
          submittedAt: new Date().toISOString(),
          dealPrice: totalFinalDeal,
          bank: 'Cash',
          approvalStatus: (hasDiscount || woForm.discount > 0) ? 'pending' : 'approved',
          approvedBy: (hasDiscount || woForm.discount > 0) ? undefined : currentUser?.name,
          approvedAt: (hasDiscount || woForm.discount > 0) ? undefined : new Date().toISOString(),
        },
      });
    }
    setWorkOrderCustomer(null);
  };


  const handleSaveBankStatuses = (customerId: string, apps?: LoanApplication[]) => {
    const list = apps ?? bankStatuses;
    const anyApproved = list.some(a => a.status === 'approved');
    const allResolved = list.every(a => a.status !== 'submitted');
    const overallStatus: Customer['loanStatus'] = anyApproved ? 'approved' : allResolved ? 'rejected' : 'submitted';
    updateCustomer(customerId, { loanApplications: list, loanStatus: overallStatus, lastActionAt: new Date().toISOString() });
    setDetailLead(prev => prev ? { ...prev, loanApplications: list, loanStatus: overallStatus } : prev);

    // Sync to car.loanSubmissions so the Loan Log on CarDetail stays up to date
    const customer = customers.find(c => c.id === customerId) ?? detailLead;
    if (customer?.interestedCarId) {
      const { cars: allCars, updateCar } = useStore.getState();
      const car = allCars.find(c => c.id === customer.interestedCarId);
      if (car) {
        const existing = car.loanSubmissions ?? [];
        const otherEntries = existing.filter(s => s.customerPhone !== customer.phone);
        const updatedEntries: LoanSubmission[] = list.map(app => {
          const prev = existing.find(s => s.customerPhone === customer.phone && s.bank === app.bank);
          return {
            id: prev?.id ?? generateId(),
            bank: app.bank,
            customerName: customer.name,
            customerPhone: customer.phone,
            submittedBy: prev?.submittedBy ?? currentUser?.id ?? '',
            submittedAt: prev?.submittedAt ?? new Date().toISOString(),
            status: app.status,
            notes: prev?.notes,
          };
        });
        updateCar(car.id, { loanSubmissions: [...otherEntries, ...updatedEntries] });
      }
    }
  };

  const toggleBankStatus = (bank: string, newStatus: 'approved' | 'rejected' | 'submitted') => {
    setBankStatuses(prev => prev.map(a => {
      if (a.bank !== bank) return a;
      return {
        ...a,
        status: newStatus,
        approvedAt: newStatus === 'approved' && !a.approvedAt ? new Date().toISOString() : a.approvedAt,
      };
    }));
  };

  // ── Loan Work Order ───────────────────────────────────────
  const openFinalDeal = (c: Customer) => {
    const approvedApp = c.loanApplications?.find(a => a.status === 'approved');
    const car = getCar(c.interestedCarId);
    setWoForm({
      ...emptyWorkOrder,
      sellingPrice: car?.sellingPrice ?? 0,
      approvedBank: approvedApp?.bank ?? '',
      loanAmount: approvedApp?.approvedAmount ?? 0,
      customerName: c.name,
      customerIc: c.ic ?? '',
      customerPhone: c.phone,
      customerEmail: c.email ?? '',
    });
    setWorkOrderCarId(c.interestedCarId ?? '');
    setWorkOrderCustomer(c);
    setWorkOrderType('loan');
  };

  const handleLoanWoSubmit = () => {
    if (!workOrderCustomer) return;
    const car = getCar(workOrderCarId);
    const totalFinalDeal = woForm.sellingPrice - woForm.discount;
    const hasDiscount = car ? woForm.discount > 0 || woForm.sellingPrice < car.sellingPrice : false;

    const loanWorkOrder: LoanWorkOrder = {
      carId: workOrderCarId,
      bank: woForm.approvedBank,
      loanAmount: woForm.loanAmount,
      sellingPrice: woForm.sellingPrice,
      insurance: woForm.insurance,
      bankProduct: woForm.bankProduct,
      additionalItems: woForm.additionalItems,
      bookingFee: woForm.bookingFee,
      discount: woForm.discount,
      customerName: woForm.customerName,
      customerIc: woForm.customerIc,
      customerPhone: woForm.customerPhone,
      customerEmail: woForm.customerEmail,
      customerAddress: woForm.customerAddress,
      hasTradeIn: woForm.hasTradeIn,
      tradeInPhotos: woForm.tradeInPhotos,
      greenCardPhoto: woForm.greenCardPhoto,
      tradeInPlate: woForm.tradeInPlate,
      tradeInMake: woForm.tradeInMake,
      tradeInModel: woForm.tradeInModel,
      tradeInVariant: woForm.tradeInVariant,
      tradeInPrice: woForm.tradeInPrice,
      settlementFigure: woForm.settlementFigure,
      submittedBy: currentUser?.name ?? '',
      createdAt: new Date().toISOString(),
    };

    updateCustomer(workOrderCustomer.id, {
      dealPrice: totalFinalDeal,
      loanStatus: 'approved',
      loanWorkOrder,
    });

    if (car) {
      const storeUpdateCar = useStore.getState().updateCar;
      storeUpdateCar(car.id, {
        status: 'deal_pending',
        finalDeal: {
          submittedBy: currentUser?.name ?? '',
          submittedAt: new Date().toISOString(),
          dealPrice: totalFinalDeal,
          bank: woForm.approvedBank,
          approvalStatus: hasDiscount ? 'pending' : 'approved',
          approvedBy: hasDiscount ? undefined : currentUser?.name,
          approvedAt: hasDiscount ? undefined : new Date().toISOString(),
        },
      });
    }

    setWorkOrderCustomer(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card p-1">
          <button
            onClick={() => { setTab('leads'); setStatusFilter('all'); }}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'leads' ? 'bg-gold-500 text-white shadow' : 'text-gray-400 hover:text-white'}`}
          >
            Leads
            <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${tab === 'leads' ? 'bg-white/20' : 'bg-[#2C2415]'}`}>{myCustomers.filter(c => !c.cashWorkOrder && !c.loanWorkOrder && c.leadStatus !== 'loan_submitted' && !c.isDead).length}</span>
            {myCustomers.filter(c => !c.cashWorkOrder && !c.loanWorkOrder && c.leadStatus !== 'loan_submitted' && isStale(c)).length > 0 && (
              <span className="ml-1 text-xs px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400">{myCustomers.filter(c => !c.cashWorkOrder && !c.loanWorkOrder && c.leadStatus !== 'loan_submitted' && isStale(c)).length} stale</span>
            )}
          </button>
          <button
            onClick={() => { setTab('loan'); setStatusFilter('all'); }}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'loan' ? 'bg-green-500 text-white shadow' : 'text-gray-400 hover:text-white'}`}
          >
            Loan <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${tab === 'loan' ? 'bg-white/20' : 'bg-[#2C2415]'}`}>{myCustomers.filter(c => !c.cashWorkOrder && !c.loanWorkOrder && c.leadStatus === 'loan_submitted').length}</span>
          </button>
          <button
            onClick={() => { setTab('confirmed'); setStatusFilter('all'); }}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'confirmed' ? 'bg-violet-500 text-white shadow' : 'text-gray-400 hover:text-white'}`}
          >
            Confirmed <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${tab === 'confirmed' ? 'bg-white/20' : 'bg-[#2C2415]'}`}>{myCustomers.filter(c => !c.delivered && (!!(c.cashWorkOrder || c.loanWorkOrder) || (!!c.dealPrice && !!cars.find(x => x.id === c.interestedCarId)?.finalDeal))).length}</span>
          </button>
          <button
            onClick={() => { setTab('bin'); setStatusFilter('all'); }}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 ${tab === 'bin' ? 'bg-red-500/80 text-white shadow' : 'text-gray-400 hover:text-white'}`}
            title="Rejected / Trashed Cases"
          >
            <Trash2 size={14} />
            {myCustomers.filter(c => c.isTrashed).length > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${tab === 'bin' ? 'bg-white/20' : 'bg-red-500/20 text-red-400'}`}>{myCustomers.filter(c => c.isTrashed).length}</span>
            )}
          </button>
        </div>
        {tab === 'leads' && (
          <button onClick={openAdd} className="flex items-center gap-2 btn-gold px-4 py-2.5 rounded-lg text-sm">
            <Plus size={16} />New Lead
          </button>
        )}
      </div>

      {/* Director view toggle */}
      {isDirectorOrAdmin && (
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
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white text-sm font-medium">{c.name}</span>
                      <span className="text-gray-600 text-xs hidden sm:inline">{c.phone}</span>
                      <span className="text-gray-700 text-xs px-1.5 py-0.5 bg-[#2C2415] rounded hidden md:inline">{SOURCE_LABELS[c.source]}</span>
                      {isDirectorOrAdmin && <span className="text-gray-600 text-xs hidden lg:inline">{getSalesName(c.assignedSalesId)}</span>}
                      {isStale(c) && (
                        <span className="flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/25">
                          <Clock size={9} />{getDaysSinceAction(c)}d stale
                        </span>
                      )}
                    </div>
                    {(() => { const car = getCar(c.interestedCarId); return car ? (
                      <div className="flex items-center gap-1 mt-0.5">
                        <Car size={10} className="text-gray-600 flex-shrink-0" />
                        <span className="text-gray-500 text-xs">{car.year} {car.make} {car.model}{car.variant ? ` ${car.variant}` : ''}</span>
                        {car.carPlate && <span className="text-xs font-mono text-gold-500/70">{car.carPlate}</span>}
                      </div>
                    ) : null; })()}
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
                    <button onClick={() => setDeleteTarget({ id: c.id, label: c.name })} className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Dead Leads section */}
        {deadLeads.length > 0 && (
          <details className="group">
            <summary className="flex items-center gap-2 px-1 py-2 text-gray-600 hover:text-gray-400 cursor-pointer text-xs font-medium select-none list-none">
              <Skull size={13} />
              Dead Leads ({deadLeads.length})
              <span className="ml-auto text-gray-700 group-open:rotate-90 transition-transform">›</span>
            </summary>
            <div className="bg-card-gradient border border-obsidian-400/40 rounded-xl shadow-card divide-y divide-obsidian-400/40 opacity-60">
              {deadLeads.map(c => (
                <div key={c.id} className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:opacity-80" onClick={() => setDetailLead(c)}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400 text-sm font-medium line-through">{c.name}</span>
                      <span className="text-gray-600 text-xs">{c.phone}</span>
                    </div>
                    {(() => { const car = getCar(c.interestedCarId); return car ? (
                      <span className="text-gray-600 text-xs">{car.year} {car.make} {car.model}</span>
                    ) : null; })()}
                  </div>
                  <span className="text-gray-700 text-xs">
                    {c.deadAt ? new Date(c.deadAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' }) : ''}
                  </span>
                </div>
              ))}
            </div>
          </details>
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
                <div key={c.id} className="divide-y divide-obsidian-400/40">
                  {/* Row */}
                  <div className="flex items-center gap-3 px-4 py-3 hover:bg-obsidian-700/50 transition-colors cursor-pointer" onClick={() => setDetailLead(c)}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-white text-sm font-medium">{c.name}</span>
                        <span className="text-gray-600 text-xs hidden sm:inline">{c.phone}</span>
                        {isDirectorOrAdmin && <span className="text-gray-600 text-xs hidden lg:inline">{getSalesName(c.assignedSalesId)}</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                        {car && <span className="text-gray-400 text-xs">{car.year} {car.make} {car.model}</span>}
                        {c.loanApplications?.length ? (
                          <div className="flex flex-wrap gap-1">
                            {c.loanApplications.map(a => {
                              const daysLeft = a.approvedAt ? 90 - Math.floor((Date.now() - new Date(a.approvedAt).getTime()) / 86400000) : null;
                              const expiring = daysLeft !== null && daysLeft <= 20;
                              return (
                                <span key={a.bank} className={`text-xs ${
                                  a.status === 'approved' ? 'text-green-400' :
                                  a.status === 'rejected' ? 'text-red-400' :
                                  'text-yellow-400'
                                }`}>
                                  {a.bank}
                                  {expiring && (
                                    <span className="ml-1 text-orange-400">⚠ {daysLeft}d</span>
                                  )}
                                </span>
                              );
                            })}
                          </div>
                        ) : c.loanBankSubmitted ? (
                          <span className="text-gray-500 text-xs">{c.loanBankSubmitted}</span>
                        ) : null}
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
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${
                        loanInfo.label === 'Approved' ? 'bg-green-500/10 border-green-500/30 text-green-400' :
                        loanInfo.label === 'Rejected' ? 'bg-red-500/10 border-red-500/30 text-red-400' :
                        'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
                      }`}>{loanInfo.label}</span>
                      <button onClick={() => handleWhatsApp(c.phone, c.name)} className="flex items-center gap-1 px-2 py-1.5 text-xs text-green-400 bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 rounded-lg transition-colors">
                        <MessageCircle size={12} />WA
                      </button>
                      {c.loanApplications?.length && c.loanApplications.every(a => a.status === 'rejected') && (
                        <button
                          onClick={() => updateCustomer(c.id, { isTrashed: true, trashedAt: new Date().toISOString() })}
                          className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                          title="Toss to bin"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                      <button onClick={() => openEdit(c)} className="p-1.5 text-gray-600 hover:text-gold-400 hover:bg-obsidian-600/60 rounded-lg transition-colors">
                        <Edit2 size={14} />
                      </button>
                    </div>
                  </div>

                </div>
              );
            })}
          </div>
        )}
      </>)}

      {/* ── Bin tab ── */}
      {tab === 'bin' && (<>
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Search by name or phone..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 input rounded-lg px-4 py-2.5 text-sm"
          />
          <input
            type="month"
            value={binMonth}
            onChange={e => setBinMonth(e.target.value)}
            className="input rounded-lg px-3 py-2.5 text-sm"
          />
          {binMonth && (
            <button onClick={() => setBinMonth('')} className="px-3 py-2.5 text-xs text-gray-500 hover:text-white border border-obsidian-400/60 rounded-lg transition-colors whitespace-nowrap">All Time</button>
          )}
        </div>

        {trashedFiltered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Trash2 size={40} className="text-gray-600 mb-3" />
            <p className="text-gray-400">No rejected cases in bin</p>
            <p className="text-gray-600 text-xs mt-1">{binMonth ? 'Try changing the month filter' : 'Cases tossed from the Loan tab will appear here'}</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-gray-500 text-xs">{trashedFiltered.length} rejected case{trashedFiltered.length > 1 ? 's' : ''}{binMonth ? ` in ${new Date(binMonth + '-01').toLocaleDateString('en-MY', { month: 'long', year: 'numeric' })}` : ''}</p>
            <div className="bg-card-gradient border border-red-500/20 rounded-xl shadow-card divide-y divide-obsidian-400/60">
              {trashedFiltered.map(c => {
                const car = getCar(c.interestedCarId);
                const rejectedBanks = c.loanApplications?.filter(a => a.status === 'rejected') ?? [];
                return (
                  <div key={c.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-white text-sm font-medium">{c.name}</span>
                        <span className="text-gray-600 text-xs">{c.phone}</span>
                        {isDirectorOrAdmin && <span className="text-gray-600 text-xs hidden lg:inline">{getSalesName(c.assignedSalesId)}</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        {car && <span className="text-gray-500 text-xs">{car.year} {car.make} {car.model}</span>}
                        {rejectedBanks.length > 0 && (
                          <div className="flex gap-1 flex-wrap">
                            {rejectedBanks.map(a => (
                              <span key={a.bank} className="text-xs text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full">{a.bank}</span>
                            ))}
                          </div>
                        )}
                        {c.trashedAt && (
                          <span className="text-gray-600 text-xs">Binned {new Date(c.trashedAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => updateCustomer(c.id, { isTrashed: false, trashedAt: undefined })}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-400 hover:text-white bg-obsidian-700/60 hover:bg-obsidian-600/60 border border-obsidian-400/60 rounded-lg transition-colors"
                      title="Restore to Loan tab"
                    >
                      <RotateCcw size={12} /> Restore
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </>)}

      {/* ── Confirmed Cases tab ── */}
      {tab === 'confirmed' && (<>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Search by name or phone..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 input rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-gold-500 transition-colors"
          />
        </div>
        {confirmedFiltered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <CheckCircle size={40} className="text-gray-600 mb-3" />
            <p className="text-gray-400">No confirmed cases yet</p>
            <p className="text-gray-600 text-xs mt-1">Cases appear here once a work order is submitted</p>
          </div>
        ) : (
          <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card divide-y divide-obsidian-400/60">
            {confirmedFiltered.map(c => {
              const car = getCar(c.interestedCarId);
              const isLoan = !!c.loanWorkOrder;
              const wo = c.loanWorkOrder ?? c.cashWorkOrder;
              return (
                <div key={c.id} className="flex items-center gap-3 px-4 py-3 hover:bg-obsidian-700/50 transition-colors cursor-pointer" onClick={() => { setDetailLead(c); setDetailTab('details'); }}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white text-sm font-medium">{c.name}</span>
                      <span className="text-gray-500 text-xs">{c.phone}</span>
                      {isDirectorOrAdmin && <span className="text-gray-600 text-xs">{getSalesName(c.assignedSalesId)}</span>}
                    </div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      {car && <span className="text-gray-400 text-xs">{car.year} {car.make} {car.model}</span>}
                      {(wo?.sellingPrice || c.dealPrice) ? <span className="text-gold-400 text-xs font-semibold">{formatRM(wo?.sellingPrice ?? c.dealPrice ?? 0)}</span> : null}
                      {wo && <span className="text-gray-600 text-xs">{new Date(wo.createdAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${isLoan ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' : 'bg-green-500/10 border-green-500/30 text-green-400'}`}>
                      {isLoan ? `Loan · ${c.loanWorkOrder?.bank}` : 'Cash'}
                    </span>
                    {c.delivered
                      ? <span className="text-xs font-medium px-2.5 py-1 rounded-full border bg-green-500/10 border-green-500/30 text-green-400 flex items-center gap-1"><Truck size={10} />Delivered</span>
                      : <span className="text-xs font-medium px-2.5 py-1 rounded-full border bg-violet-500/10 border-violet-500/30 text-violet-400">Confirmed</span>
                    }
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </>)}

      {/* ── Lead Detail Modal ────────────────────────── */}
      {detailLead && (() => {
        const car = getCar(detailLead.interestedCarId);
        const wo = detailLead.loanWorkOrder ?? detailLead.cashWorkOrder;
        const isLoanWo = !!detailLead.loanWorkOrder;
        const hasWorkOrder = !!wo;
        return (
          <>
            <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" onClick={() => setDetailLead(null)} />
            <div className="fixed inset-0 z-50 overflow-y-auto pointer-events-none">
              <div className="flex min-h-full items-center justify-center p-4">
                <div key={detailLead.id} className="pointer-events-auto relative w-full max-w-sm bg-gradient-to-b from-obsidian-700 to-obsidian-800 border border-obsidian-400/80 rounded-xl shadow-[0_20px_80px_rgba(0,0,0,0.8)] flex flex-col max-h-[90vh]">
                  <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-xl bg-gold-gradient opacity-80" />

                  {/* Header */}
                  <div className="flex items-center justify-between px-5 py-4 border-b border-obsidian-400/60 shrink-0">
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

                  {/* Tabs — only show when there's a work order */}
                  {hasWorkOrder && (
                    <div className="flex border-b border-obsidian-400/60 shrink-0">
                      <button
                        onClick={() => setDetailTab('details')}
                        className={`flex-1 py-2.5 text-xs font-medium transition-colors ${detailTab === 'details' ? 'text-white border-b-2 border-gold-500' : 'text-gray-500 hover:text-gray-300'}`}
                      >
                        Details
                      </button>
                      <button
                        onClick={() => setDetailTab('calculation')}
                        className={`flex-1 py-2.5 text-xs font-medium transition-colors ${detailTab === 'calculation' ? 'text-white border-b-2 border-gold-500' : 'text-gray-500 hover:text-gray-300'}`}
                      >
                        Calculation
                      </button>
                      <button
                        onClick={() => setDetailTab('postsale')}
                        className={`flex-1 py-2.5 text-xs font-medium transition-colors ${detailTab === 'postsale' ? 'text-white border-b-2 border-gold-500' : 'text-gray-500 hover:text-gray-300'}`}
                      >
                        Post-Sale
                      </button>
                    </div>
                  )}

                  {/* Calculation Tab */}
                  {hasWorkOrder && detailTab === 'calculation' && (() => {
                    const lwo = detailLead.loanWorkOrder;
                    const cwo = detailLead.cashWorkOrder;
                    const sellingPrice = wo!.sellingPrice;
                    const insurance = wo!.insurance;
                    const bankProduct = wo!.bankProduct;
                    const additionalItems = wo!.additionalItems ?? [];
                    const bookingFee = wo!.bookingFee;
                    const discount = wo!.discount;
                    const loanAmount = lwo?.loanAmount ?? 0;
                    const downpayment = cwo?.downpayment ?? 0;
                    const customerDownpayment = lwo ? sellingPrice - loanAmount : 0;
                    const finalDeal = sellingPrice - discount;
                    const netTradeIn = wo!.hasTradeIn ? wo!.tradeInPrice - wo!.settlementFigure : 0;

                    const Row = ({ label, value, color = 'text-white', bold = false, sub = false }: { label: string; value: string; color?: string; bold?: boolean; sub?: boolean }) => (
                      <div className={`flex items-center justify-between px-4 py-2.5 border-b border-obsidian-400/20 ${sub ? 'bg-obsidian-800/40' : ''}`}>
                        <span className={`text-xs ${sub ? 'text-gray-500' : 'text-gray-400'}`}>{label}</span>
                        <span className={`text-sm ${color} ${bold ? 'font-bold' : 'font-medium'}`}>{value}</span>
                      </div>
                    );

                    return (
                      <div className="flex-1 overflow-y-auto min-h-0">
                        {/* Car Deal */}
                        <div className="px-4 py-2 bg-obsidian-700/30">
                          <p className="text-gray-500 text-xs uppercase tracking-wide font-semibold">Car Deal</p>
                        </div>
                        <Row label="Selling Price" value={formatRM(sellingPrice)} color="text-white" />
                        {discount > 0 && <Row label="Discount" value={`− ${formatRM(discount)}`} color="text-red-400" sub />}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-obsidian-400/20 bg-gold-500/5">
                          <span className="text-xs text-gold-400 font-semibold">Total Final Deal</span>
                          <span className="text-gold-400 text-sm font-bold">{formatRM(finalDeal)}</span>
                        </div>

                        {/* Others */}
                        {(insurance > 0 || bankProduct > 0 || additionalItems.length > 0) && (<>
                          <div className="px-4 py-2 bg-obsidian-700/30">
                            <p className="text-gray-500 text-xs uppercase tracking-wide font-semibold">Others</p>
                          </div>
                          {insurance > 0 && <Row label="Insurance" value={formatRM(insurance)} />}
                          {bankProduct > 0 && <Row label="Bank Product" value={formatRM(bankProduct)} />}
                          {additionalItems.map((item, i) => <Row key={i} label={item.label || 'Item'} value={formatRM(item.amount)} />)}
                        </>)}

                        {/* Payment */}
                        <div className="px-4 py-2 bg-obsidian-700/30">
                          <p className="text-gray-500 text-xs uppercase tracking-wide font-semibold">Payment</p>
                        </div>
                        {isLoanWo && lwo && (<>
                          <Row label="Bank" value={lwo.bank} color="text-blue-300" />
                          <Row label="Loan Amount" value={formatRM(loanAmount)} color="text-blue-300" />
                          {customerDownpayment > 0 && <Row label="Customer Downpayment" value={formatRM(customerDownpayment)} color="text-blue-300" />}
                        </>)}
                        {!isLoanWo && cwo && (<>
                          {bookingFee > 0 && <Row label="Booking Fee" value={`− ${formatRM(bookingFee)}`} color="text-red-400" />}
                          {downpayment > 0 && <Row label="Downpayment" value={`− ${formatRM(downpayment)}`} color="text-red-400" />}
                        </>)}

                        {/* Trade-in */}
                        {wo!.hasTradeIn && (<>
                          <div className="px-4 py-2 bg-obsidian-700/30">
                            <p className="text-gray-500 text-xs uppercase tracking-wide font-semibold">Trade-In</p>
                          </div>
                          <Row label={`${wo!.tradeInMake} ${wo!.tradeInModel} ${wo!.tradeInPlate}`} value="" color="text-gray-300" />
                          <Row label="Trade-In Value" value={formatRM(wo!.tradeInPrice)} color="text-green-400" />
                          {wo!.settlementFigure > 0 && <Row label="Settlement" value={`− ${formatRM(wo!.settlementFigure)}`} color="text-red-400" sub />}
                          {netTradeIn !== 0 && <Row label="Net Trade-In" value={formatRM(netTradeIn)} color={netTradeIn > 0 ? 'text-green-400' : 'text-red-400'} bold />}
                        </>)}

                        <div className="h-6" />
                      </div>
                    );
                  })()}

                  {/* Post-Sale Tab */}
                  {hasWorkOrder && detailTab === 'postsale' && (() => {
                    const liveCustomer = customers.find(c => c.id === detailLead.id) ?? detailLead;
                    const cl: PostSaleChecklist = liveCustomer.postSaleChecklist ?? {};
                    const isLoanCase = !!detailLead.loanWorkOrder;
                    const update = (patch: Partial<PostSaleChecklist>) => {
                      const updated = { ...cl, ...patch };
                      updateCustomer(detailLead.id, { postSaleChecklist: updated });
                    };
                    const b5b7Done = isLoanCase ? (cl.b5Obtained && cl.b7Obtained) : cl.b5Obtained;
                    const canTransfer = !!b5b7Done && !!cl.insuranceCoverNote;
                    const b2Required = !!cl.wantsCustomPlate;

                    const Step = ({ done, locked, label, sub, onToggle }: { done: boolean; locked?: boolean; label: string; sub?: string; onToggle: () => void }) => (
                      <button
                        onClick={() => !locked && onToggle()}
                        disabled={locked}
                        className={`w-full flex items-center gap-3 px-4 py-3 border-b border-obsidian-400/20 text-left transition-colors ${locked ? 'opacity-40 cursor-not-allowed' : 'hover:bg-obsidian-700/40'}`}
                      >
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${done ? 'bg-green-500 border-green-500' : locked ? 'border-gray-600' : 'border-gray-500'}`}>
                          {done && <CheckCircle size={12} className="text-white" />}
                          {locked && !done && <Lock size={9} className="text-gray-600" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${done ? 'text-green-400 line-through opacity-60' : locked ? 'text-gray-600' : 'text-white'}`}>{label}</p>
                          {sub && <p className="text-xs text-gray-600 mt-0.5">{sub}</p>}
                        </div>
                      </button>
                    );

                    return (
                      <div className="flex-1 overflow-y-auto min-h-0">
                        {/* Custom plate toggle */}
                        <div className="px-4 py-3 border-b border-obsidian-400/30 flex items-center justify-between">
                          <div>
                            <p className="text-white text-sm font-medium">Custom Plate (B2)</p>
                            <p className="text-gray-600 text-xs">Customer wants to change car plate</p>
                          </div>
                          <button
                            onClick={() => update({ wantsCustomPlate: !cl.wantsCustomPlate })}
                            className={`w-11 h-6 rounded-full transition-colors relative ${cl.wantsCustomPlate ? 'bg-gold-500' : 'bg-obsidian-500'}`}
                          >
                            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${cl.wantsCustomPlate ? 'left-5' : 'left-0.5'}`} />
                          </button>
                        </div>

                        {/* Puspakom */}
                        <div className="px-4 py-2 bg-obsidian-700/30">
                          <p className="text-gray-500 text-xs uppercase tracking-wide font-semibold">Puspakom</p>
                        </div>
                        <Step done={!!cl.puspakomBooked} label="Book Puspakom" sub={isLoanCase ? 'B5 + B7 required' : 'B5 required'} onToggle={() => update({ puspakomBooked: !cl.puspakomBooked })} />
                        {/* Puspakom date input */}
                        <div className="flex items-center justify-between px-4 py-2.5 border-b border-obsidian-400/20 bg-obsidian-800/30">
                          <span className="text-xs text-gray-500">Puspakom Date</span>
                          <input
                            type="date"
                            className="bg-obsidian-700/60 border border-obsidian-400/60 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-gold-500/60"
                            value={cl.puspakomDate ?? ''}
                            onChange={e => {
                              const newDate = e.target.value;
                              update({ puspakomDate: newDate || undefined });
                              if (newDate && liveCustomer.assignedSalesId) {
                                // Auto-create a reminder for the salesperson
                                addPersonalReminder({
                                  id: generateId(),
                                  userId: liveCustomer.assignedSalesId,
                                  title: `Puspakom appointment – ${liveCustomer.name}`,
                                  dueAt: newDate,
                                  isCompleted: false,
                                  createdAt: new Date().toISOString(),
                                });
                              }
                            }}
                          />
                        </div>
                        <Step done={!!cl.b5Obtained} label="B5 Obtained" onToggle={() => update({ b5Obtained: !cl.b5Obtained })} />
                        {isLoanCase && <Step done={!!cl.b7Obtained} label="B7 Obtained" sub="Required for hire purchase transfer" onToggle={() => update({ b7Obtained: !cl.b7Obtained })} />}
                        {b2Required && <>
                          <Step done={!!cl.b2Booked} label="Book B2" sub="For custom plate change" onToggle={() => update({ b2Booked: !cl.b2Booked })} />
                          <Step done={!!cl.b2Obtained} label="B2 Obtained" onToggle={() => update({ b2Obtained: !cl.b2Obtained })} />
                        </>}

                        {/* Insurance & Transfer */}
                        <div className="px-4 py-2 bg-obsidian-700/30">
                          <p className="text-gray-500 text-xs uppercase tracking-wide font-semibold">Insurance & Transfer</p>
                        </div>
                        <Step done={!!cl.insuranceCoverNote} label="Insurance Cover Note" sub="Get cover note before name transfer" onToggle={() => update({ insuranceCoverNote: !cl.insuranceCoverNote })} />
                        <Step
                          done={!!cl.nameTransferDone}
                          locked={!canTransfer}
                          label="Name Transfer (JPJ)"
                          sub={!canTransfer ? `Requires: ${!b5b7Done ? (isLoanCase ? 'B5, B7' : 'B5') : ''}${!b5b7Done && !cl.insuranceCoverNote ? ', ' : ''}${!cl.insuranceCoverNote ? 'cover note' : ''}` : undefined}
                          onToggle={() => update({ nameTransferDone: !cl.nameTransferDone })}
                        />

                        {/* Progress summary */}
                        {(() => {
                          const steps = [cl.puspakomBooked, cl.b5Obtained, isLoanCase && cl.b7Obtained, b2Required && cl.b2Booked, b2Required && cl.b2Obtained, cl.insuranceCoverNote, cl.nameTransferDone].filter(s => s !== false);
                          const done = steps.filter(Boolean).length;
                          const total = steps.length;
                          const pct = Math.round((done / total) * 100);
                          return (
                            <div className="px-4 py-4">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-gray-500 text-xs">{done}/{total} steps done</span>
                                <span className="text-gray-500 text-xs">{pct}%</span>
                              </div>
                              <div className="h-1.5 bg-obsidian-600 rounded-full overflow-hidden">
                                <div className="h-full bg-gold-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })()}
                        <div className="h-4" />
                      </div>
                    );
                  })()}

                  {/* Scrollable content — Details tab */}
                  {(!hasWorkOrder || detailTab === 'details') && <div className="flex-1 overflow-y-auto p-5 space-y-5 min-h-0">
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
                    {isDirectorOrAdmin && (
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

                {/* Loan / Bank Status */}
                {detailLead.loanStatus && detailLead.loanStatus !== 'not_started' && (
                  <div className="space-y-2">
                    <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">Banks</p>
                    {!!detailLead.dealPrice && (
                      <div className="flex items-center justify-between px-1">
                        <span className="text-gray-500 text-xs">Deal Price</span>
                        <span className="text-white text-sm">{formatRM(detailLead.dealPrice)}</span>
                      </div>
                    )}
                    <div className="bg-obsidian-700/60 border border-obsidian-400/60 rounded-xl divide-y divide-obsidian-400/30 overflow-hidden">
                      {bankStatuses.map(app => (
                        <div key={app.bank}>
                          {/* Summary row — click to expand */}
                          <div className="flex items-center">
                          <button
                            className="flex-1 flex items-center justify-between px-4 py-2.5 hover:bg-obsidian-600/40 transition-colors text-left"
                            onClick={() => setExpandedBank(expandedBank === app.bank ? null : app.bank)}
                          >
                            <div className="min-w-0">
                              <span className="text-white text-sm">{app.bank}</span>
                              {app.status === 'approved' && app.approvedAt && (() => {
                                const daysLeft = 90 - Math.floor((Date.now() - new Date(app.approvedAt).getTime()) / 86400000);
                                if (daysLeft <= 20) return (
                                  <p className="text-orange-400 text-xs mt-0.5 flex items-center gap-1">
                                    <AlertCircle size={10} />Approval expires in {daysLeft} day{daysLeft !== 1 ? 's' : ''}
                                  </p>
                                );
                                return <p className="text-green-400/60 text-xs mt-0.5">{daysLeft} days remaining</p>;
                              })()}
                              {(app.approvedAmount || app.interestRate) && (
                                <p className="text-green-400 text-xs mt-0.5 truncate">
                                  {app.approvedAmount ? `RM ${app.approvedAmount.toLocaleString()}` : ''}
                                  {app.approvedAmount && app.interestRate ? ' · ' : ''}
                                  {app.interestRate ? `${app.interestRate}%` : ''}
                                </p>
                              )}
                              {app.approvalReason && <p className="text-green-400/70 text-xs mt-0.5 truncate">{app.approvalReason}</p>}
                              {app.rejectionReason && <p className="text-red-400 text-xs mt-0.5 truncate">{app.rejectionReason}</p>}
                            </div>
                            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium shrink-0 ml-3 ${
                              app.status === 'approved' ? 'bg-green-500/10 border-green-500/30 text-green-400' :
                              app.status === 'rejected' ? 'bg-red-500/10 border-red-500/30 text-red-400' :
                              'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
                            }`}>
                              {app.status === 'approved' ? 'Approved' : app.status === 'rejected' ? 'Rejected' : 'Submitted'}
                            </span>
                          </button>
                          <button
                            onClick={() => {
                              const updated = bankStatuses.filter(a => a.bank !== app.bank);
                              setBankStatuses(updated);
                              handleSaveBankStatuses(detailLead.id, updated);
                              if (expandedBank === app.bank) setExpandedBank(null);
                            }}
                            className="px-3 py-2.5 text-gray-600 hover:text-red-400 transition-colors shrink-0"
                          >
                            <X size={13} />
                          </button>
                          </div>

                          {/* Expanded edit section */}
                          {expandedBank === app.bank && (
                            <div className="px-4 pb-3 pt-1 space-y-2 bg-obsidian-800/60 border-t border-obsidian-400/30">
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
                                  onClick={() => toggleBankStatus(app.bank, 'submitted')}
                                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                                    app.status === 'submitted'
                                      ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-300'
                                      : 'border-obsidian-400/60 text-gray-500 hover:border-yellow-500/40 hover:text-yellow-400'
                                  }`}
                                >
                                  Submitted
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
                              {app.status === 'approved' && (
                                <div className="space-y-2">
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <p className="text-gray-500 text-xs mb-1">Approved Amount (RM)</p>
                                      <input
                                        type="number"
                                        className="input text-xs w-full"
                                        placeholder="e.g. 45000"
                                        value={app.approvedAmount ?? ''}
                                        onChange={e => setBankStatuses(prev => prev.map(a => a.bank === app.bank ? { ...a, approvedAmount: e.target.value ? Number(e.target.value) : undefined } : a))}
                                        onKeyDown={e => { if (e.key === 'Enter') { handleSaveBankStatuses(detailLead.id); setExpandedBank(null); } }}
                                      />
                                    </div>
                                    <div>
                                      <p className="text-gray-500 text-xs mb-1">Interest Rate (%)</p>
                                      <input
                                        type="number"
                                        step="0.01"
                                        className="input text-xs w-full"
                                        placeholder="e.g. 3.5"
                                        value={app.interestRate ?? ''}
                                        onChange={e => setBankStatuses(prev => prev.map(a => a.bank === app.bank ? { ...a, interestRate: e.target.value ? Number(e.target.value) : undefined } : a))}
                                        onKeyDown={e => { if (e.key === 'Enter') { handleSaveBankStatuses(detailLead.id); setExpandedBank(null); } }}
                                      />
                                    </div>
                                  </div>
                                  <input
                                    className="input text-xs w-full"
                                    placeholder="Approval notes..."
                                    value={app.approvalReason ?? ''}
                                    onChange={e => setBankStatuses(prev => prev.map(a => a.bank === app.bank ? { ...a, approvalReason: e.target.value } : a))}
                                    onKeyDown={e => { if (e.key === 'Enter') { handleSaveBankStatuses(detailLead.id); setExpandedBank(null); } }}
                                  />
                                </div>
                              )}
                              {app.status === 'rejected' && (
                                <input
                                  className="input text-xs w-full"
                                  placeholder="Rejection reason..."
                                  value={app.rejectionReason ?? ''}
                                  onChange={e => setBankStatuses(prev => prev.map(a => a.bank === app.bank ? { ...a, rejectionReason: e.target.value } : a))}
                                  onKeyDown={e => { if (e.key === 'Enter') { handleSaveBankStatuses(detailLead.id); setExpandedBank(null); } }}
                                />
                              )}
                              <button
                                onClick={() => { handleSaveBankStatuses(detailLead.id); setExpandedBank(null); }}
                                className="w-full btn-gold py-1.5 rounded-lg text-xs font-medium"
                              >
                                Save
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                      {/* Add Bank row */}
                      <div className="flex items-center gap-2 px-3 py-2 border-t border-obsidian-400/30">
                        <select
                          className="flex-1 bg-transparent text-gray-400 text-xs outline-none"
                          value={addBankInput}
                          onChange={e => setAddBankInput(e.target.value)}
                        >
                          <option value="">+ Add bank...</option>
                          {BANKS.filter(b => !bankStatuses.some(a => a.bank === b)).map(b => (
                            <option key={b} value={b}>{b}</option>
                          ))}
                        </select>
                        {addBankInput && (
                          <button
                            onClick={() => {
                              const updated = [...bankStatuses, { bank: addBankInput, status: 'submitted' as const }];
                              setBankStatuses(updated);
                              handleSaveBankStatuses(detailLead.id, updated);
                              setAddBankInput('');
                            }}
                            className="text-xs text-gold-400 hover:text-gold-300 font-medium transition-colors shrink-0"
                          >
                            Add
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}


                {/* Proceed to Loan — follow_up only */}
                {detailLead.leadStatus === 'follow_up' && (
                  <button
                    onClick={() => {
                      const interestedCar = cars.find(car => car.id === detailLead.interestedCarId);
                      setLoanForm({ dealPrice: String(interestedCar?.sellingPrice ?? ''), carId: detailLead.interestedCarId ?? '' });
                      setSidebarLead(detailLead);
                      setSidebarView('car_select');
                      setDetailLead(null);
                    }}
                    className="w-full flex items-center justify-center gap-2 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-400 py-2.5 rounded-xl text-sm font-medium transition-colors"
                  >
                    <Banknote size={15} />Loan
                  </button>
                )}
              </div>}

              {/* Action Footer */}
              <div className="p-4 border-t border-obsidian-400/60 space-y-2">
                <button
                  onClick={() => handleWhatsApp(detailLead.phone, detailLead.name)}
                  className="w-full flex items-center justify-center gap-2 bg-green-500/10 hover:bg-green-500/20 border border-green-500/30 text-green-400 py-2.5 rounded-lg text-sm font-medium transition-colors"
                >
                  <MessageCircle size={15} />WhatsApp
                </button>
                {(detailLead.cashWorkOrder || detailLead.loanWorkOrder) && !detailLead.delivered && (
                  <button
                    onClick={() => { setDeliveryPhotoUrl(''); setShowDeliveryModal(true); }}
                    className="w-full flex items-center justify-center gap-2 bg-green-500/10 hover:bg-green-500/20 border border-green-500/30 text-green-400 py-2.5 rounded-lg text-sm font-medium transition-colors"
                  >
                    <Truck size={15} />Mark as Delivered
                  </button>
                )}
                {detailLead.delivered && (
                  <div className="w-full flex items-center justify-center gap-2 bg-green-500/5 border border-green-500/20 text-green-500 py-2.5 rounded-lg text-sm font-medium">
                    <CheckCircle size={15} />Delivered · {detailLead.deliveredAt ? new Date(detailLead.deliveredAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                  </div>
                )}
                {getRevertLabel(detailLead) && (
                  <button
                    onClick={() => handleRevert(detailLead)}
                    className="w-full flex items-center justify-center gap-2 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 text-orange-400 py-2.5 rounded-lg text-sm font-medium transition-colors"
                  >
                    ← {getRevertLabel(detailLead)}
                  </button>
                )}
                {!detailLead.isDead && !detailLead.cashWorkOrder && !detailLead.loanWorkOrder && isStale(detailLead) && (
                  <button
                    onClick={() => handleMarkDead(detailLead)}
                    className="w-full flex items-center justify-center gap-2 bg-gray-700/40 hover:bg-gray-700/60 border border-gray-600/40 text-gray-500 hover:text-gray-300 py-2.5 rounded-lg text-sm font-medium transition-colors"
                  >
                    <Skull size={14} />Mark as Dead Lead
                  </button>
                )}
                {detailLead.isDead && (
                  <button
                    onClick={() => handleReviveLead(detailLead)}
                    className="w-full flex items-center justify-center gap-2 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-400 py-2.5 rounded-lg text-sm font-medium transition-colors"
                  >
                    ↑ Revive Lead
                  </button>
                )}
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
                    onClick={() => setDeleteTarget({ id: detailLead.id, label: detailLead.name })}
                    className="flex items-center justify-center gap-1.5 border border-red-500/20 hover:bg-red-500/10 text-red-400 py-2.5 rounded-lg text-sm font-medium transition-colors"
                  >
                    <Trash2 size={13} />Delete
                  </button>
                </div>
              </div>
                </div>
              </div>
            </div>
          </>
        );
      })()}

      {/* ── Delivery Modal ───────────────────────────────── */}
      <Modal isOpen={showDeliveryModal} onClose={() => setShowDeliveryModal(false)} title="Confirm Delivery" maxWidth="max-w-sm">
        {detailLead && (
          <div className="space-y-4">
            <p className="text-gray-400 text-sm">Confirm that the car has been delivered and payment collected.</p>
            <div>
              <label className="block text-gray-300 text-xs font-medium mb-1.5">Delivery Photo <span className="text-gray-600">(optional)</span></label>
              {deliveryPhotoUrl ? (
                <div className="relative inline-block w-full">
                  <img src={deliveryPhotoUrl} alt="Delivery" className="w-full h-40 object-cover rounded-lg border border-obsidian-400/60" />
                  <button onClick={() => setDeliveryPhotoUrl('')} className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-0.5"><X size={12} /></button>
                </div>
              ) : (
                <button
                  onClick={() => deliveryPhotoRef.current?.click()}
                  disabled={deliveryUploading}
                  className="w-full border-2 border-dashed border-obsidian-400/60 hover:border-green-500/50 rounded-lg p-4 flex flex-col items-center gap-2 text-gray-600 hover:text-green-400 transition-colors"
                >
                  {deliveryUploading ? <span className="text-xs">Uploading...</span> : <><Upload size={18} /><span className="text-xs">Upload delivery photo</span></>}
                </button>
              )}
              <input ref={deliveryPhotoRef} type="file" accept="image/*" className="hidden" onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setDeliveryUploading(true);
                const reader = new FileReader();
                reader.onload = ev => { setDeliveryPhotoUrl(ev.target?.result as string); setDeliveryUploading(false); };
                reader.readAsDataURL(file);
                e.target.value = '';
              }} />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowDeliveryModal(false)} className="flex-1 px-4 py-2.5 btn-ghost rounded-lg text-sm">Cancel</button>
              <button onClick={() => handleDeliveryConfirm(detailLead)} className="flex-1 flex items-center justify-center gap-2 btn-gold px-4 py-2.5 rounded-lg text-sm font-medium">
                <Truck size={14} />Confirm Delivery
              </button>
            </div>
          </div>
        )}
      </Modal>

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
            <div className="bg-obsidian-700/60 border border-obsidian-400/70 rounded-xl px-3 py-2.5 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-yellow-500/20 border border-yellow-500/30 flex items-center justify-center text-yellow-400 font-bold text-sm uppercase shrink-0">
                {sidebarLead.name.charAt(0)}
              </div>
              <div className="min-w-0">
                <p className="text-white font-medium text-sm truncate">{sidebarLead.name}</p>
                <p className="text-gray-500 text-xs">{sidebarLead.phone} · <span className="text-yellow-400">Test Drive Done</span></p>
              </div>
            </div>

            {/* ── Step 1: Options ── */}
            {sidebarView === 'options' && (
              <div className="space-y-2">
                <button
                  onClick={handleFollowUp}
                  className="w-full text-left bg-obsidian-700/60 hover:bg-obsidian-600/60 border border-obsidian-400/60 hover:border-gold-500/40 rounded-xl p-3 transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-gold-500/10 border border-gold-500/20 flex items-center justify-center shrink-0">
                      <CalendarCheck size={16} className="text-gold-400" />
                    </div>
                    <div className="flex-1">
                      <p className="text-white text-sm font-medium">Follow Up</p>
                      <p className="text-gray-500 text-xs">Continue nurturing this lead</p>
                    </div>
                    <ChevronRight size={15} className="text-gray-600 group-hover:text-gold-400 transition-colors shrink-0" />
                  </div>
                </button>

                <button
                  onClick={() => { setSidebarCashFlow(false); setSidebarView('car_select'); }}
                  className="w-full text-left bg-obsidian-700/60 hover:bg-obsidian-600/60 border border-obsidian-400/60 hover:border-green-500/40 rounded-xl p-3 transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center justify-center shrink-0">
                      <Banknote size={16} className="text-green-400" />
                    </div>
                    <div className="flex-1">
                      <p className="text-white text-sm font-medium">Proceed with Loan</p>
                      <p className="text-gray-500 text-xs">Submit loan application now</p>
                    </div>
                    <ChevronRight size={15} className="text-gray-600 group-hover:text-green-400 transition-colors shrink-0" />
                  </div>
                </button>

                <button
                  onClick={() => { setSidebarCashFlow(true); setSidebarView('car_select'); }}
                  className="w-full text-left bg-obsidian-700/60 hover:bg-obsidian-600/60 border border-obsidian-400/60 hover:border-purple-500/40 rounded-xl p-3 transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0">
                      <Banknote size={16} className="text-purple-400" />
                    </div>
                    <div className="flex-1">
                      <p className="text-white text-sm font-medium">Cash Purchase</p>
                      <p className="text-gray-500 text-xs">Customer paying in full cash</p>
                    </div>
                    <ChevronRight size={15} className="text-gray-600 group-hover:text-purple-400 transition-colors shrink-0" />
                  </div>
                </button>
              </div>
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
                  {cars.filter(c => c.status !== 'sold' && c.status !== 'delivered').map(c => {
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
                    if (sidebarCashFlow && sidebarLead) {
                      setWoForm({
                        ...emptyWorkOrder,
                        sellingPrice: car?.sellingPrice ?? 0,
                        customerName: sidebarLead.name,
                        customerIc: sidebarLead.ic ?? '',
                        customerPhone: sidebarLead.phone,
                        customerEmail: sidebarLead.email ?? '',
                      });
                      setWorkOrderCarId(loanForm.carId);
                      setWorkOrderCustomer(sidebarLead);
                      setWorkOrderType('cash');
                      closeSidebar();
                    } else {
                      setCashForm(f => ({ ...f, dealPrice: String(car?.sellingPrice ?? f.dealPrice) }));
                      setSidebarView('loan');
                    }
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
                    <FormField label="Loan Amount (RM)">
                      <input
                        type="number"
                        className={inputCls()}
                        value={loanForm.dealPrice}
                        onChange={e => setLoanForm({ ...loanForm, dealPrice: e.target.value })}
                        placeholder="e.g. 45000"
                      />
                    </FormField>
                  </div>

                  <button
                    onClick={handleProceedLoan}
                    className="w-full bg-green-500 hover:bg-green-400 text-white py-2.5 rounded-lg text-sm font-medium transition-colors"
                  >
                    Submit Loan & Move to Follow Up
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
        <div className="space-y-2 mt-5">
          <button
            onClick={() => {
              if (!tdCustomer) return;
              setShowTdModal(false);
              openSidebar(tdCustomer);
              setTdCustomer(null);
            }}
            className="w-full flex items-center justify-center gap-2 bg-obsidian-700/60 hover:bg-obsidian-600/60 border border-obsidian-400/60 hover:border-blue-500/40 text-blue-400 py-2.5 rounded-lg text-sm transition-colors"
          >
            Skip Test Drive — Proceed Now
          </button>
          <div className="flex justify-center gap-3">
            <button onClick={() => { setShowTdModal(false); setTdCustomer(null); }} className="px-6 py-2.5 btn-ghost rounded-lg text-sm">Cancel</button>
            <button onClick={handleSaveTd} disabled={!tdForm.date || !tdForm.time} className="btn-gold disabled:opacity-50 px-6 py-2.5 rounded-lg text-sm">Save to Calendar</button>
          </div>
        </div>
      </Modal>

      {/* ── Work Order Overlay (Cash & Loan) ─────────── */}
      {workOrderCustomer && (() => {
        const car = getCar(workOrderCarId);
        const totalFinalDeal = woForm.sellingPrice - woForm.discount;
        const downpayment = workOrderType === 'loan' ? woForm.sellingPrice - woForm.loanAmount : 0;
        const netTradeIn = woForm.tradeInPrice - woForm.settlementFigure;

        return (
          <div className="fixed inset-0 z-50 bg-[#080808] overflow-y-auto">
            {/* Header */}
            <div className="sticky top-0 z-10 bg-[#0F0E0C] border-b border-obsidian-400/60 px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-white font-semibold text-sm">{workOrderType === 'loan' ? 'Loan Work Order' : 'Cash Work Order'}</p>
                <p className="text-gray-500 text-xs">{workOrderCustomer.name} · {car ? `${car.year} ${car.make} ${car.model}` : ''}</p>
              </div>
              <button onClick={() => setWorkOrderCustomer(null)} className="p-1.5 text-gray-500 hover:text-white hover:bg-obsidian-600/60 rounded-lg transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="max-w-lg mx-auto px-4 py-5 space-y-6 pb-32">

              {/* ── Section 1: Deal ── */}
              <div>
                <p className="text-gray-400 text-xs font-semibold uppercase tracking-widest mb-3">Deal of the Car</p>
                <div className="bg-[#0F0E0C] border border-obsidian-400/60 rounded-xl overflow-hidden">
                  {/* Additions */}
                  {[
                    { label: 'Selling Price', key: 'sellingPrice' as const },
                    { label: 'Insurance', key: 'insurance' as const },
                    { label: 'Bank Product', key: 'bankProduct' as const },
                  ].map(row => (
                    <div key={row.key} className="flex items-center gap-3 px-4 py-3 border-b border-obsidian-400/30">
                      <span className="text-gray-400 text-sm flex-1">{row.label}</span>
                      <div className="flex items-center gap-1">
                        <span className="text-gray-600 text-xs">RM</span>
                        <input
                          type="number"
                          value={woForm[row.key] || ''}
                          onChange={e => setWoForm(f => ({ ...f, [row.key]: Number(e.target.value) }))}
                          className="w-28 bg-transparent text-white text-sm text-right outline-none border-b border-transparent focus:border-gold-500/60 transition-colors"
                          placeholder="0"
                        />
                      </div>
                    </div>
                  ))}

                  {/* Additional custom items */}
                  {woForm.additionalItems.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-3 px-4 py-3 border-b border-obsidian-400/30">
                      <input
                        value={item.label}
                        onChange={e => setWoForm(f => ({ ...f, additionalItems: f.additionalItems.map((x, i) => i === idx ? { ...x, label: e.target.value } : x) }))}
                        placeholder="Item name..."
                        className="flex-1 bg-transparent text-gray-300 text-sm outline-none border-b border-transparent focus:border-gold-500/60 transition-colors"
                      />
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-gray-600 text-xs">RM</span>
                        <input
                          type="number"
                          value={item.amount || ''}
                          onChange={e => setWoForm(f => ({ ...f, additionalItems: f.additionalItems.map((x, i) => i === idx ? { ...x, amount: Number(e.target.value) } : x) }))}
                          className="w-24 bg-transparent text-white text-sm text-right outline-none border-b border-transparent focus:border-gold-500/60 transition-colors"
                          placeholder="0"
                        />
                        <button onClick={() => setWoForm(f => ({ ...f, additionalItems: f.additionalItems.filter((_, i) => i !== idx) }))} className="ml-1 text-gray-600 hover:text-red-400 transition-colors">
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                  ))}

                  <button
                    onClick={() => setWoForm(f => ({ ...f, additionalItems: [...f.additionalItems, { label: '', amount: 0 }] }))}
                    className="w-full px-4 py-2.5 text-xs text-gray-600 hover:text-gold-400 text-left transition-colors border-b border-obsidian-400/30"
                  >
                    + Add item
                  </button>

                  {/* Reductions */}
                  <div className="px-4 py-2 bg-obsidian-700/30">
                    <p className="text-gray-600 text-xs uppercase tracking-wide">Reduction</p>
                  </div>

                  {/* Loan-specific: Approved Bank display + Loan Amount */}
                  {workOrderType === 'loan' && (
                    <>
                      <div className="flex items-center gap-3 px-4 py-3 border-b border-obsidian-400/30">
                        <span className="text-gray-400 text-sm flex-1">Approved Bank</span>
                        <span className="text-green-400 text-sm font-medium">{woForm.approvedBank || '—'}</span>
                      </div>
                      <div className="flex items-center gap-3 px-4 py-3 border-b border-obsidian-400/30">
                        <span className="text-gray-400 text-sm flex-1">Loan Amount</span>
                        <div className="flex items-center gap-1">
                          <span className="text-red-500/60 text-xs">- RM</span>
                          <input
                            type="number"
                            value={woForm.loanAmount || ''}
                            onChange={e => setWoForm(f => ({ ...f, loanAmount: Number(e.target.value) }))}
                            className="w-28 bg-transparent text-red-400 text-sm text-right outline-none border-b border-transparent focus:border-red-500/40 transition-colors"
                            placeholder="0"
                          />
                        </div>
                      </div>
                    </>
                  )}

                  {[
                    { label: 'Booking Fee', key: 'bookingFee' as const },
                    ...(workOrderType === 'cash' ? [{ label: 'Downpayment', key: 'downpayment' as const }] : []),
                    { label: 'Discount', key: 'discount' as const },
                  ].map(row => (
                    <div key={row.key} className="flex items-center gap-3 px-4 py-3 border-b border-obsidian-400/30">
                      <span className="text-gray-400 text-sm flex-1">{row.label}</span>
                      <div className="flex items-center gap-1">
                        <span className="text-red-500/60 text-xs">- RM</span>
                        <input
                          type="number"
                          value={woForm[row.key] || ''}
                          onChange={e => setWoForm(f => ({ ...f, [row.key]: Number(e.target.value) }))}
                          className="w-28 bg-transparent text-red-400 text-sm text-right outline-none border-b border-transparent focus:border-red-500/40 transition-colors"
                          placeholder="0"
                        />
                      </div>
                    </div>
                  ))}

                  {/* Loan: show calculated downpayment */}
                  {workOrderType === 'loan' && (
                    <div className="flex items-center justify-between px-4 py-3 border-b border-obsidian-400/30 bg-blue-500/5">
                      <span className="text-blue-300 text-sm">Downpayment (Customer)</span>
                      <span className="text-blue-300 text-sm font-semibold">{formatRM(Math.max(0, downpayment))}</span>
                    </div>
                  )}

                  {/* Total */}
                  <div className="flex items-center justify-between px-4 py-4 bg-gold-500/5">
                    <span className="text-white font-semibold text-sm">Total Final Deal</span>
                    <span className="text-gold-400 font-bold text-lg">{formatRM(totalFinalDeal)}</span>
                  </div>
                </div>
              </div>

              {/* ── Section 2: Customer Details ── */}
              <div>
                <p className="text-gray-400 text-xs font-semibold uppercase tracking-widest mb-3">Customer Details</p>
                <div className="bg-[#0F0E0C] border border-obsidian-400/60 rounded-xl overflow-hidden divide-y divide-obsidian-400/30">
                  {[
                    { label: 'Full Name', key: 'customerName' as const, placeholder: 'Ahmad Bin Ismail', lower: false },
                    { label: 'IC Number', key: 'customerIc' as const, placeholder: '901231-14-5678', lower: true },
                    { label: 'Phone', key: 'customerPhone' as const, placeholder: '0123456789', lower: false },
                    { label: 'Email', key: 'customerEmail' as const, placeholder: 'email@example.com', lower: true },
                    { label: 'Address', key: 'customerAddress' as const, placeholder: 'Full address...', lower: false },
                  ].map(row => (
                    <div key={row.key} className="flex items-start gap-3 px-4 py-3">
                      <span className="text-gray-500 text-sm w-24 shrink-0 pt-0.5">{row.label}</span>
                      <input
                        value={woForm[row.key]}
                        onChange={e => setWoForm(f => ({ ...f, [row.key]: e.target.value }))}
                        placeholder={row.placeholder}
                        autoCapitalize={row.lower ? 'none' : undefined}
                        spellCheck={row.lower ? false : undefined}
                        className="flex-1 bg-transparent text-white text-sm outline-none border-b border-transparent focus:border-gold-500/60 transition-colors"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Section 3: Trade-in ── */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-gray-400 text-xs font-semibold uppercase tracking-widest">Trade-in</p>
                  <button
                    onClick={() => setWoForm(f => ({ ...f, hasTradeIn: !f.hasTradeIn }))}
                    className={`w-10 h-6 rounded-full border transition-colors relative ${woForm.hasTradeIn ? 'bg-gold-500 border-gold-500' : 'bg-obsidian-500 border-obsidian-400/60'}`}
                  >
                    <span className={`absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow ${woForm.hasTradeIn ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                </div>

                {woForm.hasTradeIn && (
                  <div className="space-y-4">
                    {/* Trade-in car details */}
                    <div className="bg-[#0F0E0C] border border-obsidian-400/60 rounded-xl overflow-hidden divide-y divide-obsidian-400/30">
                      {[
                        { label: 'Car Plate', key: 'tradeInPlate' as const, placeholder: 'WXX 1234' },
                        { label: 'Make', key: 'tradeInMake' as const, placeholder: 'Toyota' },
                        { label: 'Model', key: 'tradeInModel' as const, placeholder: 'Vios' },
                        { label: 'Variant', key: 'tradeInVariant' as const, placeholder: '1.5 E' },
                      ].map(row => (
                        <div key={row.key} className="flex items-center gap-3 px-4 py-3">
                          <span className="text-gray-500 text-sm w-20 shrink-0">{row.label}</span>
                          <input
                            value={woForm[row.key]}
                            onChange={e => setWoForm(f => ({ ...f, [row.key]: e.target.value }))}
                            placeholder={row.placeholder}
                            className="flex-1 bg-transparent text-white text-sm outline-none border-b border-transparent focus:border-gold-500/60 transition-colors"
                          />
                        </div>
                      ))}
                      {[
                        { label: 'Trade-in Price', key: 'tradeInPrice' as const },
                        { label: 'Settlement', key: 'settlementFigure' as const },
                      ].map(row => (
                        <div key={row.key} className="flex items-center gap-3 px-4 py-3">
                          <span className="text-gray-500 text-sm w-20 shrink-0">{row.label}</span>
                          <div className="flex items-center gap-1 flex-1 justify-end">
                            <span className="text-gray-600 text-xs">RM</span>
                            <input
                              type="number"
                              value={woForm[row.key] || ''}
                              onChange={e => setWoForm(f => ({ ...f, [row.key]: Number(e.target.value) }))}
                              className="w-32 bg-transparent text-white text-sm text-right outline-none border-b border-transparent focus:border-gold-500/60 transition-colors"
                              placeholder="0"
                            />
                          </div>
                        </div>
                      ))}
                      {woForm.tradeInPrice > 0 && (
                        <div className="flex items-center justify-between px-4 py-3 bg-obsidian-700/30">
                          <span className="text-gray-500 text-xs">Net Trade-in</span>
                          <span className={`text-sm font-semibold ${netTradeIn >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {netTradeIn >= 0 ? '+' : ''}{formatRM(netTradeIn)}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Car photos */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-gray-500 text-xs">Car Photos <span className="text-red-400">*min 4</span></p>
                        <span className={`text-xs ${woForm.tradeInPhotos.length >= 4 ? 'text-green-400' : 'text-gray-600'}`}>{woForm.tradeInPhotos.length} / 4+</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {woForm.tradeInPhotos.map((p, i) => (
                          <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden border border-obsidian-400/60">
                            <img src={p} alt="" className="w-full h-full object-cover" />
                            <button onClick={() => setWoForm(f => ({ ...f, tradeInPhotos: f.tradeInPhotos.filter((_, j) => j !== i) }))} className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 flex items-center justify-center text-white">
                              <X size={10} />
                            </button>
                          </div>
                        ))}
                        <button onClick={() => tiPhotoRef.current?.click()} className="w-20 h-20 rounded-xl border border-dashed border-obsidian-400/60 flex flex-col items-center justify-center text-gray-600 hover:text-gray-400 hover:border-obsidian-400 transition-colors">
                          <Camera size={18} />
                          <span className="text-[10px] mt-1">Add Photo</span>
                        </button>
                      </div>
                      <input ref={tiPhotoRef} type="file" accept="image/*" multiple className="hidden" onChange={e => handleWoPhoto(e, 'tradeIn')} />
                    </div>

                    {/* Green card photo */}
                    <div>
                      <p className="text-gray-500 text-xs mb-2">Green Card Photo</p>
                      {woForm.greenCardPhoto ? (
                        <div className="relative w-full h-36 rounded-xl overflow-hidden border border-obsidian-400/60">
                          <img src={woForm.greenCardPhoto} alt="" className="w-full h-full object-cover" />
                          <button onClick={() => setWoForm(f => ({ ...f, greenCardPhoto: '' }))} className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/70 flex items-center justify-center text-white">
                            <X size={11} />
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => gcPhotoRef.current?.click()} className="w-full h-20 rounded-xl border border-dashed border-obsidian-400/60 flex flex-col items-center justify-center text-gray-600 hover:text-gray-400 hover:border-obsidian-400 transition-colors">
                          <Camera size={18} />
                          <span className="text-xs mt-1">Upload Green Card</span>
                        </button>
                      )}
                      <input ref={gcPhotoRef} type="file" accept="image/*" className="hidden" onChange={e => handleWoPhoto(e, 'greenCard')} />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Sticky Submit Footer */}
            <div className="fixed bottom-0 left-0 right-0 bg-[#0F0E0C] border-t border-obsidian-400/60 px-4 py-4">
              <div className="max-w-lg mx-auto flex items-center justify-between gap-4">
                <div>
                  <p className="text-gray-500 text-xs">Total Final Deal</p>
                  <p className="text-gold-400 font-bold text-lg">{formatRM(totalFinalDeal)}</p>
                </div>
                <button
                  onClick={workOrderType === 'loan' ? handleLoanWoSubmit : handleWorkOrderSubmit}
                  disabled={woForm.hasTradeIn && woForm.tradeInPhotos.length < 4}
                  className="btn-gold px-6 py-3 rounded-xl text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {woForm.hasTradeIn && woForm.tradeInPhotos.length < 4
                    ? `Need ${4 - woForm.tradeInPhotos.length} more photo(s)`
                    : 'Submit Work Order'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
      <DeleteConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => { if (deleteTarget) { deleteCustomer(deleteTarget.id); setDetailLead(null); } }}
        itemName={deleteTarget?.label ?? ''}
      />
    </div>
  );
}
