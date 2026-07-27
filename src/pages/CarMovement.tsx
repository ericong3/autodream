import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn, LogOut, Car as CarIcon, CheckCircle, AlertCircle, Upload } from 'lucide-react';
import { useStore } from '../store';
import { supabase } from '../lib/supabase';
import { Car, CarMovement } from '../types';

function generateId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const CATEGORY_OPTIONS = [
  { value: 'test_drive', label: 'Test Drive' },
  { value: 'customer_viewing', label: 'Customer Viewing' },
  { value: 'photo_shoot', label: 'Photo Shoot' },
  { value: 'dealer', label: 'Dealer' },
  { value: 'workshop', label: 'Workshop (Repair)' },
  { value: 'other', label: 'Other' },
] as const;
type Category = typeof CATEGORY_OPTIONS[number]['value'];

export default function CarMovementPage() {
  const currentUser = useStore((s) => s.currentUser);
  const cars = useStore((s) => s.cars);
  const carMovements = useStore((s) => s.carMovements);
  const addCarMovement = useStore((s) => s.addCarMovement);
  const addCar = useStore((s) => s.addCar);
  const dealers = useStore((s) => s.dealers);
  const workshops = useStore((s) => s.workshops);
  const navigate = useNavigate();

  const [type, setType] = useState<'out' | 'in'>('out');
  const [plate, setPlate] = useState('');
  const [category, setCategory] = useState<Category>('test_drive');
  const [destinationName, setDestinationName] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  // Unmatched-plate consignment intake
  const [showIntake, setShowIntake] = useState(false);
  const [intakeMake, setIntakeMake] = useState('');
  const [intakeModel, setIntakeModel] = useState('');
  const [intakeYear, setIntakeYear] = useState(new Date().getFullYear());
  const [intakeColour, setIntakeColour] = useState('');
  const [intakeDealer, setIntakeDealer] = useState('');
  const [intakePhotoFile, setIntakePhotoFile] = useState<File | null>(null);
  const [intakePhotoPreview, setIntakePhotoPreview] = useState('');
  const [intakeErrors, setIntakeErrors] = useState<Record<string, string>>({});

  // Redirect to login if not authenticated
  if (!currentUser) {
    navigate('/login', { state: { from: '/movement' }, replace: true });
    return null;
  }

  const matchedCar = cars.find(
    (c) => c.carPlate && c.carPlate.replace(/\s/g, '').toUpperCase() === plate.replace(/\s/g, '').toUpperCase()
  );

  const lastMovement = matchedCar
    ? carMovements.find((m) => m.carId === matchedCar.id)
    : carMovements.find((m) => m.carPlate.replace(/\s/g, '').toUpperCase() === plate.replace(/\s/g, '').toUpperCase());

  const isCurrentlyOut = lastMovement?.type === 'out';
  const returningFrom = type === 'in' && isCurrentlyOut ? lastMovement?.destinationName : undefined;

  const needsDestination = category === 'dealer' || category === 'workshop';
  const destinationOptions = category === 'dealer' ? dealers : category === 'workshop' ? workshops : [];

  const compressImage = (file: File, maxWidth = 900, quality = 0.78): Promise<Blob> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => { URL.revokeObjectURL(url); blob ? resolve(blob) : reject(new Error('Compression failed')); }, 'image/jpeg', quality);
      };
      img.onerror = reject;
      img.src = url;
    });

  const uploadToStorage = async (file: File, folder: string): Promise<string> => {
    const compressed = await compressImage(file);
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const { error: uploadError } = await supabase.storage.from('car-photos').upload(path, compressed, { contentType: 'image/jpeg' });
    if (uploadError) throw new Error(uploadError.message);
    const { data } = supabase.storage.from('car-photos').getPublicUrl(path);
    return data.publicUrl;
  };

  const handleIntakePhoto = (file: File | null) => {
    setIntakePhotoFile(file);
    setIntakePhotoPreview(file ? URL.createObjectURL(file) : '');
    if (file) setIntakeErrors((prev) => ({ ...prev, photo: '' }));
  };

  const handleSubmit = async () => {
    if (!plate.trim()) { setError('Please enter a car plate'); return; }
    setError('');
    setSubmitting(true);
    try {
      const movement: CarMovement = {
        id: generateId(),
        carId: matchedCar?.id,
        carPlate: plate.trim().toUpperCase(),
        type,
        userId: currentUser.id,
        userName: currentUser.name,
        reason: type === 'out'
          ? CATEGORY_OPTIONS.find((c) => c.value === category)?.label
          : lastMovement?.reason,
        notes: notes.trim() || undefined,
        destinationType: type === 'out'
          ? (needsDestination ? (category as 'dealer' | 'workshop') : undefined)
          : lastMovement?.destinationType,
        destinationName: type === 'out'
          ? (needsDestination ? destinationName : undefined)
          : lastMovement?.destinationName,
        createdAt: new Date().toISOString(),
      };
      if (type === 'out' && needsDestination && !destinationName) {
        setError(`Please select a ${category === 'dealer' ? 'dealer' : 'workshop'}`);
        setSubmitting(false);
        return;
      }
      await addCarMovement(movement);
      setDone(true);
    } catch (e: any) {
      setError(e.message ?? 'Failed to log movement');
    } finally {
      setSubmitting(false);
    }
  };

  const handleIntakeSubmit = async () => {
    const errs: Record<string, string> = {};
    if (!intakeMake.trim()) errs.make = 'Required';
    if (!intakeModel.trim()) errs.model = 'Required';
    if (!intakeColour.trim()) errs.colour = 'Required';
    if (!intakeDealer) errs.dealer = 'Please select a dealer';
    if (!intakePhotoFile) errs.photo = 'Please add a photo';
    if (Object.keys(errs).length > 0) { setIntakeErrors(errs); return; }

    setSubmitting(true);
    setError('');
    try {
      const photoUrl = await uploadToStorage(intakePhotoFile!, 'cars');
      const newCar: Car = {
        id: generateId(),
        make: intakeMake.trim(),
        model: intakeModel.trim(),
        year: intakeYear,
        colour: intakeColour.trim(),
        carPlate: plate.trim().toUpperCase(),
        mileage: 0,
        condition: 'good',
        transmission: 'auto',
        purchasePrice: 0,
        sellingPrice: 0,
        status: 'available',
        photo: photoUrl,
        photos: [photoUrl],
        dateAdded: new Date().toISOString().split('T')[0],
        // Terms/amount are technical placeholders — a director fills in the
        // real purchase price and consignment terms via Edit Car afterward.
        consignment: { dealer: intakeDealer, terms: 'fixed_amount', fixedAmount: 0 },
      };
      await addCar(newCar);
      await addCarMovement({
        id: generateId(),
        carId: newCar.id,
        carPlate: newCar.carPlate!,
        type: 'in',
        userId: currentUser.id,
        userName: currentUser.name,
        reason: 'Dealer',
        notes: notes.trim() || undefined,
        destinationType: 'dealer',
        destinationName: intakeDealer,
        createdAt: new Date().toISOString(),
      });
      setDone(true);
    } catch (e: any) {
      setError(e.message ?? 'Failed to add car');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setDone(false);
    setPlate('');
    setNotes('');
    setCategory('test_drive');
    setDestinationName('');
    setError('');
    setShowIntake(false);
    setIntakeMake('');
    setIntakeModel('');
    setIntakeYear(new Date().getFullYear());
    setIntakeColour('');
    setIntakeDealer('');
    setIntakePhotoFile(null);
    setIntakePhotoPreview('');
    setIntakeErrors({});
  };

  if (done) {
    return (
      <div className="min-h-screen bg-obsidian-950 flex flex-col items-center justify-center px-6 gap-6">
        <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-8 flex flex-col items-center gap-4 w-full max-w-sm text-center">
          <CheckCircle size={48} className="text-green-400" />
          <div>
            <p className="text-white font-bold text-xl">{type === 'out' ? 'Car Out' : 'Car In'} Logged</p>
            <p className="text-gray-400 text-sm mt-1">{plate.toUpperCase()}</p>
            <p className="text-gray-500 text-xs mt-1">by {currentUser.name}</p>
          </div>
        </div>
        <button
          onClick={handleReset}
          className="w-full max-w-sm py-3 bg-gold-500 hover:bg-gold-400 text-black font-semibold rounded-xl transition-colors"
        >
          Log Another
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-obsidian-950 flex flex-col px-5 py-8 gap-6 max-w-sm mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mt-4">
        <CarIcon size={24} className="text-gold-400" />
        <div>
          <p className="text-white font-bold text-lg">Car Movement</p>
          <p className="text-gray-500 text-xs">{currentUser.name}</p>
        </div>
      </div>

      {/* In / Out toggle */}
      <div className="flex rounded-xl overflow-hidden border border-obsidian-400/60">
        <button
          onClick={() => { setType('out'); setShowIntake(false); }}
          className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-semibold transition-colors ${
            type === 'out'
              ? 'bg-red-500/20 text-red-300 border-r border-obsidian-400/60'
              : 'bg-obsidian-800 text-gray-500 border-r border-obsidian-400/60'
          }`}
        >
          <LogOut size={16} /> Car Out
        </button>
        <button
          onClick={() => setType('in')}
          className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-semibold transition-colors ${
            type === 'in'
              ? 'bg-green-500/20 text-green-300'
              : 'bg-obsidian-800 text-gray-500'
          }`}
        >
          <LogIn size={16} /> Car In
        </button>
      </div>

      {/* Car Plate */}
      <div>
        <label className="text-gray-400 text-xs font-medium mb-1.5 block">Car Plate</label>
        <input
          type="text"
          value={plate}
          onChange={(e) => { setPlate(e.target.value.toUpperCase()); setShowIntake(false); }}
          placeholder="e.g. QBC7808"
          className="w-full bg-obsidian-800 border border-obsidian-400/60 text-white placeholder-gray-600 rounded-xl px-4 py-3.5 text-lg font-mono font-bold tracking-widest focus:outline-none focus:border-gold-500 transition-colors uppercase"
          autoComplete="off"
          autoCapitalize="characters"
        />
        {/* Car match indicator */}
        {plate.length >= 3 && (
          <p className={`text-xs mt-1.5 ${matchedCar ? 'text-green-400' : 'text-gray-600'}`}>
            {matchedCar
              ? `✓ ${matchedCar.year} ${matchedCar.make} ${matchedCar.model}${isCurrentlyOut ? ' — currently OUT' : ''}`
              : 'No matching car found'}
          </p>
        )}
      </div>

      {/* Out: category + destination pick */}
      {type === 'out' && (
        <>
          <div>
            <label className="text-gray-400 text-xs font-medium mb-1.5 block">Reason</label>
            <div className="grid grid-cols-2 gap-2">
              {CATEGORY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => { setCategory(opt.value); setDestinationName(''); }}
                  className={`px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors text-left ${
                    category === opt.value
                      ? 'bg-red-500/15 border-red-500/40 text-red-300'
                      : 'bg-obsidian-800 border-obsidian-400/60 text-gray-400'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {needsDestination && (
            <div>
              <label className="text-gray-400 text-xs font-medium mb-1.5 block">
                {category === 'dealer' ? 'Dealer' : 'Workshop'}
              </label>
              {destinationOptions.length === 0 ? (
                <p className="text-xs text-gray-500 py-2">
                  No {category === 'dealer' ? 'dealers' : 'workshops'} yet — add them in <span className="text-gold-400">Data</span>
                </p>
              ) : (
                <select
                  value={destinationName}
                  onChange={(e) => setDestinationName(e.target.value)}
                  className="w-full bg-obsidian-800 border border-obsidian-400/60 text-white rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:border-gold-500 transition-colors"
                >
                  <option value="">— Select {category === 'dealer' ? 'dealer' : 'workshop'} —</option>
                  {destinationOptions.map((d) => (
                    <option key={d.id} value={d.name}>{d.name}</option>
                  ))}
                </select>
              )}
            </div>
          )}
        </>
      )}

      {/* In: auto-resolved return trail */}
      {type === 'in' && returningFrom && (
        <p className="text-sm text-green-400 bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3">
          Returning from <span className="font-semibold">{returningFrom}</span>
        </p>
      )}

      {/* In: unmatched plate — quick consignment intake */}
      {type === 'in' && plate.length >= 3 && !matchedCar && (
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-4 space-y-3">
          <p className="text-blue-300 text-sm">
            No car found for <span className="font-mono font-semibold">{plate}</span>.
          </p>
          {!showIntake ? (
            <button
              onClick={() => setShowIntake(true)}
              className="w-full py-2.5 rounded-lg bg-blue-500/20 border border-blue-500/40 text-blue-300 text-sm font-semibold"
            >
              Add to Inventory as Consignment
            </button>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-gray-400 text-xs font-medium mb-1 block">Make</label>
                  <input
                    value={intakeMake}
                    onChange={(e) => { setIntakeMake(e.target.value); setIntakeErrors((p) => ({ ...p, make: '' })); }}
                    className={`w-full bg-obsidian-800 border rounded-lg px-3 py-2 text-white text-sm focus:outline-none ${intakeErrors.make ? 'border-red-500/60' : 'border-obsidian-400/60 focus:border-gold-500'}`}
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs font-medium mb-1 block">Model</label>
                  <input
                    value={intakeModel}
                    onChange={(e) => { setIntakeModel(e.target.value); setIntakeErrors((p) => ({ ...p, model: '' })); }}
                    className={`w-full bg-obsidian-800 border rounded-lg px-3 py-2 text-white text-sm focus:outline-none ${intakeErrors.model ? 'border-red-500/60' : 'border-obsidian-400/60 focus:border-gold-500'}`}
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs font-medium mb-1 block">Year</label>
                  <input
                    type="number"
                    value={intakeYear}
                    onChange={(e) => setIntakeYear(Number(e.target.value))}
                    className="w-full bg-obsidian-800 border border-obsidian-400/60 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-gold-500"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs font-medium mb-1 block">Colour</label>
                  <input
                    value={intakeColour}
                    onChange={(e) => { setIntakeColour(e.target.value); setIntakeErrors((p) => ({ ...p, colour: '' })); }}
                    className={`w-full bg-obsidian-800 border rounded-lg px-3 py-2 text-white text-sm focus:outline-none ${intakeErrors.colour ? 'border-red-500/60' : 'border-obsidian-400/60 focus:border-gold-500'}`}
                  />
                </div>
              </div>

              <div>
                <label className="text-gray-400 text-xs font-medium mb-1 block">Dealer</label>
                {dealers.length === 0 ? (
                  <p className="text-xs text-gray-500 py-2">No dealers yet — add them in <span className="text-gold-400">Data</span></p>
                ) : (
                  <select
                    value={intakeDealer}
                    onChange={(e) => { setIntakeDealer(e.target.value); setIntakeErrors((p) => ({ ...p, dealer: '' })); }}
                    className={`w-full bg-obsidian-800 border rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none ${intakeErrors.dealer ? 'border-red-500/60' : 'border-obsidian-400/60 focus:border-gold-500'}`}
                  >
                    <option value="">— Select dealer —</option>
                    {dealers.map((d) => (
                      <option key={d.id} value={d.name}>{d.name}</option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="text-gray-400 text-xs font-medium mb-1 block">Photo</label>
                {intakePhotoPreview ? (
                  <div className="relative">
                    <img src={intakePhotoPreview} alt="" className="w-full h-32 object-cover rounded-lg border border-obsidian-400/60" />
                    <button onClick={() => handleIntakePhoto(null)} className="absolute top-1.5 right-1.5 bg-black/60 text-white rounded-full p-1"><AlertCircle size={12} /></button>
                  </div>
                ) : (
                  <label className={`flex flex-col items-center justify-center gap-1.5 py-5 rounded-lg border-2 border-dashed cursor-pointer ${intakeErrors.photo ? 'border-red-500/60' : 'border-obsidian-400/60'}`}>
                    <Upload size={18} className="text-gray-500" />
                    <span className="text-xs text-gray-500">Add a photo</span>
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => handleIntakePhoto(e.target.files?.[0] ?? null)} />
                  </label>
                )}
                {intakeErrors.photo && <p className="text-red-400 text-xs mt-1">{intakeErrors.photo}</p>}
              </div>

              <p className="text-[11px] text-gray-500">Pricing and consignment terms are filled in later by a director.</p>

              <div className="flex gap-2">
                <button onClick={() => setShowIntake(false)} className="flex-1 py-2.5 rounded-lg border border-obsidian-400/60 text-gray-400 text-sm">Cancel</button>
                <button
                  onClick={handleIntakeSubmit}
                  disabled={submitting}
                  className="flex-1 py-2.5 rounded-lg bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold disabled:opacity-50"
                >
                  {submitting ? 'Adding...' : 'Add Car & Log In'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Notes */}
      {!(type === 'in' && showIntake) && (
        <div>
          <label className="text-gray-400 text-xs font-medium mb-1.5 block">Notes <span className="text-gray-600">(optional)</span></label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any additional details..."
            rows={3}
            className="w-full bg-obsidian-800 border border-obsidian-400/60 text-white placeholder-gray-600 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gold-500 transition-colors resize-none"
          />
        </div>
      )}

      {error && (
        <p className="text-red-400 text-sm flex items-center gap-1.5">
          <AlertCircle size={14} /> {error}
        </p>
      )}

      {!(type === 'in' && showIntake) && (
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className={`w-full py-4 rounded-xl font-bold text-base transition-colors disabled:opacity-50 ${
            type === 'out'
              ? 'bg-red-500 hover:bg-red-400 text-white'
              : 'bg-green-500 hover:bg-green-400 text-black'
          }`}
        >
          {submitting ? 'Logging...' : type === 'out' ? 'Log Car Out' : 'Log Car In'}
        </button>
      )}
    </div>
  );
}
