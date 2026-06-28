import React, { Suspense, useEffect, useState } from 'react';
import {
  HashRouter,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';
import { useStore } from './store';
import Layout from './components/Layout';
import ToastContainer from './components/Toast';

const Login           = React.lazy(() => import('./pages/Login'));
const Dashboard       = React.lazy(() => import('./pages/Dashboard'));
const Inventory       = React.lazy(() => import('./pages/Inventory'));
const CarDetail       = React.lazy(() => import('./pages/CarDetail'));
const Quotations      = React.lazy(() => import('./pages/Quotations'));
const Workshop        = React.lazy(() => import('./pages/Workshop'));
const Finance         = React.lazy(() => import('./pages/Finance'));
const TeamMembers     = React.lazy(() => import('./pages/TeamMembers'));
const Reminders       = React.lazy(() => import('./pages/Reminders'));
const History         = React.lazy(() => import('./pages/History'));
const AIAssistant     = React.lazy(() => import('./pages/AIAssistant'));
const Customers       = React.lazy(() => import('./pages/Customers'));
const Commission      = React.lazy(() => import('./pages/Commission'));
const LoanCalculator  = React.lazy(() => import('./pages/LoanCalculator'));
const CarCompare      = React.lazy(() => import('./pages/CarCompare'));
const SalesDashboard  = React.lazy(() => import('./pages/SalesDashboard'));
const Calendar        = React.lazy(() => import('./pages/Calendar'));
const Data            = React.lazy(() => import('./pages/Data'));
const Investors       = React.lazy(() => import('./pages/Investors'));
const InvestorPortal  = React.lazy(() => import('./pages/InvestorPortal'));
const LoanCases       = React.lazy(() => import('./pages/LoanCases'));
const BankerDashboard = React.lazy(() => import('./pages/BankerDashboard'));
const Payments        = React.lazy(() => import('./pages/Payments'));

function RequireAuth({ children }: { children: React.ReactNode }) {
  const currentUser = useStore((s) => s.currentUser);
  if (!currentUser) return <Navigate to="/login" replace />;
  if (currentUser.role === 'banker') return <Navigate to="/banker-dashboard" replace />;
  if (currentUser.role === 'investor') return <Navigate to="/investor-portal" replace />;
  return <>{children}</>;
}

function roleHome(role: string) {
  if (role === 'banker') return '/banker-dashboard';
  if (role === 'investor') return '/investor-portal';
  return '/inventory';
}

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

function RequireInvestor({ children }: { children: React.ReactNode }) {
  const currentUser = useStore((s) => s.currentUser);
  if (!currentUser) return <Navigate to="/login" replace />;
  if (currentUser.role !== 'investor') return <Navigate to="/inventory" replace />;
  return <>{children}</>;
}

function RequireBanker({ children }: { children: React.ReactNode }) {
  const currentUser = useStore((s) => s.currentUser);
  if (!currentUser) return <Navigate to="/login" replace />;
  if (currentUser.role !== 'banker') return <Navigate to="/inventory" replace />;
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

  // If we have cached data from a previous session, show immediately and refresh in background.
  // If no cache (first visit or cleared storage), wait for the first fetch to complete.
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
      <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0a0a0a', color: '#c9a84c', fontFamily: 'sans-serif', fontSize: 18 }}>Loading...</div>}>
      <Routes>
        <Route
          path="/login"
          element={currentUser ? <Navigate to={currentUser.role === 'investor' ? '/investor-portal' : currentUser.role === 'banker' ? '/banker-dashboard' : '/inventory'} replace /> : <Login />}
        />
        <Route
          path="/"
          element={<Navigate to={currentUser ? (currentUser.role === 'investor' ? '/investor-portal' : currentUser.role === 'banker' ? '/banker-dashboard' : '/inventory') : '/login'} replace />}
        />
        <Route
          path="/dashboard"
          element={
            <RequireDirectorOrAdmin>
              <Layout>
                <Dashboard />
              </Layout>
            </RequireDirectorOrAdmin>
          }
        />
        <Route
          path="/inventory"
          element={
            <RequireAuth>
              <Layout>
                <Inventory />
              </Layout>
            </RequireAuth>
          }
        />
        <Route
          path="/inventory/:id"
          element={
            <RequireAuth>
              <Layout>
                <CarDetail />
              </Layout>
            </RequireAuth>
          }
        />
        <Route
          path="/quotations"
          element={
            <RequireAuth>
              <Layout>
                <Quotations />
              </Layout>
            </RequireAuth>
          }
        />
        <Route
          path="/workshop"
          element={
            <RequireAuth>
              <Layout>
                <Workshop />
              </Layout>
            </RequireAuth>
          }
        />
        <Route
          path="/finance"
          element={
            <RequireDirector>
              <Layout>
                <Finance />
              </Layout>
            </RequireDirector>
          }
        />
        <Route
          path="/team"
          element={
            <RequireDirector>
              <Layout>
                <TeamMembers />
              </Layout>
            </RequireDirector>
          }
        />
        <Route
          path="/reminders"
          element={
            <RequireAuth>
              <Layout>
                <Reminders />
              </Layout>
            </RequireAuth>
          }
        />
        <Route
          path="/history"
          element={
            <RequireDirectorOrAdmin>
              <Layout>
                <History />
              </Layout>
            </RequireDirectorOrAdmin>
          }
        />
        <Route
          path="/history/:id"
          element={
            <RequireDirectorOrAdmin>
              <Layout>
                <History />
              </Layout>
            </RequireDirectorOrAdmin>
          }
        />
        <Route
          path="/ai-assistant"
          element={
            <RequireAuth>
              <Layout>
                <AIAssistant />
              </Layout>
            </RequireAuth>
          }
        />
        <Route
          path="/sales-dashboard"
          element={
            <RequireSalesOrDirector>
              <Layout>
                <SalesDashboard />
              </Layout>
            </RequireSalesOrDirector>
          }
        />
        <Route
          path="/customers"
          element={
            <RequireSalesOrDirector>
              <Layout>
                <Customers />
              </Layout>
            </RequireSalesOrDirector>
          }
        />
        <Route
          path="/commission"
          element={
            <RequireSalesOrDirector>
              <Layout>
                <Commission />
              </Layout>
            </RequireSalesOrDirector>
          }
        />
        <Route
          path="/loan-calculator"
          element={
            <RequireSalesOrDirector>
              <Layout>
                <LoanCalculator />
              </Layout>
            </RequireSalesOrDirector>
          }
        />
        <Route
          path="/car-compare"
          element={
            <RequireSalesOrDirector>
              <Layout>
                <CarCompare />
              </Layout>
            </RequireSalesOrDirector>
          }
        />
        <Route
          path="/calendar"
          element={
            <RequireSalesOrDirector>
              <Layout>
                <Calendar />
              </Layout>
            </RequireSalesOrDirector>
          }
        />
        <Route
          path="/data"
          element={
            <RequireDirector>
              <Layout>
                <Data />
              </Layout>
            </RequireDirector>
          }
        />
        <Route
          path="/investors"
          element={
            <RequireDirector>
              <Layout>
                <Investors />
              </Layout>
            </RequireDirector>
          }
        />
        <Route
          path="/investor-portal"
          element={
            <RequireInvestor>
              <Layout>
                <InvestorPortal />
              </Layout>
            </RequireInvestor>
          }
        />
        <Route
          path="/loan-cases"
          element={
            <RequireSalesOrDirector>
              <Layout>
                <LoanCases />
              </Layout>
            </RequireSalesOrDirector>
          }
        />
        <Route
          path="/banker-dashboard"
          element={
            <RequireBanker>
              <Layout>
                <BankerDashboard />
              </Layout>
            </RequireBanker>
          }
        />
        <Route
          path="/payments"
          element={
            <RequireAuth>
              <Layout><Payments /></Layout>
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </HashRouter>
  );
}
