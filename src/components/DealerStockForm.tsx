import { useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import Modal from './Modal';
import { ActionErrorBox, Field } from './InvestorFinanceCar';
import { useInvestorAction } from '../lib/investorFinance';
import { uploadCarPhoto } from '../lib/carPhotoUpload';
import { DEALER_SCOPE, type DealerCar, type DealerView } from '../lib/dealerAccounts';

// The dealer adds or edits their own consignment stock. No prices or terms:
// AutoDream sets those. A new car goes straight into AutoDream's stock list.
export default function DealerStockForm({ actorId, dealerName, car, onClose, onSaved }: {
  actorId: string; dealerName: string; car: DealerCar | null; onClose: () => void; onSaved: (v: DealerView) => void;
}) {
  const editing = !!car;
  const act = useInvestorAction(actorId);
  const [f, setF] = useState({
    make: car?.make ?? '', model: car?.model ?? '', variant: car?.variant ?? '', year: String(car?.year ?? new Date().getFullYear()),
    carPlate: car?.plate ?? '', colour: car?.colour ?? '', mileage: car?.mileage != null ? String(car.mileage) : '', transmission: car?.transmission ?? 'auto', notes: car?.notes ?? '',
  });
  const [photos, setPhotos] = useState<string[]>(car?.photos?.length ? car.photos : car?.photo ? [car.photo] : []);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const year = Number(f.year), mileage = f.mileage.trim() === '' ? undefined : Number(f.mileage.replace(/[, ]/g, ''));
  const ok = photos.length > 0 && !uploading && (editing || (f.make.trim() && f.model.trim() && f.carPlate.trim() && Number.isInteger(year) && year >= 1950 && year <= new Date().getFullYear() + 1))
    && (mileage === undefined || (Number.isSafeInteger(mileage) && mileage >= 0));
  const slot = editing ? `dealer-edit:${car!.carId}` : 'dealer-add';

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true); setUploadError('');
    try {
      const urls: string[] = [];
      for (const file of Array.from(files).slice(0, 20 - photos.length)) urls.push(await uploadCarPhoto(file, 'dealer-stock'));
      setPhotos((p) => [...p, ...urls].slice(0, 20));
    } catch { setUploadError('A photo could not be uploaded. Check your connection and try again.'); }
    finally { setUploading(false); }
  };

  const save = async () => {
    if (!ok) return;
    const common = { variant: f.variant.trim(), colour: f.colour.trim(), notes: f.notes, photos, ...(mileage !== undefined ? { mileage } : {}) };
    const data = editing ? { ...DEALER_SCOPE, carId: car!.carId, ...common }
      : { ...DEALER_SCOPE, make: f.make.trim(), model: f.model.trim(), year, carPlate: f.carPlate.trim().toUpperCase(), transmission: f.transmission, ...common };
    const r = await act.run<DealerView>(slot, editing ? 'edit_car' : 'add_car', data, editing ? `Update ${car!.plate ?? 'car'}` : `Add ${f.carPlate.trim().toUpperCase()} to ${dealerName} stock`);
    if (r) onSaved(r);
  };

  return (
    <Modal isOpen onClose={onClose} title={editing ? 'Update car' : `Add car to ${dealerName} stock`}
      footer={<div className="flex gap-2 justify-end"><button type="button" onClick={onClose} className="text-xs px-4 py-2 rounded-lg text-gray-400 border border-obsidian-400/60">Cancel</button>
        <button type="button" disabled={!ok || act.busy !== null} onClick={() => void save()} className="btn-gold text-xs px-4 py-2 rounded-lg disabled:opacity-40">{act.busy ? 'Saving…' : editing ? 'Save changes' : 'Add car'}</button></div>}>
      <div className="space-y-3">
        {!editing && <p className="text-gray-500 text-xs">The car goes straight into AutoDream's stock list. AutoDream sets the selling price and your terms.</p>}
        {!editing && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Make"><input className="input w-full px-3 py-2 rounded-lg text-sm" maxLength={100} value={f.make} onChange={set('make')} /></Field>
            <Field label="Model"><input className="input w-full px-3 py-2 rounded-lg text-sm" maxLength={100} value={f.model} onChange={set('model')} /></Field>
            <Field label="Year"><input inputMode="numeric" className="input w-full px-3 py-2 rounded-lg text-sm" value={f.year} onChange={set('year')} /></Field>
            <Field label="Plate number"><input className="input w-full px-3 py-2 rounded-lg text-sm uppercase" maxLength={30} value={f.carPlate} onChange={set('carPlate')} /></Field>
            <Field label="Transmission"><select className="input w-full px-3 py-2 rounded-lg text-sm" value={f.transmission} onChange={set('transmission')}><option value="auto">Auto</option><option value="manual">Manual</option></select></Field>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Variant"><input className="input w-full px-3 py-2 rounded-lg text-sm" maxLength={150} value={f.variant} onChange={set('variant')} /></Field>
          <Field label="Colour"><input className="input w-full px-3 py-2 rounded-lg text-sm" maxLength={150} value={f.colour} onChange={set('colour')} /></Field>
          <Field label="Mileage (km)"><input inputMode="numeric" className="input w-full px-3 py-2 rounded-lg text-sm" value={f.mileage} onChange={set('mileage')} /></Field>
        </div>
        <Field label="Notes"><textarea className="input w-full px-3 py-2 rounded-lg text-sm" rows={2} maxLength={2000} value={f.notes} onChange={set('notes')} /></Field>
        <div>
          <p className="text-gray-400 text-xs mb-1.5">Photos ({photos.length}/20)</p>
          <div className="flex flex-wrap gap-2">
            {photos.map((p, i) => (
              <div key={p + i} className="relative w-20 h-14 rounded-md overflow-hidden border border-white/10">
                <img src={p} alt={`Car photo ${i + 1}`} className="w-full h-full object-cover" />
                <button type="button" aria-label="Remove photo" onClick={() => setPhotos((s) => s.filter((_, j) => j !== i))} className="absolute top-0.5 right-0.5 bg-black/70 rounded-full p-0.5"><X size={11} className="text-white" /></button>
              </div>
            ))}
            {photos.length < 20 && (
              <label className="w-20 h-14 rounded-md border border-dashed border-gold-500/40 flex items-center justify-center cursor-pointer text-gold-300">
                {uploading ? <span className="text-[10px]">Uploading…</span> : <ImagePlus size={18} />}
                <input type="file" accept="image/*" multiple className="hidden" disabled={uploading} onChange={(e) => { void addPhotos(e.target.files); e.target.value = ''; }} />
              </label>
            )}
          </div>
          {uploadError && <p className="text-red-400 text-[11px] mt-1">{uploadError}</p>}
        </div>
        <ActionErrorBox error={act.error} slot={slot} onRetry={() => void act.retry<DealerView>(slot).then((r) => r && onSaved(r))} onDismiss={act.clearError} />
      </div>
    </Modal>
  );
}
