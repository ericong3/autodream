import {useEffect,useRef,useState} from 'react';
import {Plus,Copy,Users,CalendarDays,Gift,CheckCircle2} from 'lucide-react';
import {useStore} from '../store';
import Modal from '../components/Modal';
import PayrollTabs from '../components/PayrollTabs';
import {formatRM} from '../utils/format';
import {bonusCampaignRequest,campaignView,campaignMonths,malaysiaMonth,type BonusCampaign,type BonusCampaignDraft,type BonusParticipant,type BonusResult,type CampaignView} from '../lib/bonusCampaigns';
type Pending={action:'save'|'publish'|'confirm_month';data:Record<string,unknown>};
const input='w-full min-h-[44px] bg-obsidian-800 border border-white/15 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gold-400';
const labelMonth=(value:string)=>new Date(value+'-15T12:00:00Z').toLocaleDateString('en-MY',{month:'short',year:'numeric',timeZone:'Asia/Kuala_Lumpur'});
const draftFor=(month:string):BonusCampaignDraft=>({title:'',startMonth:month,endMonth:month,minimumUnits:6,amountPerUnit:500,participantIds:[]});
export default function BonusCampaigns(){
 const actor=useStore(s=>s.currentUser?.id),role=useStore(s=>s.currentUser?.role),canManage=role==='director',currentMonth=malaysiaMonth();
 const [campaigns,setCampaigns]=useState<BonusCampaign[]>([]),[people,setPeople]=useState<BonusParticipant[]>([]),[enabled,setEnabled]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[page,setPage]=useState(0),[hasMore,setHasMore]=useState(false);
 const [view,setView]=useState<CampaignView>('active'),[editing,setEditing]=useState<BonusCampaign|null>(null),[form,setForm]=useState<BonusCampaignDraft>(draftFor(currentMonth)),[formOpen,setFormOpen]=useState(false);
 const [busy,setBusy]=useState(false),[pending,setPending]=useState<Pending|null>(null),[notice,setNotice]=useState('');
 const [selected,setSelected]=useState<BonusCampaign|null>(null),[month,setMonth]=useState(currentMonth),[result,setResult]=useState<BonusResult|null>(null),[resultLoading,setResultLoading]=useState(false),[resultError,setResultError]=useState(''),[confirmation,setConfirmation]=useState<BonusResult|null>(null);
 const epoch=useRef(0),readEpoch=useRef(0),previewEpoch=useRef(0),lock=useRef(false),pendingRef=useRef<Pending|null>(null);
 const key=actor?`autodream-bonus-pending:${actor}`:'';
 async function load(nextPage=0){
  const mine=epoch.current,read=++readEpoch.current;setLoading(true);setError('');
  try{const r=await bonusCampaignRequest<{enabled:boolean;campaigns:BonusCampaign[];participants:BonusParticipant[];hasMore:boolean}>('list',{page:nextPage});
   if(mine!==epoch.current||read!==readEpoch.current)return;
   setEnabled(r.enabled);setPeople(r.participants);setHasMore(r.hasMore);setPage(nextPage);setCampaigns(old=>nextPage?[...new Map([...old,...r.campaigns].map(c=>[c.id,c])).values()]:r.campaigns);setSelected(old=>old?r.campaigns.find(c=>c.id===old.id)??old:null);
  }catch(e){if(mine===epoch.current&&read===readEpoch.current)setError((e as Error).message);}
  finally{if(mine===epoch.current&&read===readEpoch.current)setLoading(false);}
 }
 useEffect(()=>{epoch.current++;readEpoch.current++;previewEpoch.current++;lock.current=false;pendingRef.current=null;setPending(null);setBusy(false);setCampaigns([]);setPeople([]);setEnabled(false);setFormOpen(false);setSelected(null);setResult(null);setConfirmation(null);setNotice('');
  try{const raw=key?localStorage.getItem(key):null;if(raw){const saved=JSON.parse(raw) as Pending;if(!['save','publish','confirm_month'].includes(saved.action)||typeof saved.data?.requestId!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(saved.data.requestId))throw Error();pendingRef.current=saved;setPending(saved);}}
  catch{setError('A previous save could not be read. Ask a director to check it before creating another campaign.');return;}
  if(actor)void load();return()=>{epoch.current++;readEpoch.current++;previewEpoch.current++;};
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[actor]);
 async function preview(c:BonusCampaign,m:string){
  const mine=epoch.current,read=++previewEpoch.current;setResult(null);setResultLoading(true);setResultError('');
  try{const r=await bonusCampaignRequest<BonusResult>('preview',{id:c.id,month:m});if(mine===epoch.current&&read===previewEpoch.current)setResult(r);}
  catch(e){if(mine===epoch.current&&read===previewEpoch.current)setResultError((e as Error).message);}
  finally{if(mine===epoch.current&&read===previewEpoch.current)setResultLoading(false);}
 }
 function openResult(c:BonusCampaign){const m=currentMonth<c.startMonth?c.startMonth:currentMonth>c.endMonth?c.endMonth:currentMonth;setSelected(c);setMonth(m);void preview(c,m);}
 async function mutate(action:Pending['action'],data:Record<string,unknown>){
  if(lock.current||!actor||!canManage)return;const mine=epoch.current,storageKey=key;
  let operation=pendingRef.current;
  if(!operation){operation={action,data:{...data,requestId:crypto.randomUUID()}};try{localStorage.setItem(storageKey,JSON.stringify(operation));}catch{setError('Could not keep the save reference. Free some browser storage before trying again.');return;}pendingRef.current=operation;setPending(operation);}
  lock.current=true;setBusy(true);setError('');setNotice('');
  try{const response=await bonusCampaignRequest<{id?:string}&Partial<BonusResult>>(operation.action,operation.data);
   if(mine!==epoch.current)return;
   localStorage.removeItem(storageKey);pendingRef.current=null;setPending(null);setFormOpen(false);setConfirmation(null);setNotice(operation.action==='confirm_month'?'Monthly bonus confirmed. It is recorded separately from payments and existing payslips.':operation.action==='publish'?'Campaign published. Its rules and enrolment are now fixed.':'Draft saved. Enrolment and rules can be changed before publishing.');
   if(operation.action==='confirm_month'&&response.campaignId)setResult(response as BonusResult);
   await load();
   if(operation.action==='publish'&&selected)void preview(selected,month);
  }catch(e){if(mine!==epoch.current)return;const code=(e as {code?:string}).code;
   if(['INVALID','FORBIDDEN','NOT_ALLOWED','REVISION_CONFLICT','PUBLISHED_LOCKED','PREVIEW_CHANGED','DELIVERY_REVIEW_REQUIRED','FUTURE_MONTH'].includes(code??'')){localStorage.removeItem(storageKey);pendingRef.current=null;setPending(null);setConfirmation(null);if(selected)void preview(selected,month);}
   setError((e as Error).message);
  }finally{if(mine===epoch.current){lock.current=false;setBusy(false);}}
 }
 function openForm(c?:BonusCampaign,copy=false){setEditing(copy?null:c??null);setForm(c?{title:copy?`${c.title} (copy)`:c.title,startMonth:c.startMonth,endMonth:c.endMonth,minimumUnits:c.minimumUnits,amountPerUnit:c.amountPerUnit,participantIds:c.participants.filter(p=>people.some(eligible=>eligible.id===p.id)).map(p=>p.id)}:{...draftFor(currentMonth),participantIds:people.map(p=>p.id)});setFormOpen(true);setError('');}
 const visible=campaigns.filter(c=>campaignView(c,currentMonth)===view),writeBlocked=busy||!!pending||!canManage;
 return <div className="space-y-5">
  <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="flex items-center gap-2 text-xl font-bold text-white"><Gift size={20} className="text-gold-400"/>Bonus Campaigns</h1><p className="text-white/45 text-sm mt-1">Set the rules once. Follow each month’s progress.</p></div><button type="button" disabled={!enabled||writeBlocked} onClick={()=>openForm()} className="btn-gold min-h-[44px] px-4 py-2 rounded-xl text-sm flex items-center gap-2 disabled:opacity-40"><Plus size={16}/>New campaign</button></header>
  <PayrollTabs/>
  {error&&<p role="alert" className="rounded-xl border border-red-400/30 bg-red-400/5 p-4 text-red-200 text-sm">{error}</p>}
  {notice&&<p role="status" className="rounded-xl border border-emerald-400/20 p-4 text-emerald-200 text-sm">{notice}</p>}
  {pending&&<div className="rounded-xl border border-amber-400/30 p-4 text-amber-200 text-sm flex flex-wrap items-center justify-between gap-3"><p>A previous save needs checking before another change.</p><button type="button" disabled={busy} onClick={()=>void mutate(pending.action,pending.data)} className="min-h-[44px] border border-amber-400/40 rounded-lg px-3 disabled:opacity-40">{busy?'Checking…':'Retry original save'}</button></div>}
  {!loading&&!enabled&&!error&&<p className="text-amber-200 border border-amber-400/20 p-4 rounded-xl text-sm">Bonus Campaigns is prepared but has not been activated. Existing payroll is unchanged.</p>}
  <div role="tablist" aria-label="Campaign status" className="flex gap-2">
   {(['active','upcoming','completed'] as CampaignView[]).map(tab=><button role="tab" aria-selected={view===tab} key={tab} onClick={()=>{setView(tab);setSelected(null);previewEpoch.current++;}} className={`min-h-[44px] rounded-lg px-3 sm:px-4 text-sm border ${view===tab?'border-gold-400/50 text-gold-300 bg-gold-400/10':'border-white/10 text-white/50 hover:text-white'}`}>{tab[0].toUpperCase()+tab.slice(1)}</button>)}
  </div>
  {loading&&!campaigns.length?<p className="text-white/50 py-8 text-center">Loading campaigns…</p>:enabled&&<section aria-label={`${view} campaigns`} className="space-y-3">
   {!visible.length&&<div className="border border-dashed border-white/15 rounded-xl px-5 py-9 text-center"><p className="text-white/70">No {view} campaigns yet.</p>{view!=='completed'&&<p className="text-white/40 text-sm mt-2">Create a campaign and enrol the salespeople who will share its bonus.</p>}</div>}
   {visible.map(c=><article key={c.id} className="border border-white/10 rounded-xl bg-white/[0.025] p-4 sm:p-5 space-y-3">
    <div className="flex flex-wrap justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-white font-semibold">{c.title}</h2>{!c.publishedAt&&<span className="text-xs text-amber-300 border border-amber-400/30 rounded-full px-2 py-0.5">Draft</span>}</div><p className="text-white/45 text-xs mt-2 flex items-center gap-1.5"><CalendarDays size={13}/>{labelMonth(c.startMonth)} – {labelMonth(c.endMonth)} · calculated monthly</p></div><p className="text-gold-300 font-semibold text-sm">{formatRM(c.amountPerUnit)} / qualifying unit</p></div>
    <p className="text-white/70 text-sm">At least <strong className="text-white">{c.minimumUnits} company-owned deliveries</strong> in a month unlocks the bonus on every qualifying unit.</p>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3"><p className="flex items-center gap-2 text-white/45 text-xs"><Users size={14}/>{c.participants.length} enrolled · equal split</p><div className="flex flex-wrap gap-2">
     <button type="button" onClick={()=>openResult(c)} className="min-h-[44px] border border-white/15 rounded-lg px-3 text-sm text-white/80">{view==='completed'?'View results':'View progress'}</button>
     {!c.publishedAt&&<><button type="button" disabled={writeBlocked} onClick={()=>openForm(c)} className="min-h-[44px] px-3 text-sm text-white/60 disabled:opacity-40">Edit draft</button><button type="button" disabled={writeBlocked} onClick={()=>{setSelected(c);setConfirmation(null);setNotice('Review the rules and enrolled salespeople below before publishing.');openResult(c);}} className="min-h-[44px] px-3 text-sm text-gold-300 disabled:opacity-40">Review & publish</button></>}
     <button type="button" disabled={writeBlocked} onClick={()=>openForm(c,true)} className="min-h-[44px] px-3 text-sm text-white/45 disabled:opacity-40 flex items-center gap-1"><Copy size={14}/>Copy</button>
    </div></div>
   </article>)}
   {hasMore&&<button type="button" disabled={loading} onClick={()=>void load(page+1)} className="min-h-[44px] text-gold-300 px-4 border border-white/15 rounded-lg">Load more campaigns</button>}
  </section>}
  {selected&&<section aria-label="Monthly campaign result" className="border border-gold-400/25 rounded-xl p-4 sm:p-5 space-y-4">
   <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-white font-semibold">{selected.title}</h2><label className="text-sm text-white/60 flex items-center gap-2">Month<select aria-label="Result month" value={month} onChange={e=>{setMonth(e.target.value);void preview(selected,e.target.value);}} className={input}>{campaignMonths(selected).map(m=><option key={m} value={m}>{labelMonth(m)}</option>)}</select></label></div>
   <p className="text-white/50 text-sm">Enrolled: {selected.participants.map(p=>p.name).join(', ')}.</p>
   {!selected.publishedAt&&<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-400/20 p-3"><p className="text-amber-200 text-sm">Publishing fixes these rules and enrolled salespeople. Other published campaigns add their own bonuses.</p><button type="button" disabled={writeBlocked} onClick={()=>void mutate('publish',{id:selected.id,revision:selected.revision})} className="btn-gold px-4 py-2 rounded-lg min-h-[44px] disabled:opacity-40">Publish campaign</button></div>}
   {resultLoading?<p className="text-white/50 text-sm">Checking deliveries…</p>:resultError?<p role="alert" className="text-amber-200 text-sm">{resultError}</p>:result&&<>
    <div className="grid grid-cols-2 gap-4 border-y border-white/10 py-4"><div><p className="text-white text-xl font-semibold">{result.units} <span className="text-white/35 text-sm">/ {result.minimumUnits} target</span></p><p className="text-white/40 text-xs mt-1">Qualifying deliveries</p></div><div><p className="text-gold-300 text-xl font-semibold">{formatRM(result.pool)}</p><p className="text-white/40 text-xs mt-1">{result.confirmed?'Confirmed bonus pool':'Estimated bonus pool'}</p></div></div>
    {!result.qualified&&<p className="text-white/55 text-sm">{Math.max(0,result.minimumUnits-result.units)} more qualifying deliveries needed. The pool stays RM0 until the target is met.</p>}
    <ul className="divide-y divide-white/5">{result.shares.map(p=><li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm"><span className="text-white/70">{p.name}</span><span className="text-white">{formatRM(p.amount)}</span></li>)}</ul>
    {!!result.issues.length&&<div className="border border-amber-400/25 rounded-lg p-3 text-sm text-amber-200"><p>Check these delivery records before confirming:</p><ul className="mt-2 space-y-1">{result.issues.map(i=><li key={i.id}>{i.label}: {i.reason}</li>)}</ul></div>}
    <details className="text-white/50 text-xs"><summary className="cursor-pointer min-h-[36px] py-2">Qualifying units ({result.cars.length})</summary><ul className="space-y-1">{result.cars.map(c=><li key={c.id}>{c.label}</li>)}</ul></details>
    {result.confirmed?<p className="text-emerald-300 text-sm flex items-center gap-2"><CheckCircle2 size={16}/>Confirmed · {new Date(result.confirmedAt!).toLocaleString('en-MY')} · result kept unchanged</p>:selected.publishedAt&&<div className="flex flex-wrap items-center justify-between gap-3"><p className="text-white/45 text-xs">Confirm after the month ends. This saves the bonus breakdown; it does not pay staff or change existing payslips.</p><button type="button" disabled={writeBlocked||month>=currentMonth||!!result.issues.length} onClick={()=>setConfirmation(result)} className="btn-gold px-4 min-h-[44px] rounded-lg text-sm disabled:opacity-40">Confirm monthly result</button></div>}
   </>}
  </section>}
  <Modal isOpen={formOpen} onClose={()=>{if(!writeBlocked)setFormOpen(false);}} title={editing?'Edit bonus campaign':'New bonus campaign'} maxWidth="max-w-xl">
   <form onSubmit={e=>{e.preventDefault();void mutate('save',{...(editing?{id:editing.id,revision:editing.revision}:{}),campaign:form});}} className="space-y-4">
    {error&&<p role="alert" className="text-red-200 text-sm">{error}</p>}
    {!editing&&<button type="button" disabled={writeBlocked} onClick={()=>setForm({...form,title:'Year-end 2026',startMonth:'2026-10',endMonth:'2026-12',minimumUnits:6,amountPerUnit:500})} className="text-gold-300 text-sm min-h-[44px]">Use year-end 2026 rules</button>}
    <label className="block text-sm text-white/60 space-y-2"><span>Campaign name</span><input required maxLength={120} disabled={writeBlocked} value={form.title} onChange={e=>setForm({...form,title:e.target.value})} className={input}/></label>
    <div className="grid grid-cols-2 gap-3">{(['startMonth','endMonth'] as const).map(k=><label key={k} className="text-sm text-white/60 space-y-2"><span>{k==='startMonth'?'First month':'Last month'}</span><input required disabled={writeBlocked} type="month" value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})} className={input}/></label>)}</div>
    <div className="grid grid-cols-2 gap-3"><label className="text-sm text-white/60 space-y-2"><span>Minimum monthly units</span><input required disabled={writeBlocked} type="number" min={1} max={10000} step={1} value={form.minimumUnits} onChange={e=>setForm({...form,minimumUnits:Number(e.target.value)})} className={input}/></label><label className="text-sm text-white/60 space-y-2"><span>Bonus per unit (RM)</span><input required disabled={writeBlocked} type="number" min={0} max={100000} step="0.01" value={form.amountPerUnit} onChange={e=>setForm({...form,amountPerUnit:Number(e.target.value)})} className={input}/></label></div>
    <p className="text-white/45 text-xs">Company-owned delivered units only. Once the target is met, every qualifying unit adds to the pool, split equally below.</p>
    <fieldset disabled={writeBlocked} className="border border-white/10 rounded-lg p-3"><legend className="text-white/70 text-sm px-1">Enrolled Used Car salespeople</legend>{people.map(p=><label key={p.id} className="flex items-center gap-3 min-h-[44px] text-white/70 text-sm"><input type="checkbox" checked={form.participantIds.includes(p.id)} onChange={e=>setForm({...form,participantIds:e.target.checked?[...form.participantIds,p.id]:form.participantIds.filter(id=>id!==p.id)})}/>{p.name}</label>)}{!people.length&&<p className="text-amber-200 text-sm">No eligible salespeople. Check their staff access first.</p>}</fieldset>
    <button type="submit" disabled={busy||!form.participantIds.length} className="btn-gold rounded-lg w-full min-h-[44px] disabled:opacity-40">{busy?'Saving…':pending?'Retry original save':'Save draft'}</button>
   </form>
  </Modal>
  <Modal isOpen={!!confirmation} onClose={()=>{if(!busy)setConfirmation(null);}} title="Confirm monthly bonus">
   {confirmation&&<div className="space-y-4 text-sm text-white/70">{error&&<p role="alert" className="text-red-200">{error}</p>}<p>Keep the {labelMonth(confirmation.month)} bonus breakdown of <strong className="text-white">{formatRM(confirmation.pool)}</strong> for {confirmation.shares.length} enrolled salespeople?</p><p className="text-white/45">Later rule or sales changes will not rewrite this confirmed result. No payment or payslip is created.</p><button type="button" disabled={busy} onClick={()=>void mutate('confirm_month',{id:confirmation.campaignId,month:confirmation.month,previewHash:confirmation.previewHash})} className="btn-gold rounded-lg w-full min-h-[44px] disabled:opacity-40">{busy?'Confirming…':pending?'Retry original confirmation':'Confirm result'}</button></div>}
  </Modal>
 </div>;
}
