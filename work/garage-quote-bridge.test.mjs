import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import{WORKFLOW_KEY,BACKUP_KEY,validateSketch,downstreamActivity,planHandoff,handoffMessage,buildWorkflowWrapper,commitHandoff,editProjectDetails,versionUnchecked}from './garage-quote-bridge.mjs';
const c={};vm.createContext(c);vm.runInContext(fs.readFileSync(new URL('./garage-building-logic.js',import.meta.url),'utf8'),c);const B=c.BuildingLogic;
const ISO='2026-10-18T12:00:00.000Z';
const store=(init={})=>{const m=new Map(Object.entries(init));return{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),map:m};};
const draft=s=>JSON.stringify({v:1,state:s,actor:'alex',tab:'Quote'});
const ok=(s,a)=>{const r=B.apply(s,{actor:'alex',...a});assert.ok(r.ok,r.error);return r.state;};

test('UPDATE_PANEL resets the check only when width or height actually changes',()=>{let s=B.createDemo();s.assemblies[0].panels[0].measured=true;
 s=ok(s,{type:'UPDATE_PANEL',panelId:'1A-W1-1',w:20,h:80});assert.equal(B.findPanel(s,'1A-W1-1').panel.measured,true);
 s=ok(s,{type:'UPDATE_PANEL',panelId:'1A-W1-1',note:'frosted'});assert.equal(B.findPanel(s,'1A-W1-1').panel.measured,true);
 s=ok(s,{type:'UPDATE_PANEL',panelId:'1A-W1-1',w:21});assert.equal(B.findPanel(s,'1A-W1-1').panel.measured,false);});

test('saved version records unchecked counts and stays unchanged by later edits',()=>{let s=B.createDemo();s.assemblies[0].panels.forEach(p=>p.measured=true);s.assemblies[1].panels[0].measured=false;
 s=ok(s,{type:'SAVE_VERSION',note:''});const v=s.quote.versions[0],total=B.allPanels(s).length;
 assert.deepEqual({...v.measurement},{checked:3,approx:1,unknown:total-4});assert.deepEqual(versionUnchecked(v),{total:total-3,approx:1,unknown:total-4});
 const frozen=JSON.stringify(v);s=ok(s,{type:'UPDATE_PANEL',panelId:'1A-W1-1',w:30});s=ok(s,{type:'REMOVE_ASSEMBLY',assemblyId:'2B-W1'});
 assert.equal(JSON.stringify(s.quote.versions[0]),frozen);assert.equal(versionUnchecked({v:1,sqft:10}),null);});

test('locked or progressed destination is refused; quote-stage draft is replaceable',()=>{const sketch=B.createDemo();
 for(const name of['signed','deposit']){const p=planHandoff(B,sketch,draft(B.preset(name)));assert.equal(p.ok,false);assert.match(p.error,/signed agreement/);}
 const paid=B.createDemo();paid.milestones[0].receipts=[{amount:1}];assert.deepEqual(downstreamActivity(paid),['payment activity']);assert.equal(planHandoff(B,sketch,draft(paid)).ok,false);
 const plan=planHandoff(B,sketch,draft(B.createDemo()));assert.equal(plan.ok,true);assert.equal(plan.slot,'draft');assert.equal(plan.before.panes,14);
 assert.match(handoffMessage(plan),/Current draft: 4 rooms · 6 windows · 14 panes · 0 saved versions/);
 assert.equal(planHandoff(B,sketch,null).slot,'empty');assert.equal(planHandoff(B,sketch,'{oops').slot,'unreadable');});

