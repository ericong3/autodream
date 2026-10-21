import { handleAppSession } from '../../server/garageBuilding/core.mjs';
import { vercelHandler } from '../../server/garageBuilding/vercel.mjs';
export default vercelHandler(handleAppSession);
