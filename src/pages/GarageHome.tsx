import { Navigate } from 'react-router-dom';
import { useStore } from '../store';
import { garageHome } from '../utils/landingPath';

// The old card hub — every module now lives in GarageShell's top tab bar, so
// /garage (still the default back target on many pages) just forwards to
// the role's landing page.
export default function GarageHome() {
  const currentUser = useStore((s) => s.currentUser);
  return <Navigate to={garageHome(currentUser?.role ?? '')} replace />;
}
