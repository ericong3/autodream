interface SkeletonTextProps {
  width?: string;
}

interface SkeletonBlockProps {
  height?: string;
  className?: string;
}

export function SkeletonText({ width = '100%' }: SkeletonTextProps) {
  return (
    <div
      className="h-3 rounded bg-obsidian-700/60 animate-pulse"
      style={{ width }}
    />
  );
}

export function SkeletonBlock({ height = '3rem', className = '' }: SkeletonBlockProps) {
  return (
    <div
      className={`bg-obsidian-700/60 rounded-lg animate-pulse ${className}`}
      style={{ height }}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="rounded-xl overflow-hidden border border-obsidian-400/30 bg-obsidian-800/60 animate-pulse">
      {/* Photo area */}
      <div className="h-36 bg-obsidian-600/40" />

      {/* Info area */}
      <div className="p-3 flex flex-col gap-2">
        {/* Title line */}
        <div className="h-3.5 rounded bg-obsidian-700/60 w-3/4" />
        {/* Sub-title line */}
        <div className="h-3 rounded bg-obsidian-700/60 w-1/2" />

        {/* Detail row */}
        <div className="flex items-center gap-2 mt-1">
          <div className="h-3 rounded bg-obsidian-700/60 w-1/4" />
          <div className="h-3 rounded bg-obsidian-700/60 w-1/4" />
        </div>

        {/* Price / badge row */}
        <div className="flex items-center justify-between mt-2">
          <div className="h-4 rounded bg-obsidian-700/60 w-1/3" />
          <div className="h-5 w-14 rounded-full bg-obsidian-700/60" />
        </div>
      </div>
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 h-16 px-3 rounded-xl border border-obsidian-400/30 bg-obsidian-800/60 animate-pulse">
      {/* Thumbnail */}
      <div className="w-10 h-10 rounded-lg bg-obsidian-600/40 shrink-0" />

      {/* Text lines */}
      <div className="flex-1 flex flex-col gap-2 min-w-0">
        <div className="h-3.5 rounded bg-obsidian-700/60 w-2/3" />
        <div className="h-3 rounded bg-obsidian-700/60 w-2/5" />
      </div>

      {/* Right value */}
      <div className="h-4 w-16 rounded bg-obsidian-700/60 shrink-0" />
    </div>
  );
}
