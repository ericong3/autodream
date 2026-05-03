interface CircularProgressProps {
  value: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  bgColor?: string;
  label?: string;
  sublabel?: string;
}

export default function CircularProgress({
  value,
  size = 80,
  strokeWidth = 8,
  color = '#EAB820',
  bgColor = 'rgba(42,35,22,0.6)',
  label,
  sublabel,
}: CircularProgressProps) {
  const clamped = Math.min(100, Math.max(0, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  const cx = size / 2;
  const cy = size / 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Background ring */}
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill="none"
        stroke={bgColor}
        strokeWidth={strokeWidth}
      />

      {/* Progress arc */}
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ transition: 'stroke-dashoffset 1s ease-in-out' }}
      />

      {/* Center label */}
      {label && (
        <text
          x={cx}
          y={sublabel ? cy - 4 : cy + 1}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="white"
          fontSize={size * 0.2}
          fontWeight="700"
          fontFamily="Outfit, system-ui, sans-serif"
        >
          {label}
        </text>
      )}

      {/* Center sublabel */}
      {sublabel && (
        <text
          x={cx}
          y={cy + size * 0.14}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="rgba(255,255,255,0.45)"
          fontSize={size * 0.13}
          fontFamily="Outfit, system-ui, sans-serif"
        >
          {sublabel}
        </text>
      )}
    </svg>
  );
}
