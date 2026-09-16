import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Car, User, Phone, Layers, Plus, X, ArrowRight } from 'lucide-react';
import GarageShell from '../components/GarageShell';
import Modal from '../components/Modal';
import { getGarageVehicle, getGarageCustomer } from '../lib/garageCustomers';
import { TINT_SERIES, GLASS_POSITIONS, EXTRA_GLASS_OPTIONS } from '../utils/tintPricing';
import { formatRM, generateId } from '../utils/format';
import type {
  GarageVehicle, GarageCustomer, TintPackageType, TintSeries, TintPositionSelection,
} from '../types';

const TINT_SERIES_LABEL = Object.fromEntries(TINT_SERIES.map((s) => [s.key, s.label]));
const GLASS_POSITION_LABEL = Object.fromEntries([...GLASS_POSITIONS, ...EXTRA_GLASS_OPTIONS].map((p) => [p.key, p.label]));

// Built by GarageTintPackage and handed over via router state — nothing is
// persisted until the Payment page's final Confirm is pressed.
export interface PendingTintOrder {
  packageType: TintPackageType;
  fullSeries?: TintSeries;
  selections: TintPositionSelection[];
  extras: TintPositionSelection[];
  discount: number;
  finalTotal: number;
}

// A product tacked onto the order here on the Summary page — not persisted
// until Confirm, so it only needs a client-side id for list rendering.
export interface PendingAddon {
  clientId: string;
  name: string;
  price: number;
  qty: number;
}

