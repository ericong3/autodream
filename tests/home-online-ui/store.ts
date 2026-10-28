import {create} from 'zustand';
export const sampleUsers=[
 {id:'sample-sales',name:'Sample salesman',role:'garage_salesman',label:'Salesman'},
 {id:'sample-worker',name:'Sample installer',role:'garage_installer',label:'Installer'},
 {id:'sample-head',name:'Sample Garage Head',role:'garage_head',label:'Garage Head'},
 {id:'sample-finance',name:'Sample finance admin',role:'admin',label:'Finance admin'},
 {id:'sample-director',name:'Sample director',role:'director',label:'Director'},
].map(u=>({...u,username:u.id,businessAccess:u.role==='director'?'both':'garage'}));
export const useStore=create<any>(set=>({users:sampleUsers,currentUser:sampleUsers[0],logout:async()=>set({currentUser:sampleUsers[0]})}));
