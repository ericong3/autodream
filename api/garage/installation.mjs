import {handleInstallation} from '../../server/installation/core.mjs';
import {vercelHandler} from '../../server/garageBuilding/vercel.mjs';
export default vercelHandler(handleInstallation);
