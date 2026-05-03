import React from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  back?: () => void;
}

export default function PageHeader({ title, subtitle, action, back }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-4 mb-6">
      <div className="flex items-center gap-3 min-w-0">
        {back && (
          <button
            onClick={back}
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg
              bg-obsidian-700/60 border border-obsidian-400/50
              text-gray-400 hover:text-white hover:border-obsidian-300/60 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        )}
        <div className="min-w-0">
          <h1 className="font-display text-white font-bold text-xl leading-none truncate">{title}</h1>
          {subtitle && (
            <p className="text-gray-500 text-sm mt-1 leading-none">{subtitle}</p>
          )}
        </div>
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}
