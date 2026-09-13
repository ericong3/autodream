import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Fingerprint, Phone, ChevronRight, UserX } from 'lucide-react';
import GarageShell from '../components/GarageShell';
import { searchGarageCustomers } from '../lib/garageCustomers';
import type { GarageCustomer } from '../types';

export default function GarageWorkOrderExistingCustomer() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GarageCustomer[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  // Live search as the salesman types — no need to key in the full IC or
  // hit a button, just enough to narrow down to the right customer.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setSearched(false); return; }
    setSearching(true);
    const timer = setTimeout(() => {
      searchGarageCustomers(q)
        .then((r) => { setResults(r); setSearched(true); setError(''); })
        .catch((err) => setError(err?.message ?? 'Something went wrong — please try again'))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <GarageShell title="Existing Customer" showBack backTo="/garage/work-order/new">
      <div className="max-w-xl mx-auto">
        <div className="relative overflow-hidden rounded-[28px] p-8 sm:p-10
          bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card-lg">

          <div className="pointer-events-none absolute -inset-x-10 -top-24 h-40 rotate-[-18deg]
            bg-gradient-to-b from-white/[0.10] to-transparent blur-md opacity-40" />

          <h2 className="font-display text-xl text-white font-semibold tracking-wide mb-1">Find Customer</h2>
          <p className="text-white/40 text-sm mb-8">Search by name or IC number</p>

          <div className="relative mb-2">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" />
            <input
              className="w-full bg-white/[0.04] border border-white/10 text-white placeholder-white/25
                rounded-xl pl-10 pr-3.5 py-3 text-sm focus:outline-none focus:border-gold-400/50 transition-colors"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type a name or IC number…"
              autoFocus
            />
          </div>
          {error && <p className="text-red-400 text-xs mb-2">{error}</p>}

          {searching && <p className="text-white/30 text-xs mt-4">Searching…</p>}

          {!searching && searched && results.length === 0 && (
            <div className="flex items-start gap-2.5 bg-white/[0.03] border border-white/10 rounded-xl p-3.5 mt-4">
              <UserX size={16} className="text-white/40 shrink-0 mt-0.5" />
              <div>
                <p className="text-white/70 text-sm">No matching customer found.</p>
                <button
                  onClick={() => navigate('/garage/work-order/new-customer')}
                  className="text-gold-400 hover:text-gold-300 text-sm mt-1 transition-colors"
                >
                  Register as a new customer →
                </button>
              </div>
            </div>
          )}

          {!searching && results.length > 0 && (
            <div className="mt-5 space-y-2">
              {results.map((c) => (
                <button
                  key={c.id}
                  onClick={() => navigate(`/garage/work-order/customer/${c.id}`)}
                  className="w-full flex items-center gap-3 text-left rounded-xl p-3.5
                    bg-white/[0.03] border border-white/10 hover:border-gold-400/40 hover:bg-white/[0.06]
                    transition-colors"
                >
                  <div className="w-9 h-9 rounded-full bg-gold-400/10 border border-gold-400/20 flex items-center justify-center
                    text-gold-400 font-bold text-sm uppercase shrink-0">
                    {c.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{c.name}</p>
                    <div className="flex items-center gap-3 text-white/40 text-xs mt-0.5">
                      <span className="flex items-center gap-1"><Fingerprint size={11} /> {c.icNumber}</span>
                      <span className="flex items-center gap-1"><Phone size={11} /> {c.phone}</span>
                    </div>
                  </div>
                  <ChevronRight size={15} className="text-gold-400/50 shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </GarageShell>
  );
}
