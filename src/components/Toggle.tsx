import React from 'react';

interface ToggleProps {
  value: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
  title?: string;
}

export default function Toggle({ value, onChange, label, disabled = false, title }: ToggleProps) {
  return (
    <label
      title={title}
      className={`inline-flex items-center gap-2.5 select-none ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
    >
      <button
        type="button"
        role="switch"
        aria-checked={value}
        disabled={disabled}
        onClick={() => !disabled && onChange(!value)}
        title={title}
        className={[
          'toggle-track',
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full',
          'border transition-all duration-300 ease-in-out focus-visible:outline-none',
          'focus-visible:ring-2 focus-visible:ring-gold-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-obsidian-900',
          value
            ? 'bg-gradient-to-r from-gold-300 to-gold-500 border-gold-400/60 shadow-gold-sm'
            : 'bg-obsidian-700 border-obsidian-400/40',
          disabled ? 'cursor-not-allowed' : '',
        ].join(' ')}
      >
        <span
          className={[
            'toggle-thumb',
            'inline-block h-4 w-4 rounded-full transition-all duration-300',
            'shadow-[0_1px_4px_rgba(0,0,0,0.6)]',
            value
              ? 'translate-x-6 bg-obsidian-900'
              : 'translate-x-1 bg-obsidian-300/70',
          ].join(' ')}
          style={{ willChange: 'transform' }}
        />
      </button>

      {label && (
        <span className={`text-sm font-medium ${value ? 'text-gold-200' : 'text-white/50'} transition-colors duration-200`}>
          {label}
        </span>
      )}
    </label>
  );
}
