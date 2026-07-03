import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn, LogOut, Car, CheckCircle, AlertCircle } from 'lucide-react';
import { useStore } from '../store';
import { CarMovement } from '../types';

function generateId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const REASONS_OUT = [
  'Test Drive',
  'Customer Viewing',
  'Service / Workshop',
  'Photo Shoot',
  'Other',
];

export default function CarMovementPage() {
  const currentUser = useStore((s) => s.currentUser);
  const cars = useStore((s) => s.cars);
  const carMovements = useStore((s) => s.carMovements);
  const addCarMovement = useStore((s) => s.addCarMovement);
  const navigate = useNavigate();

  const [type, setType] = useState<'out' | 'in'>('out');
  const [plate, setPlate] = useState('');
  const [reason, setReason] = useState(REASONS_OUT[0]);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

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
        reason: type === 'out' ? reason : undefined,
        notes: notes.trim() || undefined,
        createdAt: new Date().toISOString(),
      };
      await addCarMovement(movement);
      setDone(true);
    } catch (e: any) {
      setError(e.message ?? 'Failed to log movement');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setDone(false);
    setPlate('');
    setNotes('');
    setReason(REASONS_OUT[0]);
    setError('');
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
        <Car size={24} className="text-gold-400" />
        <div>
          <p className="text-white font-bold text-lg">Car Movement</p>
          <p className="text-gray-500 text-xs">{currentUser.name}</p>
        </div>
      </div>

      {/* In / Out toggle */}
      <div className="flex rounded-xl overflow-hidden border border-obsidian-400/60">
        <button
          onClick={() => setType('out')}
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
          onChange={(e) => setPlate(e.target.value.toUpperCase())}
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

      {/* Reason (Out only) */}
      {type === 'out' && (
        <div>
          <label className="text-gray-400 text-xs font-medium mb-1.5 block">Reason</label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full bg-obsidian-800 border border-obsidian-400/60 text-white rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:border-gold-500 transition-colors"
          >
            {REASONS_OUT.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
      )}

      {/* Notes */}
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

      {error && (
        <p className="text-red-400 text-sm flex items-center gap-1.5">
          <AlertCircle size={14} /> {error}
        </p>
      )}

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
    </div>
  );
}