export default function GarageWorkOrderSummary() {
  const { id, vehicleId } = useParams<{ id: string; vehicleId: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const pending = location.state as PendingTintOrder | undefined;

  const [vehicle, setVehicle] = useState<GarageVehicle | null>(null);
  const [customer, setCustomer] = useState<GarageCustomer | null>(null);
  const [loading, setLoading] = useState(true);
  const [addons, setAddons] = useState<PendingAddon[]>([]);
  const [addonModalOpen, setAddonModalOpen] = useState(false);
  const [addonName, setAddonName] = useState('');
  const [addonPrice, setAddonPrice] = useState('');
  const [addonQty, setAddonQty] = useState('1');
  const [addonError, setAddonError] = useState('');

  useEffect(() => {
    if (!pending) {
      navigate(`/garage/work-order/customer/${id}/vehicle/${vehicleId}/service/tinted`, { replace: true });
      return;
    }
    if (!id || !vehicleId) return;
    Promise.all([getGarageVehicle(vehicleId), getGarageCustomer(id)])
      .then(([v, c]) => { setVehicle(v); setCustomer(c); })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!pending) return null;

  const backToPackage = `/garage/work-order/customer/${id}/vehicle/${vehicleId}/service/tinted`;

  const openAddonModal = () => {
    setAddonName('');
    setAddonPrice('');
    setAddonQty('1');
    setAddonError('');
    setAddonModalOpen(true);
  };

  const handleAddProduct = () => {
    const price = Number(addonPrice);
    const qty = Number(addonQty);
    if (!addonName.trim()) { setAddonError('Enter a product name'); return; }
    if (!(price >= 0)) { setAddonError('Enter a valid price'); return; }
    if (!(qty >= 1)) { setAddonError('Quantity must be at least 1'); return; }
    setAddons([...addons, { clientId: generateId(), name: addonName.trim(), price, qty }]);
    setAddonModalOpen(false);
  };

  const removeAddon = (clientId: string) => setAddons(addons.filter((a) => a.clientId !== clientId));

  const addonsTotal = addons.reduce((sum, a) => sum + a.price * a.qty, 0);
  const grandTotal = pending.finalTotal + addonsTotal;

  const handleContinue = () => {
    navigate(`/garage/work-order/customer/${id}/vehicle/${vehicleId}/service/tinted/payment`, {
      state: { pending, addons, addonsTotal, grandTotal },
    });
  };

  return (
    <GarageShell title="Order Summary" showBack backTo={backToPackage}>
      <div className="max-w-5xl mx-auto">
        {loading ? (
          <p className="text-white/40 text-sm text-center py-10">Loading…</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
            {/* Order details */}
            <div className="relative overflow-hidden rounded-[28px] p-6 sm:p-8 bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card-lg">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm mb-6">
                {vehicle && (
                  <div className="flex items-center gap-2.5 text-white/70">
                    <Car size={15} className="text-white/30 shrink-0" /> {vehicle.year} {vehicle.make} {vehicle.model} · {vehicle.registrationNo}
                  </div>
                )}
                {customer && (
                  <div className="flex items-center gap-2.5 text-white/70">
                    <User size={15} className="text-white/30 shrink-0" /> {customer.name}
                  </div>
                )}
                {customer?.phone && (
                  <div className="flex items-center gap-2.5 text-white/70">
                    <Phone size={15} className="text-white/30 shrink-0" /> {customer.phone}
                  </div>
                )}
              </div>

              <div className="pt-5 border-t border-white/10">
                <h3 className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-4 flex items-center gap-2">
                  <Layers size={13} /> {pending.packageType === 'full' ? 'Full Package' : 'Mix & Match'}
                </h3>

                {pending.packageType === 'full' && pending.fullSeries && (
                  <p className="text-white text-sm mb-3">{TINT_SERIES_LABEL[pending.fullSeries]} — same series for every window</p>
                )}
                <div className="space-y-1.5">
                  {pending.selections.map((sel) => (
                    <div key={sel.position} className="flex items-center justify-between text-sm">
                      <span className="text-white/60">{GLASS_POSITION_LABEL[sel.position]}</span>
                      <span className="text-white">
                        {pending.packageType === 'mix' ? `${TINT_SERIES_LABEL[sel.series]} · ` : ''}{sel.vlt}
                      </span>
                    </div>
                  ))}
                </div>

                {pending.extras.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-white/10 space-y-1.5">
                    <p className="text-white/40 text-xs mb-1">Extras</p>
                    {pending.extras.map((sel) => (
                      <div key={sel.position} className="flex items-center justify-between text-sm">
                        <span className="text-white/60">{GLASS_POSITION_LABEL[sel.position]}</span>
                        <span className="text-white">{TINT_SERIES_LABEL[sel.series]} · {sel.vlt}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-5 pt-4 border-t border-white/10 space-y-1.5">
                  {pending.discount > 0 && (
                    <div className="flex justify-between text-sm text-white/50">
                      <span>Discount</span>
                      <span>-{formatRM(pending.discount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-baseline">
                    <span className="text-white font-semibold text-sm">Tint Package Total</span>
                    <span className="text-white font-display text-base font-bold">{formatRM(pending.finalTotal)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Add-on products */}
            <div className="relative overflow-hidden rounded-[28px] p-6 sm:p-8 bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card-lg h-fit">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white/50 text-xs font-semibold uppercase tracking-wider">Add-on Products</h3>
                <button
                  onClick={openAddonModal}
                  className="flex items-center gap-1.5 text-gold-400 hover:text-gold-300 text-xs font-medium transition-colors"
                >
                  <Plus size={13} /> Add Product
                </button>
              </div>

              {addons.length === 0 ? (
                <p className="text-white/30 text-xs">No add-on products yet</p>
              ) : (
                <div className="space-y-1.5">
                  {addons.map((a) => (
                    <div key={a.clientId} className="flex items-center justify-between text-sm gap-3">
                      <span className="text-white/60 truncate">{a.name} {a.qty > 1 && <span className="text-white/30">× {a.qty}</span>}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-white">{formatRM(a.price * a.qty)}</span>
                        <button onClick={() => removeAddon(a.clientId)} className="text-white/30 hover:text-red-400 transition-colors">
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {!loading && (
          <div className="mt-6 space-y-6">
            <div className="flex justify-between items-baseline px-2">
              <span className="text-white font-semibold text-sm">Order Total</span>
              <span className="text-gold-400 font-display text-lg font-bold">{formatRM(grandTotal)}</span>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => navigate(backToPackage)}
                className="flex-1 px-4 py-3 btn-ghost rounded-xl text-sm"
              >
                Edit
              </button>
              <button
                onClick={handleContinue}
                className="flex-[2] flex items-center justify-center gap-2 btn-gold px-4 py-3 rounded-xl text-sm"
              >
                Continue to Payment <ArrowRight size={15} />
              </button>
            </div>
          </div>
        )}
      </div>

      <Modal isOpen={addonModalOpen} onClose={() => setAddonModalOpen(false)} title="Add Product">
        <label className="block text-gray-300 text-xs font-medium mb-1.5">Product Name</label>
        <input
          type="text"
          className="w-full bg-obsidian-700/60 border border-obsidian-400/60 text-white placeholder-gray-600
            rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:border-gold-500 transition-colors"
          value={addonName}
          onChange={(e) => setAddonName(e.target.value)}
          placeholder="e.g. Rain Repellent"
        />
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-gray-300 text-xs font-medium mb-1.5">Price (RM)</label>
            <input
              type="number"
              min={0}
              className="w-full bg-obsidian-700/60 border border-obsidian-400/60 text-white placeholder-gray-600
                rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500 transition-colors"
              value={addonPrice}
              onChange={(e) => setAddonPrice(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div>
            <label className="block text-gray-300 text-xs font-medium mb-1.5">Quantity</label>
            <input
              type="number"
              min={1}
              className="w-full bg-obsidian-700/60 border border-obsidian-400/60 text-white placeholder-gray-600
                rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500 transition-colors"
              value={addonQty}
              onChange={(e) => setAddonQty(e.target.value)}
            />
          </div>
        </div>
        {addonError && <p className="text-red-400 text-xs mb-3">{addonError}</p>}
        <div className="flex gap-3">
          <button onClick={() => setAddonModalOpen(false)} className="flex-1 px-4 py-2.5 btn-ghost rounded-lg text-sm">Cancel</button>
          <button onClick={handleAddProduct} className="flex-1 btn-gold px-4 py-2.5 rounded-lg text-sm">Add</button>
        </div>
      </Modal>
    </GarageShell>
  );
}
