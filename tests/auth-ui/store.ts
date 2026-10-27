import {create} from 'zustand';
export const useStore=create<any>((set)=>({currentUser:null,loaded:true,login:async()=>false,logout:async(options?:{revokeSession?:boolean})=>{if(options?.revokeSession!==false)await fetch('/api/test-session',{method:'DELETE'});set({currentUser:null,loaded:false});}}));
