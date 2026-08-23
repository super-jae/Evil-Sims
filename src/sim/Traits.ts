import type { NeedKey } from './Needs'

export interface TraitDef {
  id: string
  name: string
  desc: string
  /** Multipliers applied to need decay rates. */
  decay?: Partial<Record<NeedKey, number>>
  /** Multiplier on the chance of setting things on fire / breaking them. */
  clumsiness?: number
  /** Multiplier on panic response near danger. */
  bravery?: number
  /** How fast embarrassment builds. */
  shame?: number
  /** How fast rage builds. */
  temper?: number
  /** How fast hysteria builds. */
  mirth?: number
  /** Swimming competence, 0.5 = sinks like a brick. */
  swim?: number
  /** Bonus/penalty to autonomy desire for a category of interaction. */
  likes?: string[]
  dislikes?: string[]
}

export const TRAITS: TraitDef[] = [
  { id: 'glutton', name: 'Glutton', desc: 'Gets hungry alarmingly fast.', decay: { hunger: 1.55 }, likes: ['eat'] },
  { id: 'weakbladder', name: 'Weak Bladder', desc: 'Should never have had that espresso.', decay: { bladder: 1.7 } },
  { id: 'slob', name: 'Slob', desc: 'Barely notices filth. Makes plenty of it.', decay: { hygiene: 0.55 } },
  { id: 'neat', name: 'Neat', desc: 'Distressed by mess, compelled to clean.', decay: { hygiene: 1.4 }, likes: ['clean'] },
  { id: 'active', name: 'Active', desc: 'Will exercise unprompted. Unwisely.', decay: { energy: 0.85 }, likes: ['workout'] },
  { id: 'lazy', name: 'Lazy', desc: 'Tires easily, moves rarely.', decay: { energy: 1.45, comfort: 1.3 }, likes: ['sit', 'sleep'] },
  { id: 'clumsy', name: 'Clumsy', desc: 'Breaks things. Sets things alight.', clumsiness: 2.4 },
  { id: 'brave', name: 'Brave', desc: 'Slow to panic. Slower to survive.', bravery: 0.35 },
  { id: 'nervous', name: 'Nervous', desc: 'Panics at the smell of smoke.', bravery: 2.2, shame: 1.4 },
  { id: 'squeamish', name: 'Squeamish', desc: 'Dies a little inside at any indignity.', shame: 2.6 },
  { id: 'hothead', name: 'Hot-Headed', desc: 'Anger builds fast and does not vent.', temper: 2.4 },
  { id: 'goofball', name: 'Goofball', desc: 'Finds everything hilarious. Everything.', mirth: 2.3, likes: ['fun'] },
  { id: 'gloomy', name: 'Gloomy', desc: 'Fun drains away almost immediately.', decay: { fun: 1.5 } },
  { id: 'loner', name: 'Loner', desc: 'Needs no one, which is convenient.', decay: { social: 0.4 } },
  { id: 'social', name: 'Social Butterfly', desc: 'Withers without company.', decay: { social: 1.8 }, likes: ['social'] },
  { id: 'hydrophobe', name: 'Hydrophobic', desc: 'Cannot swim. At all.', swim: 0.35, dislikes: ['swim'] },
  { id: 'fish', name: 'Fish', desc: 'Practically amphibious.', swim: 2.2, likes: ['swim'] },
  { id: 'foodie', name: 'Foodie', desc: 'Insists on cooking. Should not.', likes: ['cook'] },
  { id: 'nightowl', name: 'Night Owl', desc: 'Refuses to sleep at sensible hours.', decay: { energy: 0.8 } },
  { id: 'genius', name: 'Genius', desc: 'Learns fast, repairs safely.', clumsiness: 0.4, likes: ['read', 'type'] },
]

export const TRAIT_BY_ID = new Map(TRAITS.map((t) => [t.id, t]))

export interface TraitBundle {
  ids: string[]
  decay: Record<NeedKey, number>
  clumsiness: number
  bravery: number
  shame: number
  temper: number
  mirth: number
  swim: number
  likes: Set<string>
  dislikes: Set<string>
}

export function bundleTraits(ids: string[]): TraitBundle {
  const b: TraitBundle = {
    ids,
    decay: { hunger: 1, bladder: 1, hygiene: 1, energy: 1, fun: 1, social: 1, comfort: 1 },
    clumsiness: 1, bravery: 1, shame: 1, temper: 1, mirth: 1, swim: 1,
    likes: new Set(), dislikes: new Set(),
  }
  for (const id of ids) {
    const t = TRAIT_BY_ID.get(id)
    if (!t) continue
    if (t.decay) for (const k in t.decay) {
      const key = k as NeedKey
      b.decay[key] *= t.decay[key]!
    }
    b.clumsiness *= t.clumsiness ?? 1
    b.bravery *= t.bravery ?? 1
    b.shame *= t.shame ?? 1
    b.temper *= t.temper ?? 1
    b.mirth *= t.mirth ?? 1
    b.swim *= t.swim ?? 1
    t.likes?.forEach((l) => b.likes.add(l))
    t.dislikes?.forEach((l) => b.dislikes.add(l))
  }
  return b
}
