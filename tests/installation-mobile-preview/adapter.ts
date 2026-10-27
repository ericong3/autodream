import {useStore} from '../installation-ui/store';
export type InstallationSnapshot={review:any;job:any;history:any[];result?:any};
export type SampleBody='sedan'|'coupe'|'mpv'|'suv'|'van'|'bus';
export type SampleRoof='none'|'single'|'split'|'panoramic';
const bodies:SampleBody[]=['sedan','coupe','mpv','suv','van','bus'];
const roofs:SampleRoof[]=['none','single','split','panoramic'];
const prefix='autodream-vehicle-glass-demo-v5';
let body:SampleBody='sedan';try{const b=localStorage.getItem(prefix+':body');if(bodies.includes(b as SampleBody))body=b as SampleBody;}catch{}
const roofPositions=(r:SampleRoof)=>r==='none'?[]:r==='split'?['front_roof_glass','rear_roof_glass']:r==='single'?['front_roof_glass']:['panoramic_roof_glass'];
const validConfig=(b:SampleBody,r:SampleRoof,n:number)=>roofs.includes(r)&&(b!=='bus'||r==='none')&&Number.isInteger(n)&&(b==='bus'?n>=1&&n<=10:b==='van'?n>=0&&n<=6:n===0);
export const layoutOptions=(b:SampleBody,r:SampleRoof,n:number)=>[...(b==='bus'||b==='van'?['front_windscreen','front_left_window','front_right_window',...Array.from({length:n},(_,i)=>['side_left_'+(i+1),'side_right_'+(i+1)]).flat(),'rear_windscreen']:b==='coupe'?['front_windscreen','front_left_window','front_right_window','rear_left_panel_window','rear_right_panel_window','rear_windscreen']:['front_windscreen','front_left_window','front_right_window','rear_left_window','rear_right_window','rear_left_panel_window','rear_right_panel_window','rear_windscreen']),...(b!=='bus'?roofPositions(r):[])];
const makeItems=(b:SampleBody,r:SampleRoof,n:number)=>layoutOptions(b,r,n).map(glassPosition=>({id:b+'-'+glassPosition,invoiceId:'inv',glassPosition,installerId:null,status:'pending',needsCorrection:false}));
const initial=(b:SampleBody,r:SampleRoof='none',n=b==='bus'?6:b==='van'?3:0)=>({body:b,roof:r,rows:n,review:{invoice_id:'inv',revision:0,state:'working',confirmations:{},head_at:null,sales_at:null},job:{id:'job'},items:makeItems(b,r,n),history:[]});
function load(style:SampleBody){try{const saved=JSON.parse(localStorage.getItem(prefix+':'+style)||'null');if(saved?.body===style&&validConfig(style,saved.roof,saved.rows)&&saved.review&&['working','head','sales','ready','correction_review'].includes(saved.review.state)&&Number.isInteger(saved.review.revision)&&saved.review.revision>=0&&saved.review.confirmations&&typeof saved.review.confirmations==='object'&&!Array.isArray(saved.review.confirmations)&&Array.isArray(saved.history)&&Array.isArray(saved.items)&&saved.items.length>0&&new Set(saved.items.map((p:any)=>p.glassPosition)).size===saved.items.length&&saved.items.every((p:any)=>layoutOptions(style,saved.roof,saved.rows).includes(p.glassPosition)&&p.id===style+'-'+p.glassPosition))return saved;}catch{}return initial(style);}
let state:any=load(body);
const copy=(v:any)=>JSON.parse(JSON.stringify(v));
function save(){try{localStorage.setItem(prefix+':'+body,JSON.stringify(state));localStorage.setItem(prefix+':body',body);}catch{}}
export const sampleItems=()=>copy(state.items);
export const sampleStyle=()=>body;
export const sampleRoof=():SampleRoof=>state.roof;
export const sampleRows=():number=>state.rows;
export const sampleOptions=()=>layoutOptions(body,state.roof,state.rows).map(glassPosition=>({glassPosition,included:state.items.some((p:any)=>p.glassPosition===glassPosition)}));
export const canConfigure=()=>state.review.state==='working'&&!state.items.some((p:any)=>p.installerId)&&!state.history.some((h:any)=>h.action!=='configure');
export function configureSample(selected:string[],config={roof:sampleRoof(),rows:sampleRows()}){if(!canConfigure())throw Error('Glass selection is locked after installation starts.');if(!validConfig(body,config.roof,config.rows))throw Error('Choose a valid vehicle layout.');const allowed=layoutOptions(body,config.roof,config.rows);if(!Array.isArray(selected)||!selected.length)throw Error('Choose at least one glass piece.');if(new Set(selected).size!==selected.length||selected.some(p=>!allowed.includes(p)))throw Error('Choose glass from the current layout.');state.roof=config.roof;state.rows=config.rows;state.items=makeItems(body,config.roof,config.rows).filter(p=>selected.includes(p.glassPosition));state.review.revision++;state.history.push({action:'configure',created_at:new Date().toISOString()});save();}
export function selectSampleRoof(value:SampleRoof){configureSample(layoutOptions(body,value,state.rows),{roof:value,rows:state.rows});}
export function selectSampleRows(value:number){if(body!=='van'&&body!=='bus')throw Error('This vehicle has no passenger window count.');configureSample(layoutOptions(body,state.roof,value),{roof:state.roof,rows:value});}
export function selectSampleStyle(style:SampleBody){if(!bodies.includes(style))throw Error('Choose a vehicle layout.');save();body=style;state=load(style);save();}
export function resetSample(){state=initial(body,state.roof,state.rows);save();}
export async function installationSnapshot():Promise<InstallationSnapshot>{return copy(state);}
export async function installationNotices(){const user=useStore.getState().currentUser,w=state.review;return ((user.role==='garage_head'&&['head','correction_review'].includes(w.state))||(user.id==='sales'&&w.state==='sales'))?[{invoiceId:'inv',jobId:'job',invoiceNumber:'SAMPLE-001',state:w.state,reason:w.reason}]:[];}
export async function installationMutation(action:string,ref:any,extra:any={},revision?:number):Promise<InstallationSnapshot>{
 const user=useStore.getState().currentUser,w=state.review,now=new Date().toISOString();
 if(revision!==undefined&&revision!==w.revision)throw Error('The sample changed. Close this glass and try again.');
 if(action==='claim'){
  const item=state.items.find((i:any)=>i.id===ref.itemId);if(w.state!=='working'||!item||item.status!=='pending'||item.installerId||user.role!=='garage_installer')throw Error('This glass is not available.');item.installerId=user.id;item.status='taken';delete w.confirmations[user.id];
 }else if(action==='complete'){
  const item=state.items.find((i:any)=>i.id===ref.itemId);if(w.state!=='working'||!item||item.installerId!==user.id)throw Error('Only the original installer can finish this piece.');item.status='installed';item.needsCorrection=false;item.completedAt=now;delete w.confirmations[user.id];
 }else if(action==='confirm'){
  const own=state.items.filter((i:any)=>i.installerId===user.id);if(w.state!=='working'||!own.length||own.some((i:any)=>i.status!=='installed'))throw Error('Complete your own glass first.');w.confirmations[user.id]=now;
  if(state.items.every((i:any)=>i.status==='installed'&&w.confirmations[i.installerId]))w.state='head';
 }else if(action==='head_approve'){
  if(user.role!=='garage_head'||w.state!=='head'||extra.value!==true)throw Error('Garage Head must inspect first.');w.state='sales';w.head_at=now;w.head_by=user.id;
 }else if(action==='head_return'){
  if(user.role!=='garage_head'||!['head','correction_review'].includes(w.state)||!extra.reason||!extra.itemIds?.length)throw Error('Garage Head must select the affected glass and give a reason.');
  if(extra.itemIds.some((id:string)=>!state.items.some((i:any)=>i.id===id&&i.installerId)))throw Error('Choose an installed glass.');
  for(const id of extra.itemIds){const item=state.items.find((i:any)=>i.id===id);if(!item)throw Error('Choose a sample glass.');item.status='taken';item.needsCorrection=true;item.completedAt=undefined;}
  w.state='working';w.returnedItemIds=[];w.confirmations={};w.head_at=null;w.sales_at=null;w.reason=extra.reason;
 }else if(action==='sales_approve'||action==='sales_return'){
  if(user.id!=='sales'||w.state!=='sales')throw Error('The salesman must wait for Garage Head approval.');
  if(action==='sales_approve'&&extra.value!==true)throw Error('Confirm the final inspection first.');if(action==='sales_return'&&(!extra.reason||!Array.isArray(extra.itemIds)||!extra.itemIds.length||extra.itemIds.some((id:string)=>!state.items.some((i:any)=>i.id===id))))throw Error('Select the affected glass and describe the problem for Garage Head.');w.state=action==='sales_approve'?'ready':'correction_review';w.sales_at=now;w.sales_by=user.id;w.reason=action==='sales_return'?extra.reason:null;w.returnedItemIds=action==='sales_return'?extra.itemIds:[];
 }else throw Error('This action is not part of the sample.');
 w.revision++;state.history.push({id:w.revision,actor_id:user.id,action,details:{reason:extra.reason,value:extra.value},created_at:now});save();return copy(state);
}
