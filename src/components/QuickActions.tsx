import { useState, useEffect } from 'react';
import { Search, Plus, Bell, History } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface QuickActionsProps {
  onSearch?: () => void;
}

export default function QuickActions({ onSearch }: QuickActionsProps) {
  const navigate = useNavigate();
  const [proximity, setProximity] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [tooltipIndex, setTooltipIndex] = useState<number | null>(null);
  const visible = proximity || hovering;

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setProximity(e.clientX >= window.innerWidth - 64);
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const buttons = [
    { icon: Search,  label: 'Search',    onClick: () => onSearch?.() },
    { icon: Plus,    label: 'Add Car',   onClick: () => navigate('/inventory?add=1') },
    { icon: Bell,    label: 'Reminders', onClick: () => navigate('/reminders') },
    { icon: History, label: 'History',   onClick: () => navigate('/history') },
  ];

  return (
    <div
      className={`hidden xl:flex fixed right-0 top-1/2 -translate-y-1/2 z-20 flex-col gap-2 pr-3 pl-1 py-3
        transition-transform duration-300 ease-out
        ${visible ? 'translate-x-0' : 'translate-x-full'}`}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => { setHovering(false); setTooltipIndex(null); }}
    >
      {buttons.map((btn, i) => {
        const Icon = btn.icon;
        return (
          <div key={btn.label} className="relative flex items-center">
            {tooltipIndex === i && (
              <div className="absolute right-12 px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap pointer-events-none
                bg-obsidian-700 border border-obsidian-400/30 text-white shadow-card">
                {btn.label}
                <span className="absolute top-1/2 -right-1 -translate-y-1/2 w-2 h-2 rotate-45 bg-obsidian-700 border-r border-t border-obsidian-400/30" />
              </div>
            )}
            <button
              onClick={btn.onClick}
              onMouseEnter={() => setTooltipIndex(i)}
              onMouseLeave={() => setTooltipIndex(null)}
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
