import {handleStaffProfiles} from '../../server/staffProfiles/core.mjs';
import {vercelHandler} from '../../server/garageBuilding/vercel.mjs';
export default vercelHandler(handleStaffProfiles);
