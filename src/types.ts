import type { Grid } from './world/Grid'
import type { GameClock } from './core/Time'
import type { Rand } from './core/Rand'
import type { Sim } from './sim/Sim'
import type { WorldObject } from './world/WorldObject'
import type { DeathId } from './systems/Deaths'

export type NoteKind = 'info' | 'warn' | 'danger' | 'death' | 'good'

/** The slice of the game that objects, sims and systems are allowed to touch. */
export interface IGame {
  readonly grid: Grid
  readonly clock: GameClock
  readonly rand: Rand
  readonly sims: Sim[]
  readonly objects: WorldObject[]
  funds: number

  notify(text: string, kind?: NoteKind, icon?: string): void
  spend(amount: number): boolean
  earn(amount: number): void

  /** Visual/audio effects. */
  spark(x: number, y: number, z: number, count?: number, color?: number): void
  smoke(x: number, y: number, z: number, count?: number): void
  splash(x: number, y: number, z: number): void
  floatText(x: number, y: number, z: number, text: string, color?: string): void

  startFire(tx: number, tz: number, intensity?: number): void
  makePuddle(tx: number, tz: number, kind?: 'water' | 'urine' | 'grime'): void
  removePuddleAt(tx: number, tz: number): boolean
  puddleAt(tx: number, tz: number): boolean

  kill(sim: Sim, death: DeathId, detail?: string): void
  /** Run `fn` after `minutes` of in-game time. Respects pause and game speed. */
  after(minutes: number, fn: () => void): void
  recordDeed(id: string): void

  objectsWithFlag(flag: string): WorldObject[]
  findObject(defId: string): WorldObject | undefined
}
