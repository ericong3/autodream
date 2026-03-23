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
      className={`bg-[#0d1526] rounded-xl p-5 border border-[#1a2a4a] border-l-4 ${borderColor} flex items-start gap-4`}
    >
      <div className={`p-2.5 rounded-lg bg-[#111d35] ${iconColor}`}>
        <Icon size={22} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-gray-400 text-sm font-medium">{title}</p>
        <p className="text-white text-2xl font-bold mt-0.5 truncate">{value}</p>
        {subtitle && (
          <p className="text-gray-500 text-xs mt-0.5">{subtitle}</p>
        )}
        {trend && (
          <p className={`text-xs mt-1 font-medium ${trendUp ? 'text-green-400' : 'text-red-400'}`}>
            {trendUp ? '↑' : '↓'} {trend}
          </p>
        )}
      </div>
    </div>
  );
}
