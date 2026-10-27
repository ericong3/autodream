import {handleAppointments} from '../../server/appointments/core.mjs';
import {vercelHandler} from '../../server/garageBuilding/vercel.mjs';
export default vercelHandler(handleAppointments);
