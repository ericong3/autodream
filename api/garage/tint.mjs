import {handleTintRequest} from '../../server/tintControl/router.mjs';
import {vercelHandler} from '../../server/garageBuilding/vercel.mjs';
export default vercelHandler(handleTintRequest,undefined,{maxBodyBytes:3*1024*1024});
