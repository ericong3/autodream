import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useStore } from '../store';
import { garageAppUser, garageSessionRequest, secureGarageLoginEnabled, type GarageIdentity } from '../lib/garageSession';

function VerifiedGarage({ children, allow }: { children: ReactNode; allow?: (role:string)=>boolean }) {
  const location=useLocation();
  const current=useStore(s=>s.currentUser);
  const [identity,setIdentity]=useState<GarageIdentity|null>();
  const [error,setError]=useState('');
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    let active=true,sequence=0;
    const check=async()=>{const mine=++sequence;try{const user=await garageSessionRequest('GET');if(active&&mine===sequence){setIdentity(user);setError('');}}catch(e){if(active&&mine===sequence)setError(e instanceof Error?e.message:'Could not verify Garage login.');}};
    void check();
    const timer=window.setInterval(()=>void check(),60000);
    const focus=()=>void check();window.addEventListener('focus',focus);
    return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',focus);};
  },[attempt,location.pathname]);
  const matches=identity&&current?.id===identity.id&&current.role===identity.role&&current.businessAccess===identity.businessAccess&&current.authSource==='server'&&current.username===identity.username;
  useEffect(()=>{
    if(identity&&!matches){
      // Public legacy records never determine the Garage role or grant used-car access.
      useStore.setState({currentUser:garageAppUser(identity)});
    }
  },[identity,matches]);
  if(error)return <div className="min-h-screen bg-black text-white p-10"><p role="alert">{error}</p><button className="text-gold-400 mt-4" onClick={()=>setAttempt(a=>a+1)}>Try again</button></div>;
  if(identity===null)return <Navigate to="/login" replace/>;
  if(!matches)return <div className="min-h-screen bg-black text-white/60 p-10">Checking Garage sign-in…</div>;
  if(allow&&!allow(identity.role))return <Navigate to="/garage" replace/>;
  return <>{children}</>;
}
export default function GarageSessionGate(props:{children:ReactNode;allow?:(role:string)=>boolean}) {
  const location=useLocation();
  return secureGarageLoginEnabled() && location.pathname !== '/login' && location.pathname !== '/garage/login' && !/^\/account\/(register|verify|reset|forgot|resend)$/.test(location.pathname) ? <VerifiedGarage {...props}/> : <>{props.children}</>;
}
