"use client";

/**
 * 极小的趋势线（纯 SVG，不引图表库）。
 * 只回答一个问题：这段时间是在往上还是往下。要看准确的数就点进去看明细。
 */
export function Sparkline({
  data,
  width = 84,
  height = 22,
  tone = "var(--brand)",
  fill = true,
}: {
  data: number[];
  width?: number;
  height?: number;
  tone?: string;
  fill?: boolean;
}) {
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  const pad = 2;
  const step = data.length > 1 ? (width - pad * 2) / (data.length - 1) : 0;
  const y = (v: number) => height - pad - (v / max) * (height - pad * 2);

  const pts = data.map((v, i) => [pad + i * step, y(v)] as const);
  const line = pts.map(([x, yy]) => `${x.toFixed(1)},${yy.toFixed(1)}`).join(" ");
  const area = `${pad},${height - pad} ${line} ${(pad + (data.length - 1) * step).toFixed(1)},${height - pad}`;
  const last = pts[pts.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block", overflow: "visible" }}
      aria-hidden
    >
      {fill ? <polygon points={area} fill={tone} opacity={0.12} /> : null}
      <polyline
        points={line}
        fill="none"
        stroke={tone}
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {last ? <circle cx={last[0]} cy={last[1]} r={1.9} fill={tone} /> : null}
    </svg>
  );
}
