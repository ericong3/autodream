import React from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingButtonProps {
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
  className?: string;
  children: React.ReactNode;
}

export default function LoadingButton({
  loading = false,
  disabled = false,
  onClick,
  type = 'button',
  className = '',
  children,
}: LoadingButtonProps) {
  const isDisabled = loading || disabled;

  return (
    <button
      type={type}
      disabled={isDisabled}
      onClick={onClick}
      className={[
        'relative inline-flex items-center justify-center',
        loading ? 'cursor-wait' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* Spinner — absolutely centred, only visible when loading */}
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Loader2
            size={16}
            className="animate-spin"
            aria-label="Loading"
          />
        </span>
      )}

      {/* Children — invisible (but still occupying space) while loading */}
      <span className={loading ? 'opacity-0 pointer-events-none' : 'opacity-100'}>
        {children}
      </span>
    </button>
  );
}
