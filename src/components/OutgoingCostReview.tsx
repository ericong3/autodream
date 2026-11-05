import {useEffect,useState} from 'react';
import {useStore} from '../store';
import {investorRequest,useInvestorQuery,useInvestorAction,formatCents} from '../lib/investorFinance';
import CompanyPaymentDocuments from './CompanyPaymentDocuments';
import ConfirmSheet from './ConfirmSheet';
type Review={paymentId:string;approved:boolean;costReviewPending:boolean;purchaseCents?:number;carCostCents?:number;otherExpenseCents?:number;netProfitCents?:number;missingPurchaseCents?:number;sourceRevision?:string;invoices?:{id:string;name:string}[];payments?:Record<string,unknown>[];journals?:Record<string,unknown>[]};
export default function OutgoingCostReview({paymentId,actorId,onReviewed}:{paymentId:string;actorId:string;onReviewed:()=>void}){
 const q=useInvestorQuery<Review>(actorId+':outgoing-costs:'+paymentId,()=>investorRequest('review_costs',{scope:'outgoing_collections',paymentId})),act=useInvestorAction(actorId);
 const [invoice,setInvoice]=useState(''),[ack,setAck]=useState(false),[confirm,setConfirm]=useState(false),[docs,setDocs]=useState(false);
 useEffect(()=>{setAck(false);setConfirm(false);},[q.data?.sourceRevision]);
 const apply=(saved:Review|null)=>{if(saved&&useStore.getState().currentUser?.id===actorId){useStore.getState().applyCompanyBankPayment(actorId,{payments:saved.payments??[],journals:saved.journals??[]});onReviewed();void q.reload();}};
 const close=async()=>{if(!q.data?.sourceRevision)return;apply(await act.run<Review>('outgoing-costs:'+paymentId,'close_costs',{scope:'outgoing_collections',paymentId,expectedRevision:q.data.sourceRevision,purchaseInvoiceId:invoice,reviewConfirmed:true,missingPurchaseAcknowledged:ack},'Review car costs'));};
 const ready=!q.loading&&!q.error&&!!q.data?.sourceRevision&&!!q.data.invoices?.some(d=>d.id===invoice)&&(!(q.data.missingPurchaseCents??0)||ack)&&!act.busy;
 return <div className="border-t border-white/10 pt-3 space-y-2 text-xs">
  <p className="text-white font-medium">Car cost review</p>{(q.error||act.error)&&<p role="alert" className="text-red-400">{q.error?.message||act.error?.message}</p>}
  {q.loading&&!q.data&&<p role="status" className="text-gray-300">Loading car costs…</p>}{q.error&&<button type="button" className="text-gold-300 underline py-2" onClick={()=>void q.reload()}>Refresh car costs</button>}
  <button type="button" className="text-gold-300 underline" onClick={()=>setDocs(true)}>Upload / view purchase invoice</button>
  {q.data?.costReviewPending===false?<p className="text-green-300">Car costs reviewed. Bank history may still need matching.</p>:q.data&&<>
   <p className="text-gray-300">Purchase {formatCents(q.data.purchaseCents)} · car costs {formatCents(q.data.carCostCents)} · other costs {formatCents(q.data.otherExpenseCents)}</p><p className="text-white">Profit / loss: {formatCents(q.data.netProfitCents)}</p>
   <label className="block text-gray-300">Car purchase invoice<select aria-label="Car purchase invoice" className="input w-full mt-1 px-2 py-2 rounded" value={invoice} onChange={e=>setInvoice(e.target.value)}><option value="">Choose the purchase invoice</option>{q.data.invoices?.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
   {!!q.data.missingPurchaseCents&&<label className="flex gap-2 text-amber-300"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/><span>The old purchase entry is missing: {formatCents(q.data.missingPurchaseCents)}. Record the stock cost once and leave its bank history for later review. This records no new bank payment.</span></label>}
   <button type="button" className="text-gold-300 border border-gold-500/30 px-3 py-2 rounded disabled:opacity-40" disabled={!ready} onClick={()=>setConfirm(true)}>{act.busy?'Saving cost review…':'Review car costs'}</button>
  </>}
  {act.pending.filter(p=>p.slot==='outgoing-costs:'+paymentId).map(p=><button key={p.slot} type="button" className="text-amber-300 underline" onClick={()=>void act.retry<Review>(p.slot).then(apply)}>Retry original cost review</button>)}
  {docs&&<CompanyPaymentDocuments paymentId={paymentId} onClose={()=>{setDocs(false);void q.reload();}}/>}
  <ConfirmSheet isOpen={confirm} onClose={()=>setConfirm(false)} title="Finalise these car costs?" message="I have checked the purchase invoice and all car costs. This finalises the sale profit or loss. It does not record another bank payment." confirmLabel="Finalise car costs" variant="warning" onConfirm={()=>{setConfirm(false);void close();}}/>
 </div>;
}
