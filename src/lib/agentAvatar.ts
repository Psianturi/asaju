/**
 * Procedural agent avatars: a "cyber knight" portrait drawn as SVG — a human
 * face lit in two neon tones, wearing knight or cyberpunk headgear, with
 * cybernetic implants, neon face paint and shoulder armour, in front of a
 * neon city skyline.
 *
 * Every agent gets a knight from its id; an owner can pick another one by
 * choosing an avatar seed. Parts and colours are picked by a seeded PRNG, so
 * the same (id, seed) always draws the same avatar — on every page and every
 * device — with no image files. The palette follows the agent's niche so a
 * Trading agent reads differently from a DeFi or Tech one at a glance.
 *
 * Nothing user-supplied is ever written into the SVG (only numbers and fixed
 * colours), so the data URI is safe to use anywhere.
 */

type Palette = { bg: [string, string]; accents: string[] }

const PALETTES: Record<string, Palette> = {
  trading: { bg: ['#020A14', '#0A2C44'], accents: ['#3FD8EA', '#34D399', '#FBBF24', '#60A5FA', '#F472B6'] },
  defi: { bg: ['#06021A', '#2A1060'], accents: ['#A78BFA', '#E879F9', '#22D3EE', '#818CF8', '#F0ABFC'] },
  tech: { bg: ['#12030F', '#43103F'], accents: ['#F472B6', '#FB923C', '#38BDF8', '#FACC15', '#C084FC'] },
  health: { bg: ['#020F0B', '#0B3B2D'], accents: ['#4ADE80', '#2DD4BF', '#A3E635', '#67E8F9', '#F9A8D4'] },
  general: { bg: ['#03060F', '#1B2152'], accents: ['#3FD8EA', '#A78BFA', '#FBBF24', '#F472B6', '#34D399'] },
}

/** [lit, shadow] skin tones. */
const SKINS: [string, string][] = [
  ['#F6D5BC', '#D9A88A'], ['#EBC09E', '#C68D69'], ['#D8A47D', '#AE7550'],
  ['#B98058', '#8B5535'], ['#8E5B3C', '#633A22'], ['#603C28', '#3F2417'],
]
const HAIRS = ['#16121C', '#3B2619', '#E9E5F2', '#FF4FB0', '#3FE0F0', '#C81E3A', '#8B5CF6']
const PLATINUM = '#E9E5F2'

export function paletteKey(niche: string | undefined): keyof typeof PALETTES {
  const n = (niche || '').toLowerCase()
  if (n.includes('trading') || n.includes('invest')) return 'trading'
  if (n.includes('defi') || n.includes('blockchain')) return 'defi'
  if (n.includes('tech')) return 'tech'
  if (n.includes('health') || n.includes('wellness')) return 'health'
  return 'general'
}

/** djb2 → 32-bit unsigned. */
function hash(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h >>> 0
}

/** mulberry32: tiny, fast, good enough for picking parts. */
function prng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]
const idx = (r: () => number, n: number) => Math.floor(r() * n)

// ── Geometry (100×100; face centred on x=50, eyes on y=45) ──────────────────

const FACE = 'M50 23 C61 23 67.5 31 67.5 42 C67.5 50 66 56 62 61 L56 67.5 Q53 70.5 50 70.5 Q47 70.5 44 67.5 L38 61 C34 56 32.5 50 32.5 42 C32.5 31 39 23 50 23 Z'

/** Colours and def ids shared by the parts: a/a2 accents, m metal, f glow. */
type C = { a: string; a2: string; skin: [string, string]; hair: string; m: string; f: string; uid: string }

