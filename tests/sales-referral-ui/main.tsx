import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import GarageSalesAssignment from '../../src/components/GarageSalesAssignment';
import type {SalesAssignment} from '../../src/lib/garageSalesAssignment';
import '../../src/index.css';
function Preview(){
 const [value,setValue]=useState<SalesAssignment>(),[ready,setReady]=useState(false);
 return <div className="min-h-screen bg-[#0d0c0a] text-white"><div className="bg-amber-950 text-amber-100 text-sm p-3 text-center">Design preview · sample people and deals · nothing is saved</div><main className="max-w-2xl mx-auto px-4 py-10 space-y-5"><div><p className="font-display text-gold-300 text-xl">AutoDream Garage</p><h1 className="text-white text-lg mt-3">Order summary</h1><p className="text-white/45 text-sm mt-1">Tint · sample order</p></div><GarageSalesAssignment value={value} onChange={setValue} onReady={setReady}/><button type="button" disabled={!ready} className="btn-gold w-full rounded-xl py-3 disabled:opacity-40" onClick={()=>alert('Preview only. No order or account has been created.')}>Continue to payment</button></main></div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
