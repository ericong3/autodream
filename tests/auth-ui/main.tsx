import React,{useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {HashRouter,Routes,Route} from 'react-router-dom';
import Login from '../../src/pages/Login';
import {useStore} from './store';
import '../../src/index.css';
function Harness(){
 const user=useStore(s=>s.currentUser),loaded=useStore(s=>s.loaded);
 useEffect(()=>{useStore.setState({loaded:false});const timer=setTimeout(()=>useStore.setState({loaded:true}),350);return()=>clearTimeout(timer);},[user?.id]);
 if(!loaded&&!location.hash.startsWith('#/login'))return <div>Loading workspace…</div>;
 return <HashRouter><Routes><Route path="/login" element={<Login/>}/><Route path="/choose-business" element={<h1>Signed in · Choose business</h1>}/><Route path="/garage/enquiries" element={<h1>Signed in · Follow-ups</h1>}/></Routes></HashRouter>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Harness/></React.StrictMode>);
