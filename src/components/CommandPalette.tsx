import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  LayoutDashboard,
  Car,
  Users,
  FileText,
  TrendingUp,
  UsersRound,
  Briefcase,
  CalendarDays,
  Bot,
  History,
} from 'lucide-react';
import { useStore } from '../store';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import type { Car as CarType, Customer } from '../types';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

interface PageResult {
  kind: 'page';
  label: string;
  path: string;
  icon: React.ElementType;
}

interface CarResult {
  kind: 'car';
  label: string;
  sub: string;
  path: string;
  car: CarType;
}

interface CustomerResult {
  kind: 'customer';
  label: string;
  sub: string;
  path: string;
  customer: Customer;
}

type Result = PageResult | CarResult | CustomerResult;

const PAGES: PageResult[] = [
  { kind: 'page', label: 'Dashboard',    path: '/dashboard',    icon: LayoutDashboard },
  { kind: 'page', label: 'Inventory',    path: '/inventory',    icon: Car             },
  { kind: 'page', label: 'Leads & Loan', path: '/customers',    icon: Users           },
  { kind: 'page', label: 'Quotations',   path: '/quotations',   icon: FileText        },
  { kind: 'page', label: 'Finance',      path: '/finance',      icon: TrendingUp      },
  { kind: 'page', label: 'Team',         path: '/team',         icon: UsersRound      },
  { kind: 'page', label: 'Investors',    path: '/investors',    icon: Briefcase       },
  { kind: 'page', label: 'Calendar',     path: '/calendar',     icon: CalendarDays    },
  { kind: 'page', label: 'AI Assistant', path: '/ai-assistant', icon: Bot             },
  { kind: 'page', label: 'History',      path: '/history',      icon: History         },
];

