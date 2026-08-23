import type { Sim } from './Sim'

/**
 * Directed relationship scores between sims, -100 (nemesis) to +100 (devoted).
 * Stored per ordered pair so one sim can loathe another who has not noticed.
 */
export class Relationships {
  private scores = new Map<string, number>()

  private key(a: Sim, b: Sim) { return `${a.id}>${b.id}` }

  get(a: Sim, b: Sim): number {
    if (a === b) return 100
    return this.scores.get(this.key(a, b)) ?? 0
  }

  set(a: Sim, b: Sim, value: number) {
    this.scores.set(this.key(a, b), Math.max(-100, Math.min(100, value)))
  }

  /** Apply a change one way. Returns the new value. */
  adjust(a: Sim, b: Sim, delta: number): number {
    const v = Math.max(-100, Math.min(100, this.get(a, b) + delta))
    this.scores.set(this.key(a, b), v)
    return v
  }

  /** Apply a change both ways, the target usually feeling it harder. */
  adjustMutual(a: Sim, b: Sim, delta: number, targetFactor = 1.25): { actor: number; target: number } {
    return {
      actor: this.adjust(a, b, delta),
      target: this.adjust(b, a, delta * targetFactor),
    }
  }

  /** Average of both directions, for display. */
  mutual(a: Sim, b: Sim) { return (this.get(a, b) + this.get(b, a)) / 2 }

  label(value: number): { text: string; color: string } {
    if (value >= 70) return { text: 'Devoted', color: '#57e389' }
    if (value >= 35) return { text: 'Friends', color: '#8ee39a' }
    if (value >= 10) return { text: 'Friendly', color: '#c9d36a' }
    if (value > -10) return { text: 'Acquaintances', color: '#98a0b4' }
    if (value > -35) return { text: 'Cool', color: '#ffb340' }
    if (value > -70) return { text: 'Hostile', color: '#ff8a4a' }
    if (value > -95) return { text: 'Enemies', color: '#ff5c58' }
    return { text: 'Nemesis', color: '#b06cff' }
  }

  /** Everyone who dislikes `sim`, worst first. */
  enemiesOf(sim: Sim, all: Sim[]): Sim[] {
    return all
      .filter((o) => o !== sim && o.alive && this.get(o, sim) < -25)
      .sort((a, b) => this.get(a, sim) - this.get(b, sim))
  }

  forget(sim: Sim) {
    for (const k of [...this.scores.keys()]) {
      if (k.startsWith(`${sim.id}>`) || k.endsWith(`>${sim.id}`)) this.scores.delete(k)
    }
  }
}
