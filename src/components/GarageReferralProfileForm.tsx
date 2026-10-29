import {useRef,useState,type FormEvent} from 'react';
import type {ReferralProfile} from '../lib/garageReferralAccounts';
export type ReferralProfileSave={profile:Partial<ReferralProfile>;createAccount:boolean;requestId:string;email?:string;password?:string};
export const referralProfileFields:[keyof Omit<ReferralProfile,'recipientType'>,string][]=[['legalName','Name / registered business name'],['phone','Phone'],['brand','Dealership brand'],['branch','Dealership / branch'],['identityNumber','IC, passport or business registration number'],['tin','Tax identification number (TIN)'],['address','Address'],['bank','Bank'],['bankAccount','Bank account number'],['bankHolder','Bank account holder']];
const input='w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-white outline-none focus:border-gold-400';
export default function GarageReferralProfileForm({initialProfile={},staff=false,hasAccount=false,disabled=false,onSave}:{initialProfile?:Partial<ReferralProfile>;staff?:boolean;hasAccount?:boolean;disabled?:boolean;onSave:(data:ReferralProfileSave)=>Promise<void>}){
 const [profile,setProfile]=useState<Partial<ReferralProfile>>(()=>({recipientType:'individual',...initialProfile})),[createAccount,setCreateAccount]=useState(false);
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false);
 const lock=useRef(false),request=useRef<string>();
 function choose(value:boolean){setCreateAccount(value);setError('');if(!value){setEmail('');setPassword('');setConfirm('');}}
 async function submit(e:FormEvent){e.preventDefault();if(lock.current||disabled)return;
  if(createAccount&&!staff&&(password!==confirm||new TextEncoder().encode(password).length>72)){setError(password!==confirm?'The passwords do not match.':'Use a password of at most 72 bytes.');return;}
  lock.current=true;setBusy(true);setError('');request.current??=crypto.randomUUID();
  try{await onSave({profile,createAccount,requestId:request.current,...(createAccount&&!staff?{email,password}:{})});request.current=undefined;setUncertain(false);setEmail('');setPassword('');setConfirm('');if(staff){setProfile({recipientType:'individual'});setCreateAccount(false);}}
  catch(e){const code=(e as {code?:string}).code;setError((e as Error).message);if(['INVALID','SETUP','AUTH','FORBIDDEN','RATE_LIMITED','CONFLICT'].includes(code||'')){request.current=undefined;setUncertain(false);}else setUncertain(true);}
  finally{lock.current=false;setBusy(false);}
 }
 const field=(key:keyof Omit<ReferralProfile,'recipientType'>,label:string,required=false)=><label key={key} className="block text-sm space-y-2"><span>{label}</span><input className={input} required={required} maxLength={500} value={profile[key]||''} onChange={e=>setProfile(p=>({...p,[key]:e.target.value}))}/></label>;
 return <form onSubmit={submit} className="space-y-5" aria-label="Salesman profile">
  <fieldset disabled={disabled||busy||uncertain} className="space-y-5 disabled:opacity-70">
   <div className="grid sm:grid-cols-2 gap-4">{referralProfileFields.slice(0,4).map(([key,label])=>field(key,label,true))}</div>
   <details className="rounded-xl border border-white/10 p-4"><summary className="text-gold-400 text-sm cursor-pointer">Tax & payment details (optional)</summary><div className="grid sm:grid-cols-2 gap-4 mt-4"><label className="block text-sm space-y-2"><span>Commission recipient</span><select className={input} value={profile.recipientType} onChange={e=>setProfile(p=>({...p,recipientType:e.target.value as ReferralProfile['recipientType']}))}><option value="individual">Individual</option><option value="business">Registered business</option></select></label>{referralProfileFields.slice(4).map(([key,label])=>field(key,label))}</div></details>
   {hasAccount?<p className="text-white/60 text-sm">The existing login stays linked to this profile.</p>:<fieldset className="rounded-2xl border border-gold-400/20 p-4 space-y-3"><legend className="text-sm px-2 text-white">Account access</legend>
    <label className={`flex items-start gap-3 p-3 rounded-xl cursor-pointer border ${!createAccount?'border-gold-400/40 bg-gold-400/5':'border-white/10'}`}><input className="mt-1" type="radio" name="referral-account-access" checked={!createAccount} onChange={()=>choose(false)}/><span><span className="block font-medium text-sm">Remain accountless</span><span className="text-xs text-white/50">Save this salesman without login access.</span></span></label>
    <label className={`flex items-start gap-3 p-3 rounded-xl cursor-pointer border ${createAccount?'border-gold-400/40 bg-gold-400/5':'border-white/10'}`}><input className="mt-1" type="radio" name="referral-account-access" checked={createAccount} onChange={()=>choose(true)}/><span><span className="block font-medium text-sm">Create account</span><span className="text-xs text-white/50">{staff?'Create a private link so this salesman can set up their login.':'Set up a login for this same profile.'}</span></span></label>
    <p className="text-xs text-white/50">Creating an account later keeps the same profile and its linked history.</p>
   </fieldset>}
   {createAccount&&!staff&&<div className="space-y-4"><label className="block text-sm space-y-2"><span>Email</span><input className={input} type="email" autoComplete="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)}/></label><label className="block text-sm space-y-2"><span>Password</span><input className={input} type="password" required minLength={6} maxLength={72} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/></label><label className="block text-sm space-y-2"><span>Confirm password</span><input className={input} type="password" required minLength={6} maxLength={72} autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)}/></label></div>}
  </fieldset>
  {error&&<p role="alert" className="text-red-200 text-sm">{error}</p>}
  {uncertain&&<p className="text-white/60 text-xs">The result could not be confirmed. Retry the same save before changing these details.</p>}
  <button disabled={disabled||busy} className="btn-gold rounded-xl px-5 py-3 disabled:opacity-50">{busy?'Saving…':uncertain?'Retry save':createAccount?(staff?'Save profile & create setup link':'Create account'):'Save profile'}</button>
 </form>;
}
