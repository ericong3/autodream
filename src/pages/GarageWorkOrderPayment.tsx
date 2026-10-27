import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  Banknote, CreditCard, ArrowRightLeft, CalendarClock, CheckCircle2, AlertCircle, Send, Clock,
  Upload, Camera, FileText, X,
} from 'lucide-react';
import GarageShell from '../components/GarageShell';
import { useStore } from '../store';
import {paymentProof} from '../lib/garageTintControl';
import {saleAppointmentOptions} from '../lib/garageAppointments';
import type {GarageAppointment} from '../types';
import {saleConfirmation,readSaleRecovery,keepSaleIntent,finishSaleIntent,forgetSaleIntent,currentSaleDraftId,supersedeSaleDraft,type SaleIntent,type SaleResult} from '../lib/garageSaleConfirmation';
import { formatRM } from '../utils/format';
import type { GaragePaymentMethod, GaragePaymentStatus } from '../types';
import type { PendingTintOrder, PendingAddon } from './GarageWorkOrderSummary';

export interface PendingPayment {
  pending: PendingTintOrder;
  addons: PendingAddon[];
  addonsTotal: number;
  grandTotal: number;
}

function localDateTime(date:Date){const pad=(v:number)=>String(v).padStart(2,'0');return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;}

const PAYMENT_METHODS: { key: GaragePaymentMethod; label: string; icon: typeof Banknote }[] = [
  { key: 'cash', label: 'Cash', icon: Banknote },
  { key: 'card', label: 'Card', icon: CreditCard },
  { key: 'transfer', label: 'Transfer', icon: ArrowRightLeft },
  { key: 'installment', label: 'Installment', icon: CalendarClock },
];

// Some customers pay before the job starts, some after — but always before
// the car is handed back. "Now" needs a method right away; "Later" just
// records that payment is still owed, to be settled before delivery.
const PAYMENT_TIMINGS: { key: GaragePaymentStatus; label: string; desc: string }[] = [
  { key: 'paid', label: 'Collect now', desc: 'Record a deposit or full collection for company verification' },
  { key: 'pending', label: 'Collect later', desc: 'No money received yet; track the balance before delivery' },
];

