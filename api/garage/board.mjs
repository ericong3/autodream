import {handleEnquiryBoard} from '../../server/enquiries/board.mjs';
import {vercelHandler} from '../../server/garageBuilding/vercel.mjs';
export default vercelHandler(handleEnquiryBoard);
