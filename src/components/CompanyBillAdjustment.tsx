import {useEffect,useRef,useState} from 'react';
import {useStore} from '../store';
import {formatCents,investorRequest,parseRinggit,useInvestorAction,useInvestorQuery} from '../lib/investorFinance';
import ConfirmSheet from './ConfirmSheet';

type Snapshot={paymentId:string;rootPaymentId:string;carId:string;totalCents:number;paidCents:number;returnedCents:number;eligible?:boolean;reviewIssue?:string;invoices:{documentId:string;name:string}[]};
type Preview={paymentId:string;sourceRevision:string;beforeTotalCents:number;afterTotalCents:number;payableCents:number;receivableCents:number;costAccount:string};
type Saved={paymentId:string;car?:Record<string,unknown>;repairs?:Record<string,unknown>[];payments:Record<string,unknown>[];journals:Record<string,unknown>[]};
const scope='company_bill_adjustments';
const correctionCents=(value:string)=>/^0(?:\.0{1,2})?$/.test(value.trim())?0:parseRinggit(value);
export default function CompanyBillAdjustment({paymentId,actorId,invoiceVersion}:{paymentId:string;actorId:string;invoiceVersion:number}){
 const [open,setOpen]=useState(false),[amount,setAmount]=useState(''),[invoice,setInvoice]=useState(''),[reason,setReason]=useState(''),[preview,setPreview]=useState<Preview|null>(null),[reviewBusy,setReviewBusy]=useState(false),[error,setError]=useState(''),[confirm,setConfirm]=useState(false),[saved,setSaved]=useState(false);
 const q=useInvestorQuery<Snapshot>(open?`${scope}:${actorId}:${paymentId}:${invoiceVersion}`:null,()=>investorRequest('snapshot',{scope,paymentId}));
 const act=useInvestorAction(actorId),slot=`${scope}:${paymentId}`,pending=act.pending.filter(p=>p.slot===slot);
 const current=useRef('');current.current=JSON.stringify([amount,invoice,reason,q.data]);
 useEffect(()=>{setPreview(null);setConfirm(false);},[amount,invoice,reason,q.data]);
 const applySaved=async(result:Saved|null)=>{if(!result||useStore.getState().currentUser?.id!==actorId)return;useStore.getState().applyCompanyBankPayment(actorId,result);setSaved(true);setPreview(null);setConfirm(false);await q.reload();};
 const review=async()=>{const cents=correctionCents(amount);if(cents===null)return;const expected=current.current;setReviewBusy(true);setError('');setSaved(false);try{const result=await investorRequest<Preview>('preview',{scope,paymentId,amountCents:cents,invoiceDocumentId:invoice,reason});if(useStore.getState().currentUser?.id===actorId&&current.current===expected)setPreview(result);}catch(e){setError(e instanceof Error?e.message:'Could not check this correction.');}finally{setReviewBusy(false);}};
 const apply=async()=>{if(!preview)return;await applySaved(await act.run<Saved>(slot,'apply',{scope,paymentId,amountCents:preview.afterTotalCents,invoiceDocumentId:invoice,reason,expectedRevision:preview.sourceRevision},'Correct supplier bill'));};
 return <section className="my-4 border-t border-white/10 pt-3 text-sm space-y-3">
  <button type="button" className="text-blue-300 min-h-11" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>Correct bill amount</button>
  {open&&<div className="space-y-3">
   <p className="text-xs text-gray-400">Upload the corrected invoice or supplier credit note above first. Earlier payments stay in history.</p>
   {q.loading&&<p role="status" className="text-gray-400">Loading bill…</p>}
   {(q.error||act.error||error)&&<p role="alert" className="text-red-400">{q.error?.message||act.error?.message||error}</p>}
   {q.data?.eligible===false&&<p role="status" className="text-amber-300">{q.data.reviewIssue||'This bill needs its own car account review before it can be corrected.'}</p>}
   {q.data&&q.data.eligible!==false&&<><p className="text-gray-300">Current bill {formatCents(q.data.totalCents)} · Paid {formatCents(q.data.paidCents)} · Refunded {formatCents(q.data.returnedCents)}</p>
    <label className="block text-gray-300">Correct total (RM)<input type="number" min="0" step="0.01" className="input block w-full p-3" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
    <label className="block text-gray-300">Corrected invoice / credit note<select className="input block w-full p-3" value={invoice} onChange={e=>setInvoice(e.target.value)}><option value="">Choose a new uploaded document</option>{q.data.invoices.map(d=><option key={d.documentId} value={d.documentId}>{d.name}</option>)}</select></label>
    <label className="block text-gray-300">Reason<textarea className="input block w-full p-3" maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    <button type="button" className="btn-gold rounded-lg px-4 py-3" disabled={reviewBusy||!!act.busy||pending.length>0||!invoice||reason.trim().length<5||correctionCents(amount)===null||correctionCents(amount)===q.data.totalCents} onClick={()=>void review()}>{reviewBusy?'Checking…':'Review correction'}</button>
   </>}
   {preview&&<div className="rounded-lg border border-white/15 p-3 space-y-2 text-gray-300"><p>New bill total: {formatCents(preview.afterTotalCents)}</p><p>Still to pay: {formatCents(preview.payableCents)}</p><p>Supplier owes back: {formatCents(preview.receivableCents)}</p><p className="text-xs text-gray-400">No bank money moves. Record any refund separately when it reaches the bank.</p><button type="button" className="btn-gold rounded-lg px-4 py-3" disabled={!!act.busy||pending.length>0} onClick={()=>setConfirm(true)}>Save correction</button></div>}
   {saved&&<p role="status" className="text-green-300">Bill correction saved. Original payments remain in history.</p>}
   {pending.map(p=><button key={p.slot} type="button" className="text-amber-300 underline min-h-11" disabled={!!act.busy} onClick={()=>void act.retry<Saved>(p.slot).then(applySaved)}>Retry original correction</button>)}
  </div>}
  <ConfirmSheet isOpen={confirm} onClose={()=>setConfirm(false)} title="Save this bill correction?" message="The corrected document and your reason will be saved. Earlier payments stay unchanged. Any supplier refund must be recorded separately with proof." confirmLabel="Save correction" variant="warning" onConfirm={()=>{setConfirm(false);void apply();}}/>
 </section>;
}
