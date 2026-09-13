import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Car, Layers, Calendar, Palette, Tag, AlertCircle } from 'lucide-react';
import GarageShell from '../components/GarageShell';
import { useStore } from '../store';
import { createGarageVehicle } from '../lib/garageCustomers';
import type { GarageVehicleSize } from '../types';

const CAR_MAKES = [
  'Perodua', 'Proton', 'Toyota', 'Honda', 'Nissan', 'Mazda', 'Mitsubishi',
  'Hyundai', 'Kia', 'BMW', 'Mercedes-Benz', 'Audi', 'Volkswagen', 'Ford',
  'Mini', 'Volvo', 'Lexus', 'Subaru', 'Suzuki', 'Isuzu', 'Other',
];

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: CURRENT_YEAR - 1999 }, (_, i) => CURRENT_YEAR + 1 - i);

const SIZE_OPTIONS: { value: GarageVehicleSize; label: string }[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'large', label: 'Large' },
  { value: 'xlarge', label: 'X-Large' },
];

function selectCls(error?: string) {
  return `w-full bg-white/[0.04] border ${error ? 'border-red-500/50' : 'border-white/10'}
    text-white rounded-xl pl-10 pr-3.5 py-3 text-sm
    focus:outline-none focus:border-gold-400/50 transition-colors appearance-none`;
}

function Field({
  label, required, error, icon: Icon, children,
}: { label: string; required?: boolean; error?: string; icon: typeof Car; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-white/50 text-xs font-medium mb-2">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      <div className="relative">
        <Icon size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none z-10" />
        {children}
      </div>
      {error && (
        <p className="text-red-400 text-xs mt-1.5 flex items-center gap-1">
          <AlertCircle size={11} /> {error}
        </p>
      )}
    </div>
  );
}

export default function GarageAddVehicle() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const currentUser = useStore((s) => s.currentUser);
  const [form, setForm] = useState({
    make: '', model: '', year: '', colour: '', registrationNo: '', size: 'standard' as GarageVehicleSize,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  if (!id) return null;

  const handleSubmit = async () => {
    const e: Record<string, string> = {};
    if (!form.make) e.make = 'Required';
    if (!form.model.trim()) e.model = 'Required';
    if (!form.year) e.year = 'Required';
    if (!form.registrationNo.trim()) e.registrationNo = 'Required';
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setSaving(true);
    try {
      await createGarageVehicle({
        customerId: id,
        make: form.make,
        model: form.model.trim(),
        year: Number(form.year),
        colour: form.colour.trim() || undefined,
        registrationNo: form.registrationNo.trim().toUpperCase(),
        size: form.size,
        createdBy: currentUser?.id,
      });
      navigate(`/garage/work-order/customer/${id}`);
    } catch (err: any) {
      setErrors({ form: err?.message ?? 'Something went wrong — please try again' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <GarageShell title="Add Vehicle" showBack backTo={`/garage/work-order/customer/${id}`}>
      <div className="max-w-2xl mx-auto">
        <div className="relative overflow-hidden rounded-[28px] p-8 sm:p-10
          bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card-lg">

          <div className="pointer-events-none absolute -inset-x-10 -top-24 h-40 rotate-[-18deg]
            bg-gradient-to-b from-white/[0.10] to-transparent blur-md opacity-40" />

          <h2 className="font-display text-xl text-white font-semibold tracking-wide mb-1">Vehicle Details</h2>
          <p className="text-white/40 text-sm mb-8">Please fill in the vehicle's information</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-6">
            <Field label="Vehicle Make" required error={errors.make} icon={Car}>
              <select className={selectCls(errors.make)} value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })}>
                <option value="" className="bg-obsidian-800">Select vehicle make</option>
                {CAR_MAKES.map((m) => <option key={m} value={m} className="bg-obsidian-800">{m}</option>)}
              </select>
            </Field>

            <Field label="Model" required error={errors.model} icon={Layers}>
              <input
                className={selectCls(errors.model)}
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                placeholder="e.g. Myvi, Civic, CX-5"
              />
            </Field>

            <Field label="Year" required error={errors.year} icon={Calendar}>
              <select className={selectCls(errors.year)} value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })}>
                <option value="" className="bg-obsidian-800">Select year</option>
                {YEARS.map((y) => <option key={y} value={y} className="bg-obsidian-800">{y}</option>)}
              </select>
            </Field>

            <Field label="Vehicle Colour" icon={Palette}>
              <input
                className={selectCls()}
                value={form.colour}
                onChange={(e) => setForm({ ...form, colour: e.target.value })}
                placeholder="e.g. Black, White, Silver"
              />
            </Field>

            <Field label="Vehicle Registration No." required error={errors.registrationNo} icon={Tag}>
              <input
                className={selectCls(errors.registrationNo)}
                value={form.registrationNo}
                onChange={(e) => setForm({ ...form, registrationNo: e.target.value.toUpperCase() })}
                placeholder="e.g. WXY 1234"
              />
            </Field>
          </div>

          <div className="mb-8">
            <label className="block text-white/50 text-xs font-medium mb-2">
              Vehicle Size <span className="text-red-400">*</span>
            </label>
            <div className="grid grid-cols-3 gap-3">
              {SIZE_OPTIONS.map((opt) => {
                const selected = form.size === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setForm({ ...form, size: opt.value })}
                    className={`flex items-center justify-center gap-2 px-3 py-3 rounded-xl border text-sm font-medium transition-colors ${
                      selected
                        ? 'bg-gold-500/15 border-gold-400/50 text-gold-400'
                        : 'bg-white/[0.03] border-white/10 text-white/50 hover:text-white/80 hover:border-white/20'
                    }`}
                  >
                    <Car size={15} /> {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {errors.form && (
            <p className="text-red-400 text-sm mb-4 flex items-center gap-1.5"><AlertCircle size={13} /> {errors.form}</p>
          )}

          <div className="flex justify-end">
            <button onClick={handleSubmit} disabled={saving} className="btn-gold px-8 py-3 rounded-xl text-sm disabled:opacity-60">
              {saving ? 'Saving…' : 'Save Vehicle'}
            </button>
          </div>
        </div>
      </div>
    </GarageShell>
  );
}
