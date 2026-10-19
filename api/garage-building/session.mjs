// GET    /api/garage-building/session  → current Garage online session
// POST   /api/garage-building/session  → { username, password } re-confirm
// DELETE /api/garage-building/session  → sign out of online saving
import { handleSession } from '../../server/garageBuilding/core.mjs';
import { vercelHandler } from '../../server/garageBuilding/vercel.mjs';

export default vercelHandler(handleSession);
