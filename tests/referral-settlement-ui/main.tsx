import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {HashRouter} from 'react-router-dom';
import GarageReferralSettlement from '../../src/pages/GarageReferralSettlement';
import GaragePartnerIncome from '../../src/components/GaragePartnerIncome';
import '../../src/index.css';
function Preview(){const [partner,setPartner]=useState(false);return <HashRouter><div className="min-h-screen bg-obsidian-950 text-white"><header className="text-center text-amber-200 text-sm p-4 border-b border-white/10">Sample data only · no real transfers, accounts or payouts <button className="ml-4 underline" onClick={()=>setPartner(!partner)}>{partner?'Staff view':'Partner view'}</button></header>{partner?<main className="max-w-2xl mx-auto p-6"><GaragePartnerIncome/></main>:<GarageReferralSettlement/>}</div></HashRouter>;}
createRoot(document.getElementById('root')!).render(<Preview/>);
