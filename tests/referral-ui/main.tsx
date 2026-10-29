import React from 'react';
import {createRoot} from 'react-dom/client';
import {HashRouter,Routes,Route} from 'react-router-dom';
import GarageReferralAccount from '../../src/pages/GarageReferralAccount';
import '../../src/index.css';
createRoot(document.getElementById('root')!).render(<><div className="bg-amber-950 text-amber-100 text-sm p-3 text-center">Design preview · no real account · nothing is saved</div><HashRouter><Routes><Route path="/referral-account/:mode" element={<GarageReferralAccount/>}/></Routes></HashRouter></>);
