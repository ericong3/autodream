import { useState } from 'react';
import type { Car } from '../types';
import { carToRow, useStore } from '../store';
import { REGISTRATION_KEYS } from '../lib/companyPurchases';
import { parseRinggit, useInvestorAction } from '../lib/investorFinance';
import { PendingSaves } from './InvestorFinanceCar';
import Modal from './Modal';

// inline: shown inside Edit car under Purchase Price, opening in place instead of a second window.
export default function CompanyPurchaseStart({car,actorId,inline,onSaved}:{car:Car;actorId:string;inline?:boolean;onSaved?:()=>void}){
 const [open,setOpen]=useState(false),[price,setPrice]=useState(''),[seller,setSeller]=useState(''),[lender,setLender]=useState('0'),[lenderName,setLenderName]=useState(''),[error,setError]=useState('');
 const act=useInvestorAction(actorId),slot=`car-registration:${car.id}`;
 const finish=(saved:{car:Record<string,unknown>;payments:Record<string,unknown>[];journals:Record<string,unknown>[]} | null)=>{if(saved&&useStore.getState().currentUser?.id===actorId){useStore.getState().applyCompanyBankPayment(actorId,saved);setOpen(false);onSaved?.();}};
 const save=async()=>{
  const purchase=parseRinggit(price),debt=parseRinggit(lender);if(!purchase||debt===null||debt>purchase||!seller.trim()||debt>0&&!lenderName.trim()){setError('Check the purchase price, seller and lender.');return;}
  setError('');const row=carToRow({...car,purchasePrice:purchase/100}) as Record<string,unknown>;
  const data={car:Object.fromEntries(Object.entries(row).filter(([k,v])=>REGISTRATION_KEYS.has(k)&&v!==undefined&&v!==null)),sellerName:seller.trim(),lenderCents:debt,...(debt>0?{lenderName:lenderName.trim()}:{})};
  finish(await act.run(slot,'register_company_car',data,`Record purchase · ${car.make} ${car.model}`));
 };
 const start=<button type="button" className="rounded-lg border border-gold-500/30 text-gold-300 px-4 py-2 text-sm" onClick={()=>setOpen(true)}>Record purchase</button>;
 const body=<div className="space-y-3">
   <p className="text-gray-300 text-sm">Type the agreed price and who is owed. Saving makes the unpaid bill to the seller (and the lender, if any) in the Payments tab. Pay it from there.</p>
   <PendingSaves pending={act.pending.filter(p=>p.slot===slot)} busy={act.busy} onRetry={()=>void act.retry<{car:Record<string,unknown>;payments:Record<string,unknown>[];journals:Record<string,unknown>[]}>(slot).then(finish)} onDiscard={act.discard}/>
   {(error||act.error) && <p role="alert" className="text-red-400 text-sm">{error||act.error?.message}</p>}
   <label className="block text-sm text-gray-300">Purchase price (RM)<input className="input w-full rounded-lg p-2 mt-1" inputMode="decimal" value={price} onChange={e=>setPrice(e.target.value)}/></label>
   <label className="block text-sm text-gray-300">Seller name<input className="input w-full rounded-lg p-2 mt-1" maxLength={150} value={seller} onChange={e=>setSeller(e.target.value)}/></label>
   <label className="block text-sm text-gray-300">Lender balance (RM)<input className="input w-full rounded-lg p-2 mt-1" inputMode="decimal" value={lender} onChange={e=>setLender(e.target.value)}/></label>
   {parseRinggit(lender)!==0&&<label className="block text-sm text-gray-300">Bank or lender name<input className="input w-full rounded-lg p-2 mt-1" maxLength={150} value={lenderName} onChange={e=>setLenderName(e.target.value)}/></label>}
   <div className="flex flex-wrap items-center gap-3">
    <button type="button" disabled={!!act.busy||act.pending.some(p=>p.slot===slot)} className="btn-gold rounded-lg px-4 py-2 text-sm disabled:opacity-40" onClick={()=>void save()}>{act.busy?'Saving…':'Save purchase & unpaid bills'}</button>
    {inline&&<button type="button" className="text-gray-400 underline text-sm min-h-[32px]" disabled={!!act.busy} onClick={()=>setOpen(false)}>Cancel</button>}
   </div>
  </div>;
 if(inline) return <div className="mt-2">{open?<div className="rounded-lg border border-gold-500/30 p-3">{body}</div>:start}</div>;
 return <>{start}<Modal isOpen={open} onClose={()=>setOpen(false)} title="Record car purchase">{body}</Modal></>;
}
