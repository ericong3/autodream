import {handlePaymentProof} from '../../server/tintControl/proofs.mjs';
import {vercelHandler,productionDeps} from '../../server/garageBuilding/vercel.mjs';
export default vercelHandler(handlePaymentProof,productionDeps,{maxBodyBytes:3*1024*1024});
