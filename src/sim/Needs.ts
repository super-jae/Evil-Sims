export const NEED_KEYS = ['hunger', 'bladder', 'hygiene', 'energy', 'fun', 'social', 'comfort'] as const
export type NeedKey = typeof NEED_KEYS[number]
export type Needs = Record<NeedKey, number>

export const NEED_META: Record<NeedKey, { label: string; glyph: string; decay: number; critical: number }> = {
  hunger:  { label: 'Hunger',  glyph: '🍽', decay: 0.135, critical: 12 },
  bladder: { label: 'Bladder', glyph: '🚻', decay: 0.210, critical: 10 },
  hygiene: { label: 'Hygiene', glyph: '🧼', decay: 0.105, critical: 12 },
  energy:  { label: 'Energy',  glyph: '⚡', decay: 0.098, critical: 10 },
  fun:     { label: 'Fun',     glyph: '🎉', decay: 0.150, critical: 12 },
  social:  { label: 'Social',  glyph: '💬', decay: 0.095, critical: 12 },
  comfort: { label: 'Comfort', glyph: '🛋', decay: 0.140, critical: 12 },
}

export function makeNeeds(fill = 78): Needs {
  return {
    hunger: fill, bladder: fill, hygiene: fill, energy: fill,
    fun: fill, social: fill, comfort: fill,
  }
}

export function clampNeeds(n: Needs) {
  for (const k of NEED_KEYS) n[k] = Math.max(0, Math.min(100, n[k]))
}

/** Weighted average used for the mood readout; low needs hurt disproportionately. */
export function needScore(n: Needs): number {
  let total = 0
  for (const k of NEED_KEYS) {
    const v = n[k] / 100
    total += Math.pow(v, 0.55)
  }
  return (total / NEED_KEYS.length) * 100
}

export const MOODS = [
  { min: 86, label: 'Blissful',    color: '#57e389' },
  { min: 70, label: 'Happy',       color: '#8ee39a' },
  { min: 55, label: 'Fine',        color: '#c9d36a' },
  { min: 40, label: 'Uncomfortable', color: '#ffb340' },
  { min: 26, label: 'Miserable',   color: '#ff8a4a' },
  { min: 12, label: 'Desperate',   color: '#ff5c58' },
  { min: -1, label: 'Dying',       color: '#b06cff' },
]

export function moodFor(score: number) {
  for (const m of MOODS) if (score >= m.min) return m
  return MOODS[MOODS.length - 1]
}

export function needColor(v: number): string {
  if (v > 62) return '#57e389'
  if (v > 40) return '#c9d36a'
  if (v > 22) return '#ffb340'
  return '#ff5c58'
}
