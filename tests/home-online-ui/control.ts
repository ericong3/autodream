import {useStore} from './store';
const order=(id:string,action:string,extra:Record<string,unknown>={})=>({id,invoiceNumber:id,vehicle:'DEMO vehicle · Sample car',service:'tinted',action,scope:'Your order',href:'/garage/invoice/'+id,...extra});
export async function tintControl<T>(kind:string,action:string):Promise<T>{
 if(kind!=='home'||action!=='list')throw Error('This practice preview only displays Home tasks.');
 const role=useStore.getState().currentUser.role;
 const worker=role==='garage_installer',manager=['garage_head','director'].includes(role),finance=['director','admin'].includes(role);
 const money={toCollect:300,awaitingVerification:150,verifiedBalance:450};
 let tasks=worker?[
  order('DEMO-001','Continue your glass',{scope:'Your installation',href:'/garage/installer/job/DEMO-001',assignedGlass:2,availableGlass:0}),
  order('DEMO-004','Complete your correction work',{scope:'Your installation',href:'/garage/installer/job/DEMO-004',assignedGlass:1,availableGlass:0}),
  order('DEMO-005','Claim available glass',{scope:'Available work',href:'/garage/installer/job/DEMO-005',assignedGlass:0,availableGlass:4}),
 ]:role==='admin'?[]:[
  order('DEMO-001','Check customer balance',{money}),
  order('DEMO-002',role==='garage_head'?'Review installation':'Complete your final inspection',{href:role==='garage_head'?'/garage/installer/job/DEMO-002':'/garage/invoice/DEMO-002',money:{toCollect:0,awaitingVerification:0,verifiedBalance:0}}),
  order('DEMO-003','Arrange handover',{money:{toCollect:0,awaitingVerification:0,verifiedBalance:0}}),
 ];
 if(manager)tasks=tasks.map(t=>({...t,scope:'Team order',owner:'Sample salesman'}));
 return {tasks,hasMore:false,canSeeBalances:!worker,financeUnavailable:false,verification:finance?{count:2,hasMore:false,href:'/garage/payments'}:null,checkedAt:new Date().toISOString()} as T;
}
