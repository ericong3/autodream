import React from 'react';
import { LogOut, Bell } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useStore } from '../store';

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/inventory': 'Inventory',
  '/deals': 'Deals Pipeline',
  '/quotations': 'Quotations',
  '/workshop': 'Workshop',
  '/finance': 'Finance',
  '/salespeople': 'Salespeople',
  '/reminders': 'Instructions',
  '/ai-assistant': 'AI Assistant',
};

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const logout = useStore((s) => s.logout);
  const currentUser = useStore((s) => s.currentUser);
  const instructions = useStore((s) => s.instructions);
  const navigate = useNavigate();
  const location = useLocation();

  const pendingCount = instructions.filter((i) => {
    if (currentUser?.role === 'director') {
      return i.type === 'request' && i.status === 'pending';
    }
    if (i.type === 'instruction' && i.status === 'pending') {
      if (i.toType === 'all') return true;
      if (i.toType === 'department') {
        if (i.toDepartment === 'salesman') return currentUser?.role === 'salesperson';
        if (i.toDepartment === 'mechanic') return currentUser?.role === 'mechanic';
      }
      if (i.toType === 'individual') return i.toIds?.includes(currentUser?.id ?? '');
    }
    return false;
  }).length;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const title =
    Object.entries(PAGE_TITLES).find(([path]) =>
      location.pathname.startsWith(path)
    )?.[1] ?? 'AutoDream';

  return (
    <div className="flex min-h-screen bg-[#0a0f1e]">
      <Sidebar />
      <div className="flex-1 flex flex-col min-h-screen overflow-hidden">
        {/* Topbar */}
        <header className="h-16 bg-[#0d1526] border-b border-[#1a2a4a] flex items-center justify-between px-6">
          <h2 className="text-white font-semibold text-lg">{title}</h2>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/reminders')}
              className="relative p-2 rounded-lg text-gray-400 hover:text-white hover:bg-[#1a2a4a] transition-colors"
            >
              <Bell size={18} />
              {pendingCount > 0 && (
                <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 rounded-full text-[10px] text-white flex items-center justify-center font-bold">
                  {pendingCount}
                </span>
              )}
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-gray-400 hover:text-white hover:bg-[#1a2a4a] transition-colors text-sm"
            >
              <LogOut size={16} />
              Logout
            </button>
          </div>
        </header>
        {/* Main content */}
        <main className="flex-1 p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
