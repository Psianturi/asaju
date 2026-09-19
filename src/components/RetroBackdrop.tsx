/**
 * RetroBackdrop — pure-CSS retro-futuristik background.
 *
 * Layer stack (back → front):
 *   1. Sky gradient (top navy → bottom horizon violet)
 *   2. Sun orb with horizontal strip cuts (synthwave), blur halo
 *   3. Orbital rings (3 concentric, fading toward edges)
 *   4. Perspective grid (bottom-half only, receding to horizon)
 *   5. Star field (sparse dots, subtle)
 *   6. Noise texture (SVG data-URI, very low opacity)
 *   7. Edge vignette
 *
 * All decorative — content sits above with backdrop-blur.
 * Uses prefers-reduced-motion guard for animated layers.
 * Hidden from screen readers (aria-hidden).
 *
 * Zero image asset dependency, zero extra HTTP request, ~3KB total CSS.
 */
export function RetroBackdrop() {
  return (
    <div aria-hidden="true" className="retro-backdrop pointer-events-none fixed inset-0 overflow-hidden">
      {/* Layer 1: sky gradient */}
      <div className="retro-layer retro-sky" />

      {/* Layer 2: sun orb + halo */}
      <div className="retro-layer retro-sun-wrap">
        <div className="retro-sun-halo" />
        <div className="retro-sun" />
      </div>

      {/* Layer 3: orbital rings */}
      <div className="retro-layer retro-orbit-wrap">
        <div className="retro-orbit retro-orbit-1" />
        <div className="retro-orbit retro-orbit-2" />
        <div className="retro-orbit retro-orbit-3" />
      </div>

      {/* Layer 4: perspective grid (bottom half) */}
      <div className="retro-layer retro-grid-wrap">
        <div className="retro-grid" />
        <div className="retro-grid-mask" />
      </div>

      {/* Layer 5: star field */}
      <div className="retro-layer retro-stars" />

      {/* Layer 6: noise (SVG inline) */}
      <div className="retro-layer retro-noise" />

      {/* Layer 7: vignette */}
      <div className="retro-layer retro-vignette" />
    </div>
  )
}
