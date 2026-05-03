import { useState } from 'react';

interface HeatMapProps {
  data: Record<string, number>;
  weeks?: number;
}

const CELL_SIZE = 10;
const CELL_GAP = 2;
const STEP = CELL_SIZE + CELL_GAP;
const DAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'];
const DAY_LABEL_WIDTH = 28;
const MONTH_LABEL_HEIGHT = 18;

function getCellColor(value: number): string {
  if (value === 0) return 'rgba(20,18,16,0.6)';      // obsidian-700/60
  if (value === 1) return 'rgba(92,64,5,0.6)';        // gold-800/60
  if (value <= 3)  return 'rgba(154,112,8,0.7)';      // gold-600/70
  if (value <= 5)  return 'rgba(212,160,23,0.8)';     // gold-400/80
  return 'rgb(234,184,32)';                            // gold-300 bright
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
}

interface TooltipState {
  x: number;
  y: number;
  date: string;
  count: number;
}

export default function HeatMap({ data, weeks = 12 }: HeatMapProps) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  // Build the list of dates to show (weeks * 7 days, ending today)
  const today = new Date();
  // We want the last cell to be today; calculate start date
  const totalDays = weeks * 7;
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - totalDays + 1);

  // Build grid: columns = weeks, rows = 7 (Mon–Sun)
  // ISO weekday: Mon=0...Sun=6
  function isoDay(d: Date): number {
    return d.getDay() === 0 ? 6 : d.getDay() - 1;
  }

  // Build flat date list
  const dates: string[] = [];
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }

  // Group into columns (weeks)
  // First column may be partial — pad from top
  const firstDayOffset = isoDay(startDate);
  const paddedDates: (string | null)[] = [
    ...Array(firstDayOffset).fill(null),
    ...dates,
  ];
  // Fill to full multiple of 7
  while (paddedDates.length % 7 !== 0) paddedDates.push(null);

  const cols = paddedDates.length / 7;

  // Month labels: find first date of each month change in our columns
  const monthLabels: { col: number; label: string }[] = [];
  for (let col = 0; col < cols; col++) {
    const cellDate = paddedDates[col * 7]; // top cell of column = Monday slot
    if (cellDate) {
      const d = new Date(cellDate);
      const prevCol = col > 0 ? paddedDates[(col - 1) * 7] : null;
      const prevMonth = prevCol ? new Date(prevCol).getMonth() : -1;
      if (d.getMonth() !== prevMonth) {
        monthLabels.push({
          col,
          label: d.toLocaleDateString('en-MY', { month: 'short' }),
        });
      }
    }
  }

  const svgWidth = DAY_LABEL_WIDTH + cols * STEP - CELL_GAP;
  const svgHeight = MONTH_LABEL_HEIGHT + 7 * STEP - CELL_GAP;

  return (
    <div className="overflow-x-auto">
      <div className="relative inline-block">
        <svg
          width={svgWidth}
          height={svgHeight}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Month labels */}
          {monthLabels.map(({ col, label }) => (
            <text
              key={`month-${col}`}
              x={DAY_LABEL_WIDTH + col * STEP}
              y={MONTH_LABEL_HEIGHT - 4}
              fill="rgba(255,255,255,0.35)"
              fontSize="9"
              fontFamily="Outfit, system-ui, sans-serif"
            >
              {label}
            </text>
          ))}

          {/* Day labels (Mon, Wed, Fri) */}
          {DAY_LABELS.map((lbl, row) =>
            lbl ? (
              <text
                key={`day-${row}`}
                x={0}
                y={MONTH_LABEL_HEIGHT + row * STEP + CELL_SIZE / 2 + 3}
                fill="rgba(255,255,255,0.3)"
                fontSize="8"
                fontFamily="Outfit, system-ui, sans-serif"
              >
                {lbl}
              </text>
            ) : null
          )}

          {/* Cells */}
          {Array.from({ length: cols }, (_, col) =>
            Array.from({ length: 7 }, (_, row) => {
              const idx = col * 7 + row;
              const dateStr = paddedDates[idx];
              if (!dateStr) return null;
              const count = data[dateStr] ?? 0;
              const x = DAY_LABEL_WIDTH + col * STEP;
              const y = MONTH_LABEL_HEIGHT + row * STEP;
              return (
                <rect
                  key={`${col}-${row}`}
                  x={x}
                  y={y}
                  width={CELL_SIZE}
                  height={CELL_SIZE}
                  rx={2}
                  fill={getCellColor(count)}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) => {
                    const rect = (e.target as SVGRectElement).getBoundingClientRect();
                    setTooltip({ x: rect.left + rect.width / 2, y: rect.top - 8, date: dateStr, count });
                  }}
                  onMouseLeave={() => setTooltip(null)}
                />
              );
            })
          )}
        </svg>

        {/* Tooltip */}
        {tooltip && (
          <div
            className="fixed z-50 pointer-events-none px-2.5 py-1.5 rounded-lg text-xs font-medium shadow-lg
              bg-obsidian-700 border border-obsidian-400/30 text-white whitespace-nowrap"
            style={{
              left: tooltip.x,
              top: tooltip.y,
              transform: 'translate(-50%, -100%)',
            }}
          >
            <span className="text-gold-300 font-semibold">{tooltip.count}</span>
            <span className="text-white/60 ml-1">{formatDate(tooltip.date)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
