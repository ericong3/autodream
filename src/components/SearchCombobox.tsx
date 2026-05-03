import React, { useState, useRef, useEffect, useId } from 'react';
import { ChevronDown } from 'lucide-react';

interface Option {
  value: string;
  label: string;
}

interface SearchComboboxProps {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  placeholder?: string;
  className?: string;
}

export default function SearchCombobox({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  className = '',
}: SearchComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  // Close on outside click
  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (open && searchRef.current) {
      searchRef.current.focus();
    }
  }, [open]);

  const filtered = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  const selectedLabel = options.find((o) => o.value === value)?.label ?? '';

  const handleSelect = (optValue: string) => {
    onChange(optValue);
    setOpen(false);
    setQuery('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen((prev) => !prev);
    }
    if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Trigger button — styled to match .input */}
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onKeyDown={handleKeyDown}
        onClick={() => setOpen((prev) => !prev)}
        className="input w-full flex items-center justify-between gap-2 text-left pr-3"
        style={{ cursor: 'pointer' }}
      >
        <span className={selectedLabel ? 'text-[#F0EDE8]' : 'text-[#5A5040]'}>
          {selectedLabel || placeholder}
        </span>
        <ChevronDown
          size={15}
          className={`shrink-0 text-gold-500/70 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 glass-panel rounded-xl overflow-hidden"
          style={{ maxHeight: '224px', display: 'flex', flexDirection: 'column' }}
        >
          {/* Search input */}
          <div className="p-2 border-b border-gold-500/10 shrink-0">
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="input text-xs py-1.5"
              data-no-capitalize=""
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setOpen(false);
                  setQuery('');
                }
              }}
            />
          </div>

          {/* Options list */}
          <ul className="overflow-y-auto flex-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-3 text-xs text-white/30 text-center">No results</li>
            ) : (
              filtered.map((opt) => {
                const isSelected = opt.value === value;
                return (
                  <li
                    key={opt.value}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(opt.value)}
                    className={[
                      'px-3 py-2 text-sm cursor-pointer transition-colors duration-100 flex items-center justify-between',
                      isSelected
                        ? 'text-gold-300 bg-gold-500/10'
                        : 'text-white/80 hover:bg-obsidian-700/60',
                    ].join(' ')}
                  >
                    <span>{opt.label}</span>
                    {isSelected && (
                      <span className="text-gold-400 text-[10px] font-bold">✓</span>
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
