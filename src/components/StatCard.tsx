import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  borderColor: string;
  iconColor: string;
  trend?: string;
  trendUp?: boolean;
}

export default function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  borderColor,
  iconColor,
  trend,
  trendUp,
}: StatCardProps) {
  return (
    <div
      className={`relative rounded-xl p-5 border border-l-4 ${borderColor} border-obsidian-400 flex items-start gap-4 overflow-hidden
        bg-card-gradient shadow-card
        hover:border-obsidian-300 hover:shadow-card-lg transition-all duration-200 group`}
    >
      {/* Ambient corner glow */}
      <div className="absolute -top-6 -left-6 w-28 h-28 rounded-full blur-2xl opacity-[0.07] bg-gold-300 pointer-events-none" />

      <div className={`relative p-2.5 rounded-lg bg-obsidian-700 ${iconColor}
        group-hover:scale-110 transition-transform duration-200
        shadow-[0_2px_8px_rgba(0,0,0,0.4)]`}>
        <Icon size={22} />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-obsidian-300/80 mb-1">
          {title}
        </p>
        <p className="text-white text-2xl font-bold truncate leading-none">{value}</p>
        {subtitle && (
          <p className="text-obsidian-300/60 text-xs mt-1">{subtitle}</p>
        )}
        {trend && (
          <p className={`text-xs mt-1.5 font-semibold flex items-center gap-0.5 ${trendUp ? 'text-emerald-400' : 'text-red-400'}`}>
            <span>{trendUp ? '▲' : '▼'}</span>
            {trend}
          </p>
        )}
      </div>
    </div>
  );
}
