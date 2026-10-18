// One-way, confirmed handoff from the building sketch to the full workflow draft. Pure helpers: callers pass storage in.
// Never touches a signed or progressed workflow, never mutates the sketch, and keeps a backup of whatever it replaces.
export const SKETCH_KEY='autodream-building-sketch-v1',WORKFLOW_KEY='autodream-building-review-v3',BACKUP_KEY='autodream-building-review-v3-backups';
const MAX_BACKUPS=5,WALLS=['N','E','S','W'];
const positive=v=>typeof v==='number'&&Number.isFinite(v)&&v>0;
const list=v=>Array.isArray(v)?v:[];
const plural=(n,word)=>n+' '+word+(n===1?'':'s');

// Reference and shape checks the workflow relies on. Returns a list of problems; empty means usable.
export function validateSketch(BL,s){
 if(!s||typeof s!=='object')return['Sketch is empty.'];
 if(s.schema!==1)return['Sketch format is not supported.'];
 const errors=[],need=(ok,msg)=>{if(!ok)errors.push(msg);};
 if(s.agreement)return['This sketch is signed. Signed sketches cannot be sent.'];
 for(const k of['floors','zones','rooms','assemblies','milestones'])need(Array.isArray(s[k]),'Sketch is missing '+k+'.');
 need(s.project&&typeof s.project==='object'&&BL.USERS[s.project.salesman],'Sketch project details are incomplete.');
 need(s.quote&&Array.isArray(s.quote.versions),'Sketch quote versions are missing.');
 if(errors.length)return errors;
 const unique=(items,what)=>{const ids=items.map(x=>x?.id);need(ids.every(id=>typeof id==='string'&&id),what+' without an ID.');need(new Set(ids).size===ids.length,'Duplicate '+what.toLowerCase()+' IDs.');return new Set(ids);};
 const floors=unique(s.floors,'Floor'),zones=unique(s.zones,'Zone'),rooms=unique(s.rooms,'Room');unique(s.assemblies,'Window');unique(s.milestones,'Milestone');
 for(const r of s.rooms){need(floors.has(r.floorId),'Room '+r.id+' is on an unknown floor.');need(zones.has(r.zoneId),'Room '+r.id+' has an unknown zone.');need(positive(r.w)&&positive(r.d),'Room '+r.id+' needs a size.');}
 const paneIds=new Set();
 for(const a of s.assemblies){
  need(rooms.has(a.roomId),'Window '+a.id+' is in an unknown room.');need(WALLS.includes(a.wall),'Window '+a.id+' has no wall.');need(BL.SERIES[a.series],'Window '+a.id+' has an unknown film.');
  need(Array.isArray(a.panels)&&a.panels.length,'Window '+a.id+' has no panes.');
  for(const p of list(a.panels)){need(typeof p.id==='string'&&!paneIds.has(p.id),'Pane '+p.id+' is duplicated or unnamed.');paneIds.add(p.id);need(positive(p.w)&&positive(p.h),'Pane '+p.id+' needs a size.');if(p.shape==='custom')need(Number.isFinite(p.verifiedSqft)&&p.verifiedSqft>=0,'Pane '+p.id+' has an invalid verified area.');}
  if(a.span)need(floors.has(a.span.from)&&floors.has(a.span.to),'Tall glass '+a.id+' spans an unknown floor.');
 }
 for(const m of s.milestones)need(Number.isFinite(m.amount)&&m.amount>=0&&m.trigger&&m.unlocks,'Milestone '+m.id+' is incomplete.');
 const extra=downstreamActivity(s);if(extra.length)errors.push('Sketch already has workflow records: '+extra.join(', ')+'.');
 return errors;
}

// Anything past the quote stage. A draft with any of these is never replaced.
export function downstreamActivity(s){
 const found=[],has=(cond,label)=>{if(cond)found.push(label);};
 has(s.agreement,'signed agreement');has(s.project?.mwo,'job number');
 has(Object.keys(s.pieces||{}).length,'cutting records');has(list(s.bundles).length,'bundles');
 has(list(s.milestones).some(m=>m.dueAt||m.requestSentAt||list(m.proofs).length||list(m.receipts).length||m.verified),'payment activity');
 has(list(s.team?.members).length||list(s.team?.presence).length||s.team?.targets,'site team');
 has(list(s.stock?.ledger).length||list(s.stock?.offcuts).length||list(s.stock?.discrepancies).length,'stock activity');
 for(const [k,label]of[['photos','site photos'],['wastage','wastage'],['amendments','amendments'],['losses','losses'],['exceptions','exceptions'],['cash','cash records'],['corrections','corrections']])has(list(s[k]).length,label);
 has(s.cancellation,'cancellation');has(s.delegation,'handover delegation');has(s.handover,'handover');
 return found;
}

export function draftCounts(BL,s){return{rooms:list(s?.rooms).length,windows:list(s?.assemblies).length,panes:list(s?.assemblies).reduce((n,a)=>n+list(a.panels).length,0),versions:list(s?.quote?.versions).length};}
const countText=c=>plural(c.rooms,'room')+' · '+plural(c.windows,'window')+' · '+plural(c.panes,'pane')+' · '+plural(c.versions,'saved version');

