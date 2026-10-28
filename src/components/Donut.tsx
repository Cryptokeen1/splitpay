export const SHARE_COLORS = ['var(--ink)', '#3f5b8f', '#7f9ccb', '#b4c6e4', '#c9a86a', '#8a6f3c', '#5d6882', '#d8dfec', '#2c3f66', '#a3b3d1']

/** Proportional ring showing how each payment is divided. Slices follow recipient order. */
export function Donut({ bps, size = 112, children }: { bps: readonly number[]; size?: number; children?: React.ReactNode }) {
  const r = 42
  const c = 2 * Math.PI * r
  const starts = bps.map((_, i) => bps.slice(0, i).reduce((x, y) => x + y, 0) / 10000 * c)
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label="Share of each payment per recipient">
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--line)" strokeWidth="12" />
        {bps.map((b, i) => {
          const len = (b / 10000) * c
          const gap = bps.length > 1 ? 1.2 : 0
          return (
            <circle
              key={i}
              cx="50"
              cy="50"
              r={r}
              fill="none"
              style={{ stroke: SHARE_COLORS[i % SHARE_COLORS.length] }}
              strokeWidth="12"
              strokeDasharray={`${Math.max(len - gap, 0)} ${c - Math.max(len - gap, 0)}`}
              strokeDashoffset={-starts[i]}
              transform="rotate(-90 50 50)"
            />
          )
        })}
      </svg>
      {children && <div className="absolute inset-0 grid place-items-center text-center">{children}</div>}
    </div>
  )
}
