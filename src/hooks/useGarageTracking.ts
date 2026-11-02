import {useCallback,useEffect,useRef,useState} from 'react';
import {useStore} from '../store';
import {loadGarageTracking,type GarageTrackingRow,type GarageTrackingState} from '../lib/garageTracking';
import {useInstallerJobUpdates} from './useInstallerJobUpdates';
import {useWorkOrderActivityUpdates} from './useWorkOrderActivityUpdates';
let cached:{actor:string;rows:GarageTrackingRow[]}|undefined;
export function useGarageTracking():GarageTrackingState{
 const user=useStore(s=>s.currentUser),actor=user?`${user.id}:${user.role}:${user.businessAccess}`:'';
 const [state,setState]=useState(()=>({actor,rows:cached?.actor===actor?cached.rows:[],loading:cached?.actor!==actor,refreshing:false,error:''}));
 const epoch=useRef(0),timer=useRef<ReturnType<typeof setTimeout>>(),reloadRef=useRef<()=>void>(()=>{});
 const reload=useCallback(()=>reloadRef.current(),[]);
 useEffect(()=>{
  const mine=++epoch.current;let running=false,dirty=false;
  if(cached?.actor!==actor)cached=undefined;
  setState({actor,rows:cached?.rows??[],loading:!cached,refreshing:!!cached,error:''});
  const run=async()=>{
   if(mine!==epoch.current||!actor)return;
   if(running){dirty=true;return;}running=true;
   setState(s=>s.actor===actor?{...s,refreshing:!s.loading,error:''}:s);
   try{const rows=await loadGarageTracking();if(mine===epoch.current){cached={actor,rows};setState({actor,rows,loading:false,refreshing:false,error:''});}}
   catch(e){if(mine===epoch.current)setState(s=>({...s,loading:false,refreshing:false,error:e instanceof Error?e.message:'Could not load work orders.'}));}
   finally{running=false;if(dirty&&mine===epoch.current){dirty=false;void run();}}
  };
  reloadRef.current=()=>{clearTimeout(timer.current);timer.current=setTimeout(()=>void run(),120);};
  void run();
  return()=>{epoch.current++;clearTimeout(timer.current);};
 },[actor]);
 useInstallerJobUpdates(reload);
 useWorkOrderActivityUpdates('all',reload);
 return state.actor===actor?{...state,reload}:{rows:[],loading:true,refreshing:false,error:'',reload};
}
