import React, { useEffect, useState } from 'react';
import {
  HashRouter,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';
import { useStore } from './store';
import type { AppRole } from './config/access';
import {
  ADMIN_ONLY,
  DATA_ROLES,
  DIRECTOR_ROLES,
  SALES_ROLES,
  STAFF_ROLES,
  canAccess,
  roleHome,
} from './config/access';
import Layout from './components/Layout';
import ToastContainer from './components/Toast';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Inventory from './pages/Inventory';
import CarDetail from './pages/CarDetail';
import Quotations from './pages/Quotations';
import Workshop from './pages/Workshop';
import Finance from './pages/Finance';
import Payroll from './pages/Payroll';
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
import Claims from './pages/Claims';
import CarMovement from './pages/CarMovement';

function RequireRoles({ children, roles }: { children: React.ReactNode; roles: readonly AppRole[] }) {
  const currentUser = useStore((s) => s.currentUser);
  if (!currentUser) return <Navigate to="/login" replace />;
  if (!canAccess(currentUser.role, roles)) {
    return <Navigate to={roleHome(currentUser.role)} replace />;
  }
  return <>{children}</>;
}

// Layout wrapper for normal staff. Bankers and investors have intentionally isolated portals.
function StaffLayout() {
  const currentUser = useStore((s) => s.currentUser);
  if (!currentUser) return <Navigate to="/login" replace />;
  if (!canAccess(currentUser.role, STAFF_ROLES)) {
    return <Navigate to={roleHome(currentUser.role)} replace />;
  }
  return <Layout />;
}

function RoleLayout({ role }: { role: AppRole }) {
  const currentUser = useStore((s) => s.currentUser);
  if (!currentUser) return <Navigate to="/login" replace />;
  if (currentUser.role !== role) return <Navigate to={roleHome(currentUser.role)} replace />;
  return <Layout />;
}

export default function App() {
  const currentUser = useStore((s) => s.currentUser);
  const loadAll = useStore((s) => s.loadAll);
  const storeLoaded = useStore((s) => s.loaded);
  const [hydrated, setHydrated] = useState(() => useStore.persist.hasHydrated());
  const [fetchedForUserId, setFetchedForUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!hydrated) {
      const unsub = useStore.persist.onFinishHydration(() => setHydrated(true));
      return unsub;
    }
  }, [hydrated]);

  // Never fetch company data before a user is authenticated. After login (or a
  // persisted session is restored), loadAll refreshes the in-memory working set.
  useEffect(() => {
    if (!hydrated) return;
    if (!currentUser) {
      setFetchedForUserId(null);
      return;
    }

    let cancelled = false;
    setFetchedForUserId(null);
    loadAll().finally(() => {
      if (!cancelled) setFetchedForUserId(currentUser.id);
    });

    return () => { cancelled = true; };
  }, [hydrated, currentUser?.id, loadAll]);

  const ready = hydrated && (
    !currentUser ||
    storeLoaded ||
    fetchedForUserId === currentUser.id
  );

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
        {/* Public */}
        <Route
          path="/login"
          element={currentUser ? <Navigate to={roleHome(currentUser.role)} replace /> : <Login />}
        />
        <Route
          path="/"
          element={<Navigate to={currentUser ? roleHome(currentUser.role) : '/login'} replace />}
        />

        {/* Car movement is standalone, but still staff-only. */}
        <Route
          path="/movement"
          element={<RequireRoles roles={STAFF_ROLES}><CarMovement /></RequireRoles>}
        />

        {/* Staff app */}
        <Route element={<StaffLayout />}>
          <Route path="/inventory" element={<RequireRoles roles={STAFF_ROLES}><Inventory /></RequireRoles>} />
          <Route path="/inventory/:id" element={<RequireRoles roles={STAFF_ROLES}><CarDetail /></RequireRoles>} />
          <Route path="/reminders" element={<RequireRoles roles={STAFF_ROLES}><Reminders /></RequireRoles>} />
          <Route path="/ai-assistant" element={<RequireRoles roles={STAFF_ROLES}><AIAssistant /></RequireRoles>} />
          <Route path="/claims" element={<RequireRoles roles={STAFF_ROLES}><Claims /></RequireRoles>} />
          <Route path="/history" element={<RequireRoles roles={STAFF_ROLES}><History /></RequireRoles>} />
          <Route path="/history/:id" element={<RequireRoles roles={STAFF_ROLES}><History /></RequireRoles>} />

          {/* Admin operations */}
          <Route path="/workshop" element={<RequireRoles roles={ADMIN_ONLY}><Workshop /></RequireRoles>} />
          <Route path="/payments" element={<RequireRoles roles={ADMIN_ONLY}><Payments /></RequireRoles>} />
          <Route path="/admin-dashboard" element={<RequireRoles roles={ADMIN_ONLY}><AdminDashboard /></RequireRoles>} />

          {/* Sales */}
          <Route path="/quotations" element={<RequireRoles roles={SALES_ROLES}><Quotations /></RequireRoles>} />
          <Route path="/customers" element={<RequireRoles roles={SALES_ROLES}><Customers /></RequireRoles>} />
          <Route path="/commission" element={<RequireRoles roles={SALES_ROLES}><Commission /></RequireRoles>} />
          <Route path="/loan-calculator" element={<RequireRoles roles={SALES_ROLES}><LoanCalculator /></RequireRoles>} />
          <Route path="/car-compare" element={<RequireRoles roles={SALES_ROLES}><CarCompare /></RequireRoles>} />
          <Route path="/calendar" element={<RequireRoles roles={SALES_ROLES}><Calendar /></RequireRoles>} />
          <Route path="/sales-dashboard" element={<RequireRoles roles={SALES_ROLES}><SalesDashboard /></RequireRoles>} />
          <Route path="/loan-cases" element={<RequireRoles roles={SALES_ROLES}><LoanCases /></RequireRoles>} />

          {/* Management */}
          <Route path="/finance" element={<RequireRoles roles={DIRECTOR_ROLES}><Finance /></RequireRoles>} />
          <Route path="/payroll" element={<RequireRoles roles={DIRECTOR_ROLES}><Payroll /></RequireRoles>} />
          <Route path="/team" element={<RequireRoles roles={DIRECTOR_ROLES}><TeamMembers /></RequireRoles>} />
          <Route path="/investors" element={<RequireRoles roles={DIRECTOR_ROLES}><Investors /></RequireRoles>} />
          <Route path="/dashboard" element={<RequireRoles roles={DIRECTOR_ROLES}><Dashboard /></RequireRoles>} />
          <Route path="/data" element={<RequireRoles roles={DATA_ROLES}><Data /></RequireRoles>} />
        </Route>

        {/* Banker portal */}
        <Route element={<RoleLayout role="banker" />}>
          <Route path="/banker-dashboard" element={<BankerDashboard />} />
        </Route>

        {/* Investor portal */}
        <Route element={<RoleLayout role="investor" />}>
          <Route path="/investor-portal" element={<InvestorPortal />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
