import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Upload, Receipt, Check, Clock, CreditCard, AlertCircle, X, Search, Wrench, Building2, UserCircle, Trash2 } from 'lucide-react';
import { useStore } from '../store';
import { supabase } from '../lib/supabase';
import { formatRM, generateId } from '../utils/format';
import { Payment } from '../types';
import Modal from '../components/Modal';
import StatCard from '../components/StatCard';
import ProfileModal from '../components/ProfileModal';
import Lightbox from '../components/Lightbox';
import { toast } from '../utils/toast';

async function uploadClaimReceipt(file: File): Promise<string> {
  const path = `receipts/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  const { error } = await supabase.storage.from('car-photos').upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from('car-photos').getPublicUrl(path);
  return data.publicUrl;
}

const EMPTY_FORM = {
  category: '',
  amount: '',
  description: '',
  carId: '',
  receiptUrl: '',
  recipientChoice: 'self' as 'self' | 'vendor',
  vendorId: '',
  vendorKind: '' as '' | 'workshop' | 'merchant',
  vendorName: '',
};

function inputCls() {
  return 'w-full bg-obsidian-700/60 border border-obsidian-400/60 text-white placeholder-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500 transition-colors';
}

function statusInfo(c: Payment): { label: string; cls: string; icon: React.ElementType } {
  if (c.status === 'transferred') return { label: 'Paid', cls: 'bg-green-500/15 text-green-400 border-green-500/30', icon: Check };
  if (c.claimConfirmedBy) return { label: 'Confirmed — ready', cls: 'bg-sky-500/15 text-sky-400 border-sky-500/30', icon: Check };
  return { label: 'Awaiting review', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30', icon: Clock };
}

const PLATE_SIZE_CLS = {
  xs: 'text-[10px] px-1.5 py-0.5',
  sm: 'text-xs px-2 py-0.5',
  md: 'text-sm px-2.5 py-1',
} as const;

function PlateBadge({ plate, size = 'sm' }: { plate?: string; size?: keyof typeof PLATE_SIZE_CLS }) {
  if (!plate) return <span className={`shrink-0 ${size === 'md' ? 'text-xs' : size === 'xs' ? 'text-[10px]' : 'text-xs'} text-gray-700`}>No plate</span>;
  return (
    <span className={`shrink-0 font-mono font-semibold rounded bg-[#2C2415] text-gold-300 border border-[#3C321E] tracking-wider ${PLATE_SIZE_CLS[size]}`}>
      {plate}
    </span>
  );
}

