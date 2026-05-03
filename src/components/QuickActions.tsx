import { useState } from 'react';
import { Search, Plus, Bell, History, LucideIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface QuickActionsProps {
  onAddCar?: () => void;
  onSearch?: () => void;
}

interface ActionButton {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}

interface TooltipState {
  index: number;
}

export default function QuickActions({ onAddCar, onSearch }: QuickActionsProps) {
  const navigate = useNavigate();
  const [activeTooltip, setActiveTooltip] = useState<TooltipState | null>(null);

  const buttons: ActionButton[] = [
    {
      icon: Search,
      label: 'Search',
      onClick: () => onSearch?.(),
    },
    {
      icon: Plus,
      label: 'Add Car',
      onClick: () => onAddCar?.(),
    },
    {
      icon: Bell,
      label: 'Reminders',
      onClick: () => navigate('/reminders'),
    },
    {
      icon: History,
      label: 'History',
      onClick: () => navigate('/history'),
    },
  ];

  return (
    <div className="hidden xl:flex fixed right-4 top-1/2 -translate-y-1/2 z-20 flex-col gap-2">
      {buttons.map((btn, i) => {
        const Icon = btn.icon;
        const showTooltip = activeTooltip?.index === i;
        return (
          <div key={btn.label} className="relative flex items-center">
            {/* Tooltip */}
            {showTooltip && (
              <div
                className="absolute right-12 px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap pointer-events-none
                  bg-obsidian-700 border border-obsidian-400/30 text-white shadow-card"
              >
                {btn.label}
                {/* Arrow pointing right */}
                <span
                  className="absolute top-1/2 -right-1 -translate-y-1/2 w-2 h-2 rotate-45 bg-obsidian-700 border-r border-t border-obsidian-400/30"
                />
              </div>
            )}

            <button
              onClick={btn.onClick}
              onMouseEnter={() => setActiveTooltip({ index: i })}
              onMouseLeave={() => setActiveTooltip(null)}
              aria-label={btn.label}
              className="w-10 h-10 rounded-xl bg-obsidian-800/80 border border-obsidian-400/40
                flex items-center justify-center text-gray-400
                hover:text-gold-300 hover:border-gold-500/40 hover:bg-obsidian-700/80
                transition-all backdrop-blur-sm"
            >
              <Icon size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
