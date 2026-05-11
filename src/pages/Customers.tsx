import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { Plus, Users, MessageCircle, AlertCircle, Edit2, Trash2, ChevronRight, Car, Phone, ArrowRight, Banknote, CalendarCheck, X, Mail, Briefcase, CheckCircle, XCircle, Camera, ClipboardList, Truck, Upload, Lock, Skull, Clock, RotateCcw, MoreVertical } from 'lucide-react';
import { useStore } from '../store';
import { Customer, LoanApplication, LoanSubmission, CashWorkOrder, LoanWorkOrder, WorkOrderItem, BANKS, NO_BANKER_BANKS, PostSaleChecklist } from '../types';
import Modal from '../components/Modal';
import DeleteConfirmModal from '../components/DeleteConfirmModal';
import MiniCalendar from '../components/MiniCalendar';
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
  const bankers = useStore((s) => s.bankers);

  const isDirector = currentUser?.role === 'director';
  const isAdmin = currentUser?.role === 'admin';
  const isShareHolder = currentUser?.role === 'shareholder';
  const isDirectorOrAdmin = isDirector || isAdmin;
  const isDirectorLevel = isDirectorOrAdmin || isShareHolder;

  // ── Stale lead helpers ────────────────────────────────────
  const getDaysSinceAction = (c: Customer) => {
    const ref = c.lastActionAt ?? c.createdAt;
    return Math.floor((Date.now() - new Date(ref).getTime()) / 86400000);
  };
  const isStale = (c: Customer) => !c.isDead && getDaysSinceAction(c) >= 7;

  const todayStr = new Date().toISOString().slice(0, 10);

  // Tab
  const [tab, setTab] = useState<'leads' | 'cash' | 'loan' | 'confirmed' | 'bin'>('leads');
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



  // Bin permanent delete confirmation
  const [binDeleteTarget, setBinDeleteTarget] = useState<{ id: string; label: string } | null>(null);

  // Test drive scheduling modal
  const [showTdModal, setShowTdModal] = useState(false);
  const [tdCustomer, setTdCustomer] = useState<Customer | null>(null);

  // Next-step modal (for test_drive leads)
  const [sidebarLead, setSidebarLead] = useState<Customer | null>(null);
  const [sidebarView, setSidebarView] = useState<'options' | 'car_select' | 'loan' | 'cash'>('options');
  const [sidebarCashFlow, setSidebarCashFlow] = useState(false);
  const [loanForm, setLoanForm] = useState({ dealPrice: '', carId: '' });
  const [cashForm, setCashForm] = useState({ dealPrice: '', notes: '' });

  // Work order overlay
  const [workOrderCustomer, setWorkOrderCustomer] = useState<Customer | null>(null);
  const [workOrderCarId, setWorkOrderCarId] = useState('');
  const [workOrderIsEdit, setWorkOrderIsEdit] = useState(false);
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
  const [detailTab, setDetailTab] = useState<'details' | 'calculation' | 'postsale' | 'timeline'>('details');
  const [showDetailMenu, setShowDetailMenu] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef(0);
  const [showInlineFollowup, setShowInlineFollowup] = useState(false);
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);
  const [deliveryPhotoUrl, setDeliveryPhotoUrl] = useState('');
  const [deliveryUploading, setDeliveryUploading] = useState(false);
  const deliveryPhotoRef = useRef<HTMLInputElement>(null);
  // Bank submission modal
  const [bankModalLeadId, setBankModalLeadId] = useState<string | null>(null);
  // bankModalPicks: { [bankName]: bankerId | '' }
  const [bankModalPicks, setBankModalPicks] = useState<Record<string, string>>({});
  // pending form data captured from sidebar before it closes — only set for first-time loan submission
  const [bankModalPendingData, setBankModalPendingData] = useState<{ carId: string; dealPrice: number } | null>(null);
  useBodyScrollLock(!!detailLead || !!workOrderCustomer);

  useEffect(() => {
    if (!detailLead) return;
    const apps = detailLead.loanApplications?.length
      ? detailLead.loanApplications
      : (detailLead.loanBankSubmitted ?? '').split(',').filter(Boolean).map(b => ({ bank: b.trim(), status: 'submitted' as const }));
    setBankStatuses(apps);
    setShowInlineFollowup(false);
  }, [detailLead?.id]);

  const myCustomers = useMemo(() =>
    customers
      .filter(c => {
        if (!isDirectorLevel) return c.assignedSalesId === currentUser?.id;
        if (isShareHolder) return true;
        if (directorView === 'all') return true;
        if (directorView === 'own') return c.assignedSalesId === currentUser?.id;
        return c.assignedSalesId === directorView;
      })
      .map(c => STAGE_ORDER.includes(c.leadStatus) ? c : { ...c, leadStatus: 'contacted' as Customer['leadStatus'] }),
    [customers, isDirectorLevel, isShareHolder, currentUser, directorView]
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
    if (c.isTrashed) return false;
    const matchStatus = statusFilter === 'all' || c.leadStatus === statusFilter;
    const matchSource = sourceFilter === 'all' || c.source === sourceFilter;
    const matchSearch = !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search);
    return matchStatus && matchSource && matchSearch;
  }), [myCustomers, statusFilter, sourceFilter, search]);

  const deadLeads = useMemo(() => myCustomers.filter(c =>
    c.isDead && !c.isTrashed && !c.cashWorkOrder && !c.loanWorkOrder && c.leadStatus !== 'loan_submitted' &&
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
    const leads = myCustomers.filter(c => !c.cashWorkOrder && !c.loanWorkOrder && c.leadStatus !== 'loan_submitted' && !c.isDead && !c.isTrashed);
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
    } else if (c.dealType === 'cash' && !c.cashWorkOrder) {
      updateCustomer(c.id, { dealType: undefined });
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
    if (c.dealType === 'cash' && !c.cashWorkOrder) return 'Remove Cash Tag';
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
    updateCustomer(c.id, { isDead: true, deadAt: now, isTrashed: true, trashedAt: now });
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
  const [tdForm, setTdForm] = useState({ carId: '', date: '', time: '', notes: '' });

  const openTdSchedule = (c: Customer) => {
    setTdCustomer(c);
    setTdForm({ carId: c.interestedCarId ?? '', date: '', time: '', notes: '' });
    setShowTdModal(true);
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
    const leadId = sidebarLead.id;
    setBankModalPendingData({
      carId: loanForm.carId || sidebarLead.interestedCarId || '',
      dealPrice: loanForm.dealPrice ? Number(loanForm.dealPrice) : (sidebarLead.dealPrice ?? 0),
    });
    closeSidebar();
    setBankModalPicks({});
    setBankModalLeadId(leadId);
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

    const needsApproval = hasDiscount || woForm.discount > 0;
    const storeUpdateCar = useStore.getState().updateCar;

    if (workOrderIsEdit) {
      updateCustomer(workOrderCustomer.id, {
        dealPrice: totalFinalDeal,
        cashWorkOrder: workOrder,
        lastActionAt: new Date().toISOString(),
      });
      if (car?.finalDeal) {
        storeUpdateCar(car.id, {
          finalDeal: {
            ...car.finalDeal,
            dealPrice: totalFinalDeal,
            approvalStatus: needsApproval ? 'pending' : 'approved',
            approvedBy: needsApproval ? undefined : currentUser?.name,
            approvedAt: needsApproval ? undefined : new Date().toISOString(),
          },
        });
      }
      setWorkOrderIsEdit(false);
      setWorkOrderCustomer(null);
      return;
    }

    updateCustomer(workOrderCustomer.id, {
      dealType: 'cash',
      interestedCarId: workOrderCarId,
      dealPrice: totalFinalDeal,
      cashWorkOrder: workOrder,
      lastActionAt: new Date().toISOString(),
    });

    if (car) {
      storeUpdateCar(car.id, {
        status: 'deal_pending',
        finalDeal: {
          submittedBy: currentUser?.name ?? '',
          submittedAt: new Date().toISOString(),
          dealPrice: totalFinalDeal,
          bank: 'Cash',
          approvalStatus: needsApproval ? 'pending' : 'approved',
          approvedBy: needsApproval ? undefined : currentUser?.name,
          approvedAt: needsApproval ? undefined : new Date().toISOString(),
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
  const openEditWorkOrder = (c: Customer) => {
    const wo = c.loanWorkOrder ?? c.cashWorkOrder;
    if (!wo) return;
    const type = c.loanWorkOrder ? 'loan' : 'cash';
    setWoForm({
      ...emptyWorkOrder,
      sellingPrice: wo.sellingPrice,
      insurance: wo.insurance,
      bankProduct: wo.bankProduct,
      additionalItems: wo.additionalItems ?? [],
      bookingFee: wo.bookingFee,
      downpayment: (wo as CashWorkOrder).downpayment ?? 0,
      discount: wo.discount,
      loanAmount: c.loanWorkOrder?.loanAmount ?? 0,
      approvedBank: c.loanWorkOrder?.bank ?? '',
      customerName: wo.customerName,
      customerIc: wo.customerIc,
      customerPhone: wo.customerPhone,
      customerEmail: wo.customerEmail,
      customerAddress: wo.customerAddress,
      hasTradeIn: wo.hasTradeIn,
      tradeInPhotos: wo.tradeInPhotos ?? [],
      greenCardPhoto: wo.greenCardPhoto ?? '',
      tradeInPlate: wo.tradeInPlate ?? '',
      tradeInMake: wo.tradeInMake ?? '',
      tradeInModel: wo.tradeInModel ?? '',
      tradeInVariant: wo.tradeInVariant ?? '',
      tradeInPrice: wo.tradeInPrice ?? 0,
      settlementFigure: wo.settlementFigure ?? 0,
    });
    setWorkOrderCarId(wo.carId);
    setWorkOrderCustomer(c);
    setWorkOrderType(type);
    setWorkOrderIsEdit(true);
    setDetailLead(null);
  };

  const openFinalDeal = (c: Customer, bankName?: string, bankAmount?: number) => {
    const approvedApp = bankName
      ? c.loanApplications?.find(a => a.bank === bankName && a.status === 'approved')
      : c.loanApplications?.find(a => a.status === 'approved');
    const car = getCar(c.interestedCarId);
    setWoForm({
      ...emptyWorkOrder,
      sellingPrice: car?.sellingPrice ?? 0,
      approvedBank: approvedApp?.bank ?? bankName ?? '',
      loanAmount: bankAmount ?? approvedApp?.approvedAmount ?? 0,
      customerName: c.name,
      customerIc: c.ic ?? '',
      customerPhone: c.phone,
      customerEmail: c.email ?? '',
    });
    setWorkOrderCarId(c.interestedCarId ?? '');
    setWorkOrderCustomer(c);
    setWorkOrderType('loan');
    setDetailLead(null);
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

    const storeUpdateCar2 = useStore.getState().updateCar;

    if (workOrderIsEdit) {
      updateCustomer(workOrderCustomer.id, {
        dealPrice: totalFinalDeal,
        loanWorkOrder,
        lastActionAt: new Date().toISOString(),
      });
      if (car?.finalDeal) {
        storeUpdateCar2(car.id, {
          finalDeal: {
            ...car.finalDeal,
            dealPrice: totalFinalDeal,
            approvalStatus: hasDiscount ? 'pending' : 'approved',
            approvedBy: hasDiscount ? undefined : currentUser?.name,
            approvedAt: hasDiscount ? undefined : new Date().toISOString(),
          },
        });
      }
      setWorkOrderIsEdit(false);
      setWorkOrderCustomer(null);
      return;
    }

    // Auto-cancel remaining submitted banks (not the winning one)
    const cancelledApps = (workOrderCustomer.loanApplications ?? []).map(app =>
      app.bank === woForm.approvedBank
        ? app
        : app.status === 'submitted'
          ? { ...app, status: 'cancelled' as const, rejectionReason: 'Deal confirmed with another bank' }
          : app
    );

    updateCustomer(workOrderCustomer.id, {
      dealType: 'loan',
      dealPrice: totalFinalDeal,
      loanStatus: 'approved',
      loanWorkOrder,
      loanApplications: cancelledApps,
      lastActionAt: new Date().toISOString(),
    });

    if (car) {
      storeUpdateCar2(car.id, {
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
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'leads' ? 'bg-gold-500 text-white shadow' : 'text-gray-400 hover:text-white'}`}
          >
            Leads
            <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${tab === 'leads' ? 'bg-white/20' : 'bg-[#2C2415]'}`}>{myCustomers.filter(c => !c.cashWorkOrder && !c.loanWorkOrder && c.leadStatus !== 'loan_submitted' && !c.isDead && !c.isTrashed && c.dealType !== 'cash').length}</span>
            {myCustomers.filter(c => !c.cashWorkOrder && !c.loanWorkOrder && c.leadStatus !== 'loan_submitted' && !c.isTrashed && isStale(c) && c.dealType !== 'cash').length > 0 && (
              <span className="ml-1 text-xs px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400">{myCustomers.filter(c => !c.cashWorkOrder && !c.loanWorkOrder && c.leadStatus !== 'loan_submitted' && !c.isTrashed && isStale(c) && c.dealType !== 'cash').length} stale</span>
            )}
          </button>
          <button
            onClick={() => { setTab('cash'); setStatusFilter('all'); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'cash' ? 'bg-green-500 text-white shadow' : 'text-gray-400 hover:text-white'}`}
          >
            Cash <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${tab === 'cash' ? 'bg-white/20' : 'bg-[#2C2415]'}`}>{myCustomers.filter(c => c.dealType === 'cash' && !c.cashWorkOrder && !c.isDead && !c.isTrashed).length}</span>
          </button>
          <button
            onClick={() => { setTab('loan'); setStatusFilter('all'); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'loan' ? 'bg-purple-500 text-white shadow' : 'text-gray-400 hover:text-white'}`}
          >
            Loan <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${tab === 'loan' ? 'bg-white/20' : 'bg-[#2C2415]'}`}>{myCustomers.filter(c => !c.cashWorkOrder && !c.loanWorkOrder && c.leadStatus === 'loan_submitted' && !c.isTrashed).length}</span>
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
          </button>
        </div>
        {tab === 'leads' && !isShareHolder && (
          <button onClick={openAdd} className="flex items-center gap-2 btn-gold px-4 py-2.5 rounded-lg text-sm">
            <Plus size={16} />New Lead
          </button>
        )}
      </div>

      {/* Director view toggle */}
      {isDirectorLevel && !isShareHolder && (
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
          <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card divide-y divide-obsidian-400/60 overflow-hidden">
            {leadsFiltered.map(c => {
              const stale = isStale(c);
              const car = getCar(c.interestedCarId);

              const followUpInfo = (() => {
                if (!c.followUpDate) return null;
                const today = new Date(); today.setHours(0, 0, 0, 0);
                const target = new Date(c.followUpDate + 'T00:00:00');
                const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
                if (diff < 0) return { label: `Overdue ${Math.abs(diff)}d`, urgent: true };
                if (diff === 0) return { label: 'Follow up today', urgent: true };
                if (diff === 1) return { label: 'Follow up tomorrow', urgent: false };
                return { label: `Follow up in ${diff}d`, urgent: false };
              })();

              return (
                <div
                  key={c.id}
                  className={`px-4 py-4 hover:bg-obsidian-700/30 transition-colors cursor-pointer relative ${stale ? 'border-l-[3px] border-l-red-500/60 bg-red-500/[0.03]' : ''}`}
                  onClick={() => setDetailLead(c)}
                >
                  {/* Row 1: Name + status pill */}
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <span className="text-white text-sm font-semibold">{c.name}</span>
                      {stale && (
                        <span className="flex items-center gap-0.5 text-[10px] text-red-400">
                          <Clock size={9} />{getDaysSinceAction(c)}d stale
                        </span>
                      )}
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${
                      c.leadStatus === 'contacted'      ? 'bg-blue-500/15 border-blue-500/30 text-blue-400' :
                      c.leadStatus === 'test_drive'     ? 'bg-yellow-500/15 border-yellow-500/30 text-yellow-400' :
                      c.leadStatus === 'follow_up'      ? 'bg-gold-500/15 border-gold-500/30 text-gold-400' :
                                                          'bg-green-500/15 border-green-500/30 text-green-400'
                    }`}>{LEAD_STATUS_LABELS[c.leadStatus]}</span>
                  </div>

                  {/* Row 2: Phone + source */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-gray-500 text-xs">{c.phone}</span>
                    <span className="text-gray-600 text-[10px] px-1.5 py-0.5 bg-obsidian-700/50 rounded border border-obsidian-500/30">{SOURCE_LABELS[c.source]}</span>
                    {isDirectorLevel && <span className="text-gray-600 text-xs hidden lg:inline">{getSalesName(c.assignedSalesId)}</span>}
                  </div>

                  {/* Row 3: Car badge */}
                  {car && (
                    <div className="flex items-center gap-1.5 mb-2">
                      <Car size={10} className="text-gold-500/50 shrink-0" />
                      <span className="text-gold-400/80 text-xs font-medium">{car.year} {car.make} {car.model}{car.variant ? ` ${car.variant}` : ''}</span>
                      {car.carPlate && <span className="text-[10px] font-mono text-gold-500/60 bg-obsidian-700/50 px-1.5 py-0.5 rounded border border-obsidian-500/30">{car.carPlate}</span>}
                    </div>
                  )}

                  {/* Row 4: Follow-up countdown */}
                  {followUpInfo && (
                    <div className={`flex items-center gap-1 text-[11px] mb-2 font-medium ${followUpInfo.urgent ? 'text-orange-400' : 'text-gray-500'}`}>
                      <CalendarCheck size={10} />
                      {followUpInfo.label}
                    </div>
                  )}

                  {/* Row 5: Remark input */}
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
                    className="w-full text-xs bg-transparent border-b border-obsidian-400/40 hover:border-obsidian-400/70 focus:border-gold-500/60 text-gray-400 placeholder-gray-700 focus:text-gray-200 outline-none py-1 transition-colors"
                  />

                  {/* Row 6: Quick actions */}
                  <div className="flex items-center gap-2 mt-3" onClick={e => e.stopPropagation()}>
                    <button onClick={() => handleWhatsApp(c.phone, c.name)} className="flex items-center gap-1.5 px-3 py-2 text-xs text-green-400 bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 hover:border-green-500/40 rounded-lg transition-colors font-medium touch-manipulation">
                      <MessageCircle size={13} />WA
                    </button>
                    {!isShareHolder && (
                      <div className="ml-auto flex items-center gap-1">
                        <button onClick={() => openEdit(c)} className="p-2 text-gray-600 hover:text-gold-400 hover:bg-obsidian-600/60 rounded-lg transition-colors touch-manipulation">
                          <Edit2 size={14} />
                        </button>
                        <button onClick={() => updateCustomer(c.id, { isTrashed: true, trashedAt: new Date().toISOString() })} className="p-2 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors touch-manipulation" title="Move to bin">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
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

      {tab === 'cash' && (() => {
        const cashLeads = myCustomers.filter(c => c.dealType === 'cash' && !c.cashWorkOrder && !c.isDead)
          .filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search))
          .sort((a, b) => (b.lastActionAt ?? b.createdAt).localeCompare(a.lastActionAt ?? a.createdAt));
        return (
          <>
            <div className="flex gap-2">
              <input type="text" placeholder="Search cash leads..." value={search} onChange={e => setSearch(e.target.value)} className="flex-1 input rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-gold-500 transition-colors" />
            </div>
            {cashLeads.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Banknote size={40} className="text-gray-600 mb-3" />
                <p className="text-gray-400">No cash leads yet</p>
                <p className="text-gray-600 text-xs mt-1">Tag a follow-up lead as "Cash" to add them here</p>
              </div>
            ) : (
              <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card divide-y divide-obsidian-400/60 overflow-hidden">
                {cashLeads.map(c => {
                  const car = getCar(c.interestedCarId);
                  const stale = isStale(c);
                  return (
                    <div key={c.id} className={`px-4 py-4 hover:bg-obsidian-700/30 transition-colors cursor-pointer relative ${stale ? 'border-l-[3px] border-l-red-500/60 bg-red-500/[0.03]' : ''}`}
                      onClick={() => { setDetailLead(c); setDetailTab('details'); }}>
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <span className="text-white text-sm font-semibold">{c.name}</span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 bg-green-500/10 border-green-500/30 text-green-400">Cash Buyer</span>
                      </div>
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className="text-gray-500 text-xs">{c.phone}</span>
                        {car && <span className="text-xs px-2 py-0.5 rounded-full bg-gold-500/10 border border-gold-500/20 text-gold-400">{car.year} {car.make} {car.model}</span>}
                      </div>
                      {c.followUpDate && (() => {
                        const today = new Date(); today.setHours(0,0,0,0);
                        const diff = Math.round((new Date(c.followUpDate + 'T00:00:00').getTime() - today.getTime()) / 86400000);
                        const label = diff < 0 ? `Overdue ${Math.abs(diff)}d` : diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : `In ${diff}d`;
                        return <p className={`text-xs mb-2 ${diff <= 0 ? 'text-red-400' : 'text-gray-500'}`}><CalendarCheck size={10} className="inline mr-1" />{label}</p>;
                      })()}
                      <div className="flex items-center gap-2 mt-2" onClick={e => e.stopPropagation()}>
                        <button onClick={() => handleWhatsApp(c.phone, c.name)} className="flex items-center gap-1.5 px-3 py-2 text-xs text-green-400 bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 rounded-lg transition-colors font-medium touch-manipulation">
                          <MessageCircle size={13} />WA
                        </button>
                        {!isShareHolder && (
                          <button onClick={() => {
                            const interestedCar = cars.find(car => car.id === c.interestedCarId);
                            setLoanForm({ dealPrice: String(interestedCar?.sellingPrice ?? ''), carId: c.interestedCarId ?? '' });
                            setSidebarLead(c); setSidebarCashFlow(true); setSidebarView('car_select');
                          }} className="flex items-center gap-1.5 px-3 py-2 text-xs text-white bg-green-500 hover:bg-green-400 rounded-lg transition-colors font-semibold touch-manipulation">
                            <ClipboardList size={13} />Close Deal
                          </button>
                        )}
                        {!isShareHolder && (
                          <div className="ml-auto flex items-center gap-1">
                            <button onClick={() => openEdit(c)} className="p-2 text-gray-600 hover:text-gold-400 hover:bg-obsidian-600/60 rounded-lg transition-colors touch-manipulation"><Edit2 size={14} /></button>
                            <button onClick={() => updateCustomer(c.id, { isTrashed: true, trashedAt: new Date().toISOString() })} className="p-2 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors touch-manipulation"><Trash2 size={14} /></button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        );
      })()}

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
          <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card divide-y divide-obsidian-400/60 overflow-hidden">
            {loanFiltered.map(c => {
              const car = getCar(c.interestedCarId);
              const loanInfo = LOAN_STATUS_LABELS[c.loanStatus ?? 'not_started'];
              const hasApproved = c.loanApplications?.some(a => a.status === 'approved');

              const expiringApp = c.loanApplications?.find(a => {
                if (!a.approvedAt) return false;
                const daysLeft = 90 - Math.floor((Date.now() - new Date(a.approvedAt).getTime()) / 86400000);
                return daysLeft <= 20;
              });
              const expiringDays = expiringApp?.approvedAt
                ? 90 - Math.floor((Date.now() - new Date(expiringApp.approvedAt).getTime()) / 86400000)
                : null;

              return (
                <div key={c.id}>
                  {/* Expiry warning banner */}
                  {expiringApp && expiringDays !== null && (
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-orange-500/10 border-b border-orange-500/20">
                      <AlertCircle size={13} className="text-orange-400 shrink-0" />
                      <span className="text-orange-400 text-xs font-medium">
                        {expiringApp.bank} approval expires in {expiringDays} day{expiringDays !== 1 ? 's' : ''} — complete Final Deal now
                      </span>
                    </div>
                  )}

                  {/* Main row */}
                  <div className="flex items-start gap-3 px-4 py-4 hover:bg-obsidian-700/30 transition-colors cursor-pointer" onClick={() => setDetailLead(c)}>
                    <div className="flex-1 min-w-0">
                      {/* Name + phone */}
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-white text-sm font-semibold">{c.name}</span>
                        <span className="text-gray-500 text-xs hidden sm:inline">{c.phone}</span>
                        {isDirectorLevel && <span className="text-gray-600 text-xs hidden lg:inline">{getSalesName(c.assignedSalesId)}</span>}
                      </div>

                      {/* Car badge */}
                      {car && (
                        <div className="flex items-center gap-1.5 mb-2">
                          <Car size={10} className="text-gold-500/50 shrink-0" />
                          <span className="text-gold-400/80 text-xs font-medium">{car.year} {car.make} {car.model}{car.variant ? ` ${car.variant}` : ''}</span>
                          {car.carPlate && <span className="text-[10px] font-mono text-gold-500/60 bg-obsidian-700/50 px-1.5 py-0.5 rounded border border-obsidian-500/30">{car.carPlate}</span>}
                        </div>
                      )}

                      {/* Bank status chips */}
                      {c.loanApplications?.length ? (
                        <div className="flex flex-wrap gap-1.5 mb-1.5">
                          {c.loanApplications.map(a => {
                            const daysLeft = a.approvedAt ? 90 - Math.floor((Date.now() - new Date(a.approvedAt).getTime()) / 86400000) : null;
                            const expiring = daysLeft !== null && daysLeft <= 20;
                            return (
                              <span key={a.bank} className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                                a.status === 'approved'   ? 'bg-green-500/15 border-green-500/30 text-green-400' :
                                a.status === 'rejected'   ? 'bg-red-500/15 border-red-500/30 text-red-400' :
                                a.status === 'cancelled'  ? 'bg-obsidian-700/40 border-obsidian-500/30 text-gray-600 line-through' :
                                                            'bg-yellow-500/15 border-yellow-500/30 text-yellow-400'
                              }`}>
                                {a.bank}
                                {expiring && <span className="text-orange-400 not-italic">⚠{daysLeft}d</span>}
                              </span>
                            );
                          })}
                        </div>
                      ) : c.loanBankSubmitted ? (
                        <span className="text-gray-500 text-xs">{c.loanBankSubmitted}</span>
                      ) : null}

                      {c.dealPrice ? <span className="text-gold-400 text-xs font-semibold">{formatRM(c.dealPrice)}</span> : null}
                    </div>

                    {/* Right: status pill + quick actions */}
                    <div className="flex flex-col items-end gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                      <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border ${
                        loanInfo.label === 'Approved' ? 'bg-green-500/10 border-green-500/30 text-green-400' :
                        loanInfo.label === 'Rejected' ? 'bg-red-500/10 border-red-500/30 text-red-400' :
                        'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
                      }`}>{loanInfo.label}</span>
                      <div className="flex items-center gap-1">
                        <button onClick={() => handleWhatsApp(c.phone, c.name)} className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-green-400 bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 rounded-lg transition-colors touch-manipulation">
                          <MessageCircle size={12} />WA
                        </button>
                        {!isShareHolder && (<>
                          <button onClick={() => updateCustomer(c.id, { isTrashed: true, trashedAt: new Date().toISOString() })} className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors touch-manipulation" title="Move to bin">
                            <Trash2 size={13} />
                          </button>
                          <button onClick={() => openEdit(c)} className="p-1.5 text-gray-600 hover:text-gold-400 hover:bg-obsidian-600/60 rounded-lg transition-colors touch-manipulation">
                            <Edit2 size={13} />
                          </button>
                        </>)}
                      </div>
                    </div>
                  </div>

                  {/* Final Deal CTA — full width, only when approved */}
                  {hasApproved && (
                    <div className="px-4 pb-4" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => openFinalDeal(c)}
                        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold bg-gold-500 text-obsidian-900 hover:bg-gold-400 transition-colors touch-manipulation"
                      >
                        <ClipboardList size={15} />
                        Complete Final Deal
                        <ArrowRight size={15} />
                      </button>
                    </div>
                  )}
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
            <p className="text-gray-400">No cases in bin</p>
            <p className="text-gray-600 text-xs mt-1">{binMonth ? 'Try changing the month filter' : 'Cases moved to bin from Leads or Loan tabs appear here'}</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-gray-500 text-xs">{trashedFiltered.length} case{trashedFiltered.length > 1 ? 's' : ''} in bin{binMonth ? ` — ${new Date(binMonth + '-01').toLocaleDateString('en-MY', { month: 'long', year: 'numeric' })}` : ''}</p>
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
                        {isDirectorLevel && <span className="text-gray-600 text-xs hidden lg:inline">{getSalesName(c.assignedSalesId)}</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        {car && <span className="text-gray-500 text-xs">{car.year} {car.make} {car.model}</span>}
                        {c.isDead && (
                          <span className="text-xs text-red-400/70 bg-red-500/10 px-2 py-0.5 rounded-full flex items-center gap-1"><Skull size={10} />Dead Lead</span>
                        )}
                        {!c.isDead && c.leadStatus && !c.loanApplications?.length && (
                          <span className="text-xs text-gray-500 bg-obsidian-700/60 px-2 py-0.5 rounded-full">{LEAD_STATUS_LABELS[c.leadStatus] ?? c.leadStatus}</span>
                        )}
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
                    {!isShareHolder && (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => updateCustomer(c.id, { isTrashed: false, trashedAt: undefined })}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-400 hover:text-white bg-obsidian-700/60 hover:bg-obsidian-600/60 border border-obsidian-400/60 rounded-lg transition-colors"
                          title="Restore case"
                        >
                          <RotateCcw size={12} /> Restore
                        </button>
                        <button
                          onClick={() => setBinDeleteTarget({ id: c.id, label: c.name })}
                          className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 rounded-lg transition-colors"
                          title="Permanently delete"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
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
                      {isDirectorLevel && <span className="text-gray-600 text-xs">{getSalesName(c.assignedSalesId)}</span>}
                    </div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      {car && <span className="text-gray-400 text-xs">{car.year} {car.make} {car.model}</span>}
                      {(wo?.sellingPrice || c.dealPrice) ? <span className="text-gold-400 text-xs font-semibold">{formatRM(wo?.sellingPrice ?? c.dealPrice ?? 0)}</span> : null}
                      {wo && <span className="text-gray-600 text-xs">{new Date(wo.createdAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${isLoan ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' : 'bg-green-500/10 border-green-500/30 text-green-400'}`}>
                      {isLoan ? `Loan · ${c.loanWorkOrder?.bank}` : 'Cash'}
                    </span>
                    {c.delivered
                      ? <span className="text-xs font-medium px-2.5 py-1 rounded-full border bg-green-500/10 border-green-500/30 text-green-400 flex items-center gap-1"><Truck size={10} />Delivered</span>
                      : <span className="text-xs font-medium px-2.5 py-1 rounded-full border bg-violet-500/10 border-violet-500/30 text-violet-400">Confirmed</span>
                    }
                    {!isShareHolder && (
                      <button
                        onClick={() => updateCustomer(c.id, { isTrashed: true, trashedAt: new Date().toISOString() })}
                        className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                        title="Move to bin"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
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
        return createPortal(
          <>
            <style>{`@keyframes drawerSpring{from{transform:translateY(100%)}80%{transform:translateY(-6px)}100%{transform:translateY(0)}} @media (max-width:639px){.cust-drawer-wrap{padding-bottom:calc(4rem + env(safe-area-inset-bottom,0px))}} @media (min-width:640px){.cust-drawer-wrap{padding-bottom:0}}`}</style>
            <div className="fixed inset-0 z-[400] bg-black/70 backdrop-blur-sm" onClick={() => { setDetailLead(null); }} />
            <div className="fixed inset-0 z-[400] flex items-end sm:items-center pointer-events-none cust-drawer-wrap">
              <div className="w-full sm:p-4 flex sm:justify-center">
                <div
                  key={detailLead.id}
                  className="pointer-events-auto relative w-full sm:max-w-lg bg-gradient-to-b from-obsidian-700 to-obsidian-800 border-t border-x sm:border border-obsidian-400/80 rounded-t-2xl sm:rounded-2xl shadow-[0_-20px_80px_rgba(0,0,0,0.8)] sm:shadow-[0_20px_80px_rgba(0,0,0,0.8)] flex flex-col"
                  style={{
                    maxHeight: '92vh',
                    transform: dragOffset > 0 ? `translateY(${dragOffset}px)` : undefined,
                    transition: isDragging ? 'none' : 'transform 0.35s cubic-bezier(0.34,1.56,0.64,1)',
                    animation: isDragging ? 'none' : 'drawerSpring 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards',
                  }}
                >
                  {/* Handle bar — mobile only, drag to close */}
                  <div
                    className="flex justify-center pt-3 pb-1 sm:hidden shrink-0 cursor-grab active:cursor-grabbing"
                    onTouchStart={e => { dragStartY.current = e.touches[0].clientY; setIsDragging(true); }}
                    onTouchMove={e => { const d = Math.max(0, e.touches[0].clientY - dragStartY.current); setDragOffset(d); }}
                    onTouchEnd={() => { setIsDragging(false); if (dragOffset > 90) { setDetailLead(null); } setDragOffset(0); }}
                  >
                    <div className="w-10 h-1 bg-obsidian-500/60 rounded-full" />
                  </div>
                  <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl bg-gold-gradient opacity-80" />

                  {/* Header */}
                  <div className="px-5 pt-4 pb-4 border-b border-obsidian-400/60 shrink-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-11 h-11 rounded-full flex items-center justify-center font-bold text-base uppercase shrink-0 ${
                          detailLead.leadStatus === 'contacted'  ? 'bg-blue-500/20 border border-blue-500/40 text-blue-300' :
                          detailLead.leadStatus === 'test_drive' ? 'bg-yellow-500/20 border border-yellow-500/40 text-yellow-300' :
                          detailLead.leadStatus === 'follow_up'  ? 'bg-gold-500/20 border border-gold-500/40 text-gold-300' :
                                                                   'bg-green-500/20 border border-green-500/40 text-green-300'
                        }`}>
                          {detailLead.name.charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-white font-semibold text-base leading-snug">{detailLead.name}</p>
                          {/* Smart context line */}
                          {(() => {
                            if (detailLead.delivered) {
                              const d = detailLead.deliveredAt ? new Date(detailLead.deliveredAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' }) : '';
                              return <p className="text-green-400 text-xs mt-0.5 font-medium">✓ Delivered{d ? ` · ${d}` : ''}</p>;
                            }
                            const approvedApp = detailLead.loanApplications?.find(a => a.status === 'approved');
                            if (approvedApp) {
                              const amt = approvedApp.approvedAmount ? ` · RM ${approvedApp.approvedAmount.toLocaleString()}` : '';
                              return <p className="text-green-400 text-xs mt-0.5 font-medium">✓ {approvedApp.bank} approved{amt}</p>;
                            }
                            if (detailLead.dealType === 'cash' && !detailLead.cashWorkOrder) {
                              return <p className="text-green-400 text-xs mt-0.5 font-medium">💵 Cash buyer · follow up to close</p>;
                            }
                            if (detailLead.dealType === 'loan' && !detailLead.loanWorkOrder) {
                              return <p className="text-purple-400 text-xs mt-0.5 font-medium">🏦 Loan · follow up with banker</p>;
                            }
                            const upcomingTd = testDrives.filter(t => t.customerId === detailLead.id && t.status === 'scheduled').sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0];
                            if (upcomingTd) {
                              const tdDate = new Date(upcomingTd.scheduledAt);
                              const today = new Date(); today.setHours(0,0,0,0);
                              const diff = Math.round((tdDate.getTime() - today.getTime()) / 86400000);
                              const label = diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : tdDate.toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });
                              return <p className="text-yellow-400 text-xs mt-0.5 font-medium">📅 Test drive · {label}</p>;
                            }
                            if (detailLead.followUpDate) {
                              const today = new Date(); today.setHours(0,0,0,0);
                              const target = new Date(detailLead.followUpDate + 'T00:00:00');
                              const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
                              if (diff < 0) return <p className="text-red-400 text-xs mt-0.5 font-medium">⚠ Follow-up overdue {Math.abs(diff)} day{Math.abs(diff) !== 1 ? 's' : ''}</p>;
                              if (diff === 0) return <p className="text-orange-400 text-xs mt-0.5 font-medium">📅 Follow-up today</p>;
                              if (diff === 1) return <p className="text-gold-400 text-xs mt-0.5 font-medium">📅 Follow-up tomorrow</p>;
                              return <p className="text-gray-400 text-xs mt-0.5">📅 Follow-up in {diff} days</p>;
                            }
                            return <p className="text-gray-500 text-xs mt-0.5">{detailLead.phone}</p>;
                          })()}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {!isShareHolder && (
                          <div className="relative">
                            <button onClick={() => setShowDetailMenu(v => !v)} className="p-2 text-gray-500 hover:text-white hover:bg-obsidian-600/60 rounded-xl transition-colors touch-manipulation">
                              <MoreVertical size={16} />
                            </button>
                            {showDetailMenu && (
                              <>
                                <div className="fixed inset-0 z-[299]" onClick={() => setShowDetailMenu(false)} />
                                <div className="absolute right-0 top-full mt-1 z-[300] w-52 bg-obsidian-800 border border-obsidian-400/60 rounded-2xl shadow-2xl overflow-hidden py-1">
                                  {(detailLead.cashWorkOrder || detailLead.loanWorkOrder) && (!detailLead.delivered || isDirectorOrAdmin) && (
                                    <button onClick={() => { openEditWorkOrder(detailLead); setShowDetailMenu(false); }} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gold-400 hover:bg-obsidian-700/60 transition-colors touch-manipulation text-left">
                                      <Edit2 size={14} />Edit Work Order
                                    </button>
                                  )}
                                  <button onClick={() => { openEdit(detailLead); setDetailLead(null); setShowDetailMenu(false); }} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:bg-obsidian-700/60 transition-colors touch-manipulation text-left">
                                    <Edit2 size={14} />Edit Lead Info
                                  </button>
                                  {getRevertLabel(detailLead) && (
                                    <button onClick={() => { handleRevert(detailLead); setShowDetailMenu(false); }} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-orange-400 hover:bg-obsidian-700/60 transition-colors touch-manipulation text-left">
                                      <RotateCcw size={14} />{getRevertLabel(detailLead)}
                                    </button>
                                  )}
                                  {detailLead.isDead && (
                                    <button onClick={() => { handleReviveLead(detailLead); setShowDetailMenu(false); }} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-blue-400 hover:bg-obsidian-700/60 transition-colors touch-manipulation text-left">
                                      Revive Lead
                                    </button>
                                  )}
                                  <div className="border-t border-obsidian-400/30 my-1" />
                                  {!detailLead.isDead && !detailLead.cashWorkOrder && !detailLead.loanWorkOrder && isStale(detailLead) && (
                                    <button onClick={() => { handleMarkDead(detailLead); setShowDetailMenu(false); }} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-400/70 hover:bg-red-500/10 hover:text-red-400 transition-colors touch-manipulation text-left">
                                      <Skull size={14} />Mark as Dead Lead
                                    </button>
                                  )}
                                  <button onClick={() => { updateCustomer(detailLead.id, { isTrashed: true, trashedAt: new Date().toISOString() }); setDetailLead(null); setShowDetailMenu(false); }} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-400/60 hover:bg-red-500/10 hover:text-red-400 transition-colors touch-manipulation text-left">
                                    <Trash2 size={14} />Move to Bin
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                        <button onClick={() => { setDetailLead(null); setShowDetailMenu(false); }} className="p-2 text-gray-500 hover:text-white hover:bg-obsidian-600/60 rounded-xl transition-colors shrink-0 touch-manipulation">
                          <X size={16} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Stage progress strip */}
                  {(() => {
                    const dealLabel = detailLead.cashWorkOrder || detailLead.dealType === 'cash' ? 'Cash' : detailLead.loanWorkOrder || detailLead.dealType === 'loan' || (detailLead.loanStatus && detailLead.loanStatus !== 'not_started') ? 'Loan' : 'Deal';
                    const JOURNEY = ['Lead', 'Test Drive', 'Follow Up', dealLabel, 'Delivered'];
                    const currentIdx = detailLead.delivered ? 4 :
                      (detailLead.cashWorkOrder || detailLead.loanWorkOrder || detailLead.dealType || (detailLead.loanStatus && detailLead.loanStatus !== 'not_started')) ? 3 :
                      detailLead.leadStatus === 'follow_up' ? 2 :
                      detailLead.leadStatus === 'test_drive' ? 1 : 0;
                    return (
                      <div className="px-5 py-3 border-b border-obsidian-400/20 shrink-0">
                        <div className="flex items-center">
                          {JOURNEY.map((stage, i) => (
                            <React.Fragment key={i}>
                              <div className="flex flex-col items-center gap-1 shrink-0">
                                <div className={`rounded-full transition-all ${
                                  i === currentIdx ? 'w-3 h-3 bg-gold-400 shadow-[0_0_8px_rgba(234,184,32,0.8)]' :
                                  i < currentIdx ? 'w-2 h-2 bg-gold-400/50' : 'w-2 h-2 bg-obsidian-500'
                                }`} />
                                <span className={`text-[9px] font-medium leading-none whitespace-nowrap ${
                                  i === currentIdx ? 'text-gold-400' : i < currentIdx ? 'text-gray-600' : 'text-gray-700'
                                }`}>{stage}</span>
                              </div>
                              {i < JOURNEY.length - 1 && (
                                <div className={`flex-1 h-px mx-1.5 ${i < currentIdx ? 'bg-gold-400/40' : 'bg-obsidian-600'}`} />
                              )}
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Tabs */}
                  <div className="flex border-b border-obsidian-400/60 shrink-0">
                    <button onClick={() => setDetailTab('details')} className={`flex-1 py-3.5 text-xs font-semibold transition-colors touch-manipulation ${detailTab === 'details' ? 'text-white border-b-2 border-gold-500' : 'text-gray-500 hover:text-gray-300'}`}>Details</button>
                    {hasWorkOrder && <button onClick={() => setDetailTab('calculation')} className={`flex-1 py-3.5 text-xs font-semibold transition-colors touch-manipulation ${detailTab === 'calculation' ? 'text-white border-b-2 border-gold-500' : 'text-gray-500 hover:text-gray-300'}`}>Deal</button>}
                    {hasWorkOrder && <button onClick={() => setDetailTab('postsale')} className={`flex-1 py-3.5 text-xs font-semibold transition-colors touch-manipulation ${detailTab === 'postsale' ? 'text-white border-b-2 border-gold-500' : 'text-gray-500 hover:text-gray-300'}`}>Post-Sale</button>}
                    <button onClick={() => setDetailTab('timeline')} className={`flex-1 py-3.5 text-xs font-semibold transition-colors touch-manipulation ${detailTab === 'timeline' ? 'text-white border-b-2 border-gold-500' : 'text-gray-500 hover:text-gray-300'}`}>Timeline</button>
                  </div>

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
                      <div className="flex-1 overflow-y-auto min-h-0 pb-20">
                        {/* Total Final Deal — most important number, shown prominently at top */}
                        <div className="mx-4 mt-4 mb-2 bg-gold-500/10 border border-gold-500/30 rounded-2xl p-4 text-center">
                          <p className="text-gold-400/70 text-xs font-semibold uppercase tracking-wide mb-1">Total Final Deal</p>
                          <p className="text-gold-400 text-3xl font-bold">{formatRM(finalDeal)}</p>
                          {discount > 0 && <p className="text-gray-500 text-xs mt-1">{formatRM(sellingPrice)} − {formatRM(discount)} discount</p>}
                        </div>

                        {/* Car Deal */}
                        <div className="px-4 py-2.5 bg-obsidian-700/40 border-t border-b border-obsidian-400/30 mt-4">
                          <p className="text-white text-xs font-bold uppercase tracking-wide">Car Deal</p>
                        </div>
                        <Row label="Selling Price" value={formatRM(sellingPrice)} color="text-white" />
                        {discount > 0 && <Row label="Discount" value={`− ${formatRM(discount)}`} color="text-red-400" sub />}

                        {/* Others */}
                        {(insurance > 0 || bankProduct > 0 || additionalItems.length > 0) && (<>
                          <div className="px-4 py-2.5 bg-obsidian-700/40 border-t border-b border-obsidian-400/30 mt-2">
                            <p className="text-white text-xs font-bold uppercase tracking-wide">Others</p>
                          </div>
                          {insurance > 0 && <Row label="Insurance" value={formatRM(insurance)} />}
                          {bankProduct > 0 && <Row label="Bank Product" value={formatRM(bankProduct)} />}
                          {additionalItems.map((item, i) => <Row key={i} label={item.label || 'Item'} value={formatRM(item.amount)} />)}
                        </>)}

                        {/* Payment */}
                        <div className="px-4 py-2.5 bg-obsidian-700/40 border-t border-b border-obsidian-400/30 mt-2">
                          <p className="text-white text-xs font-bold uppercase tracking-wide">Payment</p>
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
                          <div className="px-4 py-2.5 bg-obsidian-700/40 border-t border-b border-obsidian-400/30 mt-2">
                            <p className="text-white text-xs font-bold uppercase tracking-wide">Trade-In</p>
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
                      <div className="flex-1 overflow-y-auto min-h-0 pb-20">
                        {/* Progress bar — at the top */}
                        {(() => {
                          const steps = [cl.agreementSigned, cl.thumbprintDone, cl.puspakomBooked, cl.b5Obtained, isLoanCase && cl.b7Obtained, b2Required && cl.b2Booked, b2Required && cl.b2Obtained, cl.insuranceCoverNote, cl.nameTransferDone].filter(s => s !== false);
                          const done = steps.filter(Boolean).length;
                          const total = steps.length;
                          const pct = Math.round((done / total) * 100);
                          return (
                            <div className="px-5 pt-4 pb-3 border-b border-obsidian-400/20">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-white text-sm font-semibold">{done}/{total} steps done</span>
                                <span className={`text-sm font-bold ${pct === 100 ? 'text-green-400' : pct >= 60 ? 'text-gold-400' : 'text-gray-400'}`}>{pct}%</span>
                              </div>
                              <div className="h-2 bg-obsidian-600 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-green-500' : 'bg-gold-500'}`} style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })()}

                        {/* Agreement & Thumbprint */}
                        <div className="px-4 py-2.5 bg-obsidian-700/40 border-b border-obsidian-400/30">
                          <p className="text-white text-xs font-bold uppercase tracking-wide">Sale Agreement</p>
                        </div>
                        <Step done={!!cl.agreementSigned} label="S&P Agreement Signed" sub="Customer signs the sale & purchase agreement" onToggle={() => update({ agreementSigned: !cl.agreementSigned })} />
                        <Step done={!!cl.thumbprintDone} label="Thumbprint Done" sub="Customer thumbprint on agreement" onToggle={() => update({ thumbprintDone: !cl.thumbprintDone })} />

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
                        <div className="px-4 py-2.5 bg-obsidian-700/40 border-t border-b border-obsidian-400/30 mt-2">
                          <p className="text-white text-xs font-bold uppercase tracking-wide">Puspakom</p>
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
                        <div className="px-4 py-2.5 bg-obsidian-700/40 border-t border-b border-obsidian-400/30 mt-2">
                          <p className="text-white text-xs font-bold uppercase tracking-wide">Insurance & Transfer</p>
                        </div>
                        <Step done={!!cl.insuranceCoverNote} label="Insurance Cover Note" sub="Get cover note before name transfer" onToggle={() => update({ insuranceCoverNote: !cl.insuranceCoverNote })} />
                        <Step
                          done={!!cl.nameTransferDone}
                          locked={!canTransfer}
                          label="Name Transfer (JPJ)"
                          sub={!canTransfer ? `Requires: ${!b5b7Done ? (isLoanCase ? 'B5, B7' : 'B5') : ''}${!b5b7Done && !cl.insuranceCoverNote ? ', ' : ''}${!cl.insuranceCoverNote ? 'cover note' : ''}` : undefined}
                          onToggle={() => update({ nameTransferDone: !cl.nameTransferDone })}
                        />

                        <div className="h-4" />
                      </div>
                    );
                  })()}

                  {/* Scrollable content — Details tab */}
                  {(!hasWorkOrder || detailTab === 'details') && <div className="flex-1 overflow-y-auto p-5 space-y-5 min-h-0 pb-20">

                {/* Banks — at a glance, no expand/collapse, sorted approved first */}
                {detailLead.loanStatus && detailLead.loanStatus !== 'not_started' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">Banks</p>
                      {!!detailLead.dealPrice && <span className="text-white text-xs font-semibold">{formatRM(detailLead.dealPrice)}</span>}
                    </div>
                    <div className="space-y-2">
                      {[...bankStatuses]
                        .sort((a, b) => {
                          const order: Record<string, number> = { approved: 0, submitted: 1, rejected: 2, cancelled: 3 };
                          return (order[a.status] ?? 4) - (order[b.status] ?? 4);
                        })
                        .map(app => (
                        <div key={app.bank} className={`rounded-xl border overflow-hidden ${
                          app.status === 'approved' ? 'border-green-500/40 bg-green-500/5' :
                          app.status === 'rejected' ? 'border-red-500/20 bg-obsidian-700/40' :
                          app.status === 'cancelled' ? 'border-obsidian-500/30 bg-obsidian-800/40' :
                          'border-obsidian-400/50 bg-obsidian-700/50'
                        }`}>
                          {/* Top row: name + status pill + remove */}
                          <div className="flex items-center gap-2 px-3 pt-3 pb-2">
                            <div className="flex-1 min-w-0">
                              <span className="text-white text-sm font-medium">{app.bank}</span>
                              {app.bankerName && <span className="text-sky-400 text-xs ml-1.5">via {app.bankerName}</span>}
                            </div>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                              app.status === 'approved' ? 'bg-green-500/20 text-green-300' :
                              app.status === 'rejected' ? 'bg-red-500/10 text-red-400' :
                              app.status === 'cancelled' ? 'bg-gray-500/10 text-gray-500' :
                              'bg-yellow-500/10 text-yellow-400'
                            }`}>
                              {app.status === 'approved' ? 'Approved' : app.status === 'rejected' ? 'Rejected' : app.status === 'cancelled' ? 'Cancelled' : 'Submitted'}
                            </span>
                            {!isShareHolder && (
                              <button onClick={() => { const u = bankStatuses.filter(a => a.bank !== app.bank); setBankStatuses(u); handleSaveBankStatuses(detailLead.id, u); }} className="text-gray-600 hover:text-red-400 transition-colors touch-manipulation p-0.5">
                                <X size={12} />
                              </button>
                            )}
                          </div>
                          {/* Approval details */}
                          {app.status === 'approved' && (app.approvedAmount || app.interestRate || app.approvedAt) && (
                            <div className="px-3 pb-2 flex items-center gap-3 flex-wrap">
                              {app.approvedAmount && <span className="text-green-400 text-sm font-bold">RM {app.approvedAmount.toLocaleString()}</span>}
                              {app.interestRate && <span className="text-green-400/70 text-xs">{app.interestRate}% p.a.</span>}
                              {app.approvedAt && (() => {
                                const daysLeft = 90 - Math.floor((Date.now() - new Date(app.approvedAt).getTime()) / 86400000);
                                return daysLeft <= 20
                                  ? <span className="text-orange-400 text-xs flex items-center gap-1"><AlertCircle size={10} />{daysLeft}d left</span>
                                  : <span className="text-gray-500 text-xs">{daysLeft}d remaining</span>;
                              })()}
                            </div>
                          )}
                          {app.rejectionReason && <p className="px-3 pb-2 text-red-400/70 text-xs">{app.rejectionReason}</p>}
                          {app.approvalReason && <p className="px-3 pb-2 text-green-400/60 text-xs">{app.approvalReason}</p>}
                          {/* Status buttons — always visible */}
                          {!isShareHolder && (
                            <div className="flex gap-1.5 px-3 pb-3">
                              <button onClick={() => toggleBankStatus(app.bank, 'approved')} className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-semibold border transition-colors touch-manipulation ${app.status === 'approved' ? 'bg-green-500/20 border-green-500/40 text-green-300' : 'border-obsidian-400/50 text-gray-600 hover:text-green-400 hover:border-green-500/30'}`}>
                                <CheckCircle size={11} />Approve
                              </button>
                              <button onClick={() => toggleBankStatus(app.bank, 'submitted')} className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-semibold border transition-colors touch-manipulation ${app.status === 'submitted' ? 'bg-yellow-500/20 border-yellow-500/40 text-yellow-300' : 'border-obsidian-400/50 text-gray-600 hover:text-yellow-400 hover:border-yellow-500/30'}`}>
                                Pending
                              </button>
                              <button onClick={() => toggleBankStatus(app.bank, 'rejected')} className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-semibold border transition-colors touch-manipulation ${app.status === 'rejected' ? 'bg-red-500/20 border-red-500/40 text-red-300' : 'border-obsidian-400/50 text-gray-600 hover:text-red-400 hover:border-red-500/30'}`}>
                                <XCircle size={11} />Reject
                              </button>
                            </div>
                          )}
                          {/* Inline amount/rate fields when approved */}
                          {!isShareHolder && app.status === 'approved' && (
                            <div className="px-3 pb-3 space-y-2 border-t border-green-500/20 pt-2">
                              <div className="grid grid-cols-2 gap-2">
                                <input type="number" className="input text-xs w-full" placeholder="Amount (RM)" value={app.approvedAmount ?? ''} onChange={e => setBankStatuses(prev => prev.map(a => a.bank === app.bank ? { ...a, approvedAmount: e.target.value ? Number(e.target.value) : undefined } : a))} onBlur={() => handleSaveBankStatuses(detailLead.id)} />
                                <input type="number" step="0.01" className="input text-xs w-full" placeholder="Rate (%)" value={app.interestRate ?? ''} onChange={e => setBankStatuses(prev => prev.map(a => a.bank === app.bank ? { ...a, interestRate: e.target.value ? Number(e.target.value) : undefined } : a))} onBlur={() => handleSaveBankStatuses(detailLead.id)} />
                              </div>
                              <input className="input text-xs w-full" placeholder="Approval notes..." value={app.approvalReason ?? ''} onChange={e => setBankStatuses(prev => prev.map(a => a.bank === app.bank ? { ...a, approvalReason: e.target.value } : a))} onBlur={() => handleSaveBankStatuses(detailLead.id)} />
                              {!detailLead.loanWorkOrder && (
                                <button
                                  onClick={() => openFinalDeal(detailLead, app.bank, app.approvedAmount)}
                                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-green-500 hover:bg-green-400 text-obsidian-900 text-xs font-bold transition-colors touch-manipulation active:scale-95"
                                >
                                  <ClipboardList size={13} />
                                  Proceed with {app.bank} — Final Deal
                                  <ArrowRight size={13} />
                                </button>
                              )}
                            </div>
                          )}
                          {!isShareHolder && app.status === 'rejected' && (
                            <div className="px-3 pb-3 border-t border-red-500/10 pt-2">
                              <input className="input text-xs w-full" placeholder="Rejection reason..." value={app.rejectionReason ?? ''} onChange={e => setBankStatuses(prev => prev.map(a => a.bank === app.bank ? { ...a, rejectionReason: e.target.value } : a))} onBlur={() => handleSaveBankStatuses(detailLead.id)} />
                            </div>
                          )}
                        </div>
                      ))}
                      {/* Add more banks */}
                      {!isShareHolder && BANKS.some(b => !bankStatuses.some(a => a.bank === b)) && (
                        <button onClick={() => { setBankModalPicks({}); setBankModalLeadId(detailLead.id); }} className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-dashed border-obsidian-400/50 text-xs text-gold-400 hover:text-gold-300 hover:border-gold-500/30 transition-colors touch-manipulation">
                          <Plus size={12} />Add bank
                        </button>
                      )}
                    </div>
                  </div>
                )}


                {/* Contact */}
                <div className="space-y-2">
                  <p className="text-gray-500 text-xs font-semibold uppercase tracking-wide">Contact</p>
                  <div className="bg-obsidian-700/60 border border-obsidian-400/70 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Phone size={13} className="text-gray-500 shrink-0" />
                        <span className="text-white text-sm">{detailLead.phone}</span>
                      </div>
                      <button
                        onClick={() => handleWhatsApp(detailLead.phone, detailLead.name)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-semibold shrink-0 touch-manipulation"
                      >
                        <MessageCircle size={12} />WhatsApp
                      </button>
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
                    {isDirectorLevel && (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500 text-xs">Salesperson</span>
                        <span className="text-white text-sm">{getSalesName(detailLead.assignedSalesId)}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Interested Car */}
                {car && (
                  <div className="space-y-2">
                    <p className="text-gray-500 text-xs font-semibold uppercase tracking-wide">Interested Car</p>
                    <div className="bg-obsidian-700/60 border border-obsidian-400/70 rounded-xl p-4 flex items-center gap-3">
                      {car.photo ? (
                        <img src={car.photo} alt="" className="w-16 h-16 rounded-xl object-cover shrink-0 border border-obsidian-400/40" />
                      ) : (
                        <div className="w-16 h-16 rounded-xl bg-gold-500/10 border border-gold-500/20 flex items-center justify-center shrink-0">
                          <Car size={22} className="text-gold-400" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-white text-sm font-semibold">{car.year} {car.make} {car.model}</p>
                        {car.variant && <p className="text-gray-400 text-xs mt-0.5">{car.variant}</p>}
                        <p className="text-gray-500 text-xs mt-0.5">{car.colour} · {car.sellingPrice > 0 ? formatRM(car.sellingPrice) : 'TBD'}</p>
                        {car.carPlate && <p className="text-gold-500/70 text-xs font-mono mt-0.5">{car.carPlate}</p>}
                      </div>
                    </div>
                  </div>
                )}

                {/* Follow-up — always shown, inline date picker */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-gray-500 text-xs font-semibold uppercase tracking-wide">Follow-up</p>
                    {!isShareHolder && (
                      <button onClick={() => setShowInlineFollowup(v => !v)} className="text-xs text-gold-400 hover:text-gold-300 font-medium touch-manipulation">
                        {detailLead.followUpDate ? 'Change date' : '+ Set date'}
                      </button>
                    )}
                  </div>
                  {showInlineFollowup && (
                    <div className="bg-obsidian-800/80 border border-obsidian-400/50 rounded-2xl p-4">
                      <MiniCalendar
                        date={detailLead.followUpDate ?? ''}
                        time=""
                        onDate={d => {
                          updateCustomer(detailLead.id, { followUpDate: d || undefined });
                          setShowInlineFollowup(false);
                        }}
                        onTime={() => {}}
                      />
                    </div>
                  )}
                  {!showInlineFollowup && (
                    <div className="bg-obsidian-700/60 border border-obsidian-400/70 rounded-xl p-4 space-y-2">
                      {detailLead.followUpDate ? (() => {
                        const today = new Date(); today.setHours(0, 0, 0, 0);
                        const target = new Date(detailLead.followUpDate + 'T00:00:00');
                        const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
                        const countdown = diff < 0 ? `Overdue ${Math.abs(diff)} day${Math.abs(diff) !== 1 ? 's' : ''}` :
                                          diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : `In ${diff} days`;
                        const urgent = diff <= 0;
                        return (
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <CalendarCheck size={13} className="text-gray-500 shrink-0" />
                              <span className="text-white text-sm">{target.toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                            </div>
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${urgent ? 'bg-red-500/15 text-red-400 border border-red-500/25' : 'bg-obsidian-600/60 text-gray-400 border border-obsidian-500/30'}`}>{countdown}</span>
                          </div>
                        );
                      })() : (
                        <p className="text-gray-600 text-sm">No follow-up date set</p>
                      )}
                      {detailLead.followUpRemark && (
                        <p className="text-gray-300 text-sm pl-5">{detailLead.followUpRemark}</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Booking Fee */}
                <div className="space-y-2">
                  <p className="text-gray-500 text-xs font-semibold uppercase tracking-wide">Booking Fee</p>
                  <div className="bg-obsidian-700/60 border border-obsidian-400/70 rounded-xl px-4 py-3 flex items-center gap-3">
                    <span className="text-gray-500 text-xs">RM</span>
                    <input
                      type="number"
                      className="flex-1 bg-transparent text-white text-sm outline-none border-b border-transparent focus:border-gold-500/60 transition-colors"
                      placeholder="0"
                      defaultValue={detailLead.bookingFee ?? ''}
                      onBlur={e => {
                        const val = e.target.value ? Number(e.target.value) : undefined;
                        if (val !== detailLead.bookingFee) {
                          updateCustomer(detailLead.id, { bookingFee: val, lastActionAt: new Date().toISOString() });
                        }
                      }}
                      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    />
                    {detailLead.bookingFee ? (
                      <span className="text-gold-400 text-xs font-semibold">{formatRM(detailLead.bookingFee)}</span>
                    ) : (
                      <span className="text-gray-600 text-xs">Not recorded</span>
                    )}
                  </div>
                </div>

                {/* Payment method — only show when not yet tagged */}
                {detailLead.leadStatus === 'follow_up' && !detailLead.dealType && !detailLead.cashWorkOrder && !detailLead.loanWorkOrder && !isShareHolder && (
                  <div className="space-y-2">
                    <p className="text-gray-600 text-xs font-semibold uppercase tracking-wide text-center">How is customer paying?</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => {
                          updateCustomer(detailLead.id, { dealType: 'loan' });
                          setBankModalPicks({});
                          setBankModalLeadId(detailLead.id);
                          setDetailLead(null);
                        }}
                        className="flex items-center justify-center gap-2 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-400 py-3 rounded-xl text-sm font-semibold transition-colors touch-manipulation"
                      >
                        <Banknote size={14} />Loan
                      </button>
                      <button
                        onClick={() => {
                          updateCustomer(detailLead.id, { dealType: 'cash' });
                        }}
                        className="flex items-center justify-center gap-2 bg-green-500/10 hover:bg-green-500/20 border border-green-500/30 text-green-400 py-3 rounded-xl text-sm font-semibold transition-colors touch-manipulation"
                      >
                        <Banknote size={14} />Cash
                      </button>
                    </div>
                  </div>
                )}

                {/* Cash lead — tagged, not yet work order */}
                {detailLead.dealType === 'cash' && !detailLead.cashWorkOrder && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between px-3 py-2.5 bg-green-500/5 border border-green-500/20 rounded-xl">
                      <div className="flex items-center gap-2">
                        <Banknote size={13} className="text-green-400" />
                        <span className="text-green-400 text-sm font-semibold">Cash Buyer</span>
                      </div>
                      <span className="text-gray-500 text-xs">Follow up to close</span>
                    </div>
                    {!isShareHolder && (
                      <button
                        onClick={() => {
                          const interestedCar = cars.find(car => car.id === detailLead.interestedCarId);
                          setLoanForm({ dealPrice: String(interestedCar?.sellingPrice ?? ''), carId: detailLead.interestedCarId ?? '' });
                          setSidebarLead(detailLead);
                          setSidebarCashFlow(true);
                          setSidebarView('car_select');
                          setDetailLead(null);
                        }}
                        className="w-full flex items-center justify-center gap-2 bg-obsidian-700/60 hover:bg-obsidian-600/60 border border-obsidian-400/50 text-gray-300 py-2.5 rounded-xl text-sm font-medium transition-colors touch-manipulation"
                      >
                        <ClipboardList size={14} />Create Cash Work Order
                      </button>
                    )}
                  </div>
                )}
              </div>}

              {/* Timeline tab */}
              {detailTab === 'timeline' && (() => {
                const tlWo = detailLead.loanWorkOrder ?? detailLead.cashWorkOrder;
                const tlTd = testDrives.filter(t => t.customerId === detailLead.id).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
                const events: { date: string; label: string; sub?: string; color: string; dot: string }[] = [];

                if (detailLead.deliveredAt) {
                  events.push({ date: detailLead.deliveredAt, label: 'Car Delivered', sub: new Date(detailLead.deliveredAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }), color: 'text-green-400', dot: 'bg-green-400' });
                }
                if (tlWo?.createdAt) {
                  events.push({ date: tlWo.createdAt, label: detailLead.loanWorkOrder ? `Loan Work Order · ${detailLead.loanWorkOrder.bank ?? ''}` : 'Cash Work Order', sub: formatRM(tlWo.sellingPrice), color: 'text-violet-400', dot: 'bg-violet-400' });
                }
                (detailLead.loanApplications ?? []).forEach(app => {
                  const statusLabel = app.status === 'approved' ? 'Loan Approved' : app.status === 'rejected' ? 'Loan Rejected' : app.status === 'cancelled' ? 'Loan Cancelled' : 'Loan Submitted';
                  const dotColor = app.status === 'approved' ? 'bg-green-400' : app.status === 'rejected' ? 'bg-red-400' : app.status === 'cancelled' ? 'bg-gray-500' : 'bg-blue-400';
                  const textColor = app.status === 'approved' ? 'text-green-400' : app.status === 'rejected' ? 'text-red-400' : app.status === 'cancelled' ? 'text-gray-500' : 'text-blue-400';
                  events.push({ date: detailLead.createdAt, label: `${statusLabel} · ${app.bank}`, color: textColor, dot: dotColor });
                });
                tlTd.forEach(td => {
                  const tdStatus = td.status === 'completed' ? 'Test Drive Done' : td.status === 'cancelled' ? 'Test Drive Cancelled' : 'Test Drive Scheduled';
                  const tdCar = cars.find(c => c.id === td.carId);
                  events.push({ date: td.scheduledAt, label: tdStatus, sub: tdCar ? `${tdCar.year} ${tdCar.make} ${tdCar.model}` : undefined, color: 'text-yellow-400', dot: 'bg-yellow-400' });
                });
                if (detailLead.lastActionAt && detailLead.lastActionAt !== detailLead.createdAt) {
                  events.push({ date: detailLead.lastActionAt, label: 'Last Activity', color: 'text-gray-400', dot: 'bg-gray-500' });
                }
                if (detailLead.followUpDate) {
                  const isPast = detailLead.followUpDate < new Date().toISOString().slice(0, 10);
                  events.push({ date: detailLead.followUpDate + 'T00:00:00', label: isPast ? 'Follow-up (overdue)' : 'Follow-up Scheduled', sub: detailLead.followUpRemark || undefined, color: isPast ? 'text-red-400' : 'text-gold-400', dot: isPast ? 'bg-red-400' : 'bg-gold-400' });
                }
                events.push({ date: detailLead.createdAt, label: 'Lead Created', sub: SOURCE_LABELS[detailLead.source], color: 'text-gray-400', dot: 'bg-gray-600' });

                events.sort((a, b) => b.date.localeCompare(a.date));

                return (
                  <div className="flex-1 overflow-y-auto min-h-0 p-5 pb-20">
                    <div className="relative">
                      <div className="absolute left-3 top-2 bottom-2 w-px bg-obsidian-400/40" />
                      <div className="space-y-5">
                        {events.map((ev, i) => (
                          <div key={i} className="flex gap-3 relative">
                            <span className={`w-6 h-6 rounded-full ${ev.dot} flex-shrink-0 flex items-center justify-center z-10 mt-0.5`}>
                              <span className="w-2 h-2 rounded-full bg-white/30" />
                            </span>
                            <div className="min-w-0">
                              <p className={`text-sm font-semibold ${ev.color}`}>{ev.label}</p>
                              {ev.sub && <p className="text-gray-400 text-xs mt-0.5">{ev.sub}</p>}
                              <p className="text-gray-600 text-xs mt-0.5">{new Date(ev.date).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Floating corner FAB — primary action only */}
              {(() => {
                if (detailLead.delivered) {
                  return (
                    <div className="absolute right-4 bottom-4 flex items-center gap-2 bg-green-500/10 border border-green-500/30 text-green-400 px-4 h-12 rounded-full text-sm font-semibold shadow-lg" style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}>
                      <CheckCircle size={15} />Delivered
                    </div>
                  );
                }
                if ((detailLead.cashWorkOrder || detailLead.loanWorkOrder) && !isShareHolder) {
                  return (
                    <button onClick={() => { setDeliveryPhotoUrl(''); setShowDeliveryModal(true); }} className="absolute right-4 bottom-4 flex items-center gap-2 bg-violet-500 hover:bg-violet-400 text-white px-4 h-12 rounded-full text-sm font-semibold shadow-[0_4px_20px_rgba(139,92,246,0.4)] transition-all touch-manipulation active:scale-95" style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}>
                      <Truck size={15} />Deliver
                    </button>
                  );
                }
                if (detailLead.leadStatus === 'test_drive' && !isShareHolder) {
                  return (
                    <button onClick={() => { openSidebar(detailLead); setDetailLead(null); }} className="absolute right-4 bottom-4 flex items-center gap-2 bg-yellow-400 hover:bg-yellow-300 text-obsidian-900 px-4 h-12 rounded-full text-sm font-bold shadow-[0_4px_20px_rgba(234,179,8,0.4)] transition-all touch-manipulation active:scale-95" style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}>
                      Next Step <ArrowRight size={15} />
                    </button>
                  );
                }
                if (detailLead.leadStatus === 'contacted' && !isShareHolder) {
                  return (
                    <button onClick={() => { openTdSchedule(detailLead); setDetailLead(null); }} className="absolute right-4 bottom-4 flex items-center gap-2 bg-yellow-400 hover:bg-yellow-300 text-obsidian-900 px-4 h-12 rounded-full text-sm font-bold shadow-[0_4px_20px_rgba(234,179,8,0.4)] transition-all touch-manipulation active:scale-95" style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}>
                      <Car size={15} />Test Drive
                    </button>
                  );
                }
                return null;
              })()}
                </div>
              </div>
            </div>
          </>,
          document.body,
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
            <MiniCalendar
              date={tdForm.date}
              time={tdForm.time}
              onDate={d => setTdForm(f => ({ ...f, date: d, time: '' }))}
              onTime={t => setTdForm(f => ({ ...f, time: t }))}
            />
            <button
              onClick={() => {
                if (!tdForm.date || !tdForm.time) return;
                addTestDrive({
                  id: generateId(),
                  customerId: tdCustomer.id,
                  carId: tdForm.carId,
                  scheduledAt: `${tdForm.date}T${tdForm.time}`,
                  status: 'scheduled',
                  notes: tdForm.notes || undefined,
                  salesId: tdCustomer.assignedSalesId || (currentUser?.id ?? ''),
                  createdAt: new Date().toISOString(),
                });
                updateCustomer(tdCustomer.id, { leadStatus: 'test_drive', lastActionAt: new Date().toISOString() });
                setShowTdModal(false);
                setTdCustomer(null);
              }}
              disabled={!tdForm.date || !tdForm.time}
              className="w-full btn-gold disabled:opacity-40 disabled:cursor-not-allowed py-2.5 rounded-lg text-sm font-medium"
            >
              Save to Calendar
            </button>
            <button
              onClick={() => {
                updateCustomer(tdCustomer.id, { leadStatus: 'test_drive', lastActionAt: new Date().toISOString() });
                setShowTdModal(false);
                openSidebar({ ...tdCustomer, leadStatus: 'test_drive' });
                setTdCustomer(null);
              }}
              className="w-full border border-obsidian-400/50 text-gray-400 hover:text-white py-2.5 rounded-lg text-sm transition-colors"
            >
              Skip Test Drive
            </button>
          </div>
        )}
      </Modal>

      {/* ── Work Order Overlay (Cash & Loan) ─────────── */}
      {workOrderCustomer && (() => {
        const car = getCar(workOrderCarId);
        const totalFinalDeal = woForm.sellingPrice - woForm.discount;
        const downpayment = workOrderType === 'loan' ? woForm.sellingPrice - woForm.loanAmount : 0;
        const netTradeIn = woForm.tradeInPrice - woForm.settlementFigure;

        return createPortal(
          <div className="fixed inset-0 z-[400] bg-[#080808] overflow-y-auto">
            {/* Header */}
            <div className="sticky top-0 z-10 bg-[#0F0E0C] border-b border-obsidian-400/60 px-4 flex items-center justify-between"
              style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))', paddingBottom: '0.75rem' }}>
              <div>
                <p className="text-white font-semibold text-sm">{workOrderIsEdit ? 'Edit Work Order' : workOrderType === 'loan' ? 'Loan Work Order' : 'Cash Work Order'}</p>
                <p className="text-gray-500 text-xs">{workOrderCustomer.name} · {car ? `${car.year} ${car.make} ${car.model}` : ''}</p>
              </div>
              <button onClick={() => { setWorkOrderCustomer(null); setWorkOrderIsEdit(false); }} className="p-1.5 text-gray-500 hover:text-white hover:bg-obsidian-600/60 rounded-lg transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="max-w-lg mx-auto px-4 py-5 space-y-6 pb-32">

              {/* ── Section 1: Deal ── */}
              <div>
                <p className="text-gray-400 text-xs font-semibold uppercase tracking-widest mb-3">Deal of the Car</p>
                <div className="bg-[#0F0E0C] border border-obsidian-400/60 rounded-xl overflow-hidden">
                  {/* Selling Price — locked for non-directors */}
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-obsidian-400/30">
                    <span className="text-gray-400 text-sm flex-1">Selling Price</span>
                    {isDirectorOrAdmin ? (
                      <div className="flex items-center gap-1">
                        <span className="text-gray-600 text-xs">RM</span>
                        <input
                          type="number"
                          value={woForm.sellingPrice || ''}
                          onChange={e => setWoForm(f => ({ ...f, sellingPrice: Number(e.target.value) }))}
                          className="w-28 bg-transparent text-white text-sm text-right outline-none border-b border-transparent focus:border-gold-500/60 transition-colors"
                          placeholder="0"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-white text-sm font-medium">{formatRM(woForm.sellingPrice)}</span>
                        <Lock size={12} className="text-gray-600" />
                      </div>
                    )}
                  </div>

                  {/* Insurance & Bank Product */}
                  {[
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
                  {woForm.discount > 0 && !isDirectorOrAdmin && (
                    <div className="px-4 py-2 flex items-center gap-2 bg-amber-500/5 border-b border-obsidian-400/30">
                      <AlertCircle size={12} className="text-amber-400 shrink-0" />
                      <p className="text-amber-400/80 text-xs">Discount requires director approval</p>
                    </div>
                  )}

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
            <div className="fixed bottom-0 left-0 right-0 bg-[#0F0E0C] border-t border-obsidian-400/60 px-4 pt-4"
              style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}>
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
                    : workOrderIsEdit ? 'Save Changes' : 'Submit Work Order'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        );
      })()}
      <DeleteConfirmModal
        isOpen={!!binDeleteTarget}
        onClose={() => setBinDeleteTarget(null)}
        onConfirm={async () => { if (binDeleteTarget) { await deleteCustomer(binDeleteTarget.id); setBinDeleteTarget(null); } }}
        itemName={binDeleteTarget?.label ?? ''}
      />

      {/* Bank Submit Modal */}
      {bankModalLeadId && (() => {
        const lead = customers.find(c => c.id === bankModalLeadId);
        if (!lead) return null;
        const alreadySubmitted = (lead.loanApplications ?? []).map(a => a.bank);
        const available = BANKS.filter(b => !alreadySubmitted.includes(b));
        const selectedBanks = Object.keys(bankModalPicks);
        const carName = (() => { const c = cars.find(x => x.id === lead.interestedCarId); return c ? `${c.year} ${c.make} ${c.model}` : null; })();

        const toggle = (bank: string) => {
          const next = { ...bankModalPicks };
          if (bank in next) { delete next[bank]; } else { next[bank] = ''; }
          setBankModalPicks(next);
        };

        const doSubmit = () => {
          const newApps: LoanApplication[] = selectedBanks.map(bank => {
            const banker = bankers.find(b => b.id === bankModalPicks[bank]);
            return { bank, status: 'submitted' as const, ...(banker ? { bankerId: banker.id, bankerName: banker.name } : {}) };
          });
          if (bankModalPendingData) {
            updateCustomer(bankModalLeadId, {
              leadStatus: 'loan_submitted',
              loanStatus: 'submitted',
              ...(bankModalPendingData.carId ? { interestedCarId: bankModalPendingData.carId } : {}),
              ...(bankModalPendingData.dealPrice ? { dealPrice: bankModalPendingData.dealPrice } : {}),
              lastActionAt: new Date().toISOString(),
            });
          }
          handleSaveBankStatuses(bankModalLeadId, [...(lead.loanApplications ?? []), ...newApps]);
          setBankModalLeadId(null);
          setBankModalPendingData(null);
        };

        const close = () => { setBankModalLeadId(null); setBankModalPendingData(null); };

        return createPortal(
          <div className="fixed inset-0 z-[400] flex items-end sm:items-center justify-center sm:p-4 bg-black/60 backdrop-blur-sm" onClick={close}>
            <div className="w-full sm:max-w-sm bg-obsidian-800 sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col overflow-hidden" style={{ maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>

              {/* Handle bar */}
              <div className="flex justify-center pt-3 pb-1 sm:hidden">
                <div className="w-10 h-1 bg-obsidian-500/60 rounded-full" />
              </div>

              {/* Header */}
              <div className="px-6 pt-5 pb-4 flex items-start justify-between">
                <div>
                  <p className="text-white font-bold text-lg">Submit Loan</p>
                  <p className="text-gray-500 text-sm mt-0.5">{lead.name}{carName ? ` · ${carName}` : ''}</p>
                </div>
                <button onClick={close} className="mt-1 text-gray-500 hover:text-white transition-colors"><X size={18} /></button>
              </div>

              {/* Scrollable body */}
              <div className="px-4 pb-2 space-y-4 flex-1 min-h-0 overflow-y-auto">

                {/* Bank selection + inline banker picker */}
                {available.length === 0 ? (
                  <p className="text-gray-600 text-sm text-center py-8">All banks already submitted</p>
                ) : (
                  <div className="space-y-2">
                    {available.map(bank => {
                      const selected = bank in bankModalPicks;
                      const needsBanker = selected && !(NO_BANKER_BANKS as readonly string[]).includes(bank);
                      const bankBankers = needsBanker ? bankers.filter(b => b.bank === bank) : [];
                      const selectedBankerId = bankModalPicks[bank] ?? '';
                      return (
                        <React.Fragment key={bank}>
                          {/* Bank card — uniform height */}
                          <button
                            onClick={() => toggle(bank)}
                            className={`w-full flex items-center justify-between px-5 py-4 rounded-2xl border transition-all ${
                              selected
                                ? 'border-gold-500/50 bg-gold-500/5'
                                : 'border-obsidian-500/30 bg-obsidian-700/30 hover:border-obsidian-400/50'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 transition-all ${
                                selected ? 'bg-gold-500 text-obsidian-900' : 'bg-obsidian-600/60 text-gray-400'
                              }`}>
                                {bank[0]}
                              </div>
                              <p className={`font-semibold text-sm transition-colors ${selected ? 'text-white' : 'text-gray-400'}`}>{bank}</p>
                            </div>
                            <div className={`w-5 h-5 rounded-full border-2 transition-all flex items-center justify-center ${
                              selected ? 'border-gold-400 bg-gold-400' : 'border-obsidian-500/60'
                            }`}>
                              {selected && <div className="w-2 h-2 rounded-full bg-obsidian-900" />}
                            </div>
                          </button>

                          {/* Banker picker — appears directly below this bank when selected */}
                          {needsBanker && (
                            <div className="ml-3 pl-3 border-l-2 border-gold-500/30 -mt-1 pb-1">
                              {bankBankers.length === 0 ? (
                                <p className="text-gray-600 text-xs py-2 px-1">No bankers added — go to Data → Bankers</p>
                              ) : (
                                <div className="flex flex-wrap gap-2 py-2">
                                  {bankBankers.map(b => {
                                    const isChosen = selectedBankerId === b.id;
                                    return (
                                      <button
                                        key={b.id}
                                        onClick={() => setBankModalPicks({ ...bankModalPicks, [bank]: isChosen ? '' : b.id })}
                                        className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition-all ${
                                          isChosen
                                            ? 'border-gold-500/60 bg-gold-500/10 text-gold-300'
                                            : 'border-obsidian-500/30 bg-obsidian-700/40 text-gray-400 hover:border-obsidian-400/60'
                                        }`}
                                      >
                                        <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                                          isChosen ? 'bg-gold-500 text-obsidian-900' : 'bg-obsidian-600/60'
                                        }`}>
                                          {b.name[0]}
                                        </div>
                                        {b.name}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                )}

              </div>

              {/* Submit */}
              <div className="px-4 pt-3 shrink-0"
                style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}>
                <button
                  onClick={doSubmit}
                  disabled={selectedBanks.length === 0}
                  className="w-full btn-gold py-4 rounded-2xl text-sm font-bold disabled:opacity-30"
                >
                  {selectedBanks.length === 0
                    ? 'Select at least one bank'
                    : `Submit to ${selectedBanks.length} bank${selectedBanks.length > 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        );
      })()}
    </div>
  );
}
