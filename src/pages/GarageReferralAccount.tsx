import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Link,useParams,useSearchParams} from 'react-router-dom';
import {referralAccountRequest,type ReferralProfile} from '../lib/garageReferralAccounts';
const fields:[keyof Omit<ReferralProfile,'recipientType'>,string][]=[['legalName','Legal name / registered business name'],['identityNumber','IC, passport or business registration number'],['tin','Tax identification number (TIN)'],['address','Address'],['phone','Phone'],['brand','Dealership brand'],['branch','Dealership / branch'],['bank','Bank'],['bankAccount','Bank account number'],['bankHolder','Bank account holder']];
const input='w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-white outline-none focus:border-gold-400';
export default function GarageReferralAccount(){
 const {mode='login'}=useParams(),[params]=useSearchParams(),token=params.get('token')||'';
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState('');
 const [profile,setProfile]=useState<Partial<ReferralProfile>>({recipientType:'individual'}),[account,setAccount]=useState<{email:string;profile:ReferralProfile}|null>(null);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[ready,setReady]=useState(false),[saved,setSaved]=useState(false);
 const lock=useRef(false),epoch=useRef(0);
 useEffect(()=>{const mine=++epoch.current;setError('');setMessage('');setSaved(false);setReady(false);setPassword('');setConfirm('');setAccount(null);
  if(mode==='register')referralAccountRequest('inspect',{token}).then(()=>{if(epoch.current===mine)setReady(true);}).catch(e=>{if(epoch.current===mine)setError(e.message);});
  else if(mode==='home')referralAccountRequest<{email:string;profile:ReferralProfile}>('session').then(r=>{if(epoch.current===mine){setAccount(r);setReady(true);}}).catch(e=>{if(epoch.current===mine)setError(e.message);});
  else setReady(true);
  return()=>{epoch.current++;};
 },[mode,token]);
 async function submit(e:FormEvent){e.preventDefault();if(lock.current)return;
  if(['register','reset'].includes(mode)&&password!==confirm){setError('The passwords do not match.');return;}
  if(['register','reset'].includes(mode)&&new TextEncoder().encode(password).length>72){setError('Use a password of at most 72 bytes.');return;}
  const mine=epoch.current;lock.current=true;setBusy(true);setError('');setMessage('');
  try{
   if(mode==='home'){await referralAccountRequest('logout');if(mine===epoch.current){setAccount(null);setMessage('Signed out.');}}
   else if(mode==='verify'){await referralAccountRequest('verify',{token});if(mine===epoch.current){setSaved(true);setMessage('Email verified. Garage management can now approve your account.');}}
   else if(mode==='register'){const r=await referralAccountRequest<{message:string}>('register',{token,email,password,profile});if(mine===epoch.current){setSaved(true);setPassword('');setConfirm('');setMessage(r.message);}}
   else if(mode==='reset'){const r=await referralAccountRequest<{message:string}>('reset',{token,password});if(mine===epoch.current){setSaved(true);setPassword('');setConfirm('');setMessage(r.message);}}
   else if(['resend','forgot'].includes(mode)){const r=await referralAccountRequest<{message:string}>(mode,{email});if(mine===epoch.current)setMessage(r.message);}
   else {await referralAccountRequest('login',{email,password});if(mine===epoch.current){setPassword('');window.location.hash='/referral-account/home';}}
  }catch(e){if(mine===epoch.current){setError((e as Error).message);if((e as {code?:string}).code==='MAIL'){setSaved(true);setPassword('');setConfirm('');}}}
  finally{lock.current=false;if(mine===epoch.current)setBusy(false);}
 }
 return <main className="min-h-screen bg-obsidian-950 text-white px-5 py-10 sm:py-16"><div className="max-w-2xl mx-auto">
  <p className="font-display text-gold-400 mb-8">AutoDream Garage</p>
  <h1 className="font-display text-2xl mb-2">{mode==='register'?'Create your referral account':mode==='verify'?'Verify your email':mode==='resend'?'Resend verification':mode==='forgot'?'Reset your password':mode==='reset'?'Choose a new password':mode==='home'?'Your referral profile':'Referral partner sign-in'}</h1>
  <p className="text-white/60 text-sm mb-7">{mode==='register'?'Complete your details for commission payments and annual statements. Garage management will review your registration.':'External referral accounts are separate from AutoDream staff accounts.'}</p>
  {error&&<p role="alert" className="rounded-xl border border-red-400/30 bg-red-400/5 p-4 text-red-200 mb-5">{error}</p>}
  {message&&<p role="status" className="rounded-xl border border-emerald-400/30 p-4 text-emerald-200 mb-5">{message}</p>}
  {!ready&&!error&&<p className="text-white/50">Checking your account…</p>}
  {mode==='home'&&account&&<dl className="rounded-2xl border border-white/10 p-5 space-y-4 mb-5"><div><dt className="text-white/50 text-xs">Email</dt><dd>{account.email}</dd></div>{fields.map(([key,label])=><div key={key}><dt className="text-white/50 text-xs">{label}</dt><dd className="break-words">{account.profile[key]}</dd></div>)}</dl>}
  {ready&&!saved&&(mode!=='home'||account)&&<form onSubmit={submit} className="space-y-5">
   {['register','login','resend','forgot'].includes(mode)&&<label className="block text-sm space-y-2"><span>Email</span><input className={input} type="email" autoComplete="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)}/></label>}
   {mode==='register'&&<><label className="block text-sm space-y-2"><span>Commission recipient</span><select className={input} value={profile.recipientType} onChange={e=>setProfile(p=>({...p,recipientType:e.target.value as ReferralProfile['recipientType']}))}><option value="individual">Individual</option><option value="business">Registered business</option></select></label>
    <div className="grid sm:grid-cols-2 gap-4">{fields.map(([key,label])=><label key={key} className={`block text-sm space-y-2 ${key==='address'?'sm:col-span-2':''}`}><span>{label}</span><input className={input} required maxLength={500} value={profile[key]||''} onChange={e=>setProfile(p=>({...p,[key]:e.target.value}))}/></label>)}</div></>}
   {['register','login','reset'].includes(mode)&&<label className="block text-sm space-y-2"><span>Password</span><input className={input} type="password" required minLength={6} maxLength={72} autoComplete={mode==='login'?'current-password':'new-password'} value={password} onChange={e=>setPassword(e.target.value)}/></label>}
   {['register','reset'].includes(mode)&&<label className="block text-sm space-y-2"><span>Confirm password</span><input className={input} type="password" required minLength={6} maxLength={72} autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>}
   <button disabled={busy} className="btn-gold rounded-xl px-5 py-3 disabled:opacity-50">{busy?'Please wait…':mode==='register'?'Create account':mode==='verify'?'Verify email':mode==='resend'?'Send verification email':mode==='forgot'?'Send password reset email':mode==='reset'?'Change password':mode==='home'?'Sign out':'Sign in'}</button>
  </form>}
  <nav className="flex flex-wrap gap-5 mt-7 text-sm text-gold-400"><Link to="/referral-account/login">Partner sign-in</Link><Link to="/referral-account/resend">Resend verification</Link><Link to="/referral-account/forgot">Forgot password</Link>{mode!=='home'&&<Link to="/login">Staff sign-in</Link>}</nav>
 </div></main>;
}
