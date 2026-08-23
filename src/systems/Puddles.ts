import * as THREE from 'three'
import { DecalLayer } from './Decals'
import type { Grid } from '../world/Grid'

export type PuddleKind = 'water' | 'urine' | 'grime'

interface Puddle {
  x: number
  z: number
  kind: PuddleKind
  /** In-game minutes remaining. */
  life: number
  maxLife: number
  seed: number
}

const COLORS: Record<PuddleKind, THREE.Color> = {
  water: new THREE.Color(0x6fc8e8),
  urine: new THREE.Color(0xd8c24a),
  grime: new THREE.Color(0x6a5a3a),
}

const LIFETIME: Record<PuddleKind, number> = { water: 240, urine: 420, grime: 900 }

export class PuddleSystem {
  readonly layer = new DecalLayer(300, 0.035, 0.06)
  private puddles = new Map<number, Puddle>()

  constructor(private grid: Grid) {}

  add(x: number, z: number, kind: PuddleKind = 'water') {
    if (!this.grid.inBounds(x, z) || this.grid.isPool(x, z)) return
    const i = this.grid.idx(x, z)
    const existing = this.puddles.get(i)
    if (existing) {
      existing.life = Math.max(existing.life, LIFETIME[kind])
      if (kind === 'urine') existing.kind = 'urine'
      return
    }
    this.puddles.set(i, {
      x, z, kind, life: LIFETIME[kind], maxLife: LIFETIME[kind], seed: Math.random() * 10,
    })
  }

  has(x: number, z: number) {
    if (!this.grid.inBounds(x, z)) return false
    return this.puddles.has(this.grid.idx(x, z))
  }

  remove(x: number, z: number) {
    if (!this.grid.inBounds(x, z)) return false
    return this.puddles.delete(this.grid.idx(x, z))
  }

  get count() { return this.puddles.size }

  /** All puddle tiles, used by sims fleeing a fire. */
  forEach(fn: (x: number, z: number, kind: PuddleKind) => void) {
    for (const p of this.puddles.values()) fn(p.x, p.z, p.kind)
  }

  update(dtMin: number, time: number) {
    for (const [i, p] of this.puddles) {
      p.life -= dtMin
      if (p.life <= 0) this.puddles.delete(i)
    }
    this.layer.begin()
    for (const p of this.puddles.values()) {
      const [wx, wz] = this.grid.tileToWorld(p.x, p.z)
      const k = Math.min(1, p.life / (p.maxLife * 0.3))
      this.layer.add(wx, wz, 0.95 + p.seed * 0.02, COLORS[p.kind], 0.55 * k, p.seed, p.seed)
    }
    this.layer.end(time)
  }
}
