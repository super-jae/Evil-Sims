import * as THREE from 'three'
import { Engine } from './core/Engine'
import { Input, CameraRig } from './core/Input'
import { GameClock } from './core/Time'
import { Rand } from './core/Rand'
import { audio } from './core/Audio'
import { Grid, Floor, LOT_W, LOT_H, type TilePos } from './world/Grid'
import { mats } from './world/Materials'
import { Lot, type WallMode } from './world/Lot'
import { CATALOG, CATALOG_BY_ID, GRAVESTONE, initCatalog } from './world/Catalog'
import { WorldObject, footprintFits } from './world/WorldObject'
import type { ObjectDef } from './world/ObjectTypes'
import { BUILDERS } from './world/Meshes'
import { Sim } from './sim/Sim'
import { Relationships } from './sim/Relationships'
import type { SocialDef } from './sim/Socials'
import { SKIN_TONES, HAIR_COLORS, CLOTH_COLORS, type SimLook } from './sim/SimMesh'
import { TRAITS } from './sim/Traits'
import { Effects } from './systems/Effects'
import { FireSystem } from './systems/Fire'
import { PuddleSystem } from './systems/Puddles'
import { DEATHS, DEED_BY_ID, type DeathId } from './systems/Deaths'
import type { IGame, NoteKind } from './types'

export type Mode = 'live' | 'build'
export type BuildTool = 'object' | 'sell' | 'wall' | 'door' | 'floor' | 'pool' | 'erase'

const FIRST_NAMES = [
  'Bella', 'Mortimer', 'Cassandra', 'Alexander', 'Nervous', 'Agnes', 'Bob', 'Dina',
  'Malcolm', 'Brandi', 'Daniel', 'Marisa', 'Vidcund', 'Pascal', 'Lola', 'Chloe',
  'Gunther', 'Cornelia', 'Erin', 'Ripp', 'Buzz', 'Tank', 'Ophelia', 'Johnny',
]
const SURNAMES = ['Goth', 'Pleasant', 'Landgraab', 'Curious', 'Broke', 'Caliente', 'Grunt', 'Specter']

interface DeathRecord {
  name: string
  death: DeathId
  day: number
  time: string
  detail?: string
}

interface ReaperVisit {
  root: THREE.Group
  sim: Sim
  timer: number
  phase: number
}

export interface BuildState {
  tool: BuildTool
  defId: string | null
  rot: 0 | 1 | 2 | 3
  floor: Floor
}

export class Game implements IGame {
  readonly engine: Engine
  readonly rig: CameraRig
  readonly input: Input
  readonly grid = new Grid()
  readonly clock = new GameClock()
  readonly rand = new Rand(Math.floor(Math.random() * 0xfffffff))
  readonly lot: Lot
  readonly fx: Effects
  readonly fire: FireSystem
  readonly puddles: PuddleSystem
  readonly relationships = new Relationships()

  sims: Sim[] = []
  objects: WorldObject[] = []
  funds = 18000
  spentTotal = 0
  earnedTotal = 0
  soldCount = 0

  mode: Mode = 'live'
  build: BuildState = { tool: 'object', defId: null, rot: 0, floor: Floor.Wood }
  selected: Sim | null = null

  deeds = new Set<string>()
  deedPoints = 0
  deaths: DeathRecord[] = []
  deathTypes = new Set<DeathId>()
  private fireDeathTally = 0
  private fireEpoch = 0

  // --- social cruelty bookkeeping
  meanSocialTotal = 0
  private meanAgainst = new Map<number, number>()
  private wakeCount = new Map<number, number>()
  private fightCount = 0
  private shovedIntoPoolAt = new Map<number, number>()

  /** Sim currently being dragged by the player. */
  dragging: Sim | null = null
  private dragPlaneY = 0

  private simGroup = new THREE.Group()
  private objGroup = new THREE.Group()
  private ghostPreview: THREE.Group | null = null
  private reapers: ReaperVisit[] = []
  private elapsedReal = 0
  private timers: { at: number; fn: () => void }[] = []

  // UI callbacks, assigned by the UI layer
  onNotify: (text: string, kind: NoteKind, icon: string) => void = () => {}
  onDeed: (id: string) => void = () => {}
  onStateChange: () => void = () => {}
  onGameOver: () => void = () => {}

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    mats.build()
    initCatalog()
    this.engine = new Engine(canvas)
    this.rig = new CameraRig(this.engine.camera)
    this.input = new Input(canvas, this.engine.camera, this.rig)
    this.lot = new Lot(this.grid)
    this.fx = new Effects(uiRoot)
    this.fire = new FireSystem(this.grid)
    this.puddles = new PuddleSystem(this.grid)

