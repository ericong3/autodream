import { useNavigate } from 'react-router-dom';
import { FilePlus, ClipboardList } from 'lucide-react';
import GarageShell, { SALESMAN_TABS } from '../components/GarageShell';

export default function GarageSalesTools() {
  const navigate = useNavigate();

  return (
    <GarageShell title="AutoDream Garage" tabs={SALESMAN_TABS} showBack>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          onClick={() => navigate('/garage/work-order/new')}
          className="group relative overflow-hidden text-left rounded-2xl p-6 flex items-center gap-4
            bg-white/[0.04] backdrop-blur-xl border border-gold-400/15
            hover:border-gold-400/50 hover:bg-white/[0.06] hover:-translate-y-0.5
            transition-all duration-300 shadow-card"
        >
          <div className="shrink-0 w-12 h-12 rounded-xl bg-gold-400/10 flex items-center justify-center text-gold-400">
            <FilePlus size={22} strokeWidth={1.5} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-display text-white font-semibold tracking-wide">Create Work Order</h3>
            <p className="text-white/40 text-xs mt-0.5">Start a new job for a customer</p>
          </div>
        </button>

        <button
          onClick={() => navigate('/garage/my-work-orders')}
          className="group relative overflow-hidden text-left rounded-2xl p-6 flex items-center gap-4
            bg-white/[0.04] backdrop-blur-xl border border-gold-400/15
            hover:border-gold-400/50 hover:bg-white/[0.06] hover:-translate-y-0.5
            transition-all duration-300 shadow-card"
        >
          <div className="shrink-0 w-12 h-12 rounded-xl bg-gold-400/10 flex items-center justify-center text-gold-400">
            <ClipboardList size={22} strokeWidth={1.5} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-display text-white font-semibold tracking-wide">My Work Orders</h3>
            <p className="text-white/40 text-xs mt-0.5">Track jobs from payment to delivery</p>
          </div>
        </button>
      </div>
    </GarageShell>
  );
}
