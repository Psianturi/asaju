/** Unified retro-futuristic background — synthwave/outrun feel, zero asset dependency.
 * Layer stack (back→front):
 *  1. Sky gradient (deep space → horizon violet)
 *  2. Sun disk (upper-center, half-submerged)
 *  3. Orbital rings (subtle, center-faded)
 *  4. Perspective grid plane (bottom half)
 *  5. Star dots (sparse static, no JS animation)
 *  6. Vignette + noise texture (3% opacity)
 * DataFlow canvas remains as a separate layer (streams over grid).
 */
export function RetroFuturisticBackground() {
  return (
    <div className="fixed inset-0 pointer-events-none -z-10 overflow-hidden" aria-hidden="true">
      {/* Sky gradient */}
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(ellipse at 50% 0%, rgba(255,46,151,0.10) 0%, transparent 40%),
                       radial-gradient(ellipse at 50% 100%, rgba(0,240,255,0.10) 0%, transparent 45%),
                       linear-gradient(180deg, #070915 0%, #0d0b23 55%, #070915 100%)`,
        }}
      />

      {/* Sun disk — half submerged at visual horizon (55% from top) */}
      <div
        className="absolute left-1/2 -translate-x-1/2"
        style={{
          top: '55%',
          width: '44vmin',
          height: '22vmin',
          borderRadius: '50% 50% 0 0',
          background: 'linear-gradient(180deg, rgba(255,46,151,0.55) 0%, rgba(157,78,221,0.45) 50%, rgba(0,240,255,0.35) 100%)',
          filter: 'blur(28px)',
          opacity: 0.7,
        }}
      />
      {/* Hard-edged sun silhouette under the glow */}
      <div
        className="absolute left-1/2 -translate-x-1/2"
        style={{
          top: '55%',
          width: '32vmin',
          height: '16vmin',
          borderRadius: '50% 50% 0 0',
          background: 'linear-gradient(180deg, rgba(255,46,151,0.20) 0%, rgba(157,78,221,0.18) 60%, rgba(0,240,255,0.10) 100%)',
          filter: 'blur(6px)',
        }}
      />

      {/* Horizon line */}
      <div
        className="absolute left-0 right-0"
        style={{
          top: '55%',
          height: '1px',
          background: 'linear-gradient(90deg, transparent 0%, rgba(0,240,255,0.45) 20%, rgba(255,46,151,0.55) 50%, rgba(0,240,255,0.45) 80%, transparent 100%)',
          boxShadow: '0 0 24px rgba(0,240,255,0.4), 0 0 48px rgba(255,46,151,0.25)',
        }}
      />

      {/* Perspective grid plane — bottom half only */}
      <svg
        className="absolute left-0 right-0 bottom-0 w-full"
        style={{ height: '45%', opacity: 0.5 }}
        viewBox="0 0 1440 405"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="grid-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00f0ff" stopOpacity="0" />
            <stop offset="55%" stopColor="#00f0ff" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#ff2e97" stopOpacity="0.85" />
          </linearGradient>
        </defs>
        <g stroke="url(#grid-fade)" strokeWidth="0.8" fill="none">
          {/* converging verticals */}
          {Array.from({ length: 17 }).map((_, i) => {
            const x = 720 + (i - 8) * 90
            return (
              <line key={`v${i}`} x1={x} y1="0" x2={720 + (x - 720) * 3} y2="405" />
            )
          })}
          {/* horizontal lines with perspective compression */}
          {Array.from({ length: 12 }).map((_, i) => {
            const t = i / 11
            const y = Math.pow(t, 1.8) * 405
            return <line key={`h${i}`} x1="0" y1={y} x2="1440" y2={y} />
          })}
        </g>
      </svg>

      {/* Orbital rings — center-faded decoration */}
      <svg
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ width: '110vmin', height: '110vmin', opacity: 0.12 }}
        viewBox="0 0 100 100"
      >
        <circle cx="50" cy="50" r="38" fill="none" stroke="#00f0ff" strokeWidth="0.06" strokeDasharray="1 1.6" />
        <circle cx="50" cy="50" r="46" fill="none" stroke="#9d4edd" strokeWidth="0.05" />
        <circle cx="50" cy="50" r="54" fill="none" stroke="#ff2e97" strokeWidth="0.04" strokeDasharray="2 2.4" />
      </svg>

      {/* Sparse star dots (static, accessibility-safe) */}
      <svg className="absolute inset-0 w-full h-full" style={{ opacity: 0.4 }}>
        {[
          [8, 12], [23, 7], [37, 18], [51, 8], [68, 14], [82, 5], [92, 19],
          [14, 32], [44, 28], [76, 31], [88, 38], [5, 45], [26, 52], [60, 47],
        ].map(([x, y], i) => (
          <circle key={i} cx={`${x}%`} cy={`${y}%`} r="0.6" fill={i % 3 === 0 ? '#ffd166' : i % 3 === 1 ? '#00f0ff' : '#9d4edd'} />
        ))}
      </svg>

      {/* Vignette + subtle noise */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 55%, rgba(3,4,12,0.55) 100%)',
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.03] mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E")`,
        }}
      />
    </div>
  )
}