export function readWorkflowSlot(raw){
 if(raw===null||raw===undefined)return{kind:'empty'};
 try{const w=JSON.parse(raw);if(w&&w.v===1&&w.state&&w.state.schema===1)return{kind:'draft',wrapper:w,state:w.state};}catch{}
 return{kind:'unreadable'};
}

export function planHandoff(BL,sketch,raw){
 const problems=validateSketch(BL,sketch);if(problems.length)return{ok:false,error:problems[0]};
 const slot=readWorkflowSlot(raw);
 if(slot.kind==='draft'){const busy=downstreamActivity(slot.state);if(busy.length)return{ok:false,error:'The full workflow has '+busy.join(', ')+'. It was not replaced.'};}
 return{ok:true,slot:slot.kind,before:slot.kind==='draft'?draftCounts(BL,slot.state):null,after:draftCounts(BL,sketch)};
}

export function handoffMessage(plan){
 const current=plan.slot==='empty'?'Current draft: none saved.':plan.slot==='unreadable'?'Current draft: unreadable data.':'Current draft: '+countText(plan.before)+'.';
 return 'Replace the local full workflow draft only?\n\n'+current+'\nFrom sketch: '+countText(plan.after)+'.\n\nThe current draft is backed up in this browser first. Nothing is sent anywhere. Prices and amounts are copied as they are.';
}

// The sketch is copied, never shared; the copy records where it came from.
export function buildWorkflowWrapper(sketch,iso){
 const state=JSON.parse(JSON.stringify(sketch));
 state.context={source:'sketch',sketchKey:SKETCH_KEY,handedOffAt:iso};
 state.audit=[{at:iso,by:state.project.salesman,role:'salesman',text:'Loaded from building sketch · replaced local draft'},...list(state.audit)];
 return{v:1,state,actor:state.project.salesman,tab:'Quote'};
}

// expectedRaw is the slot as it was when the user confirmed. Any change since then aborts without writing.
export function commitHandoff(storage,BL,sketch,expectedRaw,iso){
 try{
  const current=storage.getItem(WORKFLOW_KEY);
  if(current!==expectedRaw)return{ok:false,error:'The full workflow draft changed after you confirmed. Nothing was replaced.'};
  const plan=planHandoff(BL,sketch,current);if(!plan.ok)return plan;
  let backups=[];
  if(current!==null){
   const stored=storage.getItem(BACKUP_KEY);
   if(stored!==null){try{backups=JSON.parse(stored);}catch{backups=null;}if(!Array.isArray(backups))return{ok:false,error:'The draft backup slot is unreadable. Nothing was replaced.'};}
   const next=JSON.stringify([{at:iso,counts:plan.before,raw:current},...backups].slice(0,MAX_BACKUPS));
   storage.setItem(BACKUP_KEY,next);
   if(storage.getItem(BACKUP_KEY)!==next)return{ok:false,error:'Could not back up the current draft. Nothing was replaced.'};
  }
  const raw=JSON.stringify(buildWorkflowWrapper(sketch,iso));
  storage.setItem(WORKFLOW_KEY,raw);
  if(storage.getItem(WORKFLOW_KEY)!==raw)return{ok:false,error:'The workflow draft could not be saved. Check the backup before retrying.'};
  return{ok:true,raw,backedUp:current!==null};
 }catch(err){return{ok:false,error:'Browser storage refused the change ('+err.message+'). Nothing further was written.'};}
}

// Name and address only. A changed address un-confirms the site pin rather than keeping a confirmation for a different place.
export function editProjectDetails(state,{title,customer,address},iso){
 if(state.agreement)throw Error('Signed projects cannot be edited here.');
 const clean=v=>String(v??'').trim(),next=JSON.parse(JSON.stringify(state)),p=next.project,changes=[];
 const t=clean(title),c=clean(customer),a=clean(address);
 if(!c)throw Error('Enter the customer name.');if(!a)throw Error('Enter the site address.');
 if(t&&t!==p.title){p.title=t;changes.push('project name');}
 if(c!==p.customer){p.customer=c;changes.push('customer');}
 if(a!==p.address){p.address=a;changes.push('address');if(p.pin?.confirmed){Object.assign(p.pin,{confirmed:false,by:null,at:null});changes.push('site pin needs confirming again');}}
 if(changes.length)next.audit=[{at:iso,by:p.salesman,role:'salesman',text:'Project details updated · '+changes.join(', ')},...list(next.audit)];
 return{state:next,changed:changes.length>0};
}

// Unchecked panes recorded with a saved version, or null when the version predates measurement flags.
export function versionUnchecked(v){const m=v?.measurement;return m&&Number.isFinite(m.approx)&&Number.isFinite(m.unknown)?{total:m.approx+m.unknown,approx:m.approx,unknown:m.unknown}:null;}
