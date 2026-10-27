import {handleSales} from '../../server/sales/core.mjs';
import {vercelHandler} from '../../server/garageBuilding/vercel.mjs';
export default vercelHandler(handleSales);
