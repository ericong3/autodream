import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Fingerprint, Phone, Mail, AlertCircle } from 'lucide-react';
import GarageShell from '../components/GarageShell';
import { useStore } from '../store';
import { createGarageCustomer, UNIQUE_VIOLATION } from '../lib/garageCustomers';
import { formatMalaysianIc, isValidMalaysianIc } from '../utils/format';

function fieldCls(error?: string) {
  return `w-full bg-white/[0.04] border ${error ? 'border-red-500/50' : 'border-white/10'}
    text-white placeholder-white/25 rounded-xl pl-10 pr-3.5 py-3 text-sm
    focus:outline-none focus:border-gold-400/50 transition-colors`;
}

function Field({
  label, required, error, icon: Icon, children,
}: { label: string; required?: boolean; error?: string; icon: typeof User; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-white/50 text-xs font-medium mb-2">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      <div className="relative">
        <Icon size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" />
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

export default function GarageWorkOrderNewCustomer() {
  const navigate = useNavigate();
  const currentUser = useStore((s) => s.currentUser);
  const [form, setForm] = useState({ name: '', icNumber: '', phone: '', email: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Required';
    if (!form.icNumber.trim()) e.icNumber = 'Required';
    else if (!isValidMalaysianIc(form.icNumber)) e.icNumber = 'Format: 990101-14-5566';
    if (!form.phone.trim()) e.phone = 'Required';
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setSaving(true);
    try {
      const customer = await createGarageCustomer({
        name: form.name.trim(),
        icNumber: form.icNumber,
        phone: form.phone.trim(),
        email: form.email.trim() || undefined,
        createdBy: currentUser?.id,
      });
      navigate(`/garage/work-order/customer/${customer.id}`);
    } catch (err: any) {
      if (err?.code === UNIQUE_VIOLATION) {
        setErrors({ icNumber: 'A customer with this IC number already exists' });
      } else {
        setErrors({ form: err?.message ?? 'Something went wrong — please try again' });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <GarageShell title="New Customer" showBack backTo="/garage/work-order/new">
      <div className="max-w-2xl mx-auto">
        <div className="relative overflow-hidden rounded-[28px] p-8 sm:p-10
          bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card-lg">

          <div className="pointer-events-none absolute -inset-x-10 -top-24 h-40 rotate-[-18deg]
            bg-gradient-to-b from-white/[0.10] to-transparent blur-md opacity-40" />

          <h2 className="font-display text-xl text-white font-semibold tracking-wide mb-1">Customer Details</h2>
          <p className="text-white/40 text-sm mb-8">Please fill in the customer's information</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-8">
            <Field label="Customer Name" required error={errors.name} icon={User}>
              <input
                className={fieldCls(errors.name)}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Enter customer name"
              />
            </Field>

            <Field label="IC Number" required error={errors.icNumber} icon={Fingerprint}>
              <input
                className={fieldCls(errors.icNumber)}
                value={form.icNumber}
                onChange={(e) => setForm({ ...form, icNumber: formatMalaysianIc(e.target.value) })}
                placeholder="990101-14-5566"
                inputMode="numeric"
                maxLength={14}
              />
            </Field>

            <Field label="Mobile No. / WhatsApp" required error={errors.phone} icon={Phone}>
              <input
                className={fieldCls(errors.phone)}
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+601X-XXXXXXX"
              />
            </Field>

            <Field label="Email Address" icon={Mail}>
              <input
                type="email"
                className={fieldCls()}
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="Enter email address"
                autoCapitalize="none"
              />
            </Field>
          </div>

          {errors.form && (
            <p className="text-red-400 text-sm mb-4 flex items-center gap-1.5"><AlertCircle size={13} /> {errors.form}</p>
          )}

          <div className="flex justify-end">
            <button onClick={handleSubmit} disabled={saving} className="btn-gold px-8 py-3 rounded-xl text-sm disabled:opacity-60">
              {saving ? 'Saving…' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </GarageShell>
  );
}