export default function GarageWorkOrderPayment() {
  const { id, vehicleId } = useParams<{ id: string; vehicleId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const currentUser = useStore((s) => s.currentUser);

  const state = location.state as PendingPayment | undefined;

  const [timing, setTiming] = useState<GaragePaymentStatus>('paid');
  const [method, setMethod] = useState<GaragePaymentMethod | ''>('');
  const [collectionAmount,setCollectionAmount]=useState(''),[paymentReference,setPaymentReference]=useState(''),[savedInvoiceId,setSavedInvoiceId]=useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  // For the installer — shown on the job before they accept it.
  const [bookings,setBookings]=useState<GarageAppointment[]>([]),[bookingMode,setBookingModeState]=useState(''),[bookingLoading,setBookingLoading]=useState(true),[bookingError,setBookingError]=useState(''),[moreBookings,setMoreBookings]=useState(false);
  const bookingModeRef=useRef(''),bookingGeneration=useRef(0),confirmLock=useRef(false);
  const [recoveryBlocked,setRecoveryBlocked]=useState(false),[appointmentEnd,setAppointmentEnd]=useState('');
  const setBookingMode=(value:string)=>{bookingModeRef.current=value;setBookingModeState(value);};
  const refreshBookings=async(preferred?:string)=>{
    if(!id||!vehicleId)return;const generation=bookingGeneration.current;setBookingLoading(true);setBookingError('');
    try{const result=await saleAppointmentOptions(id,vehicleId,'tinted');if(generation!==bookingGeneration.current)return;
      setBookings(result.appointments);setMoreBookings(result.hasMore);const chosen=preferred??bookingModeRef.current;
      setBookingMode(chosen==='new'||chosen==='none'||result.appointments.some(a=>a.id===chosen)?chosen:result.appointments.length===1?result.appointments[0].id:result.appointments.length?'':'new');
    }catch(err){if(generation===bookingGeneration.current)setBookingError((err as Error).message);}
    finally{if(generation===bookingGeneration.current)setBookingLoading(false);}
  };
  const [appointmentAt, setAppointmentAt] = useState(''); // datetime-local value
  const [remark, setRemark] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [recovery,setRecovery]=useState<SaleIntent|null>(null),[recoveryResult,setRecoveryResult]=useState<SaleResult|null>(null);
  const recoveryRef=useRef<SaleIntent|null>(null);

  const handleReceiptPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type)||file.size>2097152) {
      setError('Choose a JPEG, PNG, WebP or PDF up to 2 MB');
      return;
    }
    setError('');
    setReceiptFile(file);
  };

  // The URL here is keyed only on customer + vehicle, not on a per-order id —
  // creating a second work order for the same customer/vehicle resolves to
  // the identical pathname, so React Router reuses this component instance
  // instead of remounting it. Without this, a stale `done: true` from the
  // first order would show "Work Order Confirmed" again without ever
  // calling handleConfirm, silently dropping every order after the first.
  useEffect(() => {
    if (!state) {
      navigate(`/garage/work-order/customer/${id}/vehicle/${vehicleId}/service/tinted`, { replace: true });
      return;
    }
    setDone(false);setRecovery(null);setRecoveryResult(null);recoveryRef.current=null;
    setConfirming(false);
    setError('');
    setTiming('paid');
    setMethod('');
    setCollectionAmount(String(state?.grandTotal??0));setPaymentReference('');setSavedInvoiceId('');
    setReceiptFile(null);
    setAppointmentAt('');setAppointmentEnd('');setRecoveryBlocked(false);confirmLock.current=false;
    setRemark('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  useEffect(()=>{bookingGeneration.current++;setBookings([]);setBookingMode('');if(state)void refreshBookings();return()=>{bookingGeneration.current++;};},[location.key,currentUser?.id,id,vehicleId]);

  useEffect(()=>{
    if(!currentUser?.id||!id||!vehicleId)return;
    try{const intent=readSaleRecovery(currentUser.id,id,vehicleId,location.key);if(intent){recoveryRef.current=intent;setRecovery(intent);setRecoveryBlocked(true);setError('A previous confirmation needs checking. Check the saved sale to continue.');}}
    catch(err){setRecoveryBlocked(true);setError((err as Error).message);}
  },[location.key,currentUser?.id,id,vehicleId]);
  const completeSavedSale=async(intent:SaleIntent,result:SaleResult,generation:number)=>{
    if(result.state!=='saved'||!result.invoiceId)throw new Error('This confirmation has not saved yet. Retry the original confirmation, or cancel it to edit.');
    if(generation!==bookingGeneration.current)return;
    setRecoveryResult(result);
    if((result.receiptExpected??intent.sale.receiptExpected)&&!result.receiptPath){
      if(!receiptFile)throw new Error(`Sale ${result.invoiceNumber||''} is saved. Choose the receipt again, then retry the attachment.`);
      if(!result.paymentId)throw new Error('Sale saved. Check its payment history before attaching proof.');
      await paymentProof(result.invoiceId,result.paymentId,receiptFile);
    }
    if(generation!==bookingGeneration.current)return;
    setSavedInvoiceId(result.invoiceId);setTiming(result.paymentStatus??intent.sale.paymentStatus);setMethod((intent.sale.paymentMethod||'') as GaragePaymentMethod|'');finishSaleIntent(currentUser!.id,intent);setRecovery(null);setRecoveryResult(null);recoveryRef.current=null;setRecoveryBlocked(false);setError('');setDone(true);
  };
  const recoverSale=async(action:'status'|'confirm'|'abandon')=>{
    const intent=recoveryRef.current;if(!intent||confirmLock.current)return;const generation=bookingGeneration.current;
    confirmLock.current=true;setConfirming(true);setError('');
    try{const result=await saleConfirmation(action,intent);if(generation!==bookingGeneration.current)return;setRecoveryResult(result);
      if(result.state==='saved'){await completeSavedSale(intent,result,generation);}
      else if(action==='abandon'&&(result.state==='abandoned'||result.state==='removed')){if(!result.replacementRequestId)throw new Error('Check the saved sale again before editing.');supersedeSaleDraft(intent.requestId,result.replacementRequestId);forgetSaleIntent(currentUser!.id,intent);setRecovery(null);recoveryRef.current=null;setRecoveryBlocked(false);setRecoveryResult(null);void refreshBookings();}
      else setError(result.state==='missing'?'The original confirmation was not saved. Retry it, or cancel that attempt to change the details.':result.state==='removed'?'The saved sale was removed. Check with a director before starting another.':'This confirmation was cancelled. Cancel this recovery to return to editing.');
    }catch(err){if(generation===bookingGeneration.current)setError((err as Error).message);}
    finally{if(generation===bookingGeneration.current){confirmLock.current=false;setConfirming(false);}}
  };

  if (!state) return null;
  const { pending, addons, grandTotal } = state;

  const handleConfirm = async () => {
    if(confirmLock.current||recoveryBlocked)return;
    const booking=bookings.find(a=>a.id===bookingMode);
    if(bookingMode!=='none'&&(bookingLoading||bookingError)){setError('Check the installation booking first, or choose No appointment.');return;}
    if(!bookingMode){setError('Choose the installation booking to use.');return;}
    if(bookingMode!=='new'&&bookingMode!=='none'&&!booking){setError('Reload the available bookings before confirming.');return;}
    const newStart=appointmentAt?new Date(appointmentAt):null,newEnd=appointmentEnd?new Date(appointmentEnd):null;
    if(bookingMode==='new'&&appointmentAt&&(!newStart||!newEnd||!Number.isFinite(newStart.getTime())||!Number.isFinite(newEnd.getTime())||newEnd<=newStart)){setError('Choose an end time after the appointment starts.');return;}

    if (timing === 'paid' && grandTotal>0 && !method) { setError('Choose a payment method'); return; }
    const received=Number(collectionAmount);
    if(timing==='paid'&&grandTotal>0&&(!Number.isFinite(received)||received<=0||received>grandTotal||Math.abs(received*100-Math.round(received*100))>0.00001)){setError('Enter the deposit/full amount received, within the order total and with at most two decimal places.');return;}
    setError('');
    const confirmGeneration=bookingGeneration.current;
    confirmLock.current=true;setConfirming(true);
    let intent:SaleIntent|null=null;
    try {
      intent={requestId:pending.confirmationId?currentSaleDraftId(pending.confirmationId):crypto.randomUUID(),routeKey:location.key,sale:{customerId:id!,vehicleId:vehicleId!,paymentStatus:timing,paymentMethod:method||undefined,remark:remark.trim(),pending:JSON.parse(JSON.stringify(pending)),addons:addons.map(({name,price,qty})=>({name,price,qty})),receiptExpected:grandTotal>0&&!!receiptFile,...(timing==='paid'&&grandTotal>0?{initialPayment:{amount:received,method,reference:paymentReference.trim()}}:{}),
        booking:booking?{mode:'existing',appointmentId:booking.id,revision:booking.revision}:bookingMode==='new'&&newStart&&newEnd?{mode:'new',startsAt:newStart.toISOString(),endsAt:newEnd.toISOString()}:{mode:'none'}}};
      // Persist before any network write. A retry or refresh uses this same intent.
      await keepSaleIntent(currentUser!.id,intent);recoveryRef.current=intent;setRecovery(intent);setRecoveryBlocked(true);
      const result=await saleConfirmation('confirm',intent);await completeSavedSale(intent,result,confirmGeneration);
    } catch(err) {
      if(confirmGeneration===bookingGeneration.current){setError((err as Error).message);if((err as {code?:string}).code==='PENDING'){const existing=readSaleRecovery(currentUser!.id,id!,vehicleId!,location.key);if(existing){recoveryRef.current=existing;setRecovery(existing);setRecoveryBlocked(true);}}else if(!recoveryRef.current)setRecoveryBlocked(false);}
    } finally {
      if(confirmGeneration===bookingGeneration.current){confirmLock.current=false;setConfirming(false);}
    }
  };

  if (done) {
    return (
      <GarageShell title="Payment" showBack={false}>
        <div className="max-w-5xl mx-auto flex flex-col items-center text-center py-16">
          <div className="relative mb-5 flex items-center justify-center">
            <div className="absolute w-20 h-20 rounded-full bg-emerald-400/10 blur-xl" />
            <CheckCircle2 size={40} strokeWidth={1.5} className="relative text-emerald-400" />
          </div>
          <h2 className="font-display text-xl text-white font-semibold tracking-wide mb-2">Work Order Confirmed</h2>
          <p className="text-white/50 text-sm mb-8">
            Sent to the installers. Recorded collections await director/admin verification. Track deposits and balances in the work order.
          </p>
          {savedInvoiceId&&<button onClick={()=>navigate('/garage/invoice/'+savedInvoiceId)} className="btn-gold px-6 py-2.5 rounded-xl text-sm mb-3">View work order & payments</button>}
          <button
            onClick={() => navigate('/garage/dashboard')}
            className="btn-gold px-6 py-2.5 rounded-xl text-sm"
          >
            Back to Dashboard
          </button>
        </div>
      </GarageShell>
    );
  }

  return (
    <GarageShell title="Payment">
      <div className="max-w-5xl mx-auto space-y-6">
        <fieldset disabled={confirming||recoveryBlocked} className={recovery?'hidden':'contents'}>
        <div className="relative overflow-hidden rounded-[28px] p-8 sm:p-10
          bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card-lg">
          <div className="flex justify-between items-baseline mb-8 pb-6 border-b border-white/10">
            <span className="text-white/50 text-sm">Amount Due</span>
            <span className="text-gold-400 font-display text-3xl font-bold">{formatRM(grandTotal)}</span>
          </div>

          <p className="text-white/50 text-xs font-medium uppercase tracking-wider mb-4">When</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
            {PAYMENT_TIMINGS.map((t) => (
              <button
                key={t.key}
                onClick={() => {
                  setTiming(t.key);
                  // Pay Later means payment isn't happening now — no method
                  // to record until it's actually collected at delivery.
                  if (t.key === 'pending') { setMethod(''); setReceiptFile(null); }
                }}
                className={`flex flex-col items-start gap-1 px-5 py-4 rounded-xl border text-left transition-colors ${
                  timing === t.key
                    ? 'bg-gold-500/15 border-gold-400/50'
                    : 'bg-white/[0.03] border-white/10 hover:border-white/20'
                }`}
              >
                <span className={`flex items-center gap-2 text-sm font-semibold ${timing === t.key ? 'text-gold-400' : 'text-white/80'}`}>
                  <Clock size={15} /> {t.label}
                </span>
                <span className="text-white/40 text-xs">{t.desc}</span>
              </button>
            ))}
          </div>

          {timing === 'paid' && grandTotal>0 && (
            <>
              <p className="text-white/50 text-xs font-medium uppercase tracking-wider mb-4">Payment Method</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {PAYMENT_METHODS.map((m) => (
                  <button
                    key={m.key}
                    onClick={() => setMethod(m.key)}
                    className={`flex flex-col items-center justify-center gap-2.5 px-4 py-7 rounded-xl border text-sm font-medium transition-colors ${
                      method === m.key
                        ? 'bg-gold-500/15 border-gold-400/50 text-gold-400'
                        : 'bg-white/[0.03] border-white/10 text-white/60 hover:text-white/90 hover:border-white/20'
                    }`}
                  >
                    <m.icon size={24} strokeWidth={1.5} />
                    {m.label}
                  </button>
                ))}
              </div>
            </>
          )}

          {timing === 'pending' && (
            <p className="text-white/40 text-sm">Payment will be collected later, before the car is delivered.</p>
          )}
          {timing==='paid'&&grandTotal>0&&<div className="grid sm:grid-cols-2 gap-4 mt-5"><label className="text-white/60 text-sm">Amount received (RM)<input aria-label="Initial amount received" type="number" min="0.01" step="0.01" max={grandTotal} value={collectionAmount} onChange={e=>setCollectionAmount(e.target.value)} className="w-full mt-2 bg-white/5 border border-white/20 rounded-lg p-3 text-white"/></label><label className="text-white/60 text-sm">Reference / note<input aria-label="Initial payment reference" maxLength={200} value={paymentReference} onChange={e=>setPaymentReference(e.target.value)} className="w-full mt-2 bg-white/5 border border-white/20 rounded-lg p-3 text-white"/></label><p className="text-white/40 text-xs sm:col-span-2">A director or authorised admin must verify that the company received this money. A collection entry alone does not mark the order paid.</p></div>}

          {timing === 'paid' && grandTotal>0 && method && (
            <div className="mt-8 pt-6 border-t border-white/10">
              <p className="text-white/50 text-xs font-medium uppercase tracking-wider mb-4">Proof of Payment (optional)</p>
              {receiptFile ? (
                <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-gold-400/30 bg-gold-500/10">
                  <span className="flex items-center gap-2 text-sm text-white/80 truncate">
                    <FileText size={15} className="text-gold-400 shrink-0" /> {receiptFile.name}
                  </span>
                  <button onClick={() => setReceiptFile(null)} className="text-white/40 hover:text-red-400 transition-colors shrink-0">
                    <X size={15} />
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium
                      bg-white/[0.03] border-white/10 text-white/60 hover:text-white/90 hover:border-white/20 transition-colors"
                  >
                    <Upload size={16} /> Upload File
                  </button>
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium
                      bg-white/[0.03] border-white/10 text-white/60 hover:text-white/90 hover:border-white/20 transition-colors"
                  >
                    <Camera size={16} /> Take Photo
                  </button>
                </div>
              )}
              <input ref={fileInputRef} type="file" accept="image/*,application/pdf" onChange={handleReceiptPick} className="hidden" />
              <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleReceiptPick} className="hidden" />
            </div>
          )}
        </div>

        <div className="relative overflow-hidden rounded-[28px] p-8 sm:p-10
          bg-white/[0.04] backdrop-blur-xl border border-gold-400/15 shadow-card-lg">
          <p className="text-white/50 text-xs font-medium uppercase tracking-wider mb-4">For the Installer (optional)</p>
          <label className="block text-white/60 text-sm mb-4">Installation booking
            <select aria-label="Installation booking" value={bookingMode} disabled={confirming||recoveryBlocked} onChange={e=>setBookingMode(e.target.value)} className="block w-full bg-obsidian-800 border border-white/20 rounded-lg p-3 mt-2 text-white">
              <option value="">Choose booking</option>
              {bookings.map(a=><option key={a.id} value={a.id}>{new Date(a.startsAt).toLocaleString('en-MY')} – {new Date(a.endsAt).toLocaleTimeString('en-MY',{hour:'2-digit',minute:'2-digit'})}{a.title?` · ${a.title}`:''}</option>)}
              <option value="new">New appointment (optional)</option><option value="none">No appointment</option>
            </select>
          </label>
          {bookingLoading&&<p role="status" className="text-white/50 text-sm mb-3">Checking existing bookings…</p>}
          {bookingError&&<p role="alert" className="text-red-300 text-sm mb-3">{bookingError} <button type="button" onClick={()=>void refreshBookings()}>Try again</button></p>}
          {moreBookings&&<p className="text-white/60 text-sm">Showing the nearest 200 bookings. Check the calendar for older appointments.</p>}
          {bookings.find(a=>a.id===bookingMode)&&<p className="text-white/60 text-sm mb-4">This booking will be reused. <Link className="text-gold-400" onClick={e=>{if(confirming)e.preventDefault();}} to={`/garage/calendar?date=${localDateTime(new Date(bookings.find(a=>a.id===bookingMode)!.startsAt)).slice(0,10)}&open=${bookingMode}`}>Reschedule in calendar</Link></p>}
          <div className="grid grid-cols-1 sm:grid-cols-[220px_1fr] gap-3 items-start">
            {bookingMode==='new'&&<div><label className="block">
              <span className="block text-white/40 text-xs mb-1.5">Appointment date &amp; time</span>
              <input
                type="datetime-local"
                value={appointmentAt}
                disabled={confirming||recoveryBlocked}
                onChange={e=>{setAppointmentAt(e.target.value);const date=new Date(e.target.value);setAppointmentEnd(Number.isFinite(date.getTime())?localDateTime(new Date(date.getTime()+3600000)):'');}}
                onInput={e=>{const value=e.currentTarget.value;setAppointmentAt(value);const date=new Date(value);setAppointmentEnd(Number.isFinite(date.getTime())?localDateTime(new Date(date.getTime()+3600000)):'');}}
                className="w-full bg-white/[0.04] border border-white/10 focus:border-gold-400/50 rounded-lg
                  px-3 py-2.5 text-white text-sm outline-none transition-colors [color-scheme:dark]"
              />
            </label><label className="block mt-3"><span className="block text-white/40 text-xs mb-1.5">End time (defaults to 1 hour)</span><input aria-label="Appointment end" type="datetime-local" value={appointmentEnd} disabled={confirming||recoveryBlocked} onChange={e=>setAppointmentEnd(e.target.value)} onInput={e=>setAppointmentEnd(e.currentTarget.value)} className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm"/></label></div>}
            <label className="block">
              <span className="block text-white/40 text-xs mb-1.5">Remarks</span>
              <textarea
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                rows={2}
                placeholder="Anything the installer should know…"
                className="w-full bg-white/[0.04] border border-white/10 focus:border-gold-400/50 rounded-lg
                  px-3 py-2.5 text-white text-sm outline-none transition-colors resize-none"
              />
            </label>
          </div>
        </div>

        </fieldset>
        {error && (
          <p className="text-red-400 text-xs text-center flex items-center justify-center gap-1.5"><AlertCircle size={12} /> {error}</p>
        )}

        {recovery&&<section className="border border-gold-400/30 rounded-xl p-4 space-y-3" aria-label="Sale recovery"><h3 className="text-white font-medium">Check previous confirmation</h3>{recoveryResult?.state==='saved'&&<p role="status" className="text-emerald-300 text-sm">Sale {recoveryResult.invoiceNumber} is saved. Check or retry the receipt.</p>}<p className="text-white/70 text-sm">Original sale: {formatRM(recovery.sale.pending.finalTotal+recovery.sale.addons.reduce((sum,a)=>sum+a.price*a.qty,0))} · {recovery.sale.paymentStatus==='paid'?'Pay Now':'Pay Later'}</p><p className="text-white/60 text-sm">Your original details are kept. Checking or retrying uses the same recovery reference.</p>
          <button type="button" disabled={confirming} className="btn-gold px-4 py-2 rounded-lg mr-2" onClick={()=>void recoverSale('status')}>{confirming?'Checking…':'Check saved sale'}</button>
          <button type="button" disabled={confirming} className="text-gold-400 text-sm" onClick={()=>void recoverSale('confirm')}>{recoveryResult?.state==='saved'?'Retry receipt attachment':'Retry original confirmation'}</button>
          {recoveryResult?.state!=='saved'&&<button type="button" disabled={confirming} className="block text-white/60 text-sm" onClick={()=>void recoverSale('abandon')}>Cancel this attempt and edit</button>}
          {recovery.sale.receiptExpected&&<label className="block text-white/60 text-sm">Receipt attachment<input aria-label="Recovery receipt" type="file" accept="image/*,application/pdf" disabled={confirming} onChange={handleReceiptPick} className="block mt-2"/></label>}
        </section>}
        <div className="flex gap-3">
          <button
            disabled={confirming}
            onClick={() => navigate(-1)}
            className="flex-1 px-4 py-3 btn-ghost rounded-xl text-sm !text-white/90 font-medium"
          >
            Back
          </button>
          <button
            onClick={handleConfirm}
            disabled={confirming||recoveryBlocked}
            className="flex-[2] flex items-center justify-center gap-2 btn-gold px-4 py-3 rounded-xl text-sm disabled:opacity-60"
          >
            <Send size={15} /> {confirming ? 'Sending…' : 'Confirm & Send to Installer'}
          </button>
        </div>
      </div>
    </GarageShell>
  );
}