export default function Claims() {
  const currentUser = useStore((s) => s.currentUser);
  const cars = useStore((s) => s.cars);
  const workshops = useStore((s) => s.workshops);
  const merchants = useStore((s) => s.merchants);
  const claimCategories = useStore((s) => s.claimCategories);
  const payments = useStore((s) => s.payments);
  const addPayment = useStore((s) => s.addPayment);
  const deletePayment = useStore((s) => s.deletePayment);

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [previewReceipt, setPreviewReceipt] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [carQuery, setCarQuery] = useState('');
  const [showCarDropdown, setShowCarDropdown] = useState(false);
  const carPickerRef = useRef<HTMLDivElement>(null);

  const [showVendorDropdown, setShowVendorDropdown] = useState(false);
  const vendorPickerRef = useRef<HTMLDivElement>(null);

  const [categoryQuery, setCategoryQuery] = useState('');
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const categoryPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (carPickerRef.current && !carPickerRef.current.contains(e.target as Node)) setShowCarDropdown(false);
      if (vendorPickerRef.current && !vendorPickerRef.current.contains(e.target as Node)) setShowVendorDropdown(false);
      if (categoryPickerRef.current && !categoryPickerRef.current.contains(e.target as Node)) setShowCategoryDropdown(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // Admin-managed in Data → Claim Categories. 'kind' decides which car cost
  // bucket a confirmed claim writes into — never asked as a separate step.
  const categoryKindByName = useMemo(() => {
    const m: Record<string, 'repair' | 'misc'> = {};
    claimCategories.forEach((c) => { m[c.name] = c.kind; });
    return m;
  }, [claimCategories]);

  const categoryNames = useMemo(() => claimCategories.map((c) => c.name), [claimCategories]);

  const filteredCategories = useMemo(() => {
    const q = categoryQuery.trim().toLowerCase();
    if (!q) return categoryNames;
    return categoryNames.filter((c) => c.toLowerCase().includes(q));
  }, [categoryNames, categoryQuery]);

  const selectedCar = cars.find((c) => c.id === form.carId);

  const filteredCars = useMemo(() => {
    const q = carQuery.trim().toLowerCase();
    const list = !q ? cars : cars.filter((c) =>
      (c.carPlate ?? '').toLowerCase().includes(q) ||
      c.make.toLowerCase().includes(q) ||
      c.model.toLowerCase().includes(q) ||
      String(c.year).includes(q)
    );
    return list.slice(0, 40);
  }, [cars, carQuery]);

  const vendorOptions = useMemo(() => [
    ...workshops.map((w) => ({ id: w.id, name: w.name, kind: 'workshop' as const, bankName: w.bankName, accountNumber: w.bankAccountNumber, accountHolder: w.bankAccountHolder, category: w.speciality })),
    ...merchants.map((m) => ({ id: m.id, name: m.name, kind: 'merchant' as const, bankName: m.bankName, accountNumber: m.bankAccountNumber, accountHolder: m.bankAccountHolder, category: m.category })),
  ], [workshops, merchants]);

  // Workshops are always repair vendors, merchants already carry their own
  // category from Data — pick a vendor and the category fills itself in.
  const selectVendor = (v: typeof vendorOptions[number]) => {
    setForm((f) => ({ ...f, vendorId: v.id, vendorKind: v.kind, vendorName: v.name, category: v.category || (v.kind === 'workshop' ? 'Repair' : 'Other') }));
    setShowVendorDropdown(false);
  };

  const filteredVendors = useMemo(() => {
    const q = form.vendorName.trim().toLowerCase();
    if (!q) return vendorOptions.slice(0, 40);
    return vendorOptions.filter((v) => v.name.toLowerCase().includes(q)).slice(0, 40);
  }, [vendorOptions, form.vendorName]);

  const isVendorRegistered = !!form.vendorId;

  const hasBankDetails = !!currentUser?.bankAccountNumber;
  const needsSelfBank = form.recipientChoice === 'self';

  const myClaims = payments
    .filter((p) => p.type === 'expense_claim' && p.recipientId === currentUser?.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const pendingCount = myClaims.filter((c) => c.status === 'pending').length;
  const paidTotal = myClaims.filter((c) => c.status === 'transferred').reduce((s, c) => s + c.amount, 0);

  const canSubmit =
    (!needsSelfBank || hasBankDetails) &&
    !!form.category.trim() &&
    !!form.amount && Number(form.amount) > 0 &&
    !!form.receiptUrl &&
    (form.recipientChoice === 'self' || !!form.vendorName.trim()) &&
    !submitting;

  const openModal = () => { setForm(EMPTY_FORM); setCarQuery(''); setShowCarDropdown(false); setShowVendorDropdown(false); setCategoryQuery(''); setShowCategoryDropdown(false); setShowModal(true); };

  const handleSubmit = async () => {
    if (!currentUser || !canSubmit) return;
    setSubmitting(true);
    try {
      const isSelf = form.recipientChoice === 'self';
      const vendor = vendorOptions.find((v) => v.id === form.vendorId);
      const kind = categoryKindByName[form.category] ?? 'misc';
      await addPayment({
        id: generateId(),
        type: 'expense_claim',
        carId: form.carId || undefined,
        recipientType: isSelf ? 'user' : (form.vendorKind || (kind === 'repair' ? 'workshop' : 'merchant')),
        recipientId: isSelf ? currentUser.id : form.vendorId,
        recipientName: isSelf ? currentUser.name : form.vendorName.trim(),
        bankName: isSelf ? currentUser.bankName : vendor?.bankName,
        accountNumber: isSelf ? currentUser.bankAccountNumber : vendor?.accountNumber,
        accountHolder: isSelf ? currentUser.bankAccountHolder : vendor?.accountHolder,
        amount: Number(form.amount),
        description: form.description.trim(),
        claimKind: kind,
        claimCategory: form.category,
        receiptUrl: form.receiptUrl,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
      setShowModal(false);
      setForm(EMPTY_FORM);
      toast.success('Claim submitted');
    } finally {
      setSubmitting(false);
    }
  };

  // Only while a claim hasn't been reviewed yet — once admin confirms it, it may
  // already be tied to a car's cost record, so deleting from there is director-only.
  const handleDeleteClaim = (id: string) => {
    if (confirm('Delete this claim? This cannot be undone.')) deletePayment(id);
  };

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="Pending Claims" value={pendingCount} icon={Clock} borderColor="border-l-amber-400" iconColor="text-amber-400" />
        <StatCard title="Total Paid" value={formatRM(paidTotal)} icon={CreditCard} borderColor="border-l-green-400" iconColor="text-green-400" />
        <StatCard title="All Claims" value={myClaims.length} icon={Receipt} borderColor="border-l-gold-400" iconColor="text-gold-400" />
      </div>

      {/* Header + submit */}
      <div className="flex items-center justify-between">
        <p className="text-gray-400 text-sm">
          <span className="text-white font-medium">{myClaims.length}</span> claim{myClaims.length !== 1 ? 's' : ''} submitted
        </p>
        <button onClick={openModal} className="flex items-center gap-2 btn-gold px-4 py-2.5 rounded-lg text-sm">
          <Plus size={16} /> Submit Claim
        </button>
      </div>

      {!hasBankDetails && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <AlertCircle size={16} className="text-amber-400 shrink-0" />
          <p className="text-xs text-amber-300 flex-1">
            Add your bank account details in your profile before you can submit a claim.
          </p>
          <button
            onClick={() => setShowProfile(true)}
            className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors"
          >
            Add Bank Details
          </button>
        </div>
      )}

      {/* List */}
      {myClaims.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Receipt size={40} className="text-gray-600 mb-3" />
          <p className="text-gray-400">No claims submitted yet</p>
          <p className="text-gray-600 text-xs mt-1">Petrol, bills, or anything else you paid for out of pocket</p>
        </div>
      ) : (
        <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card overflow-hidden divide-y divide-obsidian-400/30">
          {myClaims.map((c) => {
            const info = statusInfo(c);
            const StatusIcon = info.icon;
            const claimCar = c.carId ? cars.find((car) => car.id === c.carId) : undefined;
            const canDelete = !c.claimConfirmedBy;
            return (
              <div key={c.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white text-sm font-medium">{formatRM(c.amount)}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium flex items-center gap-1 ${info.cls}`}>
                      <StatusIcon size={9} />{info.label}
                    </span>
                    {claimCar?.carPlate && <PlateBadge plate={claimCar.carPlate} size="xs" />}
                  </div>
                  <p className="text-gray-500 text-xs mt-0.5 truncate">
                    {c.description}
                    {claimCar && <span> · {claimCar.year} {claimCar.make} {claimCar.model}</span>}
                  </p>
                </div>
                {c.receiptUrl ? (
                  <button
                    type="button"
                    onClick={() => setPreviewReceipt(c.receiptUrl!)}
                    title="View receipt"
                    className="shrink-0 flex items-center gap-1 text-[11px] font-medium text-green-400 bg-green-500/10 border border-green-500/25 px-2 py-1 rounded-lg hover:bg-green-500/20 transition-colors"
                  >
                    <Check size={11} /> Receipt
                  </button>
                ) : (
                  <span className="shrink-0 flex items-center gap-1 text-[11px] font-medium text-red-400 bg-red-500/10 border border-red-500/25 px-2 py-1 rounded-lg">
                    No receipt
                  </span>
                )}
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => handleDeleteClaim(c.id)}
                    title="Delete claim"
                    className="shrink-0 p-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Submit modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Submit Expense Claim" maxWidth="max-w-md">
        <div className="space-y-4">
          <div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, recipientChoice: 'self' }))}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  form.recipientChoice === 'self' ? 'bg-sky-500/20 border-sky-500/40 text-sky-300' : 'border-obsidian-400/60 text-gray-400 hover:text-white'
                }`}
              >
                <UserCircle size={14} /> Self Claim
              </button>
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, recipientChoice: 'vendor' }))}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  form.recipientChoice === 'vendor' ? 'bg-violet-500/20 border-violet-500/40 text-violet-300' : 'border-obsidian-400/60 text-gray-400 hover:text-white'
                }`}
              >
                <Building2 size={14} /> Vendor Claim
              </button>
            </div>
            {form.recipientChoice === 'self' && !hasBankDetails && (
              <p className="text-[11px] text-amber-400 mt-1.5">
                You'll need bank details on your profile before you can submit this.{' '}
                <button type="button" onClick={() => setShowProfile(true)} className="underline hover:text-amber-300">Add now</button>
              </p>
            )}
          </div>

          {/* Always rendered (even for "Me") so the modal doesn't resize when switching — just blank, not removed */}
          <div className={form.recipientChoice === 'vendor' ? undefined : 'invisible'} aria-hidden={form.recipientChoice !== 'vendor'}>
            <label className="block text-gray-400 text-xs mb-1">Vendor / Workshop</label>
            {isVendorRegistered ? (
                <div className="flex items-center gap-2.5 bg-obsidian-700/60 border border-obsidian-400/60 rounded-lg px-3 py-2">
                  {form.vendorKind === 'workshop' ? <Wrench size={14} className="text-orange-400 shrink-0" /> : <Receipt size={14} className="text-pink-400 shrink-0" />}
                  <span className="flex-1 text-sm text-white truncate">{form.vendorName}</span>
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, vendorId: '', vendorKind: '', vendorName: '' }))}
                    className="shrink-0 p-1 rounded text-gray-500 hover:text-red-400 transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div className="relative" ref={vendorPickerRef}>
                  <input
                    className={inputCls()}
                    placeholder="Search or type a new vendor's name..."
                    value={form.vendorName}
                    onChange={(e) => { setForm((f) => ({ ...f, vendorName: e.target.value, vendorId: '', vendorKind: '' })); setShowVendorDropdown(true); }}
                    onFocus={() => setShowVendorDropdown(true)}
                  />
                  {showVendorDropdown && filteredVendors.length > 0 && (
                    <div className="absolute z-10 mt-1.5 w-full max-h-56 overflow-y-auto rounded-lg bg-obsidian-800 border border-obsidian-400/60 shadow-card-lg divide-y divide-obsidian-400/20">
                      {filteredVendors.map((v) => (
                        <button
                          key={`${v.kind}-${v.id}`}
                          type="button"
                          onClick={() => selectVendor(v)}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/[0.06] transition-colors"
                        >
                          {v.kind === 'workshop' ? <Wrench size={13} className="text-orange-400 shrink-0" /> : <Receipt size={13} className="text-pink-400 shrink-0" />}
                          <span className="text-sm text-gray-200 truncate">{v.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {form.vendorName.trim() && (
                    <p className="text-[11px] text-gray-500 mt-1.5">
                      Not in your list yet — that's fine, it'll be submitted as "{form.vendorName.trim()}" and admin will register them before it's paid.
                    </p>
                  )}
                </div>
              )}
            </div>

          <div>
            <label className="block text-gray-400 text-xs mb-1">
              Category *{isVendorRegistered && <span className="text-gray-600 font-normal"> — auto-filled from vendor, change if needed</span>}
            </label>
            <div className="relative" ref={categoryPickerRef}>
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                className={`${inputCls()} pl-9`}
                placeholder="Search category..."
                value={showCategoryDropdown ? categoryQuery : form.category}
                onChange={(e) => setCategoryQuery(e.target.value)}
                onFocus={() => { setCategoryQuery(''); setShowCategoryDropdown(true); }}
              />
              {showCategoryDropdown && (
                <div className="absolute z-10 mt-1.5 w-full max-h-56 overflow-y-auto rounded-lg bg-obsidian-800 border border-obsidian-400/60 shadow-card-lg divide-y divide-obsidian-400/20">
                  {filteredCategories.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-gray-600">No matching category</p>
                  ) : (
                    filteredCategories.map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => { setForm((f) => ({ ...f, category: cat })); setCategoryQuery(''); setShowCategoryDropdown(false); }}
                        className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                          form.category === cat ? 'text-gold-300 bg-gold-500/10' : 'text-gray-200 hover:bg-white/[0.06]'
                        }`}
                      >
                        {cat}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-gray-400 text-xs mb-1">Amount (RM) *</label>
            <input type="number" min={0} className={inputCls()} placeholder="e.g. 30" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </div>

          <div>
            <label className="block text-gray-400 text-xs mb-1">Description</label>
            <input className={inputCls()} placeholder="e.g. Petrol for client visit" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>

          <div>
            <label className="block text-gray-400 text-xs mb-1">Related Car (optional)</label>
            {selectedCar ? (
              <div className="flex items-center gap-3 bg-obsidian-700/60 border border-obsidian-400/60 rounded-lg pl-2 pr-2.5 py-2">
                <PlateBadge plate={selectedCar.carPlate} size="md" />
                <span className="flex-1 text-sm text-white truncate">{selectedCar.year} {selectedCar.make} {selectedCar.model}</span>
                <button
                  type="button"
                  onClick={() => { setForm((f) => ({ ...f, carId: '' })); setCarQuery(''); }}
                  className="shrink-0 p-1 rounded text-gray-500 hover:text-red-400 transition-colors"
                >
                  <X size={15} />
                </button>
              </div>
            ) : (
              <div className="relative" ref={carPickerRef}>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    className={`${inputCls()} pl-9`}
                    placeholder="Search by plate, make or model..."
                    value={carQuery}
                    onChange={(e) => { setCarQuery(e.target.value); setShowCarDropdown(true); }}
                    onFocus={() => setShowCarDropdown(true)}
                  />
                </div>
                {showCarDropdown && (
                  <div className="absolute z-10 mt-1.5 w-full max-h-72 overflow-y-auto rounded-xl bg-obsidian-800 border border-obsidian-400/60 shadow-card-lg divide-y divide-obsidian-400/20">
                    {filteredCars.length === 0 ? (
                      <p className="px-4 py-3 text-sm text-gray-600">No cars found</p>
                    ) : (
                      filteredCars.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => { setForm((f) => ({ ...f, carId: c.id })); setCarQuery(''); setShowCarDropdown(false); }}
                          className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.06] transition-colors"
                        >
                          <PlateBadge plate={c.carPlate} size="md" />
                          <span className="text-sm text-gray-200 truncate">{c.year} {c.make} {c.model}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block text-gray-400 text-xs mb-1">Receipt Photo *</label>
            {form.receiptUrl ? (
              <div className="flex items-center gap-3">
                <img src={form.receiptUrl} alt="Receipt" className="w-16 h-16 object-cover rounded-lg border border-obsidian-400/60" />
                <button onClick={() => setForm((f) => ({ ...f, receiptUrl: '' }))} className="text-xs text-gray-500 hover:text-red-400 transition-colors">Remove</button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-2 w-full justify-center px-3 py-3 rounded-lg border-2 border-dashed border-obsidian-400/60 text-gray-400 text-sm hover:border-gold-500/40 hover:text-white transition-colors disabled:opacity-50"
              >
                <Upload size={15} />
                {uploading ? 'Uploading…' : 'Take / upload photo'}
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setUploading(true);
                try {
                  const url = await uploadClaimReceipt(file);
                  setForm((f) => ({ ...f, receiptUrl: url }));
                } catch (err: any) {
                  toast.error(err.message || 'Upload failed');
                } finally {
                  setUploading(false);
                  e.target.value = '';
                }
              }}
            />
          </div>

        </div>

        <div className="flex gap-3 mt-5">
          <button onClick={() => setShowModal(false)} className="flex-1 px-4 py-2.5 btn-ghost rounded-lg text-sm">Cancel</button>
          <button onClick={handleSubmit} disabled={!canSubmit} className="flex-1 btn-gold px-4 py-2.5 rounded-lg text-sm disabled:opacity-40 disabled:cursor-not-allowed">
            {submitting ? 'Submitting…' : 'Submit Claim'}
          </button>
        </div>
      </Modal>

      <ProfileModal isOpen={showProfile} onClose={() => setShowProfile(false)} />

      {previewReceipt && (
        <Lightbox images={[previewReceipt]} isOpen={!!previewReceipt} onClose={() => setPreviewReceipt(null)} />
      )}
    </div>
  );
}
