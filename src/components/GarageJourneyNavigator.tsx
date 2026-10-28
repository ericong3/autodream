import {Check,Wrench,FileText,ShieldCheck,UserCheck,CreditCard,Car,Award,CheckCircle2,ArrowLeft} from 'lucide-react';
import type {PipelineStage,PipelineStageKey} from '../utils/garageWorkOrderTimeline';
import './garage-journey.css';
const ICONS:Record<PipelineStageKey,typeof Wrench>={created:FileText,installation:Wrench,approval:ShieldCheck,inspection:UserCheck,payment:CreditCard,delivery:Car,warranty:Award,closed:CheckCircle2};
const HELP:Record<PipelineStageKey,string>={created:'Order details',installation:'Claim glass and record film',approval:'Garage Head inspection',inspection:'Salesman final inspection',payment:'Deposits, balance and verification',delivery:'Customer handover',warranty:'Warranty registration',closed:'Completed job history'};
// A stage click only changes the panel being viewed, never workflow progress.
export default function GarageJourneyNavigator({stages,selectedKey,onSelect}:{stages:PipelineStage[];selectedKey:PipelineStageKey;onSelect:(key:PipelineStageKey)=>void}){
 const current=stages.find(s=>s.state==='current')??stages[stages.length-1];
 if(!current)return null;
 const allDone=stages.every(s=>s.state==='done');
 return <>
  <div className="gj-bar-heading"><h3>Job progress</h3>{selectedKey!==current.key?<button type="button" onClick={()=>onSelect(current.key)} className="gj-return"><ArrowLeft size={13} aria-hidden="true"/>Back to live step</button>:<span className="gj-progress-label">{allDone?'All stages completed':'Select a step to view'}</span>}</div>
  <nav aria-label="Work order stages"><ol className="gj-steps">{stages.map(s=>{
   const active=s.state==='current',selected=s.key===selectedKey,Icon=ICONS[s.key];
   return <li key={s.key} className="gj-step" data-state={s.state} data-selected={selected}>
    <button type="button" className="gj-step-button" data-stage-key={s.key} onClick={()=>onSelect(s.key)} aria-pressed={selected} aria-current={active?'step':undefined} aria-label={'View '+s.label+(active?', current stage':'')}>
     <span className="gj-step-icon">{s.state==='done'?<Check size={18} strokeWidth={2.3} aria-hidden="true"/>:<Icon size={19} strokeWidth={1.7} aria-hidden="true"/>}</span>
     <span className="gj-step-name">{s.label}</span><span className="gj-step-status">{active?'Current':selected?'Viewing':s.state==='done'?'Done':''}</span>
     <span className="gj-step-tooltip" aria-hidden="true">{HELP[s.key]}</span>
    </button>
   </li>;
  })}</ol></nav>
 </>;
}
