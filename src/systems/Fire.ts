import * as THREE from 'three'
import { DecalLayer } from './Decals'
import { Floor, type Grid } from '../world/Grid'
import type { IGame } from '../types'
import type { Effects } from './Effects'
import { audio } from '../core/Audio'

export interface FireCell {
  x: number
  z: number
  /** 0.3 = smoldering, 2.5 = fully involved. */
  intensity: number
  fuel: number
  age: number
  seed: number
}

const FLOOR_FUEL: Record<number, number> = {
  [Floor.None]: 1.2,
  [Floor.Wood]: 5.5,
  [Floor.Tile]: 0.4,
  [Floor.Carpet]: 8.0,
  [Floor.Concrete]: 0.2,
  [Floor.Marble]: 0.2,
}

export class FireSystem {
  readonly fires = new Map<number, FireCell>()
  readonly scorchLayer = new DecalLayer(500, 0.028)
  private scorched = new Map<number, { x: number; z: number; seed: number }>()
  private alarmCooldown = 0
  private spreadAccum = 0
  private tmp = new THREE.Vector3()

  constructor(private grid: Grid) {}

  get count() { return this.fires.size }
  get maxIntensity() {
    let m = 0
    for (const f of this.fires.values()) m = Math.max(m, f.intensity)
    return m
  }
  get totalIntensity() {
    let m = 0
    for (const f of this.fires.values()) m += f.intensity
    return m
  }

  /** Fuel available on a tile, from its floor and whatever is standing on it. */
  private fuelAt(game: IGame, x: number, z: number): number {
    if (!this.grid.inBounds(x, z)) return 0
    const i = this.grid.idx(x, z)
    if (this.grid.pool[i]) return 0
    if (game.puddleAt(x, z)) return 0
    let fuel = FLOOR_FUEL[this.grid.floor[i]] ?? 1
    const objId = this.grid.objAt[i]
    if (objId) {
      const obj = game.objects.find((o) => o.id === objId && o.contains(x, z))
      if (obj) {
        if (obj.def.flags?.fireproof || obj.charred) return 0.05
        fuel += obj.flammability * 26
      }
    }
    return fuel
  }

  start(game: IGame, x: number, z: number, intensity = 1) {
    if (!this.grid.inBounds(x, z)) return
    const i = this.grid.idx(x, z)
    if (this.fires.has(i)) return
    if (this.grid.pool[i] || game.puddleAt(x, z)) return
    const fuel = this.fuelAt(game, x, z)
    if (fuel <= 0.1) return
    this.fires.set(i, { x, z, intensity, fuel, age: 0, seed: Math.random() * 10 })
    audio.play('ignite', this.worldOf(x, z))
    audio.startLoop('firebed', 'fire', this.worldOf(x, z))
    if (this.fires.size === 1) {
      game.notify('<b>FIRE!</b> Something has caught alight.', 'danger', '🔥')
      if (game.findObject('smokeAlarm')) {
        audio.play('alarm')
        game.notify('The smoke alarm is screaming.', 'warn', '🚨')
      }
    }
    if (this.fires.size === 4) game.recordDeed('arsonist')
  }

  private worldOf(x: number, z: number) {
    const [wx, wz] = this.grid.tileToWorld(x, z)
    return new THREE.Vector3(wx, 0.4, wz)
  }

  extinguish(x: number, z: number, amount: number) {
    const i = this.grid.idx(x, z)
    const f = this.fires.get(i)
    if (!f) return
    f.intensity -= amount
    if (f.intensity <= 0.1) this.douse(i, f)
  }

  private douse(i: number, f: FireCell) {
    this.fires.delete(i)
    this.scorched.set(i, { x: f.x, z: f.z, seed: f.seed })
    if (this.fires.size === 0) audio.stopLoop('firebed')
  }

  extinguishAll() {
    for (const [i, f] of [...this.fires]) this.douse(i, f)
  }

