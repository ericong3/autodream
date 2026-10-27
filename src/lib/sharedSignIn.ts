import type {GarageIdentity} from './garageSession';
type SessionRequest=(method:'GET'|'POST'|'DELETE',body?:unknown)=>Promise<GarageIdentity|null>;
export async function confirmSharedSignIn(request:SessionRequest,username:string,password:string,clearPreviousAccount:()=>void=()=>{}):Promise<GarageIdentity>{
 const signedIn=await request('POST',{username:username.trim(),password});
 if(!signedIn)throw new Error('Could not sign in. Please try again.');
 clearPreviousAccount();
 const confirmed=await request('GET');
 if(!confirmed)throw new Error('Your browser did not keep your sign-in. Open autodream.vercel.app directly in Safari or Chrome, then sign in again.');
 if(confirmed.id!==signedIn.id||confirmed.username!==signedIn.username)throw new Error('The signed-in account changed. Please sign in again.');
 return confirmed;
}
