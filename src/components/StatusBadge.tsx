import React from 'react';

interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

interface BadgeConfig {
  colour: string;
  label: string;
  live?: boolean;
}

const STATUS_MAP: Record<string, BadgeConfig> = {
  available:      { colour: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', label: 'Available' },
  coming_soon:    { colour: 'bg-blue-500/15 text-blue-400 border-blue-500/30',          label: 'Coming Soon' },
  in_workshop:    { colour: 'bg-orange-500/15 text-orange-400 border-orange-500/30',    label: 'In Workshop' },
  ready:          { colour: 'bg-teal-500/15 text-teal-400 border-teal-500/30',          label: 'Ready' },
  photo_complete: { colour: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',          label: 'Photo Done' },
  submitted:      { colour: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',    label: 'Submitted' },
  deal_pending:   { colour: 'bg-amber-500/15 text-amber-400 border-amber-500/30',       label: 'Deal Pending', live: true },
  reserved:       { colour: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',    label: 'Reserved',     live: true },
  sold:           { colour: 'bg-violet-500/15 text-violet-400 border-violet-500/30',    label: 'Sold' },
  delivered:      { colour: 'bg-violet-500/15 text-violet-400 border-violet-500/30',    label: 'Delivered' },
};

const FALLBACK: BadgeConfig = {
  colour: 'bg-white/10 text-white/50 border-white/20',
  label: '',
};

export default function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  const config = STATUS_MAP[status] ?? { ...FALLBACK, label: status.replace(/_/g, ' ') };

  const sizeClasses =
    size === 'md'
      ? 'text-xs px-2.5 py-1 rounded-full'
      : 'text-[10px] px-2 py-0.5 rounded-full';

  return (
    <span
      className={[
        sizeClasses,
        'inline-flex items-center gap-1 font-semibold uppercase tracking-wide border whitespace-nowrap',
        config.colour,
        config.live ? 'badge-live' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {config.live && (
        <span className="relative inline-flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-current" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-current" />
        </span>
      )}
      {config.label}
    </span>
  );
}
