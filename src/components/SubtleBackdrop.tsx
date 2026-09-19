/**
 * SubtleBackdrop — minimal CSS background for productive dashboards.
 *
 * Layer stack (back → front):
 *   1. Subtle radial gradient mesh (top-left cyan glow + bottom-right violet glow)
 *   2. Sparse star field (very low opacity)
 *   3. Edge vignette
 *
 * No sun, no grid, no orbital rings — those were distracting from content.
 * Designed for daily-use dashboards where content readability matters more
 * than decorative impact.
 *
 * Zero asset dependency, zero HTTP request, ~1KB CSS.
 */
export function SubtleBackdrop() {
  return (
    <div aria-hidden="true" className="subtle-backdrop pointer-events-none fixed inset-0 overflow-hidden">
      <div className="subtle-layer subtle-mesh" />
      <div className="subtle-layer subtle-stars" />
      <div className="subtle-layer subtle-vignette" />
    </div>
  )
}
