import React, { useEffect, useState } from 'react';
import {
  HashRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
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

function RequireAuth({ children }: { children: React.ReactNode }) {
  const currentUser = useStore((s) => s.currentUser);
  if (!currentUser) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireDirector({ children }: { children: React.ReactNode }) {
  const currentUser = useStore((s) => s.currentUser);
  if (!currentUser) return <Navigate to="/login" replace />;
  if (currentUser.role !== 'director' && currentUser.role !== 'shareholder') return <Navigate to="/inventory" replace />;
  return <>{children}</>;
}

function RequireDirectorOrAdmin({ children }: { children: React.ReactNode }) {
  const currentUser = useStore((s) => s.currentUser);
  if (!currentUser) return <Navigate to="/login" replace />;
  if (!['director', 'admin', 'shareholder'].includes(currentUser.role)) return <Navigate to="/inventory" replace />;
  return <>{children}</>;
}

function RequireSalesOrDirector({ children }: { children: React.ReactNode }) {
  const currentUser = useStore((s) => s.currentUser);
  if (!currentUser) return <Navigate to="/login" replace />;
  if (!['director', 'salesperson', 'shareholder'].includes(currentUser.role)) return <Navigate to="/inventory" replace />;
  return <>{children}</>;
}

function RequireInvestor({ children }: { children: React.ReactNode }) {
  const currentUser = useStore((s) => s.currentUser);
  if (!currentUser) return <Navigate to="/login" replace />;
  if (currentUser.role !== 'investor') return <Navigate to="/inventory" replace />;
  return <>{children}</>;
}

export default function App() {
  const currentUser = useStore((s) => s.currentUser);
  const loadAll = useStore((s) => s.loadAll);
  const [loading, setLoading] = useState(true);
  const [hydrated, setHydrated] = useState(() => useStore.persist.hasHydrated());

  useEffect(() => {
    if (!hydrated) {
      const unsub = useStore.persist.onFinishHydration(() => setHydrated(true));
      return unsub;
    }
  }, []);

  useEffect(() => {
    loadAll().finally(() => setLoading(false));
  }, []);

  if (loading || !hydrated) {
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
        <Route
          path="/login"
          element={currentUser ? <Navigate to={currentUser.role === 'investor' ? '/investor-portal' : '/inventory'} replace /> : <Login />}
        />
        <Route
          path="/"
          element={<Navigate to={currentUser ? (currentUser.role === 'investor' ? '/investor-portal' : '/inventory') : '/login'} replace />}
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
