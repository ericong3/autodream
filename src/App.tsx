import React, { useEffect, useState } from 'react';
import {
  HashRouter,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';
import { useStore } from './store';
import Layout from './components/Layout';
import ToastContainer from './components/Toast';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Inventory from './pages/Inventory';
import CarDetail from './pages/CarDetail';
import Quotations from './pages/Quotations';
import Workshop from './pages/Workshop';
import Finance from './pages/Finance';
import TeamMembers from './pages/TeamMembers';
import Reminders from './pages/Reminders';
import History from './pages/History';
import AIAssistant from './pages/AIAssistant';
import Customers from './pages/Customers';
import Commission from './pages/Commission';
import LoanCalculator from './pages/LoanCalculator';
import CarCompare from './pages/CarCompare';
import SalesDashboard from './pages/SalesDashboard';
import Calendar from './pages/Calendar';
import Data from './pages/Data';
import Investors from './pages/Investors';
import InvestorPortal from './pages/InvestorPortal';
import LoanCases from './pages/LoanCases';
import BankerDashboard from './pages/BankerDashboard';
import AdminDashboard from './pages/AdminDashboard';
import Payments from './pages/Payments';
import CarMovement from './pages/CarMovement';

function roleHome(role: string) {
  if (role === 'banker') return '/banker-dashboard';
  if (role === 'investor') return '/investor-portal';
  if (role === 'admin') return '/admin-dashboard';
  return '/inventory';
}

// Layout wrapper for regular users — mounts once, stays mounted across navigation
function AuthedLayout() {
  const currentUser = useStore((s) => s.currentUser);
  if (!currentUser) return <Navigate to="/login" replace />;
  if (currentUser.role === 'banker') return <Navigate to="/banker-dashboard" replace />;
  if (currentUser.role === 'investor') return <Navigate to="/investor-portal" replace />;
  return <Layout />;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const currentUser = useStore((s) => s.currentUser);
  if (!currentUser) return <Navigate to="/login" replace />;
  if (currentUser.role !== 'admin') return <Navigate to={roleHome(currentUser.role)} replace />;
  return <>{children}</>;
}

// Layout wrapper for bankers
function BankerLayout() {
  const currentUser = useStore((s) => s.currentUser);
  if (!currentUser) return <Navigate to="/login" replace />;
  if (currentUser.role !== 'banker') return <Navigate to={roleHome(currentUser.role)} replace />;
  return <Layout />;
}

// Layout wrapper for investors
function InvestorLayout() {
  const currentUser = useStore((s) => s.currentUser);
  if (!currentUser) return <Navigate to="/login" replace />;
  if (currentUser.role !== 'investor') return <Navigate to="/inventory" replace />;
  return <Layout />;
}

// Role guards — wrap page elements only, not Layout
function RequireDirector({ children }: { children: React.ReactNode }) {
  const currentUser = useStore((s) => s.currentUser);
  if (!currentUser) return <Navigate to="/login" replace />;
  if (currentUser.role !== 'director' && currentUser.role !== 'shareholder') return <Navigate to={roleHome(currentUser.role)} replace />;
  return <>{children}</>;
}

function RequireDirectorOrAdmin({ children }: { children: React.ReactNode }) {
  const currentUser = useStore((s) => s.currentUser);
  if (!currentUser) return <Navigate to="/login" replace />;
  if (!['director', 'admin', 'shareholder'].includes(currentUser.role)) return <Navigate to={roleHome(currentUser.role)} replace />;
  return <>{children}</>;
}

function RequireSalesOrDirector({ children }: { children: React.ReactNode }) {
  const currentUser = useStore((s) => s.currentUser);
  if (!currentUser) return <Navigate to="/login" replace />;
  if (!['director', 'salesperson', 'shareholder'].includes(currentUser.role)) return <Navigate to={roleHome(currentUser.role)} replace />;
  return <>{children}</>;
}

export default function App() {
  const currentUser = useStore((s) => s.currentUser);
  const loadAll = useStore((s) => s.loadAll);
  const storeLoaded = useStore((s) => s.loaded);
  const [hydrated, setHydrated] = useState(() => useStore.persist.hasHydrated());
  const [fetchDone, setFetchDone] = useState(false);

  useEffect(() => {
    if (!hydrated) {
      const unsub = useStore.persist.onFinishHydration(() => setHydrated(true));
      return unsub;
    }
  }, []);

  useEffect(() => {
    loadAll().finally(() => setFetchDone(true));
  }, []);

  const ready = hydrated && (storeLoaded || fetchDone);

  if (!ready) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0a0a0a', color: '#c9a84c', fontFamily: 'sans-serif', fontSize: 18 }}>
        Loading...
      </div>
    );
  }

  return (
    <HashRouter>
      <ToastContainer />
      <Routes>
        {/* Car Movement — login-required but standalone (no Layout) */}
        <Route path="/movement" element={<CarMovement />} />

        {/* Public */}
        <Route
          path="/login"
          element={currentUser ? <Navigate to={roleHome(currentUser.role)} replace /> : <Login />}
        />
        <Route
          path="/"
          element={<Navigate to={currentUser ? roleHome(currentUser.role) : '/login'} replace />}
        />

        {/* Regular users — Layout mounts once, stays alive across all these routes */}
        <Route element={<AuthedLayout />}>
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/inventory/:id" element={<CarDetail />} />
          <Route path="/workshop" element={<Workshop />} />
          <Route path="/reminders" element={<Reminders />} />
          <Route path="/ai-assistant" element={<AIAssistant />} />
          <Route path="/payments" element={<Payments />} />
          <Route path="/quotations" element={<RequireSalesOrDirector><Quotations /></RequireSalesOrDirector>} />
          <Route path="/customers" element={<RequireSalesOrDirector><Customers /></RequireSalesOrDirector>} />
          <Route path="/commission" element={<RequireSalesOrDirector><Commission /></RequireSalesOrDirector>} />
          <Route path="/loan-calculator" element={<RequireSalesOrDirector><LoanCalculator /></RequireSalesOrDirector>} />
          <Route path="/car-compare" element={<RequireSalesOrDirector><CarCompare /></RequireSalesOrDirector>} />
          <Route path="/calendar" element={<RequireSalesOrDirector><Calendar /></RequireSalesOrDirector>} />
          <Route path="/sales-dashboard" element={<RequireSalesOrDirector><SalesDashboard /></RequireSalesOrDirector>} />
          <Route path="/loan-cases" element={<RequireSalesOrDirector><LoanCases /></RequireSalesOrDirector>} />
          <Route path="/finance" element={<RequireDirector><Finance /></RequireDirector>} />
          <Route path="/team" element={<RequireDirector><TeamMembers /></RequireDirector>} />
          <Route path="/data" element={<RequireSalesOrDirector><Data /></RequireSalesOrDirector>} />
          <Route path="/investors" element={<RequireDirector><Investors /></RequireDirector>} />
          <Route path="/dashboard" element={<RequireDirectorOrAdmin><Dashboard /></RequireDirectorOrAdmin>} />
          <Route path="/history" element={<RequireDirectorOrAdmin><History /></RequireDirectorOrAdmin>} />
          <Route path="/history/:id" element={<RequireDirectorOrAdmin><History /></RequireDirectorOrAdmin>} />
          <Route path="/admin-dashboard" element={<RequireAdmin><AdminDashboard /></RequireAdmin>} />
        </Route>

        {/* Banker — own Layout instance */}
        <Route element={<BankerLayout />}>
          <Route path="/banker-dashboard" element={<BankerDashboard />} />
        </Route>

        {/* Investor — own Layout instance */}
        <Route element={<InvestorLayout />}>
          <Route path="/investor-portal" element={<InvestorPortal />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
