// Persist identity and preferences, not finance returned under an earlier role.
// Used for both reading old caches and writing the current private-mode cache.
const sensitive=new Set(['users','ledgerAccounts','journalEntries','payments','payslips','bankStatementUploads','bankTransactions','investorTransactions']);
export function privateFinanceCacheState<T extends Record<string,unknown>>(snapshot:T):T {
 const safe:Record<string,unknown>={...snapshot};
 const identity=snapshot.currentUser as Record<string,unknown>|null|undefined;
 const investor=identity?.role==='investor';
 if(identity&&typeof identity==='object')safe.currentUser=Object.fromEntries(['id','name','username','role','businessAccess','authSource','avatar'].filter(k=>Object.prototype.hasOwnProperty.call(identity,k)).map(k=>[k,identity[k]]));
 for(const [key,value] of Object.entries(safe))if(sensitive.has(key)||(investor&&Array.isArray(value)))safe[key]=[];
 safe.loaded=false;safe.phase2Loaded=false;
 if(investor)safe.viewPreference={};
 return safe as T;
}
export function privateFinanceCacheJson(raw:string|null):string|null {
 if(!raw)return null;
 try{const value=JSON.parse(raw);if(!value?.state||typeof value.state!=='object'||Array.isArray(value.state))return null;return JSON.stringify({...value,state:privateFinanceCacheState(value.state)});}catch{return null;}
}
