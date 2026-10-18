// Review-only workflow. No production services or customer records.
export function initialCar() {
  return {version:1,confirmed:false,checkin:[],checkinOwner:'',confirmations:[],inspection:'pending',payment:{verified:false},deliveryPhoto:false,signature:false,delegate:null,delivered:false,amendment:null,cash:{holder:'',acknowledged:false},events:[],defects:[],usage:[],rolls:[{id:'M-001',kind:'Offcut',series:'Demo Film A',vlt:70,available:18},{id:'M-002',kind:'Roll',series:'Demo Film A',vlt:70,available:120},{id:'M-003',kind:'Roll',series:'Demo Film A',vlt:50,available:120},{id:'M-004',kind:'Roll',series:'Demo Film A',vlt:30,available:120}],panes:[['front','Front windscreen',70,14],['rear','Rear windscreen',50,12],['fl','Front left',50,5],['fr','Front right',50,5],['rl','Rear left',30,4],['rr','Rear right',30,4]].map(([id,name,vlt,estimate])=>({id,name,vlt,estimate,series:'Demo Film A',owner:'',status:'available',sqft:0,stock:'',note:''}))};
}
const requireThat=(condition,message)=>{if(!condition)throw new Error(message);};
export function canSubmit(s){return s.panes.every(p=>p.status==='installed')&&[...new Set(s.panes.map(p=>p.owner))].every(n=>s.confirmations.includes(n))&&!s.amendment;}
export function canDeliver(s){return s.inspection==='approved'&&s.payment.verified&&s.deliveryPhoto&&s.signature&&!s.amendment&&!s.delivered;}
export function transition(state,action,actor){
 const s=structuredClone(state), p=s.panes.find(x=>x.id===action.pane);
 requireThat(!s.delivered||action.type==='acknowledgeCash','Order is closed.');
 const role=(...roles)=>requireThat(roles.includes(actor.role),'Switch to the required demo role.');
 const editable=()=>requireThat(!['submitted','approved'].includes(s.inspection),'Job is locked for inspection.');
 const handover=()=>{role('Sales','Installer');requireThat(actor.role==='Sales'||actor.name===s.delegate,'Salesperson must delegate handover to you.');};
 const owner=()=>{role('Installer');requireThat(p&&p.owner===actor.name,'This glass belongs to another installer.');editable();requireThat(s.amendment?.pane!==p.id,'This glass is paused for an amendment.');};
 switch(action.type){
 case 'confirmOrder':role('Sales');requireThat(!s.confirmed,'Order already confirmed.');s.confirmed=true;break;
 case 'checkin':role('Sales','Installer');requireThat(s.confirmed,'Confirm the order first.');requireThat(!s.checkin.length,'Check-in already recorded.');requireThat(['Front','Rear','Left','Right'].every(x=>action.photos?.includes(x)),'Add all four check-in photos.');s.checkin=[...action.photos];s.checkinOwner=actor.name;break;
 case 'claim':role('Installer');editable();requireThat(s.checkin.length===4,'Check in the car first.');requireThat(p&&p.status==='available','Glass already taken.');requireThat(s.amendment?.pane!==p.id,'Glass paused for amendment.');p.owner=actor.name;p.status='taken';s.confirmations=s.confirmations.filter(n=>n!==actor.name);break;
 case 'release':owner();requireThat(p.status==='taken'&&!p.sqft,'Film already used; ask Garage Head.');p.owner='';p.status='available';break;
 case 'install':owner();requireThat(p.status==='taken','Take the glass first.');requireThat(Number.isFinite(action.sqft)&&action.sqft>0,'Enter a valid area used.');{const roll=s.rolls.find(r=>r.id===action.stock);requireThat(roll&&roll.series===p.series&&roll.vlt===p.vlt,'Choose matching film and VLT.');requireThat(roll.available>=action.sqft,'Not enough film in this stock.');s.usage.push({pane:p.id,stock:roll.id,sqft:action.sqft,by:actor.name});roll.available=Number((roll.available-action.sqft).toFixed(2));p.sqft=action.sqft;p.stock=roll.id;p.status='installed';p.note='';p.requiresReplacement=false;s.confirmations=s.confirmations.filter(n=>n!==actor.name);}break;
 case 'confirmMine':role('Installer');editable();requireThat(!s.amendment,'Resolve the amendment first.');{const mine=s.panes.filter(x=>x.owner===actor.name);requireThat(mine.length&&mine.every(x=>x.status==='installed'),'Finish your glass first.');requireThat(!s.confirmations.includes(actor.name),'Already confirmed.');s.confirmations.push(actor.name);if(canSubmit(s))s.inspection='submitted';}break;
 case 'return':role('Garage Head');requireThat(s.inspection==='submitted','Wait for team submission.');{const ids=action.panes||[action.pane],targets=s.panes.filter(x=>ids.includes(x.id));requireThat(targets.length&&action.reason?.trim(),'Select glass and enter a reason.');for(const target of targets){target.status='taken';target.note=action.reason.trim();s.confirmations=s.confirmations.filter(n=>n!==target.owner);}s.inspection='returned';}break;
 case 'defect':role('Sales','Installer','Garage Head');requireThat(s.confirmed&&action.reason?.trim()&&action.photo,'Add a note and evidence photo.');s.defects.push({by:actor.name,note:action.reason.trim(),at:new Date().toISOString(),photo:true});break;
 case 'correct':owner();requireThat(p.status==='taken'&&p.note&&!p.requiresReplacement,'Log new film for this change.');p.status='installed';p.note='';break;
 case 'approve':role('Garage Head');requireThat(s.inspection==='submitted'&&action.checked,'Inspect all glass before approval.');s.inspection='approved';break;
 case 'verifyPayment':role('Finance','Director');requireThat(s.confirmed,'Confirm the order first.');requireThat(!s.payment.verified,'Payment already verified.');requireThat(action.reference?.trim(),'Enter a verification reference.');s.payment={verified:true,reference:action.reference.trim(),by:actor.name};break;
 case 'requestAmendment':role('Sales');requireThat(s.confirmed&&p&&!s.amendment,'Select glass; resolve any pending change first.');requireThat(!['submitted','approved'].includes(s.inspection),'Return the job before changing it.');requireThat(['30','50','70'].includes(String(action.vlt))&&action.reason?.trim(),'Choose VLT and give a reason.');s.amendment={pane:p.id,vlt:Number(action.vlt),reason:action.reason.trim()};break;
 case 'resolveAmendment':role('Director');requireThat(s.amendment,'No amendment waiting.');{const target=s.panes.find(x=>x.id===s.amendment.pane);if(action.approve){target.vlt=s.amendment.vlt;target.requiresReplacement=true;target.status=target.owner?'taken':'available';target.note='Approved change: confirm revised scope before work.';s.confirmations=s.confirmations.filter(n=>n!==target.owner);}s.amendment=null;}break;
 case 'delegateHandover':role('Sales');requireThat(s.confirmed&&s.panes.some(p=>p.owner===action.name),'Choose an installer working on this car.');s.delegate=action.name;break;
 case 'deliveryPhoto':handover();requireThat(s.inspection==='approved','Complete inspection first.');s.deliveryPhoto=true;break;
 case 'signature':handover();requireThat(s.inspection==='approved'&&s.payment.verified,'Clear inspection and payment first.');s.signature=true;break;
 case 'deliver':handover();requireThat(canDeliver(s),'Clear approvals, payment, photo and signature.');s.delivered=true;break;
 case 'receiveCash':role('Installer');requireThat(s.confirmed,'Confirm the order first.');requireThat(!s.cash.holder,'Cash already held.');s.cash={holder:actor.name,acknowledged:false};break;
 case 'acknowledgeCash':role('Sales');requireThat(actor.name==='Alex','Original salesperson must acknowledge cash.');requireThat(s.cash.holder&&!s.cash.acknowledged,'No cash to receive.');s.cash={holder:actor.name,acknowledged:true};break;
 default:throw new Error('Unknown demo action.');
 }
 s.events.unshift({action:action.type,by:actor.name,detail:action.reason||s.amendment?.reason||'',at:new Date().toISOString()});return s;
}
export function carPreset(name){
 let s=initialCar();const sales={name:'Alex',role:'Sales'},head={name:'Garage Head',role:'Garage Head'};
 if(name==='draft')return s;
 s=transition(s,{type:'confirmOrder'},sales);s=transition(s,{type:'checkin',photos:['Front','Rear','Left','Right']},sales);
 if(name==='install')return s;
 for(const [index,p] of s.panes.entries()){const installer={name:index<2?'Jay':'Lee',role:'Installer'};s=transition(s,{type:'claim',pane:p.id},installer);s=transition(s,{type:'install',pane:p.id,sqft:p.estimate,stock:p.vlt===70?'M-002':p.vlt===50?'M-003':'M-004'},installer);}
 for(const person of ['Jay','Lee'])s=transition(s,{type:'confirmMine'},{name:person,role:'Installer'});
 if(name==='inspect')return s;
 s=transition(s,{type:'approve',checked:true},head);s=transition(s,{type:'verifyPayment',reference:'DEMO-BANK-001'},{name:'Finance',role:'Finance'});s=transition(s,{type:'delegateHandover',name:'Jay'},sales);return s;
}
