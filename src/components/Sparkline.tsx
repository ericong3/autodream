interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  showDot?: boolean;
}

export default function Sparkline({
  data,
  width = 80,
  height = 32,
  color = '#EAB820',
  showDot = true,
}: SparklineProps) {
  if (!data || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const padding = 3;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  const points = data.map((val, i) => {
    const x = padding + (i / (data.length - 1)) * innerW;
    const y = padding + (1 - (val - min) / range) * innerH;
    return { x, y };
  });

  const polylinePoints = points.map(p => `${p.x},${p.y}`).join(' ');

  // Build the gradient fill path: line points + bottom-right + bottom-left
  const fillPath =
    `M ${points[0].x},${points[0].y} ` +
    points.slice(1).map(p => `L ${p.x},${p.y}`).join(' ') +
    ` L ${points[points.length - 1].x},${height} L ${points[0].x},${height} Z`;

  const lastPoint = points[points.length - 1];
  const gradientId = `sparkline-gradient-${color.replace('#', '')}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      xmlns="http://www.w3.org/2000/svg"
      style={{ overflow: 'visible' }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Gradient fill under line */}
      <path
        d={fillPath}
        fill={`url(#${gradientId})`}
      />

      {/* Line */}
      <polyline
        points={polylinePoints}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Last point dot */}
      {showDot && (
        <circle
          cx={lastPoint.x}
          cy={lastPoint.y}
          r="2.5"
          fill={color}
        />
      )}
    </svg>
  );
}
