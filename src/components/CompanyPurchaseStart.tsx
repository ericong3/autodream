import { useState } from 'react';
import type { Car } from '../types';
import { carToRow, useStore } from '../store';
import { existingCarPurchaseFields } from '../lib/companyPurchases';
import { formatCents, parseRinggit, useInvestorAction } from '../lib/investorFinance';
import { PendingSaves } from './InvestorFinanceCar';
import Modal from './Modal';
import './carForm/carForm.css';

// inline: shown inside Edit car under Purchase Price, opening in place instead of a second window.
// A loan settlement (paid off to the bank or lender) is only asked for when its switch is on.
// existing: the purchase is recorded but nothing is paid yet, so it can still be changed.
// The server changes the car, the bills and the books together, and refuses once money is paid.
export type RecordedPurchase={priceCents:number;seller:string;lenderCents:number;lenderName:string};
type Saved={car:Record<string,unknown>;payments:Record<string,unknown>[];journals:Record<string,unknown>[];removedPaymentIds?:string[]};
const ringgitText=(cents:number)=>cents>0?(cents%100===0?String(cents/100):(cents/100).toFixed(2)):'';
export default function CompanyPurchaseStart({car,actorId,inline,onSaved,existing}:{car:Car;actorId:string;inline?:boolean;onSaved?:()=>void;existing?:RecordedPurchase}){
 const [open,setOpen]=useState(false),[price,setPrice]=useState(''),[seller,setSeller]=useState(''),[settle,setSettle]=useState(false),[lender,setLender]=useState(''),[lenderName,setLenderName]=useState(''),[error,setError]=useState('');
 const act=useInvestorAction(actorId),slot=existing?`company-purchase-edit:${car.id}`:`car-registration:${car.id}`;
 const openForm=()=>{setError('');setPrice(ringgitText(existing?.priceCents??0));setSeller(existing?.seller??'');setSettle((existing?.lenderCents??0)>0);setLender(ringgitText(existing?.lenderCents??0));setLenderName(existing?.lenderName??'');setOpen(true);};
 const finish=(saved:Saved|null)=>{if(saved&&useStore.getState().currentUser?.id===actorId){useStore.getState().applyCompanyBankPayment(actorId,saved);const gone=saved.removedPaymentIds??[];if(gone.length)useStore.setState(s=>({payments:s.payments.filter(p=>!gone.includes(p.id))}));setOpen(false);onSaved?.();}};
 const purchase=parseRinggit(price),debt=settle?parseRinggit(lender):0;
 const save=async()=>{
  const problem=!purchase?'Type the purchase price.':!seller.trim()?'Type the seller name.':settle&&!debt?'Type the loan amount, or turn off "The car still has a loan".':settle&&!lenderName.trim()?'Type who the loan is paid to.':debt&&debt>purchase?'The loan cannot be more than the purchase price.':'';
  if(problem||!purchase||debt===null){setError(problem);return;}
  if(existing){
   const name=debt>0?lenderName.trim():'';
   if(purchase===existing.priceCents&&debt===existing.lenderCents&&seller.trim()===existing.seller&&name===(existing.lenderCents>0?existing.lenderName:'')){setError('Nothing was changed.');return;}
   setError('');
   finish(await act.run<Saved>(slot,'edit_company_purchase',{carId:car.id,purchaseCents:purchase,sellerName:seller.trim(),lenderCents:debt,...(debt>0?{lenderName:name}:{})},`Change purchase · ${car.make} ${car.model}`));
   return;
  }
  setError('');const row=carToRow({...car,purchasePrice:purchase/100}) as Record<string,unknown>;
  const data={car:existingCarPurchaseFields(row),sellerName:seller.trim(),lenderCents:debt,...(debt>0?{lenderName:lenderName.trim()}:{})};
  finish(await act.run(slot,'register_company_car',data,`Record purchase · ${car.make} ${car.model}`));
 };
 const start=<button type="button" className="g-ghost !w-auto px-6 !border-[rgba(234,184,32,0.55)] !text-[#F2CF5B]" onClick={openForm}>{existing?'Change purchase':'Record purchase'}</button>;
 const body=<div className="flex flex-col gap-3.5">
   <p className="m-0 text-[14px] leading-relaxed text-[#C3C7CF]">{existing?'Nothing is paid on this purchase yet, so it can still change. Saving updates the unpaid bills in Payments and the books together.':'Type the agreed price and who is owed. Saving makes the unpaid bill to the seller (and the lender, if any) in Payments. Pay it from there.'}</p>
   <PendingSaves pending={act.pending.filter(p=>p.slot===slot)} busy={act.busy} onRetry={()=>void act.retry<Saved>(slot).then(finish)} onDiscard={act.discard}/>
   {(error||act.error) && <p role="alert" className="g-error m-0">{error||act.error?.message}</p>}
   <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
    <label className="block"><span className="g-label">Purchase price (RM)</span><input className="g-input g-num" inputMode="decimal" value={price} onChange={e=>setPrice(e.target.value)}/></label>
    <label className="block"><span className="g-label">Seller name</span><input className="g-input" maxLength={150} value={seller} onChange={e=>setSeller(e.target.value)}/></label>
   </div>
   <button type="button" className="g-switch" aria-pressed={settle} onClick={()=>setSettle(v=>!v)}>
    <span className="g-track" aria-hidden="true"/>
    <span><b>The car still has a loan</b><small>Part of the price pays the bank or lender directly</small></span>
   </button>
   {settle&&<div className="g-inset">
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
     <label className="block"><span className="g-label">Pay the loan to</span><input className="g-input" maxLength={150} placeholder="e.g. Public Bank" value={lenderName} onChange={e=>setLenderName(e.target.value)}/></label>
     <label className="block"><span className="g-label">Loan amount (RM)</span><input className="g-input g-num" inputMode="decimal" value={lender} onChange={e=>setLender(e.target.value)}/></label>
    </div>
    {purchase&&debt?<p className="g-help">The seller gets the rest: <span className="g-num text-[#F4F5F7] font-semibold">{formatCents(Math.max(0,purchase-debt))}</span></p>:null}
   </div>}
   <div className="flex flex-wrap items-center gap-3">
    <button type="button" disabled={!!act.busy||act.pending.some(p=>p.slot===slot)} className="g-gold !w-auto px-6" onClick={()=>void save()}>{act.busy?'Saving…':existing?'Save purchase changes':'Save purchase & unpaid bills'}</button>
    {inline&&<button type="button" className="g-ghost !w-auto px-6" disabled={!!act.busy} onClick={()=>setOpen(false)}>Cancel</button>}
   </div>
  </div>;
 if(inline) return <div className="mt-3.5">{open?<div className="rounded-[18px] border border-white/10 bg-black/20 p-4">{body}</div>:start}</div>;
 return <>{start}<Modal isOpen={open} onClose={()=>setOpen(false)} title={existing?'Change car purchase':'Record car purchase'}>{body}</Modal></>;
}
