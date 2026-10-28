import {ApiError,respond} from '../garageBuilding/core.mjs';
import {handleTintControl} from './core.mjs';
import {handleHomeTasks} from './home.mjs';
import {handlePaymentProof} from './proofs.mjs';
const handlers={home:handleHomeTasks,finance:handleTintControl('finance'),stock:handleTintControl('stock'),claims:handleTintControl('claims'),'payment-proof':handlePaymentProof};
export function handleTintRequest(req,deps){
 const params=new URL(req.url??'/', 'https://local.invalid').searchParams;
 const operation=params.get('operation');
 if(params.getAll('operation').length===1&&Object.hasOwn(handlers,operation))return handlers[operation](req,deps);
 return respond(req,deps,['POST'],async()=>{throw new ApiError(400,'INVALID','Choose a valid tint action.');});
}
