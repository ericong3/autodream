// GET /api/garage-building/projects          → projects this session may edit
// GET /api/garage-building/projects?id=<id>  → one project
// PUT /api/garage-building/projects          → { project } save (revision CAS)
import { handleProjects } from '../../server/garageBuilding/core.mjs';
import { vercelHandler } from '../../server/garageBuilding/vercel.mjs';

export default vercelHandler(handleProjects);
