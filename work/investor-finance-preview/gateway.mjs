// Local sample gateway only. Real sign-in/session routing is a separate phase.
const key='autodream-investor-sample-pending';
export const pendingSave=()=>{try{return JSON.parse(sessionStorage.getItem(key)||'null');}catch{return null;}};
async function response(res){const data=await res.json();if(!res.ok)throw Object.assign(new Error(data.message||'Could not save the sample.'),{known:res.status<500});return data;}
export const loadState=role=>fetch('/sample/state?role='+encodeURIComponent(role),{cache:'no-store'}).then(response);
export async function saveAction(role,action,payload={}){
 const previous=pendingSave(),intent={role,action,payload};
 if(previous&&JSON.stringify(previous.intent)!==JSON.stringify(intent))throw Error('A save is waiting. Use Retry save first.');
 const command=previous??{intent,requestId:crypto.randomUUID()};sessionStorage.setItem(key,JSON.stringify(command));
 try{const state=await response(await fetch('/sample/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...command.intent,requestId:command.requestId})}));sessionStorage.removeItem(key);return state;}
 catch(error){if(error.known)sessionStorage.removeItem(key);throw error;}
}
export function retrySave(){const p=pendingSave();if(!p)throw Error('There is no save waiting.');return saveAction(p.intent.role,p.intent.action,p.intent.payload);}
