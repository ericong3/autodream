import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Fingerprint, Search, UserX } from 'lucide-react';
import GarageShell from '../components/GarageShell';
import { findGarageCustomerByIc } from '../lib/garageCustomers';
import { formatMalaysianIc, isValidMalaysianIc } from '../utils/format';

export default function GarageWorkOrderExistingCustomer() {
  const navigate = useNavigate();
  const [ic, setIc] = useState('');
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [searching, setSearching] = useState(false);

  const handleSearch = async () => {
    setNotFound(false);
    if (!isValidMalaysianIc(ic)) {
      setError('Enter a full IC number, e.g. 990101-14-5566');
      return;
    }
    setError('');
    setSearching(true);
    try {
      const customer = await findGarageCustomerByIc(ic);
      if (customer) {
        navigate(`/garage/work-order/customer/${customer.id}`);
      } else {
        setNotFound(true);
      }
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong — please try again');
    } finally {
      setSearching(false);
    }
  };

  return (
    <GarageShell title="Existing Customer" showBack backTo="/garage/work-order/new">
      <div className="max-w-xl mx-auto">
        <div className="relative overflow-hidden rounded-[28px] p-8 sm:p-10
          bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card-lg">

          <div className="pointer-events-none absolute -inset-x-10 -top-24 h-40 rotate-[-18deg]
            bg-gradient-to-b from-white/[0.10] to-transparent blur-md opacity-40" />

          <h2 className="font-display text-xl text-white font-semibold tracking-wide mb-1">Find Customer</h2>
          <p className="text-white/40 text-sm mb-8">Enter the customer's IC number to look up their profile</p>

          <div className="relative mb-2">
            <Fingerprint size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" />
            <input
              className={`w-full bg-white/[0.04] border ${error ? 'border-red-500/50' : 'border-white/10'}
                text-white placeholder-white/25 rounded-xl pl-10 pr-3.5 py-3 text-sm
                focus:outline-none focus:border-gold-400/50 transition-colors`}
              value={ic}
              onChange={(e) => { setIc(formatMalaysianIc(e.target.value)); setNotFound(false); }}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="990101-14-5566"
              inputMode="numeric"
              maxLength={14}
              autoFocus
            />
          </div>
          {error && <p className="text-red-400 text-xs mb-4">{error}</p>}

          {notFound && (
            <div className="flex items-start gap-2.5 bg-white/[0.03] border border-white/10 rounded-xl p-3.5 mb-6 mt-4">
              <UserX size={16} className="text-white/40 shrink-0 mt-0.5" />
              <div>
                <p className="text-white/70 text-sm">No customer found with this IC number.</p>
                <button
                  onClick={() => navigate('/garage/work-order/new-customer')}
                  className="text-gold-400 hover:text-gold-300 text-sm mt-1 transition-colors"
                >
                  Register as a new customer →
                </button>
              </div>
            </div>
          )}

          <div className="flex justify-end mt-6">
            <button
              onClick={handleSearch}
              disabled={searching}
              className="btn-gold px-8 py-3 rounded-xl text-sm flex items-center gap-2 disabled:opacity-60"
            >
              <Search size={15} /> {searching ? 'Searching…' : 'Search'}
            </button>
          </div>
        </div>
      </div>
    </GarageShell>
  );
}
