import React from 'react';
import {createRoot} from 'react-dom/client';
import {HashRouter} from 'react-router-dom';
import BonusCampaigns from '../../src/pages/BonusCampaigns';
import '../../src/index.css';
createRoot(document.getElementById('root')!).render(<HashRouter><div className="min-h-screen bg-[#0d0c0a]"><div className="bg-amber-950 text-amber-100 text-sm p-3 text-center">Design preview · sample campaigns and people · nothing is saved</div><main className="max-w-5xl mx-auto p-4 sm:p-8"><BonusCampaigns/></main></div></HashRouter>);