test('signed sketch and broken references are rejected',()=>{const signed=B.preset('signed');assert.match(validateSketch(B,signed)[0],/signed/i);
 const cases=[s=>{s.rooms[0].floorId='L9';},s=>{s.assemblies[0].roomId='9Z';},s=>{s.assemblies[1].panels[0].id=s.assemblies[0].panels[0].id;},s=>{s.assemblies[0].panels[0].w=-1;},s=>{s.assemblies[0].series='Z';},s=>{s.assemblies[0].span={from:'L1',to:'L7'};},s=>{s.schema=2;},s=>{s.pieces={x:{}};}];
 for(const breakIt of cases){const s=B.createDemo();breakIt(s);assert.ok(validateSketch(B,s).length,String(breakIt));assert.equal(planHandoff(B,s,null).ok,false);}
 assert.deepEqual(validateSketch(B,B.createDemo()),[]);});

test('wrapper copies the sketch, marks the source and keeps amounts without mutating the sketch',()=>{const s=B.createDemo();s.milestones[1].amount=8123.5;const before=JSON.stringify(s),w=buildWorkflowWrapper(s,ISO);
 assert.equal(JSON.stringify(s),before);assert.deepEqual(Object.keys(w).sort(),['actor','state','tab','v']);assert.equal(w.v,1);assert.equal(w.actor,'alex');assert.equal(w.tab,'Quote');
 assert.deepEqual({...w.state.context},{source:'sketch',sketchKey:'autodream-building-sketch-v1',handedOffAt:ISO});assert.deepEqual(w.state.milestones.map(m=>m.amount),[6000,8123.5,6000]);
 w.state.rooms[0].name='changed';assert.equal(s.rooms[0].name,'Living');});

test('commit backs up the replaced draft and aborts on concurrent change',()=>{const sketch=B.createDemo(),old=B.createDemo();old.rooms[0].name='Old living';const raw=draft(old),st=store({[WORKFLOW_KEY]:raw}),before=JSON.stringify(sketch);
 const changed=store({[WORKFLOW_KEY]:raw});changed.setItem(WORKFLOW_KEY,draft(B.createDemo()));const after=changed.getItem(WORKFLOW_KEY);
 assert.equal(commitHandoff(changed,B,sketch,raw,ISO).ok,false);assert.equal(changed.getItem(WORKFLOW_KEY),after);assert.equal(changed.getItem(BACKUP_KEY),null);
 const r=commitHandoff(st,B,sketch,raw,ISO);assert.ok(r.ok,r.error);assert.equal(JSON.stringify(sketch),before);
 const backups=JSON.parse(st.getItem(BACKUP_KEY));assert.equal(backups[0].raw,raw);assert.equal(JSON.parse(st.getItem(WORKFLOW_KEY)).state.context.source,'sketch');
 const locked=store({[WORKFLOW_KEY]:draft(B.preset('signed'))}),lockedRaw=locked.getItem(WORKFLOW_KEY);assert.equal(commitHandoff(locked,B,sketch,lockedRaw,ISO).ok,false);assert.equal(locked.getItem(WORKFLOW_KEY),lockedRaw);
 const badBackup=store({[WORKFLOW_KEY]:raw,[BACKUP_KEY]:'nope'});assert.equal(commitHandoff(badBackup,B,sketch,raw,ISO).ok,false);assert.equal(badBackup.getItem(WORKFLOW_KEY),raw);});

test('project details edit text only and un-confirm a pin when the address changes',()=>{const s=B.createDemo();s.project.pin.confirmed=true;const before=JSON.stringify(s);
 const r=editProjectDetails(s,{title:'Lim House',customer:'Lim Family',address:'2 Jalan Baru'},ISO);assert.equal(JSON.stringify(s),before);
 assert.equal(r.state.project.title,'Lim House');assert.equal(r.state.project.pin.confirmed,false);assert.equal(r.state.project.pin.x,s.project.pin.x);
 assert.equal(editProjectDetails(s,{title:s.project.title,customer:s.project.customer,address:s.project.address},ISO).changed,false);
 assert.throws(()=>editProjectDetails(s,{customer:'',address:'x'},ISO));assert.throws(()=>editProjectDetails(B.preset('signed'),{customer:'a',address:'b'},ISO));});
