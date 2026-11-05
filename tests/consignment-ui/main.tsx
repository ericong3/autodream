import React from 'react';
import {createRoot} from 'react-dom/client';
import ConsignmentFinancePanel from '../../src/components/ConsignmentFinancePanel';
import {useStore} from '../../src/store';
import '../../src/index.css';
const role=new URLSearchParams(location.search).get('role')||'director';
useStore.setState({currentUser:{id:'test-'+role,role,name:'Test '+role} as any});
const car={id:'test-car',make:'Toyota',model:'Vios',purchasePrice:50000,consignment:{terms:'profit_split',splitPercent:30,dealer:'Dealer'}} as any;
createRoot(document.getElementById('root')!).render(<main className="p-4 max-w-3xl mx-auto"><p>Isolated browser test — no real data</p><ConsignmentFinancePanel key={role} car={car} actorId={'test-'+role} role={role}/></main>);
