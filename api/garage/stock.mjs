import {handleTintControl} from '../../server/tintControl/core.mjs';
import {vercelHandler} from '../../server/garageBuilding/vercel.mjs';
export default vercelHandler(handleTintControl('stock'));