/** Neon city skyline; its own PRNG so it never shifts the portrait's parts. */
function skyline(seed: number, c: C): string {
  const r = prng(seed)
  let x = -2
  let out = ''
  while (x < 102) {
    const w = 6 + r() * 9
    const h = 14 + r() * 30
    const y = 100 - h
    out += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="#05070F" opacity=".9"/>`
    for (let wy = y + 3; wy < 96; wy += 4) {
      for (let wx = x + 1.5; wx < x + w - 1.5; wx += 3) {
        if (r() < 0.22) out += `<rect x="${wx.toFixed(1)}" y="${wy.toFixed(1)}" width="1.2" height="1.6" fill="${r() < 0.5 ? c.a : c.a2}" opacity=".55"/>`
      }
    }
    x += w + 0.6
  }
  return out
}

/** A few drifting sparks of neon light. */
function particles(seed: number, c: C): string {
  const r = prng(seed)
  return Array.from({ length: 7 }, () => {
    const x = (r() < 0.5 ? 4 + r() * 22 : 74 + r() * 22).toFixed(1)
    const y = (8 + r() * 60).toFixed(1)
    return `<circle cx="${x}" cy="${y}" r="${(0.4 + r() * 0.8).toFixed(2)}" fill="${r() < 0.5 ? c.a : c.a2}" opacity="${(0.4 + r() * 0.5).toFixed(2)}"/>`
  }).join('')
}

/** Shoulder armour. */
const ARMOURS = [
  (c: C) => `<path d="M6 100 Q8 82 26 77 L40 76 L50 82 L60 76 L74 77 Q92 82 94 100 Z" fill="url(#${c.m})" stroke="${c.a}" stroke-width=".9" stroke-opacity=".8"/><path d="M14 92 Q18 84 30 81 M86 92 Q82 84 70 81" fill="none" stroke="${c.a}" stroke-width="1.1" opacity=".8"/>`,
  (c: C) => `<path d="M2 100 Q2 80 24 75 L38 79 L35 100 Z M98 100 Q98 80 76 75 L62 79 L65 100 Z" fill="url(#${c.m})" stroke="${c.a2}" stroke-width="1" stroke-opacity=".85"/><path d="M35 100 L38 79 H62 L65 100 Z" fill="#0B0F22" stroke="${c.a}" stroke-width=".7" stroke-opacity=".6"/><path d="M44 86 L50 92 L56 86" fill="none" stroke="${c.a}" stroke-width="1.3"/><circle cx="50" cy="93" r="1.8" fill="${c.a}"/>`,
  (c: C) => `<path d="M4 100 L14 82 L34 75 L66 75 L86 82 L96 100 Z" fill="url(#${c.m})" stroke="${c.a}" stroke-width=".9" stroke-opacity=".75"/><path d="M14 82 L8 74 L22 78 Z M86 82 L92 74 L78 78 Z" fill="url(#${c.m})" stroke="${c.a2}" stroke-width=".8"/><path d="M22 93 H38 L42 87 M78 93 H62 L58 87" fill="none" stroke="${c.a2}" stroke-width="1.1" opacity=".85"/>`,
]

const GORGET = (c: C) =>
  `<path d="M35 77 Q50 70 65 77 L67 83 Q50 76 33 83 Z" fill="url(#${c.m})" stroke="${c.a}" stroke-width=".7" stroke-opacity=".7"/>`

/** Hair behind the head (long style only). */
const LONG_HAIR = 3
const LONG_BACK = (c: C) => `<path d="M30 42 C29 22 40 17 50 17 C60 17 71 22 70 42 L72 76 H62 L60 52 H40 L38 76 H28 Z" fill="${c.hair}"/>`

const CROP = 'M33 43 C31.5 26 40 19.5 50 19.5 C60 19.5 68.5 26 67 43 C64.5 34 58.5 30.5 50 30.5 C41.5 30.5 35.5 34 33 43 Z'
const MOHAWK = 'M45 31 L42.5 21 L46.5 23 L45 12 L49 15.5 L50.5 4 L53 14 L56.5 9 L55.5 20 L58.5 18.5 L55.5 31 Z'

/** Hair over the head. */
const HAIR_STYLES = [
  (c: C) => `<path d="${CROP}" fill="${c.hair}"/><path d="M38 27 Q45 21.5 56 22.5" fill="none" stroke="#fff" stroke-width="1" stroke-linecap="round" opacity=".22"/>`,
  (c: C) => `<path d="M33 44 C30.5 25 40 18.5 52 18.5 C64 18.5 70 27 67 41 C63 34 56 31.5 47 35 C41 37.5 36 40 33 44 Z" fill="${c.hair}"/><path d="M47 22 Q58 22 64 30" fill="none" stroke="#fff" stroke-width=".8" opacity=".25"/>`,
  (c: C) => `<path d="${CROP}" fill="${c.hair}" opacity=".35"/><path d="${MOHAWK}" fill="${c.a2}" filter="url(#${c.f})" opacity=".8"/><path d="${MOHAWK}" fill="${c.a2}"/>`,
  (c: C) => `<path d="M32 50 C29 25 40 18 51 18 C63 18 71 27 68 50 C66 38 60 31 50 33 C42 34.5 35 40 32 50 Z" fill="${c.hair}"/><path d="M37 30 Q44 22 55 22" fill="none" stroke="#fff" stroke-width="1" stroke-linecap="round" opacity=".22"/>`,
]

const HELM_OPENING = 'M50 33 C58 33 63 38 63 46 V60 Q63 68 50 71.5 Q37 68 37 60 V46 C37 38 42 33 50 33 Z'
const HOOD_OPENING = 'M50 27 C60 27 65.5 35 65.5 46 V60 Q61 72 50 73 Q39 72 34.5 60 V46 C34.5 35 40 27 50 27 Z'
const PLUME = 'M45 15 C44 7 46.5 2 50 0 C53.5 2 56 7 55 15 Z'
const BROW_ARC = 'M35.5 44 C37 37 42 34.5 50 34.5 C58 34.5 63 37 64.5 44'
const GEM = 'M50 30 L53 34.5 L50 39 L47 34.5 Z'

/** Headgear. `hair` says whether the hair style shows under it. */
const GEARS: { hair: boolean; draw: (c: C) => string }[] = [
  { // open-face knight helm with a neon plume
    hair: false,
    draw: c => `<path d="${PLUME}" fill="${c.a2}" filter="url(#${c.f})" opacity=".8"/><path d="${PLUME}" fill="${c.a2}"/><path d="M48 14 C47.5 8 48.5 4 50 1.5 M52 14 C52.5 8 51.5 4 50 1.5" fill="none" stroke="#fff" stroke-width=".5" opacity=".5"/>` +
      `<path fill-rule="evenodd" d="M50 13 C64 13 74 23 74 40 V62 L64 74 H36 L26 62 V40 C26 23 36 13 50 13 Z ${HELM_OPENING}" fill="url(#${c.m})" stroke="${c.a}" stroke-width="1"/>` +
      `<path d="${HELM_OPENING}" fill="none" stroke="${c.a}" stroke-width="1.4"/><path d="M50 14 V33" stroke="${c.a}" stroke-width=".8" opacity=".6"/>` +
      `<g fill="${c.a}"><circle cx="31" cy="50" r="1.1"/><circle cx="69" cy="50" r="1.1"/><circle cx="31" cy="57" r="1.1"/><circle cx="69" cy="57" r="1.1"/></g>`,
  },
  { // cloak hood with a neon hem
    hair: false,
    draw: c => `<path fill-rule="evenodd" d="M50 12 C67 12 76 27 76 47 L81 83 Q68 75 61 77 L50 84 L39 77 Q32 75 19 83 L24 47 C24 27 33 12 50 12 Z ${HOOD_OPENING}" fill="url(#${c.uid}hood)" stroke="${c.a2}" stroke-width=".7" stroke-opacity=".6"/>` +
      `<path d="${HOOD_OPENING}" fill="none" stroke="${c.a}" stroke-width="1.3"/>` +
      `<path d="M35 40 C38 31 44 28 50 28 C56 28 62 31 65 40 C60 35 55 34 50 34 C45 34 40 35 35 40 Z" fill="#000" opacity=".35"/>` +
      `<path d="M24 47 L20 80 M76 47 L80 80" stroke="${c.a}" stroke-width=".6" opacity=".5"/>`,
  },
  { // circlet with a glowing gem
    hair: true,
    draw: c => `<path d="M33.5 37 Q50 31 66.5 37 L66 40 Q50 34 34 40 Z" fill="url(#${c.m})" stroke="${c.a}" stroke-width=".7"/><path d="${GEM}" fill="${c.a2}" filter="url(#${c.f})"/><path d="${GEM}" fill="${c.a2}" stroke="#fff" stroke-width=".4"/>`,
  },
  { // horned half-helm
    hair: false,
    draw: c => `<path d="M34 31 Q22 24 22 8 Q29 20 39 25 Z M66 31 Q78 24 78 8 Q71 20 61 25 Z" fill="url(#${c.m})" stroke="${c.a2}" stroke-width=".9"/>` +
      `<path d="M31 46 C30 24 40 16 50 16 C60 16 70 24 69 46 L65 47 C64 37 58 33 50 33 C42 33 36 37 35 47 Z" fill="url(#${c.m})" stroke="${c.a}" stroke-width="1"/>` +
      `<path d="${BROW_ARC}" fill="none" stroke="${c.a}" stroke-width="1.3" filter="url(#${c.f})"/><path d="${BROW_ARC}" fill="none" stroke="${c.a}" stroke-width=".9"/><path d="M50 17 V33" stroke="${c.a2}" stroke-width=".8" opacity=".7"/>`,
  },
  { // hair only
    hair: true,
    draw: () => '',
  },
  { // cyber headset with a mic
    hair: true,
    draw: c => `<path d="M31 46 C30 24 40 17 50 17 C60 17 70 24 69 46" fill="none" stroke="url(#${c.m})" stroke-width="2.6"/>` +
      `<g fill="url(#${c.m})" stroke="${c.a}" stroke-width=".8"><rect x="27.5" y="42" width="6" height="11" rx="2.5"/><rect x="66.5" y="42" width="6" height="11" rx="2.5"/></g>` +
      `<g fill="${c.a2}"><circle cx="30.5" cy="47.5" r="1.3"/><circle cx="69.5" cy="47.5" r="1.3"/></g><path d="M30.5 53 Q32 61 40 62" fill="none" stroke="url(#${c.m})" stroke-width="1.2"/><circle cx="40.5" cy="62" r="1.1" fill="${c.a}"/>`,
  },
]

/** Cybernetic implants, drawn over the face. */
const IMPLANTS = [
  // cyber eye
  (c: C) => `<circle cx="43" cy="45.2" r="5.2" fill="none" stroke="url(#${c.m})" stroke-width="2"/><circle cx="43" cy="45.2" r="5.2" fill="none" stroke="${c.a}" stroke-width=".5"/><circle cx="43" cy="45.2" r="2.3" fill="${c.a}" filter="url(#${c.f})"/><path d="M38 45 H33 M39.5 41.5 L35 38" stroke="${c.a}" stroke-width=".6" opacity=".9"/>`,
  // metal jaw plate
  (c: C) => `<path d="M57 52 L65.5 50 C64.5 57 61 63 56 67 Q53 70 50.5 70.5 L52 63 Z" fill="url(#${c.m})" stroke="${c.a}" stroke-width=".7"/><path d="M57 57 H62 M56 60.5 H60.5 M55 64 H58.5" stroke="${c.a}" stroke-width=".9"/>`,
  // cheek circuitry
  (c: C) => `<path d="M58 50 L62 54 V60 M55 52 L58 55 V62 M61 47 H65" fill="none" stroke="${c.a}" stroke-width=".7"/><g fill="${c.a}"><circle cx="62" cy="60.5" r=".9"/><circle cx="58" cy="62.5" r=".9"/><circle cx="65.5" cy="47" r=".9"/></g>`,
  // neon visor glasses
  (c: C) => `<path d="M35.5 42 H64.5 L63 48.5 Q56.5 50 50 47.5 Q43.5 50 37 48.5 Z" fill="${c.a}" fill-opacity=".32" stroke="${c.a}" stroke-width=".9"/><path d="M38 43.5 H46" stroke="#fff" stroke-width=".7" opacity=".7"/>`,
  // temple implant
  (c: C) => `<path d="M33.5 37 L38 35.5 L38.5 41 L34 42 Z" fill="url(#${c.m})" stroke="${c.a2}" stroke-width=".5"/><circle cx="36" cy="38.5" r=".9" fill="${c.a2}"/><path d="M38.5 38.5 H42" stroke="${c.a2}" stroke-width=".5"/>`,
  () => '',
]

/** Neon face paint. */
const PAINTS = [
  () => '',
  (c: C) => `<path d="M41 49.5 V55 M44 49.5 V53.5" stroke="${c.a2}" stroke-width=".9" stroke-linecap="round" opacity=".9"/>`,
  (c: C) => `<path d="M37 50 H63" stroke="${c.a2}" stroke-width="1.4" opacity=".55"/>`,
  (c: C) => `<path d="M59 37 L56 41 L58.5 41 L55.5 46" fill="none" stroke="${c.a2}" stroke-width=".8" stroke-linejoin="round" opacity=".9"/>`,
]

function face(c: C): string {
  const shade = c.skin[1]
  const brow = c.hair === PLATINUM ? '#9A93A8' : HAIRS.indexOf(c.hair) < 2 ? c.hair : '#2A1E26'
  return [
    // Ears and neck.
    `<ellipse cx="33" cy="47" rx="2.6" ry="4.6" fill="${shade}"/><ellipse cx="67" cy="47" rx="2.6" ry="4.6" fill="${shade}"/>`,
    `<path d="M43.5 64 V78 H56.5 V64 Z" fill="${shade}"/><path d="M43.5 66 Q50 72 56.5 66 V71 Q50 75 43.5 71 Z" fill="#000" opacity=".3"/>`,
    // Face: lit from the left, rounded by a contour shade, tinted by neon light.
    `<path d="${FACE}" fill="url(#${c.uid}s)"/>`,
    `<path d="${FACE}" fill="url(#${c.uid}c)"/>`,
    `<path d="${FACE}" fill="url(#${c.uid}t)"/>`,
    `<path d="M36.5 51 Q40 57 45.5 58.5 M63.5 51 Q60 57 54.5 58.5" fill="none" stroke="${shade}" stroke-width="1.6" stroke-linecap="round" opacity=".55"/>`,
    `<path d="${FACE}" fill="none" stroke="url(#${c.uid}r)" stroke-width="1.4"/>`,
    // Stern brows.
    `<path d="M37.5 40 Q42 38.4 47 40.9 M53 40.9 Q58 38.4 62.5 40" fill="none" stroke="${brow}" stroke-width="1.7" stroke-linecap="round"/>`,
    // Almond eyes with glowing irises.
    `<path d="M39 45.4 Q43 42.4 47.3 45 Q43.4 47.3 39 45.4 Z M52.7 45 Q57 42.4 61 45.4 Q56.6 47.3 52.7 45 Z" fill="#EDE8F2"/>`,
    `<g fill="${c.a}" filter="url(#${c.f})" opacity=".8"><circle cx="43.2" cy="45" r="1.8"/><circle cx="56.8" cy="45" r="1.8"/></g>`,
    `<g fill="${c.a}"><circle cx="43.2" cy="45" r="1.7"/><circle cx="56.8" cy="45" r="1.7"/></g><g fill="#07070F"><circle cx="43.2" cy="45" r=".75"/><circle cx="56.8" cy="45" r=".75"/></g><g fill="#fff"><circle cx="43.8" cy="44.4" r=".4"/><circle cx="57.4" cy="44.4" r=".4"/></g>`,
    `<path d="M38.6 45.5 Q43 42 47.6 44.9 M52.4 44.9 Q57 42 61.4 45.5" fill="none" stroke="#120A10" stroke-width="1.1" stroke-linecap="round"/>`,
    `<path d="M40 46.6 Q43.5 47.8 46.8 46 M53.2 46 Q56.5 47.8 60 46.6" fill="none" stroke="${shade}" stroke-width=".5" opacity=".8"/>`,
    // Nose with a shaded bridge.
    `<path d="M52 42 Q52.6 48 52.4 53" fill="none" stroke="${shade}" stroke-width="1.3" stroke-linecap="round" opacity=".55"/>`,
    `<path d="M47.6 54.2 Q50 56 52.6 54.2" fill="none" stroke="${shade}" stroke-width="1" stroke-linecap="round"/><path d="M49.2 49 L48.6 53" stroke="#fff" stroke-width=".6" opacity=".25"/>`,
    // Lips and chin.
    `<path d="M45.5 60.3 Q48 59.2 50 60 Q52 59.2 54.5 60.3 Q50 63.8 45.5 60.3 Z" fill="${shade}"/><path d="M45.5 60.3 Q50 61.3 54.5 60.3" fill="none" stroke="#2E1614" stroke-width=".7" opacity=".8"/><path d="M48 62.3 Q50 62.9 52 62.3" fill="none" stroke="#fff" stroke-width=".45" opacity=".3"/>`,
    `<path d="M47.3 66.8 Q50 68 52.7 66.8" fill="none" stroke="${shade}" stroke-width=".8" opacity=".8"/>`,
  ].join('')
}

export interface AvatarParts {
  palette: keyof typeof PALETTES
  skin: number
  hair: number
  hairStyle: number
  gear: number
  implant: number
  paint: number
  armour: number
  accent: string
  accent2: string
}

/** The parts an (agent, seed) pair draws. seed 0 = the agent's default avatar. */
export function avatarParts(agentId: string, niche: string | undefined, seed = 0): AvatarParts {
  const palette = paletteKey(niche)
  const r = prng(hash(`${agentId}:${seed}`))
  const accents = PALETTES[palette].accents
  const accent = pick(r, accents)
  const others = accents.filter(c => c !== accent)
  return {
    palette,
    skin: idx(r, SKINS.length),
    hair: idx(r, HAIRS.length),
    hairStyle: idx(r, HAIR_STYLES.length),
    gear: idx(r, GEARS.length),
    implant: idx(r, IMPLANTS.length),
    paint: idx(r, PAINTS.length),
    armour: idx(r, ARMOURS.length),
    accent,
    accent2: pick(r, others),
  }
}

/** Highest seed the backend accepts (avatar_seed is validated 0..1e6). */
export const AVATAR_SEED_MAX = 1_000_000

/** Number of distinct avatars per niche (for UI copy and tests). */
export const AVATAR_VARIETY =
  SKINS.length * HAIRS.length * HAIR_STYLES.length * GEARS.length * IMPLANTS.length * PAINTS.length * ARMOURS.length * 5 * 4

export function avatarSvg(agentId: string, niche: string | undefined, seed = 0): string {
  const p = avatarParts(agentId, niche, seed)
  const [bg1, bg2] = PALETTES[p.palette].bg
  const h = hash(`${agentId}:${seed}`)
  const uid = `a${h.toString(36)}`
  const c: C = { a: p.accent, a2: p.accent2, skin: SKINS[p.skin], hair: HAIRS[p.hair], m: `${uid}m`, f: `${uid}f`, uid }
  const gear = GEARS[p.gear]
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">`,
    `<defs>`,
    `<linearGradient id="${uid}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg2}"/><stop offset="1" stop-color="${bg1}"/></linearGradient>`,
    `<radialGradient id="${uid}g" cx=".5" cy=".42" r=".5"><stop offset="0" stop-color="${c.a2}" stop-opacity=".55"/><stop offset="1" stop-color="${c.a2}" stop-opacity="0"/></radialGradient>`,
    `<linearGradient id="${c.m}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7C8BB8"/><stop offset=".3" stop-color="#34406E"/><stop offset=".7" stop-color="#151C40"/><stop offset="1" stop-color="#080C20"/></linearGradient>`,
    `<linearGradient id="${uid}hood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2A2F52"/><stop offset=".6" stop-color="#11142C"/><stop offset="1" stop-color="#070914"/></linearGradient>`,
    `<linearGradient id="${uid}s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${c.skin[0]}"/><stop offset=".55" stop-color="${c.skin[0]}"/><stop offset="1" stop-color="${c.skin[1]}"/></linearGradient>`,
    `<radialGradient id="${uid}c" cx=".44" cy=".42" r=".62"><stop offset=".55" stop-color="${c.skin[1]}" stop-opacity="0"/><stop offset="1" stop-color="${c.skin[1]}" stop-opacity=".85"/></radialGradient>`,
    `<linearGradient id="${uid}t" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${c.a}" stop-opacity=".22"/><stop offset=".4" stop-color="${c.a}" stop-opacity="0"/><stop offset=".6" stop-color="${c.a2}" stop-opacity="0"/><stop offset="1" stop-color="${c.a2}" stop-opacity=".35"/></linearGradient>`,
    `<linearGradient id="${uid}r" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${c.a}"/><stop offset=".35" stop-color="${c.a}" stop-opacity="0"/><stop offset=".65" stop-color="${c.a2}" stop-opacity="0"/><stop offset="1" stop-color="${c.a2}"/></linearGradient>`,
    `<filter id="${c.f}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2.2"/></filter>`,
    `</defs>`,
    // Backdrop: night sky, neon halo, city skyline, scanlines.
    `<rect width="100" height="100" fill="url(#${uid}b)"/>`,
    `<circle cx="50" cy="42" r="48" fill="url(#${uid}g)"/>`,
    `<circle cx="50" cy="42" r="33" fill="none" stroke="${c.a2}" stroke-width="1" opacity=".55"/>`,
    `<circle cx="50" cy="42" r="37" fill="none" stroke="${c.a}" stroke-width=".5" stroke-dasharray="3 4" opacity=".4"/>`,
    skyline(h ^ 0x9e3779b9, c),
    particles(h ^ 0x85ebca6b, c),
    `<g stroke="#fff" stroke-width=".25" opacity=".05">${Array.from({ length: 25 }, (_, i) => `<path d="M0 ${i * 4} H100"/>`).join('')}</g>`,
    // The figure, scaled up a little so the face leads the frame.
    `<g transform="translate(50 100) scale(1.1) translate(-50 -100)">`,
    gear.hair && p.hairStyle === LONG_HAIR ? LONG_BACK(c) : '',
    ARMOURS[p.armour](c),
    face(c),
    GORGET(c),
    PAINTS[p.paint](c),
    IMPLANTS[p.implant](c),
    gear.hair ? HAIR_STYLES[p.hairStyle](c) : '',
    gear.draw(c),
    `</g>`,
    `</svg>`,
  ].join('')
}

const cache = new Map<string, string>()

/** Data URI for <img src>. Memoised: avatars repeat across lists. */
export function avatarDataUri(agentId: string, niche: string | undefined, seed = 0): string {
  const key = `${agentId}|${paletteKey(niche)}|${seed}`
  let uri = cache.get(key)
  if (!uri) {
    uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(avatarSvg(agentId, niche, seed))}`
    if (cache.size > 500) cache.clear()
    cache.set(key, uri)
  }
  return uri
}