export default function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  useBodyScrollLock(isOpen);

  const navigate = useNavigate();
  const cars = useStore((s) => s.cars);
  const customers = useStore((s) => s.customers);

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActiveIndex(0);
      // Delay focus slightly to ensure the portal has rendered
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  const trimmed = query.trim().toLowerCase();

  // Filter pages
  const pageResults: PageResult[] = PAGES.filter((p) =>
    p.label.toLowerCase().includes(trimmed)
  );

  // Filter cars
  const carResults: CarResult[] = cars
    .filter((car) => {
      const label = `${car.year} ${car.make} ${car.model}`.toLowerCase();
      const plate = (car.carPlate ?? '').toLowerCase();
      return label.includes(trimmed) || plate.includes(trimmed);
    })
    .slice(0, 8)
    .map((car) => ({
      kind: 'car' as const,
      label: `${car.year} ${car.make} ${car.model}${car.variant ? ` ${car.variant}` : ''}`,
      sub: car.carPlate ?? '',
      path: `/inventory/${car.id}`,
      car,
    }));

  // Filter customers
  const customerResults: CustomerResult[] = customers
    .filter((c) => {
      return (
        c.name.toLowerCase().includes(trimmed) ||
        (c.phone ?? '').toLowerCase().includes(trimmed)
      );
    })
    .slice(0, 8)
    .map((customer) => ({
      kind: 'customer' as const,
      label: customer.name,
      sub: customer.phone,
      path: '/customers',
      customer,
    }));

  // Build flat results list for keyboard nav — only show groups with matches
  const allResults: Result[] = [
    ...(pageResults.length > 0 ? pageResults : []),
    ...(carResults.length > 0 ? carResults : []),
    ...(customerResults.length > 0 ? customerResults : []),
  ];

  const totalResults = allResults.length;

  // Clamp active index when results change
  useEffect(() => {
    setActiveIndex((prev) => (totalResults === 0 ? 0 : Math.min(prev, totalResults - 1)));
  }, [totalResults]);

  const handleSelect = useCallback(
    (result: Result) => {
      navigate(result.path);
      onClose();
    },
    [navigate, onClose]
  );

  // Keyboard handler
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => (totalResults === 0 ? 0 : (prev + 1) % totalResults));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => (totalResults === 0 ? 0 : (prev - 1 + totalResults) % totalResults));
        return;
      }
      if (e.key === 'Enter' && totalResults > 0) {
        e.preventDefault();
        handleSelect(allResults[activeIndex]);
        return;
      }
      // Tab for focus trap — keep focus inside
      if (e.key === 'Tab') {
        e.preventDefault();
      }
    },
    [totalResults, activeIndex, allResults, handleSelect, onClose]
  );

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const active = listRef.current.querySelector<HTMLElement>('[data-active="true"]');
    if (active) {
      active.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  // Close on Escape via global listener (also captures when focus is not in input)
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isEmpty = totalResults === 0;

  // Determine result index offset per group for highlighting
  const pageOffset = 0;
  const carOffset = pageResults.length;
  const customerOffset = pageResults.length + carResults.length;

  const modal = (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-start justify-center pt-[12vh] px-4">
      {/* Backdrop click to close */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Panel */}
      <div
        ref={panelRef}
        className="relative max-w-xl w-full mx-4 bg-obsidian-900 border border-gold-500/20 rounded-2xl shadow-2xl overflow-hidden"
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        {/* Search row */}
        <div className="flex items-center border-b border-obsidian-400/40">
          <div className="pl-4 shrink-0 text-gray-500">
            <Search size={16} />
          </div>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            placeholder="Search pages, cars, customers..."
            className="w-full bg-transparent px-4 py-4 text-white placeholder-gray-500 text-base outline-none"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <div className="pr-4 shrink-0 flex items-center gap-1.5">
            <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded border border-obsidian-400/60 text-[10px] text-gray-500 font-mono">
              ⌘K
            </kbd>
            <kbd className="inline-flex items-center px-1.5 py-0.5 rounded border border-obsidian-400/60 text-[10px] text-gray-500 font-mono">
              ESC
            </kbd>
          </div>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-96 overflow-y-auto">
          {isEmpty && trimmed.length > 0 && (
            <p className="text-gray-500 text-sm text-center py-8">
              No results for &ldquo;{query.trim()}&rdquo;
            </p>
          )}

          {isEmpty && trimmed.length === 0 && (
            <p className="text-gray-500 text-sm text-center py-8">
              Type to search pages, cars or customers&hellip;
            </p>
          )}

          {/* Pages group */}
          {pageResults.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-gray-500 px-4 py-2">
                Pages
              </p>
              {pageResults.map((result, i) => {
                const idx = pageOffset + i;
                const isActive = idx === activeIndex;
                const Icon = result.icon;
                return (
                  <button
                    key={result.path}
                    data-active={isActive}
                    onClick={() => handleSelect(result)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors text-left ${
                      isActive
                        ? 'bg-gold-500/10 text-gold-300'
                        : 'text-gray-300 hover:bg-obsidian-700/60'
                    }`}
                  >
                    <Icon
                      size={15}
                      className={isActive ? 'text-gold-400' : 'text-gray-500'}
                    />
                    <span className="text-sm">{result.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Cars group */}
          {carResults.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-gray-500 px-4 py-2">
                Cars
              </p>
              {carResults.map((result, i) => {
                const idx = carOffset + i;
                const isActive = idx === activeIndex;
                return (
                  <button
                    key={result.car.id}
                    data-active={isActive}
                    onClick={() => handleSelect(result)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors text-left ${
                      isActive
                        ? 'bg-gold-500/10 text-gold-300'
                        : 'text-gray-300 hover:bg-obsidian-700/60'
                    }`}
                  >
                    <Car
                      size={15}
                      className={isActive ? 'text-gold-400' : 'text-gray-500'}
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm block truncate">{result.label}</span>
                      {result.sub && (
                        <span className="text-[11px] text-gray-500 block truncate">
                          {result.sub}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Customers group */}
          {customerResults.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-gray-500 px-4 py-2">
                Customers
              </p>
              {customerResults.map((result, i) => {
                const idx = customerOffset + i;
                const isActive = idx === activeIndex;
                return (
                  <button
                    key={result.customer.id}
                    data-active={isActive}
                    onClick={() => handleSelect(result)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors text-left ${
                      isActive
                        ? 'bg-gold-500/10 text-gold-300'
                        : 'text-gray-300 hover:bg-obsidian-700/60'
                    }`}
                  >
                    <Users
                      size={15}
                      className={isActive ? 'text-gold-400' : 'text-gray-500'}
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm block truncate">{result.label}</span>
                      {result.sub && (
                        <span className="text-[11px] text-gray-500 block truncate">
                          {result.sub}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
