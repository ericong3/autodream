import React from 'react';
import {
  BrowserRouter,
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
import Salespeople from './pages/Salespeople';
import TeamMembers from './pages/TeamMembers';
import Reminders from './pages/Reminders';
import AIAssistant from './pages/AIAssistant';

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

export default function App() {
  const currentUser = useStore((s) => s.currentUser);

  return (
    <BrowserRouter>
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
          path="/salespeople"
          element={
            <RequireDirector>
              <Layout>
                <Salespeople />
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
          path="/ai-assistant"
          element={
            <RequireAuth>
              <Layout>
                <AIAssistant />
              </Layout>
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
