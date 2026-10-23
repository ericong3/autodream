import GarageShell from '../components/GarageShell';
import StaffAccountAccess from './StaffAccountAccess';

export default function GarageTeamMembers(){
 return <GarageShell title="Team Members" nav><StaffAccountAccess embedded/></GarageShell>;
}
