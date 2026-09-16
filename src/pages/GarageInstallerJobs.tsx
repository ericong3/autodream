import { useEffect, useState } from 'react';
import { ClipboardList, Car, User, Layers, CheckCircle2 } from 'lucide-react';
import GarageShell from '../components/GarageShell';
import { useStore } from '../store';
import { listPendingInstallerJobs, acceptInstallerJob } from '../lib/garageInstallerJobs';
import { getGarageInvoice } from '../lib/garageInvoices';
import { getGarageVehicle, getGarageCustomer } from '../lib/garageCustomers';
import { getTintOrder } from '../lib/garageTint';
import { GARAGE_SERVICE_MAP } from '../utils/garageServices';
import { TINT_SERIES } from '../utils/tintPricing';
import { formatRM } from '../utils/format';
import type { GarageInstallerJob, GarageInvoice, GarageVehicle, GarageCustomer, GarageTintOrder } from '../types';

const TINT_SERIES_LABEL = Object.fromEntries(TINT_SERIES.map((s) => [s.key, s.label]));

interface JobCard {
  job: GarageInstallerJob;
  invoice: GarageInvoice;
  vehicle: GarageVehicle | null;
  customer: GarageCustomer | null;
  tintOrder: GarageTintOrder | null;
}

export default function GarageInstallerJobs() {
  const currentUser = useStore((s) => s.currentUser);
  const [cards, setCards] = useState<JobCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    listPendingInstallerJobs()
      .then(async (jobs) => {
        const built = await Promise.all(jobs.map(async (job): Promise<JobCard | null> => {
          const invoice = await getGarageInvoice(job.invoiceId);
          if (!invoice) return null;
          const [vehicle, customer, tintOrder] = await Promise.all([
            getGarageVehicle(invoice.vehicleId),
            getGarageCustomer(invoice.customerId),
            invoice.service === 'tinted' ? getTintOrder(invoice.id) : Promise.resolve(null),
          ]);
          return { job, invoice, vehicle, customer, tintOrder };
        }));
        setCards(built.filter((c): c is JobCard => c !== null));
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleAccept = async (jobId: string) => {
    if (!currentUser) return;
    setAcceptingId(jobId);
    try {
      await acceptInstallerJob(jobId, currentUser.id);
      setCards((prev) => prev.filter((c) => c.job.id !== jobId));
    } finally {
      setAcceptingId(null);
    }
  };

  return (
    <GarageShell title="Job Queue" showBack>
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-2.5 mb-6">
          <ClipboardList size={18} className="text-gold-400" />
          <h2 className="font-display text-lg text-white font-semibold tracking-wide">Incoming Orders</h2>
        </div>

        {loading ? (
          <p className="text-white/40 text-sm text-center py-20">Loading…</p>
        ) : cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="relative mb-5 flex items-center justify-center">
              <div className="absolute w-20 h-20 rounded-full bg-gold-400/10 blur-xl" />
              <ClipboardList size={34} strokeWidth={1.5} className="relative text-gold-400/70" />
            </div>
            <p className="text-white/40 text-sm">No jobs waiting right now</p>
          </div>
        ) : (
          <div className="space-y-4">
            {cards.map(({ job, invoice, vehicle, customer, tintOrder }) => {
              const meta = GARAGE_SERVICE_MAP[invoice.service];
              return (
                <div
                  key={job.id}
                  className="relative overflow-hidden rounded-2xl p-6 bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card"
                >
                  <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gold-400/10 border border-gold-400/20 flex items-center justify-center text-gold-400 shrink-0">
                        <meta.icon size={18} strokeWidth={1.5} />
                      </div>
                      <div>
                        <p className="text-white font-semibold text-sm">{invoice.invoiceNumber}</p>
                        <p className="text-white/40 text-xs">{meta.label}</p>
                      </div>
                    </div>
                    {tintOrder && (
                      <span className="text-gold-400 font-display text-base font-bold">{formatRM(tintOrder.finalTotal)}</span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-sm mb-4">
                    {vehicle && (
                      <div className="flex items-center gap-2.5 text-white/70">
                        <Car size={14} className="text-white/30 shrink-0" /> {vehicle.year} {vehicle.make} {vehicle.model} · {vehicle.registrationNo}
                      </div>
                    )}
                    {customer && (
                      <div className="flex items-center gap-2.5 text-white/70">
                        <User size={14} className="text-white/30 shrink-0" /> {customer.name}
                      </div>
                    )}
                    {tintOrder && (
                      <div className="flex items-center gap-2.5 text-white/70 sm:col-span-2">
                        <Layers size={14} className="text-white/30 shrink-0" />
                        {tintOrder.packageType === 'full' ? 'Full Package' : 'Mix & Match'}
                        {tintOrder.fullSeries && ` · ${TINT_SERIES_LABEL[tintOrder.fullSeries]}`}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => handleAccept(job.id)}
                    disabled={acceptingId === job.id}
                    className="w-full flex items-center justify-center gap-2 btn-gold py-2.5 rounded-xl text-sm disabled:opacity-60"
                  >
                    <CheckCircle2 size={15} /> {acceptingId === job.id ? 'Accepting…' : 'Accept Job'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </GarageShell>
  );
}
