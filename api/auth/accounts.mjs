import { handleAccounts } from '../../server/accounts/core.mjs';
import { vercelHandler } from '../../server/garageBuilding/vercel.mjs';
export default vercelHandler(handleAccounts);
