import {handleEnquiries} from '../../server/enquiries/core.mjs';
import {vercelHandler} from '../../server/garageBuilding/vercel.mjs';
export default vercelHandler(handleEnquiries);
