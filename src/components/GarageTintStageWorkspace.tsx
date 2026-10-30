import GarageReferralSummary from './GarageReferralSummary';
import type {ReactNode} from 'react';
import GarageInvoiceGlassWork from './GarageInvoiceGlassWork';
import GarageTintPayments from './GarageTintPayments';
import GarageTintUsage from './GarageTintUsage';
import GarageInstallationReview from './GarageInstallationReview';
import GarageInstallationPhotos from './GarageInstallationPhotos';
import GarageTintAfterSales from './GarageTintAfterSales';
import {GLASS_LABEL,TINT_SERIES} from '../utils/tintPricing';
import type {PipelineStageKey} from '../utils/garageWorkOrderTimeline';
import type {GarageInvoice,GarageTintOrder,GarageTintWorkOrderItem,GarageInvoiceClaim} from '../types';

export default function GarageTintStageWorkspace({stage,invoice,order,items,jobId,claims,orderSummary,action,onChange,onReady,onPayment}:{
 stage:PipelineStageKey;invoice:GarageInvoice;order:GarageTintOrder;items:GarageTintWorkOrderItem[];jobId?:string;claims:GarageInvoiceClaim[];
 orderSummary:ReactNode;action?:ReactNode;onChange:()=>void;onReady:(ready:boolean)=>void;onPayment:()=>void;
}){
 const version=items.map(i=>`${i.id}:${i.updatedAt}:${i.sqft}:${i.usageAttempt}`).join('|');
 return <div className="space-y-5" aria-label={`${stage} work order functions`}>
  <div hidden={stage!=='created'} className="space-y-5">
   {orderSummary}
   <section className="rounded-xl border border-white/10 p-4 space-y-3" aria-label="Ordered glass">
    <h4 className="text-white font-semibold">Ordered glass</h4>
    {[...order.selections,...order.extras].map(s=><p key={s.position} className="flex justify-between gap-3 text-sm text-white/75"><span>{GLASS_LABEL[s.position]??s.position}</span><span>{TINT_SERIES.find(t=>t.key===s.series)?.label} · {s.vlt}</span></p>)}
   </section>
  </div>
  {/* Keep live checks mounted while switching stages so readiness and pending
      inputs survive navigation. Hidden sections do not create extra steps. */}
  <div hidden={stage!=='installation'} className="space-y-5">
   <GarageInvoiceGlassWork key={invoice.id} invoiceId={invoice.id} jobId={jobId} items={items} layout={order.vehicleLayout} workStatus={invoice.workStatus} onChange={onChange}/>
   <GarageTintUsage invoiceId={invoice.id} version={version}/>
   <GarageInstallationPhotos invoiceId={invoice.id} refreshKey={version}/>
  </div>
  <div hidden={!['installation','approval','inspection'].includes(stage)}>
   <GarageInstallationReview invoiceId={invoice.id} ownerId={(invoice.salesOwnerId??invoice.createdBy)} items={items} viewStage={stage} onChange={onChange} onReady={onReady}/>
  </div>

  <div hidden={stage!=='payment'}>
   <GarageTintPayments invoiceId={invoice.id} onChange={onChange}/>
   <GarageReferralSummary invoiceId={invoice.id} version={`${invoice.paymentStatus}:${invoice.paidAt??''}`}/>
  </div>
  {stage==='delivery'&&<section className="rounded-xl border border-white/15 p-5 space-y-4" aria-label="Delivery checks">
   <p className="text-white/70 text-sm">Handover requires Garage Head approval, the salesman’s final inspection, verified payment and reviewed damage reports.</p>
   {invoice.deliveredAt?<p className="text-emerald-300 text-sm">Delivered · {new Date(invoice.deliveredAt).toLocaleString('en-MY')}</p>:action??<p className="text-white/60 text-sm">Complete the outstanding checks before delivery.</p>}
   <button type="button" onClick={onPayment} className="min-h-[44px] border border-gold-400/30 text-gold-300 px-4 py-3 rounded-xl text-sm">Check payment and balance</button>
  </section>}
  {stage==='warranty'&&<section className="rounded-xl border border-white/15 p-5 space-y-4" aria-label="Warranty registration">
   {invoice.warrantyRegisteredAt?<p className="text-emerald-300 text-sm">Warranty registered · {new Date(invoice.warrantyRegisteredAt).toLocaleString('en-MY')}</p>:<><p className="text-white/70 text-sm">Register the warranty after delivery using the existing registration process.</p>{action??<p className="text-white/60 text-sm">Complete delivery before registering the warranty.</p>}</>}
  </section>}
  <div hidden={!['warranty','closed'].includes(stage)}>
   <GarageTintAfterSales invoiceId={invoice.id} claims={claims} onChange={onChange}/>
  </div>
  {stage==='closed'&&<p className="text-white/60 text-sm">This work order’s activity history remains available. Warranty and company replacement claims stay linked to this past purchase.</p>}
 </div>;
}
