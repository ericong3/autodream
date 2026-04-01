import React from 'react';
import {
  HashRouter,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';
import { useStore } from './store';
import Layout from './components/Layout';
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
import SalesPipeline from './pages/SalesPipeline';
import Commission from './pages/Commission';
import LoanCalculator from './pages/LoanCalculator';
import CarCompare from './pages/CarCompare';
import SalesDashboard from './pages/SalesDashboard';
import Calendar from './pages/Calendar';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const currentUser = useStore((s) => s.currentUser);
  if (!currentUser) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireDirector({ children }: { children: React.ReactNode }) {
  const currentUser = useStore((s) => s.currentUser);
  if (!currentUser) return <Navigate to="/login" replace />;
  if (currentUser.role !== 'director') return <Navigate to="/inventory" replace />;
  return <>{children}</>;
}

function RequireSalesOrDirector({ children }: { children: React.ReactNode }) {
  const currentUser = useStore((s) => s.currentUser);
  if (!currentUser) return <Navigate to="/login" replace />;
  if (currentUser.role !== 'director' && currentUser.role !== 'salesperson') return <Navigate to="/inventory" replace />;
  return <>{children}</>;
}

export default function App() {
  const currentUser = useStore((s) => s.currentUser);

  return (
    <HashRouter>
      <Routes>
        <Route
          path="/login"
          element={currentUser ? <Navigate to="/inventory" replace /> : <Login />}
        />
        <Route
          path="/"
          element={<Navigate to={currentUser ? '/inventory' : '/login'} replace />}
        />
        <Route
          path="/dashboard"
          element={
            <RequireDirector>
              <Layout>
                <Dashboard />
              </Layout>
            </RequireDirector>
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
            <RequireDirector>
              <Layout>
                <History />
              </Layout>
            </RequireDirector>
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
          path="/pipeline"
          element={
            <RequireSalesOrDirector>
              <Layout>
                <SalesPipeline />
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
