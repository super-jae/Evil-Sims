import type * as THREE from 'three'
import type { NeedKey } from '../sim/Needs'
import type { Sim } from '../sim/Sim'
import type { WorldObject } from './WorldObject'
import type { IGame } from '../types'

export type Category =
  | 'kitchen' | 'bath' | 'bed' | 'living' | 'electronics'
  | 'fitness' | 'outdoor' | 'decor' | 'devious' | 'build'

export type SkillKey = 'cooking' | 'handiness' | 'fitness' | 'swimming' | 'comedy' | 'logic'

export type AnimName =
  | 'idle' | 'walk' | 'swim' | 'sit' | 'sleep' | 'stand_use' | 'cook' | 'eat'
  | 'shower' | 'toilet' | 'read' | 'type' | 'watch' | 'dance' | 'run' | 'lift'
  | 'panic' | 'burn' | 'drown' | 'zap' | 'collapse' | 'cry' | 'laugh' | 'repair' | 'wave'

export interface ObjFlags {
  /** 0 = fireproof, 1 = practically kindling. */
  flammable?: number
  heatSource?: boolean
  electrical?: boolean
  plumbing?: boolean
  /** Emits water when broken (makes puddles). */
  wet?: boolean
  seat?: boolean
  bed?: boolean
  /** A way out of the swimming pool. */
  ladder?: boolean
  /** Chance per use-minute of breaking down. */
  breakable?: number
  outdoorOnly?: boolean
  poolOnly?: boolean
  /** Blocks pathing over its footprint. */
  solid?: boolean
  /** Placed against a wall; snaps its back to one. */
  wallish?: boolean
  /** Fire never starts here and never spreads through it. */
  fireproof?: boolean
}

export interface InteractionCtx {
  sim: Sim
  obj: WorldObject
  game: IGame
  /** In-game minutes spent on this interaction so far. */
  elapsed: number
}

export interface Interaction {
  id: string
  label: string
  /** Duration in in-game minutes. */
  duration: number
  /** Need change per in-game minute while performing. */
  needs?: Partial<Record<NeedKey, number>>
  /** Where the sim positions itself. */
  stand?: 'adjacent' | 'on' | 'front'
  anim?: AnimName
  skill?: { key: SkillKey; rate: number }
  /** Hidden interactions are autonomy/system only and never listed in the menu. */
  hidden?: boolean
  requires?: (ctx: InteractionCtx) => boolean
  /** Ends the interaction early once this becomes true. */
  endWhen?: (ctx: InteractionCtx) => boolean
  onStart?: (ctx: InteractionCtx) => void
  onTick?: (ctx: InteractionCtx, dtMin: number) => void
  onFinish?: (ctx: InteractionCtx) => void
  /** Relative desire, 0 = never pick autonomously. */
  autonomy?: (ctx: InteractionCtx) => number
  hint?: string
  /** Shown in red in the menu — this one can end badly. */
  danger?: string
}

export interface ObjectDef {
  id: string
  name: string
  glyph: string
  category: Category
  price: number
  /** Footprint in tiles at rotation 0: [width(x), depth(z)]. */
  size: [number, number]
  /** Approximate visual height in meters, used for the cutaway and tooltips. */
  height: number
  desc: string
  /** Short blurb describing how this thing can go wrong. */
  lethal?: string
  flags?: ObjFlags
  interactions?: Interaction[]
  build: (obj: WorldObject) => THREE.Object3D
  /** Reduces to zero the moment the household can't afford it. */
  unlock?: number
}
