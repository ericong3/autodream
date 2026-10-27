import {create} from 'zustand';
export const sampleUsers=[{id:'i1',name:'Installer A',role:'garage_installer'},{id:'i2',name:'Installer B',role:'garage_installer'},{id:'head',name:'Garage Head',role:'garage_head'},{id:'sales',name:'Salesman',role:'garage_salesman'},{id:'director',name:'Director',role:'director'}].map(u=>({...u,username:u.id,businessAccess:u.role==='director'?'both':'garage'}));
export const useStore=create<any>(()=>({users:sampleUsers,currentUser:sampleUsers[0]}));
