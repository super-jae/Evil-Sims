import * as THREE from 'three'
import type { ObjectDef } from './ObjectTypes'
import type { Sim } from '../sim/Sim'
import { Grid, LOT_W, LOT_H, TILE, type TilePos } from './Grid'

const CHARRED = new THREE.MeshStandardMaterial({ color: 0x1a1614, roughness: 0.98 })

let nextId = 1

export class WorldObject {
  readonly id = nextId++
  readonly def: ObjectDef
  tx: number
  tz: number
  rot: 0 | 1 | 2 | 3
  root: THREE.Group

  broken = false
  onFire = false
  charred = false
  /** 0..100 grime; dirty objects give worse results and attract flies. */
  grime = 0
  /** Player can padlock an object so sims refuse to use it. */
  locked = false
  inUseBy: Sim | null = null
  reservedBy: Sim | null = null
  /** Object-specific scratch state (rocket fuel, freezer temperature, ...). */
  meta: Record<string, number | boolean | string> = {}
  /** Accumulated minutes of use — drives wear and tear. */
  wear = 0

  private originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()

  constructor(def: ObjectDef, tx: number, tz: number, rot: 0 | 1 | 2 | 3) {
    this.def = def
    this.tx = tx
    this.tz = tz
    this.rot = rot
    this.root = new THREE.Group()
    const mesh = def.build(this)
    mesh.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) {
        const m = c as THREE.Mesh
        m.receiveShadow = true
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox()
        const bb = m.geometry.boundingBox
        const h = bb ? bb.max.y - bb.min.y : 1
        m.castShadow = h > 0.28
      }
      c.matrixAutoUpdate = false
    })
    mesh.updateMatrixWorld(true)
    this.root.matrixAutoUpdate = false
    this.root.add(mesh)
    this.root.userData.worldObject = this
    this.syncTransform()
  }

  /** Footprint after rotation. */
  get size(): [number, number] {
    const [w, d] = this.def.size
    return this.rot % 2 === 0 ? [w, d] : [d, w]
  }

  get centerWorld(): THREE.Vector3 {
    const [w, d] = this.size
    return new THREE.Vector3(
      (this.tx + w / 2 - LOT_W / 2) * TILE,
      0,
      (this.tz + d / 2 - LOT_H / 2) * TILE,
    )
  }

  /** Unit vector the object faces (its "front"). */
  get facing(): THREE.Vector3 {
    const a = this.rot * (Math.PI / 2)
    return new THREE.Vector3(Math.sin(a), 0, Math.cos(a))
  }

  tiles(): TilePos[] {
    const [w, d] = this.size
    const out: TilePos[] = []
    for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) out.push({ x: this.tx + x, z: this.tz + z })
    return out
  }

  contains(x: number, z: number) {
    const [w, d] = this.size
    return x >= this.tx && x < this.tx + w && z >= this.tz && z < this.tz + d
  }

  syncTransform() {
    const c = this.centerWorld
    this.root.position.set(c.x, 0, c.z)
    this.root.rotation.y = this.rot * (Math.PI / 2)
    this.root.updateMatrix()
    this.root.updateMatrixWorld(true)
  }

  /** Where a sim stands to use this object, in tile coords. */
  useTile(grid: Grid): TilePos | null {
    const [w, d] = this.size
    const opts = grid.adjacentFreeTiles(this.tx, this.tz, w, d)
    if (!opts.length) return null
    // prefer a tile in front of the object
    const f = this.facing
    const cx = this.tx + w / 2 - 0.5, cz = this.tz + d / 2 - 0.5
    opts.sort((a, b) => {
      const sa = (a.x - cx) * f.x + (a.z - cz) * f.z
      const sb = (b.x - cx) * f.x + (b.z - cz) * f.z
      return sb - sa
    })
    return opts[0]
  }

  /** Center tile of the footprint (used for "stand on" interactions). */
  centerTile(): TilePos {
    const [w, d] = this.size
    return { x: this.tx + Math.floor(w / 2), z: this.tz + Math.floor(d / 2) }
  }

  setCharred(on: boolean) {
    if (this.charred === on) return
    this.charred = on
    this.root.traverse((c) => {
      const m = c as THREE.Mesh
      if (!m.isMesh) return
      if (on) {
        if (!this.originalMaterials.has(m)) this.originalMaterials.set(m, m.material)
        m.material = CHARRED
      } else {
        const orig = this.originalMaterials.get(m)
        if (orig) m.material = orig
      }
    })
    if (on) {
      this.root.scale.set(1, 0.92, 1)
      this.root.rotation.z = (Math.random() - 0.5) * 0.06
      this.root.updateMatrix()
      this.root.updateMatrixWorld(true)
    }
  }

  get isUsable() {
    return !this.locked && !this.broken && !this.onFire && !this.charred
  }

  get flammability() {
    if (this.charred) return 0
    return this.def.flags?.fireproof ? 0 : (this.def.flags?.flammable ?? 0.12)
  }

  dispose() {
    this.root.traverse((c) => {
      const m = c as THREE.Mesh
      if (m.isMesh) {
        m.geometry.dispose?.()
      }
    })
    this.root.removeFromParent()
  }
}

export function footprintFits(grid: Grid, tx: number, tz: number, w: number, d: number, opts: {
  needsFloor?: boolean; poolOnly?: boolean; outdoorOnly?: boolean
} = {}): boolean {
  for (let x = tx; x < tx + w; x++) {
    for (let z = tz; z < tz + d; z++) {
      if (!grid.inBounds(x, z)) return false
      const i = grid.idx(x, z)
      if (grid.objAt[i]) return false
      if (opts.poolOnly && !grid.pool[i]) return false
      if (!opts.poolOnly && grid.pool[i]) return false
      if (opts.needsFloor && grid.floor[i] === 0) return false
      if (opts.outdoorOnly && grid.indoor[i] === 1) return false
    }
  }
  return true
}

export { LOT_W, LOT_H }
