import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {transformSync} from 'esbuild';

// Execute the real loadAll body, holding database batches to reproduce late responses.
const source=readFileSync(new URL('../src/store/index.ts',import.meta.url),'utf8');
const body=source.slice(source.indexOf('  loadAll: async '),source.indexOf('  login: async '));
function harness(privateFinance=false){
 const empty=()=>Object.fromEntries([...new Set(body.matchAll(/\bs\.(\w+)/g))].map(m=>[m[1],[]]));
 let state={...empty(),currentUser:{id:'A'},loaded:false,lastFetched:null,cars:[],notifications:[],toastQueue:[]};
 const pending=[],callbacks=[];
 const query=new Proxy({}, {get:(_,key)=>key==='then'?((done)=>Promise.resolve({data:[]}).then(done)):(()=>query)});
 const scope={get:()=>state,set:change=>{Object.assign(state,typeof change==='function'?change(state):change);},
  runBatched:thunks=>new Promise(resolve=>pending.push(()=>resolve(thunks.map(()=>({data:[]}))))),
  supabase:{from:()=>query,channel:()=>{const channel={on:(_kind,filter,fn)=>{callbacks.push({filter,fn});return channel;},subscribe:()=>channel};return channel;}},
  mergeBonusRows:(fresh,old)=>[...fresh,...old],mergePendingCars:(rows)=>rows,scheduledNotifAllowed:()=>false,console,setTimeout,Date,channelCleanup:Promise.resolve(),accountDataGeneration:0,dataLoadGeneration:0,realtimeSubscribed:false};
 for(const name of new Set(body.match(/\browTo\w+/g)))scope[name]=value=>value;
 const context=vm.createContext(scope);
 vm.runInContext(transformSync(`globalThis.actions={${body}}`,{loader:'ts',define:{'import.meta.env.VITE_USED_CAR_PRIVATE_FINANCE':JSON.stringify(privateFinance?'1':'0')}}).code,context);
 return {context,pending,callbacks,get state(){return state;},switchAccount(id){scope.accountDataGeneration++;scope.dataLoadGeneration++;scope.realtimeSubscribed=false;state={...empty(),currentUser:{id},loaded:false,lastFetched:null,cars:[],notifications:[],toastQueue:[]};}};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('late previous-account database responses cannot populate the new account',async()=>{
 const h=harness(),loading=h.context.actions.loadAll();
 h.switchAccount('B');h.pending.splice(0).forEach(resolve=>resolve());await loading;await flush();
 assert.equal(h.state.loaded,false);assert.equal(h.state.lastFetched,null);assert.equal(h.callbacks.length,0);
});
test('realtime remains active after same-account refresh but ignores switched accounts',async()=>{
 const h=harness(),loading=h.context.actions.loadAll();h.pending.splice(0).forEach(resolve=>resolve());await loading;await flush();
 const notification=h.callbacks.find(x=>x.filter.table==='notifications'&&x.filter.event==='INSERT').fn;
 const refresh=h.context.actions.loadAll(true);h.pending.splice(0).forEach(resolve=>resolve());await refresh;await flush();
 notification({new:{id:'same-account'}});assert.equal(h.state.notifications[0].id,'same-account');
 h.switchAccount('B');notification({new:{id:'old-account'}});assert.equal(h.state.notifications.length,0);
});
test('new subscriptions wait for previous-account channel cleanup',async()=>{
 const h=harness();let finish;
 h.context.channelCleanup=new Promise(resolve=>{finish=resolve;});
 const loading=h.context.actions.loadAll();h.pending.splice(0).forEach(resolve=>resolve());await flush();
 assert.equal(h.callbacks.length,0);finish();await loading;assert.ok(h.callbacks.length>0);
});
test('logout clears local identity immediately even while channel cleanup is pending',async()=>{
 const h=harness();let finish;
 h.context.supabase.removeAllChannels=()=>new Promise(resolve=>{finish=resolve;});
 const logout=source.slice(source.indexOf('  logout: async '),source.indexOf('  // Cars',source.indexOf('  logout: async ')));
 vm.runInContext(transformSync(`globalThis.signOut={${logout}}`,{loader:'ts',define:{'import.meta.env.VITE_GARAGE_BUILDING_STORAGE':'"local"'}}).code,h.context);
 const pending=h.context.signOut.logout({revokeSession:false});
 assert.equal(h.state.currentUser,null);assert.equal(h.state.loaded,false);finish();await pending;
});
test('server sign-out starts without waiting for realtime cleanup',async()=>{
 const h=harness();let finish,revoked=false;
 h.context.supabase.removeAllChannels=()=>new Promise(resolve=>{finish=resolve;});
 h.context.secureGarageLoginEnabled=()=>true;
 h.context.garageSessionRequest=async method=>{assert.equal(method,'DELETE');revoked=true;};
 const logout=source.slice(source.indexOf('  logout: async '),source.indexOf('  // Cars',source.indexOf('  logout: async ')));
 vm.runInContext(transformSync(`globalThis.signOut={${logout}}`,{loader:'ts',define:{'import.meta.env.VITE_GARAGE_BUILDING_STORAGE':'"local"'}}).code,h.context);
 const pending=h.context.signOut.logout();assert.equal(revoked,true);finish();await pending;
});

test('investor startup does not load shared data or subscribe to staff changes',async()=>{const h=harness(true);h.state.currentUser.role='investor';await h.context.actions.loadAll();assert.equal(h.pending.length,0);assert.equal(h.callbacks.length,0);assert.equal(h.state.loaded,true);});
test('private finance does not subscribe to unfiltered staff or investor transaction rows',async()=>{const h=harness(true),p=h.context.actions.loadAll();h.pending.splice(0).forEach(resolve=>resolve());await p;assert.ok(h.callbacks.length>0);assert.ok(!h.callbacks.some(c=>['users','investor_transactions'].includes(c.filter.table)));});
