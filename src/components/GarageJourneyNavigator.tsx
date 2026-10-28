import {Check,ArrowRight,Wrench,FileText,ShieldCheck,UserCheck,CreditCard,Car,Award,CheckCircle2,ChevronDown} from 'lucide-react';
import {useState} from 'react';
import type {PipelineStage,PipelineStageKey} from '../utils/garageWorkOrderTimeline';
import './garage-journey.css';

const CHAPTERS:{key:string;number:string;name:string;description:string;stages:PipelineStageKey[]}[]=[
 {key:'workshop',number:'I',name:'Workshop',description:'Arrival, installation and Head approval',stages:['created','installation','approval']},
 {key:'checks',number:'II',name:'Final checks',description:'Inspection and customer payment',stages:['inspection','payment']},
 {key:'handover',number:'III',name:'Handover',description:'Delivery, warranty and completion',stages:['delivery','warranty','closed']},
];
const ICONS:Record<PipelineStageKey,typeof Wrench>={created:FileText,installation:Wrench,approval:ShieldCheck,inspection:UserCheck,payment:CreditCard,delivery:Car,warranty:Award,closed:CheckCircle2};

// Navigation only: the live stage remains distinct from the stage being viewed.
export default function GarageJourneyNavigator({stages,selectedKey,onSelect,onPayment}:{stages:PipelineStage[];selectedKey:PipelineStageKey;onSelect:(key:PipelineStageKey)=>void;onPayment?:()=>void}){
 const [mobileExpansion,setMobileExpansion]=useState<{selection:PipelineStageKey;chapter:string|null}|null>(null);
 const expandedChapter=mobileExpansion?.selection===selectedKey?mobileExpansion.chapter:CHAPTERS.find(c=>c.stages.includes(selectedKey))?.key;
 const selectStage=(key:PipelineStageKey)=>{setMobileExpansion(null);onSelect(key);};
 const current=stages.find(s=>s.state==='current')??stages[stages.length-1];
 if(!current)return null;
 const currentIndex=stages.indexOf(current),allDone=stages.every(s=>s.state==='done'),CurrentIcon=ICONS[current.key];
 return <>
  <header className="gj-header">
   <div className="gj-current">
    <span className="gj-current-icon"><CurrentIcon size={25} strokeWidth={1.6} aria-hidden="true"/></span>
    <div><h3 className="gj-title">Work order journey</h3><div className="gj-current-title">{current.label}<span className="gj-live-label">{allDone?'Complete':'In progress'}</span></div><p className="gj-subtitle">{allDone?'All stages completed':`Stage ${currentIndex+1} of ${stages.length}`}{!allDone&&current.responsible?` · ${current.responsible}`:''}</p></div>
   </div>
   <div className="gj-header-actions">
    {selectedKey!==current.key&&<button type="button" onClick={()=>selectStage(current.key)} className="gj-return">Return to {current.label.toLowerCase()}<ArrowRight size={14} aria-hidden="true"/></button>}
    {onPayment&&<button type="button" onClick={()=>{setMobileExpansion(null);onPayment();}} className="gj-payment"><CreditCard size={16} aria-hidden="true"/><span>Deposit &amp; balance</span><ArrowRight size={15} aria-hidden="true"/></button>}
   </div>
  </header>
  <nav className="gj-chapters" aria-label="Work order stages">
   {CHAPTERS.map(chapter=>{
    const list=chapter.stages.map(key=>stages.find(s=>s.key===key)).filter((s):s is PipelineStage=>!!s);
    if(!list.length)return null;
    const expanded=expandedChapter===chapter.key,chapterDone=list.every(s=>s.state==='done'),containsCurrent=list.some(s=>s.state==='current');
    return <div className="gj-chapter" key={chapter.key} data-expanded={expanded} data-current={containsCurrent}>
     <div className="gj-chapter-heading"><span className="gj-chapter-number">{chapter.number}</span><div><h4>{chapter.name}</h4><p>{chapter.description}</p></div></div>
     <button type="button" className="gj-mobile-chapter" aria-expanded={expanded} aria-controls={`journey-${chapter.key}`} onClick={()=>setMobileExpansion({selection:selectedKey,chapter:expanded?null:chapter.key})}><span className="gj-chapter-number">{chapter.number}</span><span>{chapter.name}</span>{chapterDone?<Check size={16} aria-hidden="true"/>:containsCurrent?<span className="gj-mobile-now">Current</span>:null}<ChevronDown size={16} aria-hidden="true"/></button>
     <ol id={`journey-${chapter.key}`} className="gj-stage-list">
      {list.map(s=>{const selected=s.key===selectedKey,active=s.state==='current',Icon=ICONS[s.key];
       return <li key={s.key} className="gj-stage" data-state={s.state} data-selected={selected}>
        <button type="button" className="gj-stage-button" aria-pressed={selected} aria-current={active?'step':undefined} data-stage-key={s.key} onClick={()=>selectStage(s.key)}>
         <span className="gj-stage-mark">{s.state==='done'?<Check size={16} strokeWidth={2.3} aria-hidden="true"/>:<Icon size={18} strokeWidth={1.6} aria-hidden="true"/>}</span>
         <span className="gj-stage-copy"><span className="gj-stage-name">{s.label}{active&&<span className="gj-now">Now</span>}</span><span className="gj-stage-detail">{s.state==='done'?(s.by||'Completed'):active?(s.by||'Work in progress'):s.key==='payment'?'Deposit or balance anytime':'Not started'}</span></span>
         {selected&&!active&&<span className="gj-viewing">Viewing<ArrowRight size={13} aria-hidden="true"/></span>}
        </button>
       </li>;
      })}
     </ol>
    </div>;
   })}
  </nav>
  <footer className="gj-footer"><span className="gj-status-key"><span/>Current stage</span><span>Select a stage to view its details.</span></footer>
 </>;
}
