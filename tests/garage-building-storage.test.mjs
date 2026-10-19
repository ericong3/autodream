// Building project storage: local CAS / scoping and cloud error surfacing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingStorage, isBuildingSetupError, buildingStorageMode } from '../src/lib/garageBuildingProjects.ts';
import { createBuildingProject, saveBuildingVersion } from '../src/utils/garageBuilding.ts';

const sales = { id: 'u1', role: 'garage_salesman', businessAccess: 'garage' };
const other = { id: 'u2', role: 'garage_salesman', businessAccess: 'garage' };
const head = { id: 'h1', role: 'garage_head', businessAccess: 'garage' };

function memStore() {
  const m = new Map();
  return { m, getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
}
function withWindow(owner = 'u1') {
  const doc = createBuildingProject(owner);
  doc.rooms.push({ id: 'r1', floorId: doc.floors[0].id, name: 'Hall', width: 200, depth: 200, x: 0, z: 0 });
  doc.windows.push({ id: 'w1', roomId: 'r1', label: '', kind: 'window', wall: 'N', position: 0.5, film: 'eco',
    panes: [{ id: 'p1', width: 24, height: 48, measured: false, shape: 'rect' }] });
  return doc;
}

test('default mode is local; env opt-in switches to online', () => {
  assert.equal(buildingStorageMode(), 'local');
  assert.equal(createBuildingStorage({ env: {} }).mode, 'local');
  assert.equal(createBuildingStorage({ env: { VITE_GARAGE_BUILDING_STORAGE: 'online' } }).mode, 'online');
});

test('local save bumps revision and enforces compare-and-swap', async () => {
  const s = createBuildingStorage({ env: {}, store: memStore(), now: () => '2026-10-19T00:00:00.000Z' });
  const saved = await s.save(withWindow(), sales);
  assert.equal(saved.revision, 1);
  const again = await s.save({ ...saved, title: 'Shop' }, sales);
  assert.equal(again.revision, 2);
  await assert.rejects(s.save({ ...saved, title: 'stale' }, sales), e => e.code === 'CONFLICT');
  assert.equal((await s.get(saved.id, sales)).title, 'Shop');
});

test('local storage is per-user; no enumeration of other keys', async () => {
  const store = memStore();
  const s = createBuildingStorage({ env: {}, store });
  const saved = await s.save(withWindow(), sales);
  assert.deepEqual(await s.list(other), []);
  assert.equal(await s.get(saved.id, other), null);
  assert.deepEqual(await s.list(head), [], 'manager sees only their own device key');
  assert.equal((await s.list(sales)).length, 1);
  assert.ok([...store.m.keys()].every(k => k.endsWith('.u1')));
});

test('permission and access guards', async () => {
  const s = createBuildingStorage({ env: {}, store: memStore() });
  await assert.rejects(s.save(withWindow('u2'), sales), e => e.code === 'FORBIDDEN');
  await assert.rejects(s.save(withWindow(), { ...sales, businessAccess: 'used_car' }), e => e.code === 'FORBIDDEN');
  await assert.rejects(s.save(withWindow(), { id: 'u1', role: 'garage_installer', businessAccess: 'garage' }), e => e.code === 'FORBIDDEN');
  await assert.rejects(s.list(null), e => e.code === 'FORBIDDEN');
  const bad = withWindow(); bad.windows[0].panes[0].height = 0;
  await assert.rejects(s.save(bad, sales), e => e.code === 'INVALID');
});

test('saved versions are immutable and cannot be dropped', async () => {
  const s = createBuildingStorage({ env: {}, store: memStore() });
  const saved = await s.save(saveBuildingVersion(withWindow(), 'v1'), sales);
  const tampered = structuredClone(saved); tampered.versions[0].sqft = 1;
  await assert.rejects(s.save(tampered, sales), /cannot be changed/);
  await assert.rejects(s.save({ ...saved, versions: [] }, sales), e => e.code === 'INVALID');
  const next = await s.save(saveBuildingVersion(saved, 'v2'), sales);
  assert.equal(next.versions.length, 2);
});

test('new project with existing-revision or someone else’s id is refused', async () => {
  const s = createBuildingStorage({ env: {}, store: memStore() });
  await assert.rejects(s.save({ ...withWindow(), revision: 3 }, sales), e => e.code === 'CONFLICT');
});


function online(handler) {
 const calls=[], store=memStore();
 const s=createBuildingStorage({env:{VITE_GARAGE_BUILDING_STORAGE:'online'},store,
 fetch:async(url,init)=>{calls.push({url,init});return handler(url,init);}});
 return {s,calls,store};
}
const response=(status,body)=>({status,json:async()=>body});
test('online save uses same-origin API and never sends a client actor',async()=>{
 const {s,calls}=online((url,init)=>response(200,{project:{...JSON.parse(init.body).project,revision:7}}));
 const saved=await s.save(withWindow(),sales); assert.equal(saved.revision,7);
 assert.equal(calls[0].url,'/api/garage-building/projects');
 assert.equal(calls[0].init.credentials,'same-origin');
 assert.equal(calls[0].init.headers['X-Garage-Building'],'1');
 assert.deepEqual(Object.keys(JSON.parse(calls[0].init.body)),['project']);
});
test('online errors retain edits and never fall back to local',async()=>{
 for(const [status,code] of [[401,'AUTH'],[403,'FORBIDDEN'],[409,'CONFLICT'],[503,'SETUP'],[429,'RATE_LIMITED']]) {
 const {s,store}=online(()=>response(status,{error:{message:'Blocked',retryAfter:60}}));
 const doc=withWindow(),before=structuredClone(doc);
 await assert.rejects(s.save(doc,sales),e=>e.code===code);assert.deepEqual(doc,before);assert.equal(store.m.size,0);
 }
 const {s}=online(()=>{throw new Error('offline');});
 await assert.rejects(s.save(withWindow(),sales),e=>e.code==='CLOUD');
});
test('online session sign-in, expiry, sign-out and malformed responses',async()=>{
 const user={...sales,name:'Sam',username:'sam'};
 const {s,calls}=online((url,init)=>response(200,init.method==='DELETE'?{}:{user,expiresAt:'2026-10-20T00:00:00Z'}));
 assert.equal((await s.signIn('sam','test-pass')).user.id,'u1');
 assert.deepEqual(JSON.parse(calls[0].init.body),{username:'sam',password:'test-pass'});
 assert.equal((await s.session()).user.id,'u1');await s.signOut();
 assert.equal(await online(()=>response(401,{})).s.session(),null);
 const bad=online(()=>response(200,{}));await assert.rejects(bad.s.list(sales),e=>e.code==='CLOUD');
 await assert.rejects(bad.s.signIn('sam','x'),e=>e.code==='CLOUD');
 assert.equal(await online(()=>response(404,{})).s.get('missing',sales),null);
});
test('cross-origin API override is refused before sending credentials',()=>{
 for(const url of ['https://example.com/api','//example.com/api']) {
 assert.throws(()=>createBuildingStorage({env:{VITE_GARAGE_BUILDING_STORAGE:'online',VITE_GARAGE_BUILDING_API:url}}),e=>isBuildingSetupError(e));
 }
});
test('corrupt local documents fail safely',async()=>{
 const store=memStore();store.setItem('autodream.garageBuilding.v1.u1',JSON.stringify({broken:{id:'broken'}}));
 const s=createBuildingStorage({env:{},store});
 await assert.rejects(s.get('broken',sales),e=>e.code==='INVALID');await assert.rejects(s.list(sales),e=>e.code==='INVALID');
});