  update(game: IGame, dtMin: number, dtReal: number, fx: Effects) {
    this.alarmCooldown -= dtReal
    if (this.fires.size === 0) return

    const grid = this.grid

    // --- burn down fuel, ignite objects, hurt sims
    for (const [i, f] of [...this.fires]) {
      f.age += dtMin
      const burnRate = 0.9 + f.intensity * 0.35
      f.fuel -= burnRate * dtMin * 0.14
      const targetIntensity = Math.min(2.6, 0.4 + f.fuel * 0.16)
      f.intensity += (targetIntensity - f.intensity) * Math.min(1, dtMin * 0.08)
      if (f.fuel <= 0 || f.intensity < 0.15) { this.douse(i, f); continue }
      if (grid.pool[i] || game.puddleAt(f.x, f.z)) { this.douse(i, f); continue }

      // consume the object standing here
      const objId = grid.objAt[i]
      if (objId) {
        const obj = game.objects.find((o) => o.contains(f.x, f.z))
        if (obj && !obj.charred && !obj.def.flags?.fireproof) {
          obj.onFire = true
          obj.meta.burn = ((obj.meta.burn as number) ?? 0) + dtMin
          if ((obj.meta.burn as number) > 9) {
            obj.onFire = false
            obj.setCharred(true)
            for (const t of obj.tiles()) grid.solid[grid.idx(t.x, t.z)] = 0
            game.notify(`The ${obj.def.name.toLowerCase()} is destroyed.`, 'warn', '🔥')
          }
        }
      }

      const wp = this.worldOf(f.x, f.z)
      for (const sim of game.sims) {
        if (!sim.alive) continue
        const st = sim.tileOf(game)
        const d = Math.hypot(st.x - f.x, st.z - f.z)
        if (d < 0.9) {
          if (sim.burning === 0 && !sim.inPool) {
            sim.burning = 0.01
            sim.avatar.tint(0xff4400, 1.4)
            audio.play('scream', sim.pos)
            game.notify(`<b>${sim.name}</b> is on fire!`, 'danger', '🔥')
          }
        } else if (d < 6.5) {
          sim.reactToDanger(game, wp, (1 - d / 6.5) * f.intensity)
        }
      }
    }

    // --- spread
    this.spreadAccum += dtMin
    if (this.spreadAccum > 0.5) {
      const step = this.spreadAccum
      this.spreadAccum = 0
      for (const f of [...this.fires.values()]) {
        if (f.intensity < 0.6) continue
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = f.x + dx, nz = f.z + dz
          if (!grid.inBounds(nx, nz)) continue
          const ni = grid.idx(nx, nz)
          if (this.fires.has(ni)) continue
          if (grid.wallBetween(f.x, f.z, nx, nz)) continue
          const fuel = this.fuelAt(game, nx, nz)
          if (fuel < 0.6) continue
          const p = Math.min(0.55, fuel * 0.0072 * f.intensity * step)
          if (game.rand.next() < p) {
            this.fires.set(ni, { x: nx, z: nz, intensity: 0.5, fuel, age: 0, seed: Math.random() * 10 })
            if (this.fires.size >= 4) game.recordDeed('arsonist')
          }
        }
      }
    }

    // --- household response
    if (this.alarmCooldown <= 0) {
      this.alarmCooldown = 6
      const extinguisher = game.findObject('extinguisher')
      if (extinguisher && !extinguisher.charred) {
        // the calmest sim available goes to fight the fire
        const candidates = game.sims.filter((s) => s.alive && s.burning === 0 && s.traits.bravery < 1.3)
        const hero = candidates.sort((a, b) => a.traits.bravery - b.traits.bravery)[0]
        const target = [...this.fires.values()].sort((a, b) => b.intensity - a.intensity)[0]
        if (hero && target && hero.task?.tag !== 'firefight') {
          const stand = grid.findNearest(target.x, target.z, (x, z) =>
            grid.walkable(x, z) && !this.fires.has(grid.idx(x, z)), { allowStart: false })
          if (stand) {
            hero.clearTask(game)
            hero.task = {
              ...hero.simpleTask('Fighting the fire', 'repair', 30, 8, stand),
              tag: 'firefight',
              phase: 'route',
              onTick: (s, g, dt) => {
                const t = s.tileOf(g)
                for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
                  this.extinguish(t.x + dx, t.z + dz, dt * 0.95)
                }
                if (g.rand.next() < dt * 0.4) fx.steam(s.pos.x, 0.8, s.pos.z, 2)
              },
            }
            hero.say('Everyone out!', 3)
          }
        }
      }
    }

    if (this.fires.size > 0) {
      const worst = [...this.fires.values()].sort((a, b) => b.intensity - a.intensity)[0]
      audio.moveLoop('firebed', this.worldOf(worst.x, worst.z))
    }
  }

  /**
   * Flames are drawn every frame, including while the game is paused, so a
   * paused lot still looks like it is burning.
   */
  emitParticles(fx: Effects, dtReal: number) {
    if (this.fires.size === 0) return
    // one particle budget shared across every burning cell
    const budget = Math.min(1, 6 / this.fires.size)
    for (const f of this.fires.values()) {
      const [wx, wz] = this.grid.tileToWorld(f.x, f.z)
      fx.fire(wx, 0.15, wz, f.intensity, dtReal * budget)
    }
  }

  /** Fire positions for lighting. */
  lightSources(): { x: number; y: number; z: number; intensity: number }[] {
    const out: { x: number; y: number; z: number; intensity: number }[] = []
    for (const f of this.fires.values()) {
      const [wx, wz] = this.grid.tileToWorld(f.x, f.z)
      out.push({ x: wx, y: 0.2, z: wz, intensity: f.intensity })
    }
    return out
  }

  renderScorch(time: number) {
    this.scorchLayer.begin()
    const col = new THREE.Color(0x1a1512)
    for (const s of this.scorched.values()) {
      const [wx, wz] = this.grid.tileToWorld(s.x, s.z)
      this.scorchLayer.add(wx, wz, 1.35, col, 0.72, s.seed, s.seed)
    }
    this.scorchLayer.end(time)
  }

  nearestFireDistance(pos: THREE.Vector3): number {
    let best = Infinity
    for (const f of this.fires.values()) {
      const [wx, wz] = this.grid.tileToWorld(f.x, f.z)
      this.tmp.set(wx, 0, wz)
      best = Math.min(best, this.tmp.distanceTo(pos))
    }
    return best
  }
}
