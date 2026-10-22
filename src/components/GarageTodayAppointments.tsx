import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { listAppointmentsInRange } from '../lib/garageAppointments';
import type { GarageAppointment } from '../types';

export default function GarageTodayAppointments() {
  const userId = useStore(s => s.currentUser?.id);
  const navigate = useNavigate();
  const [state, setState] = useState<{ owner?: string; items: GarageAppointment[]; error?: boolean }>({ items: [] });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    if (!userId) return;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    listAppointmentsInRange(start.toISOString(), end.toISOString())
      .then(items => { if (!cancelled) setState({ owner: userId, items: items.filter(a => a.createdBy === userId) }); })
      .catch(() => { if (!cancelled) setState({ owner: userId, items: [], error: true }); });
    return () => { cancelled = true; };
  }, [userId, attempt]);
  return <section className="mt-8 border border-white/10 rounded-2xl p-5 bg-white/[0.03]">
    <div className="flex justify-between items-center gap-4"><h2 className="text-white font-medium">Today’s appointments</h2><button className="text-sm text-gold-400" onClick={() => navigate('/garage/calendar')}>Open calendar</button></div>
    {state.owner !== userId ? <p className="text-white/50 text-sm mt-4">Loading appointments…</p> : state.error ? <p role="alert" className="text-white/60 text-sm mt-4">Could not load appointments. <button className="text-gold-400" onClick={() => setAttempt(a => a + 1)}>Try again</button></p> : state.items.length ? state.items.map(a => <button key={a.id} onClick={() => navigate('/garage/calendar')} className="block w-full text-left border-t border-white/10 mt-4 pt-4 text-sm"><span className="text-gold-400 mr-3">{new Date(a.startsAt).toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit' })}</span><span className="text-white/80">{a.title || 'Appointment'}</span></button>) : <p className="text-white/50 text-sm mt-4">No appointments today.</p>}
  </section>;
}