    this.engine.scene.add(this.lot.group, this.objGroup, this.simGroup, this.fx.group)
    this.engine.scene.add(this.puddles.layer.mesh, this.fire.scorchLayer.mesh)
    this.rig.lookAt(new THREE.Vector3(2.5, 0, -1), 34)
    this.rig.setPolar(0.82)
  }

  // ================================================================= setup

  createWorld() {
    this.buildStarterHome()
    this.lot.rebuildFloors()
    this.lot.rebuildWalls()
    this.lot.rebuildPool()
    this.grid.recomputeIndoors()
    this.spawnHousehold()
    this.refreshPoolExits()
  }

  private fillFloor(x0: number, z0: number, x1: number, z1: number, f: Floor) {
    for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) {
      if (this.grid.inBounds(x, z)) this.grid.floor[this.grid.idx(x, z)] = f
    }
  }
  private hWall(x0: number, x1: number, z: number) {
    for (let x = x0; x < x1; x++) if (this.grid.inBounds(x, z)) this.grid.wallN[this.grid.idx(x, z)] = 1
  }
  private vWall(z0: number, z1: number, x: number) {
    for (let z = z0; z < z1; z++) if (this.grid.inBounds(x, z)) this.grid.wallW[this.grid.idx(x, z)] = 1
  }
  private doorN(x: number, z: number) { this.grid.doorN[this.grid.idx(x, z)] = 1 }
  private doorW(x: number, z: number) { this.grid.doorW[this.grid.idx(x, z)] = 1 }

  private buildStarterHome() {
    // --- shell -----------------------------------------------------------
    this.fillFloor(9, 9, 25, 23, Floor.Wood)
    this.fillFloor(9, 9, 17, 16, Floor.Carpet)   // bedroom 1
    this.fillFloor(17, 9, 25, 16, Floor.Carpet)  // bedroom 2
    this.fillFloor(9, 16, 15, 23, Floor.Tile)    // bathroom / utility

    this.hWall(9, 25, 9)
    this.hWall(9, 25, 23)
    this.vWall(9, 23, 9)
    this.vWall(9, 23, 25)

    this.hWall(9, 25, 16)
    this.vWall(9, 16, 17)
    this.vWall(16, 23, 15)

    this.doorN(12, 16); this.doorN(20, 16)
    this.doorW(17, 12)
    this.doorW(15, 19)
    this.doorN(19, 23)   // front door

    // --- patio and pool --------------------------------------------------
    this.fillFloor(25, 10, 33, 21, Floor.Concrete)
    for (let x = 27; x < 32; x++) for (let z = 12; z < 19; z++) {
      const i = this.grid.idx(x, z)
      this.grid.pool[i] = 1
      this.grid.floor[i] = Floor.None
    }

    // --- furnishings -----------------------------------------------------
    const P = (id: string, x: number, z: number, rot: 0 | 1 | 2 | 3 = 0) => this.placeObject(id, x, z, rot, true)

    // bedroom 1
    P('bedDouble', 10, 10, 0)
    P('lamp', 13, 10)
    P('mirror', 15, 10, 1)
    // bedroom 2
    P('bedSingle', 18, 10, 0)
    P('bedSingle', 21, 10, 0)
    P('bookshelf', 23, 9)
    P('computer', 23, 13, 2)
    P('diningChair', 23, 14, 0)
    // bathroom
    P('toilet', 9, 17, 3)
    P('shower', 9, 20, 3)
    P('sink', 11, 16, 0)
    P('toilet', 13, 17, 3)
    P('trash', 13, 22)
    // kitchen / living
    P('fridge', 15, 16, 0)
    P('counter', 16, 16, 0)
    P('stove', 17, 16, 0)
    P('counter', 18, 16, 0)
    P('espresso', 19, 16, 0)
    P('microwave', 20, 16, 0)
    P('diningTable', 16, 19, 0)
    P('diningChair', 16, 20, 2)
    P('diningChair', 17, 20, 2)
    P('diningChair', 16, 18, 0)
    P('sofa', 21, 21, 2)
    P('coffeeTable', 21, 20, 0)
    P('tv', 21, 18, 0)
    P('rug', 16, 21, 0)
    P('plant', 24, 22)
    P('smokeAlarm', 22, 16)
    P('extinguisher', 15, 22)
    P('curtains', 23, 16, 0)
    // outdoors
    P('poolLadder', 27, 12, 0)
    P('treadmill', 25, 19, 0)
    P('tree', 4, 5)
    P('tree', 29, 27)
    P('flowerbed', 11, 25)
    P('umbrella', 26, 10)
    P('painting', 23, 22, 2)
  }

  private spawnHousehold() {
    const used = new Set<string>()
    const surname = this.rand.pick(SURNAMES)
    const spots: TilePos[] = [{ x: 18, z: 20 }, { x: 19, z: 20 }, { x: 20, z: 21 }, { x: 18, z: 19 }]
    const count = 4
    for (let i = 0; i < count; i++) {
      let name = this.rand.pick(FIRST_NAMES)
      let guard = 0
      while (used.has(name) && guard++ < 40) name = this.rand.pick(FIRST_NAMES)
      used.add(name)

      const look: SimLook = {
        skin: this.rand.pick(SKIN_TONES),
        hair: this.rand.pick(HAIR_COLORS),
        hairStyle: this.rand.int(0, 3) as 0 | 1 | 2 | 3,
        shirt: this.rand.pick(CLOTH_COLORS),
        pants: this.rand.pick(CLOTH_COLORS),
        shoes: this.rand.pick([0x2a2a30, 0x5a3a22, 0xf0f0f0]),
        height: this.rand.range(0.93, 1.07),
        build: this.rand.range(-0.5, 1),
      }
      const pool = this.rand.shuffle(TRAITS.map((t) => t.id))
      const traits = pool.slice(0, 3)
      const sim = new Sim(name, surname, look, traits, this.rand.range(28, 60))
      const spot = spots[i % spots.length]
      const [wx, wz] = this.grid.tileToWorld(spot.x, spot.z)
      sim.pos.set(wx, 0, wz)
      sim.facing = this.rand.range(-Math.PI, Math.PI)
      for (const k of Object.keys(sim.skills) as (keyof typeof sim.skills)[]) {
        sim.skills[k] = this.rand.range(0, 3.5)
      }
      this.sims.push(sim)
      this.simGroup.add(sim.avatar.root)
    }
    this.selectSim(this.sims[0])
  }

  private refreshPoolExits() {
    this.grid.poolExit.fill(0)
    for (const o of this.objects) {
      if (!o.def.flags?.ladder) continue
      for (const t of o.tiles()) {
        this.grid.poolExit[this.grid.idx(t.x, t.z)] = 1
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = t.x + dx, nz = t.z + dz
          if (this.grid.inBounds(nx, nz)) this.grid.poolExit[this.grid.idx(nx, nz)] = 1
        }
      }
    }
  }

  // ================================================================= IGame

  notify(text: string, kind: NoteKind = 'info', icon = '') {
    this.onNotify(text, kind, icon)
  }

  spend(amount: number): boolean {
    if (this.funds < amount) {
      this.notify('Not enough simoleons.', 'warn', '🪙')
      audio.play('cancel')
      return false
    }
    this.funds -= amount
    this.spentTotal += amount
    this.onStateChange()
    return true
  }

  earn(amount: number) {
    this.funds += amount
    this.earnedTotal += amount
    this.onStateChange()
  }

  spark(x: number, y: number, z: number, count = 12, color = 0xffee66) { this.fx.spark(x, y, z, count, color) }
  smoke(x: number, y: number, z: number, count = 4) { this.fx.smoke(x, y, z, count) }
  splash(x: number, y: number, z: number) { this.fx.splash(x, y, z) }
  floatText(x: number, y: number, z: number, text: string, color = '#fff') { this.fx.floatText(x, y, z, text, color) }

  startFire(tx: number, tz: number, intensity = 1) { this.fire.start(this, tx, tz, intensity) }
  makePuddle(tx: number, tz: number, kind: 'water' | 'urine' | 'grime' = 'water') { this.puddles.add(tx, tz, kind) }
  removePuddleAt(tx: number, tz: number) { return this.puddles.remove(tx, tz) }
  puddleAt(tx: number, tz: number) { return this.puddles.has(tx, tz) }

  objectsWithFlag(flag: string) {
    return this.objects.filter((o) => (o.def.flags as Record<string, unknown> | undefined)?.[flag])
  }
  findObject(defId: string) { return this.objects.find((o) => o.def.id === defId && !o.charred) }

  after(minutes: number, fn: () => void) {
    this.timers.push({ at: this.clock.minutes + minutes, fn })
  }

  private tickTimers() {
    if (!this.timers.length) return
    const now = this.clock.minutes
    const due = this.timers.filter((t) => t.at <= now)
    if (!due.length) return
    this.timers = this.timers.filter((t) => t.at > now)
    for (const t of due) t.fn()
  }

  /** Bookkeeping for social cruelty, and the deeds that hang off it. */
  noteSocial(actor: Sim, target: Sim, social: SocialDef) {
    if (social.tone === 'friendly') return
    this.meanSocialTotal++
    this.meanAgainst.set(target.id, (this.meanAgainst.get(target.id) ?? 0) + 1)
    if (this.meanSocialTotal >= 15) this.recordDeed('bully')

    if (social.id === 'wake') {
      const n = (this.wakeCount.get(target.id) ?? 0) + 1
      this.wakeCount.set(target.id, n)
      if (n >= 5) this.recordDeed('sleepdeprived')
    }
    if (social.id === 'fight') {
      this.fightCount++
      if (this.fightCount >= 3) this.recordDeed('brawler')
    }
    if (social.id === 'shovePool') this.shovedIntoPoolAt.set(target.id, this.clock.minutes)

    if (this.relationships.get(actor, target) <= -95 || this.relationships.get(target, actor) <= -95) {
      this.recordDeed('nemesis')
    }
    // is anybody universally loathed?
    for (const victim of this.sims) {
      if (!victim.alive) continue
      const others = this.sims.filter((s) => s !== victim && s.alive)
      if (others.length >= 2 && others.every((o) => this.relationships.get(o, victim) < -25)) {
        this.recordDeed('pariah')
      }
    }
    this.onStateChange()
  }

  /** How many cruel things have been done to this sim. */
  crueltyAgainst(sim: Sim) { return this.meanAgainst.get(sim.id) ?? 0 }

  recordDeed(id: string) {
    if (this.deeds.has(id)) return
    const def = DEED_BY_ID.get(id)
    if (!def) return
    this.deeds.add(id)
    this.deedPoints += def.points
    audio.play('deed')
    this.notify(`<b>Devious Deed:</b> ${def.name} — +${def.points}`, 'death', def.icon)
    this.onDeed(id)
    this.onStateChange()
  }

  // ================================================================= death

  kill(sim: Sim, death: DeathId, detail?: string) {
    if (sim.dead) return
    sim.dead = true
    sim.deathId = death
    sim.burning = 0
    sim.avatar.tint(null)
    sim.anim = 'collapse'
    // release whatever they were using, or nobody else can ever use it again
    sim.clearTask(this)
    sim.path = null
    sim.queue = []
    sim.avatar.setSelected(false)

    const def = DEATHS[death]
    this.deaths.push({
      name: sim.fullName, death, day: this.clock.day, time: this.clock.label, detail,
    })
    this.deathTypes.add(death)

    audio.play('reaper', sim.pos)
    this.fx.deathBurst(sim.pos.x, 0.4, sim.pos.z, new THREE.Color(def.color).getHex())
    this.fx.floatText(sim.pos.x, 1.9, sim.pos.z, def.icon + ' ' + def.name, def.color)
    this.rig.shake(0.35)
    this.engine.desat = 0.75
    this.clock.setSpeed(1)
    this.rig.lookAt(sim.pos, Math.min(this.rig.distance, 16))

    this.notify(
      `<b>${sim.fullName}</b> ${def.obituary}.${detail ? ` (${detail})` : ''}`,
      'death', def.icon)

    // --- deeds
    if (def.deed) this.recordDeed(def.deed)
    this.recordDeed('firstblood')
    if (this.clock.day <= 1) this.recordDeed('speedrun')
    if (this.deathTypes.size >= 5) this.recordDeed('varietypack')
    if (this.earnedTotal > this.spentTotal) this.recordDeed('frugal')
    if (this.sims.every((s) => s.dead)) this.recordDeed('fullhouse')

    // was this sim sealed in?
    const t = sim.tileOf(this)
    const canLeave = this.grid.canReach(t.x, t.z, (x, z) =>
      x <= 1 || z <= 1 || x >= LOT_W - 2 || z >= LOT_H - 2, { avoidPool: true })
    if (!canLeave) this.recordDeed('trapped')

    if (death === 'drowning') {
      const shoved = this.shovedIntoPoolAt.get(sim.id)
      if (shoved !== undefined && this.clock.minutes - shoved < 180) this.recordDeed('pushed')
    }
    if (death === 'mortification' && this.crueltyAgainst(sim) >= 5) this.recordDeed('socialmurder')

    if (death === 'fire') {
      if (this.clock.minutes - this.fireEpoch > 600) { this.fireEpoch = this.clock.minutes; this.fireDeathTally = 0 }
      this.fireDeathTally++
      if (this.fireDeathTally >= 3) this.recordDeed('rubegoldberg')
    }

    this.summonReaper(sim)
    if (this.selected === sim) {
      const next = this.sims.find((s) => s.alive)
      this.selectSim(next ?? null)
    }
    this.onStateChange()
    if (this.sims.every((s) => s.dead)) {
      setTimeout(() => this.onGameOver(), 4200)
    }
  }

  private summonReaper(sim: Sim) {
    const root = BUILDERS.reaper() as THREE.Group
    root.position.set(sim.pos.x + 1.6, 0, sim.pos.z + 1.2)
    root.rotation.y = Math.atan2(sim.pos.x - root.position.x, sim.pos.z - root.position.z)
    root.traverse((c) => {
      const m = c as THREE.Mesh
      if (!m.isMesh) return
      const mm = (m.material as THREE.Material).clone()
      ;(mm as THREE.MeshStandardMaterial).transparent = true
      ;(mm as THREE.MeshStandardMaterial).opacity = 0
      m.material = mm
      m.castShadow = true
    })
    this.engine.scene.add(root)
    this.reapers.push({ root, sim, timer: 0, phase: 0 })
    audio.play('ghost', sim.pos)
  }

  private updateReapers(dt: number) {
    for (let i = this.reapers.length - 1; i >= 0; i--) {
      const r = this.reapers[i]
      r.timer += dt
      const fade = r.timer < 1 ? r.timer : r.timer > 5 ? Math.max(0, 1 - (r.timer - 5) / 1.6) : 1
      r.root.traverse((c) => {
        const m = c as THREE.Mesh
        if (m.isMesh) (m.material as THREE.MeshStandardMaterial).opacity = fade * 0.94
      })
      r.root.position.y = Math.sin(r.timer * 1.4) * 0.09
      if (r.timer > 3.4 && r.phase === 0) {
        r.phase = 1
        r.sim.avatar.root.visible = false
        this.placeGravestone(r.sim)
        r.sim.becomeGhost()
      }
      if (r.timer > 6.8) {
        r.root.removeFromParent()
        this.reapers.splice(i, 1)
        this.engine.desat = 0
      }
    }
  }

  private placeGravestone(sim: Sim) {
    const t = sim.tileOf(this)
    let spot: TilePos | null = null
    for (const cand of [{ x: t.x, z: t.z }, ...this.grid.adjacentFreeTiles(t.x, t.z, 1, 1)]) {
      if (footprintFits(this.grid, cand.x, cand.z, 1, 1)) { spot = cand; break }
    }
    if (!spot) {
      spot = this.grid.findNearest(t.x, t.z, (x, z) => footprintFits(this.grid, x, z, 1, 1))
    }
    if (!spot) return
    const obj = this.spawnObject(GRAVESTONE, spot.x, spot.z, 0)
    obj.meta.owner = sim.fullName
    const [wx, wz] = this.grid.tileToWorld(spot.x, spot.z)
    sim.pos.set(wx, 0.6, wz)
    this.fx.floatText(wx, 1.5, wz, `RIP ${sim.name}`, '#b06cff')
  }

  // ================================================================= build

  private spawnObject(def: ObjectDef, tx: number, tz: number, rot: 0 | 1 | 2 | 3): WorldObject {
    const obj = new WorldObject(def, tx, tz, rot)
    this.objects.push(obj)
    this.objGroup.add(obj.root)
    for (const t of obj.tiles()) {
      const i = this.grid.idx(t.x, t.z)
      this.grid.objAt[i] = obj.id
      if (def.flags?.solid) this.grid.solid[i] = 1
    }
    return obj
  }

  canPlace(def: ObjectDef, tx: number, tz: number, rot: 0 | 1 | 2 | 3): boolean {
    const [w, d] = rot % 2 === 0 ? def.size : [def.size[1], def.size[0]]
    return footprintFits(this.grid, tx, tz, w, d, {
      needsFloor: false,
      poolOnly: def.flags?.poolOnly,
      outdoorOnly: def.flags?.outdoorOnly,
    })
  }

  placeObject(defId: string, tx: number, tz: number, rot: 0 | 1 | 2 | 3, free = false): WorldObject | null {
    const def = CATALOG_BY_ID.get(defId)
    if (!def) return null
    if (!this.canPlace(def, tx, tz, rot)) {
      if (!free) { audio.play('cancel'); this.notify('That does not fit there.', 'warn', '🚫') }
      return null
    }
    if (!free && !this.spend(def.price)) return null
    const obj = this.spawnObject(def, tx, tz, rot)
    if (!free) {
      audio.play('place', obj.centerWorld)
      this.fx.smoke(obj.centerWorld.x, 0.1, obj.centerWorld.z, 3)
    }
    if (def.flags?.ladder) this.refreshPoolExits()
    this.onStateChange()
    return obj
  }

  sellObject(obj: WorldObject) {
    if (obj.def.id === 'gravestone') {
      this.notify('The dead stay where you put them.', 'warn', '🪦')
      return
    }
    const refund = Math.round(obj.def.price * (obj.charred ? 0.1 : 0.9))
    for (const t of obj.tiles()) {
      const i = this.grid.idx(t.x, t.z)
      this.grid.objAt[i] = 0
      this.grid.solid[i] = 0
    }
    // free any sim mid-use
    for (const s of this.sims) {
      if (s.task?.obj === obj) s.clearTask(this)
      s.queue = s.queue.filter((q) => q.obj !== obj)
    }
    audio.stopLoop(`water${obj.id}`)
    audio.stopLoop(`sizzle${obj.id}`)
    audio.stopLoop(`fire${obj.id}`)
    obj.dispose()
    this.objects = this.objects.filter((o) => o !== obj)
    this.earn(refund)
    this.soldCount++
    if (this.soldCount >= 20) this.recordDeed('demolition')
    audio.play('sell', obj.centerWorld)
    this.fx.spark(obj.centerWorld.x, 0.4, obj.centerWorld.z, 10, 0x57e389)
    this.notify(`Sold ${obj.def.name} for §${refund}.`, 'good', '🪙')
    if (obj.def.flags?.ladder) {
      this.refreshPoolExits()
      const swimmers = this.sims.filter((s) => s.alive && s.inPool)
      if (swimmers.length) this.notify('There is no way out of the pool now.', 'danger', '🪜')
    }
    if (obj.def.id === 'toilet' && !this.findObject('toilet')) {
      const desperate = this.sims.some((s) => s.alive && s.needs.bladder < 30)
      if (desperate) this.recordDeed('plumbing')
    }
    this.onStateChange()
  }

  paintFloor(tx: number, tz: number) {
    if (!this.grid.inBounds(tx, tz)) return false
    const i = this.grid.idx(tx, tz)
    if (this.grid.pool[i]) return false
    if (this.grid.floor[i] === this.build.floor) return false
    const cost = this.build.floor === Floor.None ? 0 : 12
    if (cost && !this.spend(cost)) return false
    if (this.build.floor === Floor.None) this.earn(4)
    this.grid.floor[i] = this.build.floor
    return true
  }

  toggleWall(tx: number, tz: number, axis: 'n' | 'w', erase: boolean, door: boolean) {
    if (!this.grid.inBounds(tx, tz)) return false
    const i = this.grid.idx(tx, tz)
    const arr = axis === 'n' ? this.grid.wallN : this.grid.wallW
    const darr = axis === 'n' ? this.grid.doorN : this.grid.doorW
    if (erase) {
      if (!arr[i]) return false
      arr[i] = 0; darr[i] = 0
      this.earn(14)
      return true
    }
    if (door) {
      if (!arr[i]) return false
      darr[i] = darr[i] ? 0 : 1
      return true
    }
    if (arr[i]) return false
    if (!this.spend(28)) return false
    arr[i] = 1
    return true
  }

  digPool(tx: number, tz: number, fill: boolean) {
    if (!this.grid.inBounds(tx, tz)) return false
    const i = this.grid.idx(tx, tz)
    if (fill) {
      if (!this.grid.pool[i]) return false
      this.grid.pool[i] = 0
      this.earn(30)
      return true
    }
    if (this.grid.pool[i] || this.grid.objAt[i]) return false
    if (this.grid.wallN[i] || this.grid.wallW[i]) return false
    if (!this.spend(90)) return false
    this.grid.pool[i] = 1
    this.grid.floor[i] = Floor.None
    return true
  }

  rebuildLot(floors = true, walls = true, pool = true) {
    if (floors) this.lot.rebuildFloors()
    if (walls) { this.lot.rebuildWalls(); this.grid.recomputeIndoors() }
    if (pool) this.lot.rebuildPool()
  }

  setWallMode(m: WallMode) { this.lot.wallMode = m }

  // ================================================================= picking

  pickSim(): Sim | null {
    const roots = this.sims.filter((s) => s.alive && s.avatar.root.visible).map((s) => s.avatar.root)
    const hits = this.input.raycast(roots)
    if (!hits.length) return null
    let node: THREE.Object3D | null = hits[0].object
    while (node) {
      const found = this.sims.find((s) => s.avatar.root === node)
      if (found) return found
      node = node.parent
    }
    return null
  }

  pickObject(): WorldObject | null {
    const hits = this.input.raycast(this.objGroup.children)
    if (!hits.length) return null
    let node: THREE.Object3D | null = hits[0].object
    while (node) {
      if (node.userData.worldObject) return node.userData.worldObject as WorldObject
      node = node.parent
    }
    return null
  }

  hoveredTile(): TilePos | null {
    const p = this.input.groundPoint()
    if (!p) return null
    const t = this.grid.worldToTile(p.x, p.z)
    return this.grid.inBounds(t.x, t.z) ? t : null
  }

  /** Which wall edge is the cursor nearest? Used by the wall tool. */
  hoveredEdge(): { x: number; z: number; axis: 'n' | 'w' } | null {
    const p = this.input.groundPoint()
    if (!p) return null
    const fx = p.x / 1 + LOT_W / 2
    const fz = p.z / 1 + LOT_H / 2
    const cx = Math.floor(fx), cz = Math.floor(fz)
    const rx = fx - cx, rz = fz - cz
    const dists: [number, { x: number; z: number; axis: 'n' | 'w' }][] = [
      [rz, { x: cx, z: cz, axis: 'n' }],
      [1 - rz, { x: cx, z: cz + 1, axis: 'n' }],
      [rx, { x: cx, z: cz, axis: 'w' }],
      [1 - rx, { x: cx + 1, z: cz, axis: 'w' }],
    ]
    dists.sort((a, b) => a[0] - b[0])
    const e = dists[0][1]
    return this.grid.inBounds(e.x, e.z) ? e : null
  }

  /**
   * Pull the camera back to take in the whole household. The direct answer to
   * "I have lost them and cannot find my way back".
   */
  frameHousehold() {
    const alive = this.sims.filter((s) => s.alive)
    const points = alive.length ? alive.map((s) => s.pos) : [new THREE.Vector3(0, 0, 0)]
    const center = points
      .reduce((acc, p) => acc.add(p), new THREE.Vector3())
      .divideScalar(points.length)
    let spread = 6
    for (const p of points) spread = Math.max(spread, p.distanceTo(center))
    this.rig.lookAt(center, THREE.MathUtils.clamp(spread * 2.4 + 12, 16, this.rig.maxDistance))
  }

  selectSim(sim: Sim | null) {
    if (this.selected) this.selected.avatar.setSelected(false)
    this.selected = sim
    if (sim && sim.alive) {
      sim.avatar.setSelected(true)
      sim.avatar.setPlumbobColor(sim.mood.color)
    }
    this.onStateChange()
  }

  // ================================================================= drag & drop

  beginDrag(sim: Sim) {
    if (!sim.alive) return
    this.dragging = sim
    sim.held = true
    sim.clearTask(this)
    sim.queue = []
    this.dragPlaneY = 1.4
    audio.play('click')
    sim.say('Put me down!', 3)
  }

  updateDrag() {
    if (!this.dragging) return
    const p = this.input.planePoint(this.dragPlaneY)
    if (!p) return
    this.dragging.pos.x = THREE.MathUtils.clamp(p.x, -LOT_W / 2 + 0.5, LOT_W / 2 - 0.5)
    this.dragging.pos.z = THREE.MathUtils.clamp(p.z, -LOT_H / 2 + 0.5, LOT_H / 2 - 0.5)
    this.dragging.avatar.root.position.set(this.dragging.pos.x, this.dragPlaneY, this.dragging.pos.z)
    this.dragging.avatar.update(0.016, 'panic', 1)
  }

  endDrag() {
    const sim = this.dragging
    if (!sim) return
    this.dragging = null
    sim.held = false
    const t = sim.tileOf(this)
    let target: TilePos | null = t
    if (!this.grid.walkable(t.x, t.z)) {
      target = this.grid.findNearest(t.x, t.z, (x, z) => this.grid.walkable(x, z))
    }
    if (target) {
      const [wx, wz] = this.grid.tileToWorld(target.x, target.z)
      sim.pos.set(wx, 0, wz)
    }
    sim.avatar.root.position.set(sim.pos.x, 0, sim.pos.z)
    if (this.grid.isPool(sim.pos.x !== undefined ? sim.tileOf(this).x : 0, sim.tileOf(this).z)) {
      this.fx.splash(sim.pos.x, 0, sim.pos.z)
      audio.play('splash', sim.pos)
      sim.swimStamina = Math.min(sim.swimStamina, 82)
      sim.soaked = 120
      sim.needs.fun -= 12
      sim.embarrassment += 8
      this.notify(`<b>${sim.name}</b> is in the pool.`, 'warn', '🌊')
    } else {
      audio.play('place', sim.pos)
      sim.needs.comfort -= 8
    }
    sim.panicTimer = 3
  }

  // ================================================================= loop

  update(dtReal: number) {
    const dt = Math.min(dtReal, 0.05)
    this.elapsedReal += dt
    const dtMin = this.clock.advance(dt)
    const speedF = GameClock.SPEEDS[this.clock.speed]
    const animDt = dt * Math.min(speedF, 3)

    this.input.update(dt)
    this.rig.update(dt)
    this.engine.setTimeOfDay(this.clock.hour)
    this.engine.setShadowFocus(this.rig.focus.x, this.rig.focus.z, this.rig.distance)

    if (this.dragging) this.updateDrag()

    // --- simulation
    if (dtMin > 0) {
      this.tickTimers()
      this.fire.update(this, dtMin, dt, this.fx)
      this.puddles.update(dtMin, this.elapsedReal)
      this.tickObjects(dtMin, dt)
    }
    for (const sim of this.sims) sim.update(this, dtMin, animDt)
    this.fire.emitParticles(this.fx, dt)
    this.updateReapers(dt)

    // --- audio + post-processing mood
    const heat = Math.min(1, this.fire.totalIntensity / 6)
    this.engine.heat = heat
    const anyPanic = this.sims.some((s) => s.alive && (s.panicTimer > 0 || s.burning > 0))
    const anyDeadRecently = this.reapers.length > 0
    audio.setMood(anyDeadRecently ? 'dirge' : this.fire.count > 0 ? 'chaos' : anyPanic ? 'tense' : 'calm')
    audio.update(dt)

    const cam = this.engine.camera
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0)
    audio.setListener(cam.position, right)

    // --- visuals
    this.lot.updateCutaway(this.rig.azimuth, dt)
    mats.updateWater(this.elapsedReal, this.engine.sun.position.clone().normalize(), this.engine.sun.color, 0)
    this.fire.renderScorch(this.elapsedReal)
    this.fx.update(dt, cam, this.engine.renderer.domElement, this.fire.lightSources())

    if (this.selected && this.selected.alive) {
      this.selected.avatar.setPlumbobColor(this.selected.mood.color)
    }

    this.engine.render(dt)
  }

  /** Slow background processes that belong to objects rather than sims. */
  private tickObjects(dtMin: number, dtReal: number) {
    for (const obj of this.objects) {
      if (obj.charred) continue

      // defensive sweep: never let a claim outlive the sim that made it
      if (obj.reservedBy && (obj.reservedBy.dead || obj.reservedBy.task?.obj !== obj)) obj.reservedBy = null
      if (obj.inUseBy && (obj.inUseBy.dead || obj.inUseBy.task?.obj !== obj)) obj.inUseBy = null

      // wear and tear: anything in use can fail, which is how repairs happen
      const breakable = obj.def.flags?.breakable
      if (breakable && obj.inUseBy && !obj.broken) {
        const clumsy = obj.inUseBy.traits.clumsiness
        if (this.rand.next() < dtMin * breakable * clumsy * (1 + obj.grime / 150)) {
          obj.broken = true
          const c = obj.centerWorld
          this.fx.spark(c.x, obj.def.height * 0.6, c.z, 8, 0x88ccff)
          if (obj.def.flags?.wet) {
            const t = obj.centerTile()
            this.puddles.add(t.x, t.z, 'water')
          }
          this.notify(`The ${obj.def.name.toLowerCase()} has broken down.`, 'info', '🔧')
          if (obj.inUseBy.task?.obj === obj) obj.inUseBy.clearTask(this)
        }
      }

      if (obj.def.id === 'trash') {
        obj.grime = Math.min(120, obj.grime + dtMin * 0.045)
        if (obj.grime > 88) {
          const c = obj.centerWorld
          this.fx.flies(c.x, 0.35, c.z, dtReal)
          for (const s of this.sims) {
            if (!s.alive) continue
            if (s.pos.distanceTo(c) > 2.4) continue
            s.needs.hygiene = Math.max(0, s.needs.hygiene - dtMin * 0.4)
            if (this.rand.next() < dtMin * 0.0006 * (s.needs.hygiene < 12 ? 4 : 1)) {
              this.kill(s, 'vermin')
            }
          }
        }
      }
      if (obj.def.id === 'sauna' && obj.meta.maxHeat) {
        const c = obj.centerWorld
        if (this.rand.next() < dtReal * 3) this.fx.steam(c.x, 1.8, c.z, 1)
      }
      if (obj.def.id === 'deepFreezer') {
        const c = obj.centerWorld
        if (this.rand.next() < dtReal * 1.5) this.fx.frost(c.x, 0.9, c.z, 1)
      }
      if (obj.def.id === 'cowplant') {
        const head = obj.root.getObjectByName('head')
        if (head) {
          head.position.y = 1.7 + Math.sin(this.elapsedReal * 1.2) * 0.08
          head.rotation.y = Math.sin(this.elapsedReal * 0.6) * 0.3
        }
      }
      if (obj.broken && this.rand.next() < dtReal * 0.6) {
        const c = obj.centerWorld
        this.fx.spark(c.x, obj.def.height * 0.6, c.z, 1, 0x88ccff)
        if (obj.def.flags?.wet && this.rand.next() < 0.25) {
          const t = obj.centerTile()
          this.puddles.add(t.x, t.z, 'water')
        }
      }
      if (obj.onFire) {
        const c = obj.centerWorld
        this.fx.fire(c.x, obj.def.height * 0.4, c.z, 0.8, dtReal)
      }
    }
  }

  // ================================================================= preview

  setGhostPreview(def: ObjectDef | null, tx: number, tz: number, rot: 0 | 1 | 2 | 3, valid: boolean) {
    if (!def) {
      if (this.ghostPreview) { this.ghostPreview.removeFromParent(); this.ghostPreview = null }
      return
    }
    const key = `${def.id}:${rot}`
    if (!this.ghostPreview || this.ghostPreview.userData.key !== key) {
      this.ghostPreview?.removeFromParent()
      const g = new THREE.Group()
      const mesh = def.build({} as WorldObject)
      g.add(mesh)
      g.userData.key = key
      g.rotation.y = rot * (Math.PI / 2)
      this.ghostPreview = g
      this.engine.scene.add(g)
    }
    const [w, d] = rot % 2 === 0 ? def.size : [def.size[1], def.size[0]]
    const cx = (tx + w / 2 - LOT_W / 2)
    const cz = (tz + d / 2 - LOT_H / 2)
    this.ghostPreview.position.set(cx, 0.02, cz)
    this.ghostPreview.rotation.y = rot * (Math.PI / 2)
    const mat = valid ? mats.ghost : mats.invalid
    this.ghostPreview.traverse((c) => {
      const m = c as THREE.Mesh
      if (m.isMesh) { m.material = mat; m.castShadow = false }
    })
  }
}
