import * as THREE from 'three'
import { Grid, LOT_W, LOT_H, TILE, Floor } from './Grid'
import { mats } from './Materials'

const WALL_H = 2.72
const WALL_T = 0.13
const POOL_DEPTH = 1.55
const WATER_Y = -0.14

export type WallMode = 'up' | 'cutaway' | 'down'

interface WallSeg {
  mesh: THREE.Mesh
  axis: 'n' | 'w'
  x: number
  z: number
  target: number
  current: number
}

/** Builds and maintains all of the static lot geometry. */
export class Lot {
  readonly group = new THREE.Group()
  private floorGroup = new THREE.Group()
  private wallGroup = new THREE.Group()
  private poolGroup = new THREE.Group()
  private walls: WallSeg[] = []
  private wallGeo = new THREE.BoxGeometry(1, WALL_H, WALL_T)
  private waterMesh: THREE.Mesh | null = null

  wallMode: WallMode = 'cutaway'

  constructor(private grid: Grid) {
    this.group.add(this.floorGroup, this.wallGroup, this.poolGroup)
    this.buildSurrounds()
  }

  /** Ground outside the lot boundary, so the world does not end abruptly. */
  private buildSurrounds() {
    const halfX = (LOT_W / 2) * TILE
    const halfZ = (LOT_H / 2) * TILE
    const far = 120

    // A ring of ground with the lot punched out, so excavated pools are not
    // occluded by the neighbourhood terrain underneath them.
    const shape = new THREE.Shape()
    shape.moveTo(-far, -far)
    shape.lineTo(far, -far)
    shape.lineTo(far, far)
    shape.lineTo(-far, far)
    shape.closePath()
    const hole = new THREE.Path()
    hole.moveTo(-halfX, -halfZ)
    hole.lineTo(-halfX, halfZ)
    hole.lineTo(halfX, halfZ)
    hole.lineTo(halfX, -halfZ)
    hole.closePath()
    shape.holes.push(hole)

    const g = new THREE.ShapeGeometry(shape)
    const uv = g.getAttribute('uv') as THREE.BufferAttribute
    const pos = g.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i), pos.getY(i))
    uv.needsUpdate = true
    const m = new THREE.Mesh(g, mats.grass.clone())
    ;(m.material as THREE.MeshStandardMaterial).color.setHex(0xbfc9b0)
    m.rotation.x = -Math.PI / 2
    m.position.y = -0.02
    m.receiveShadow = true
    this.group.add(m)
    const half = halfX

    // low kerb around the lot so the plot reads as a plot
    const kerbMat = new THREE.MeshStandardMaterial({ color: 0xb0aca2, roughness: 0.92 })
    for (const [sx, sz, w, d] of [
      [0, -half - 0.2, LOT_W + 0.8, 0.4], [0, half + 0.2, LOT_W + 0.8, 0.4],
      [-half - 0.2, 0, 0.4, LOT_H + 0.8], [half + 0.2, 0, 0.4, LOT_H + 0.8],
    ]) {
      const k = new THREE.Mesh(new THREE.BoxGeometry(w, 0.14, d), kerbMat)
      k.position.set(sx, 0.02, sz)
      k.receiveShadow = true
      this.group.add(k)
    }
  }

  // ------------------------------------------------------------ floors

  rebuildFloors() {
    this.floorGroup.clear()
    const byMat = new Map<number, { pos: number[]; norm: number[]; uv: number[] }>()

    const push = (mat: number, x: number, z: number, y: number, uvScale: number) => {
      let b = byMat.get(mat)
      if (!b) { b = { pos: [], norm: [], uv: [] }; byMat.set(mat, b) }
      const x0 = (x - LOT_W / 2) * TILE, z0 = (z - LOT_H / 2) * TILE
      const x1 = x0 + TILE, z1 = z0 + TILE
      const quad = [
        [x0, y, z0], [x0, y, z1], [x1, y, z1],
        [x0, y, z0], [x1, y, z1], [x1, y, z0],
      ]
      const uvs = [
        [x * uvScale, z * uvScale], [x * uvScale, (z + 1) * uvScale], [(x + 1) * uvScale, (z + 1) * uvScale],
        [x * uvScale, z * uvScale], [(x + 1) * uvScale, (z + 1) * uvScale], [(x + 1) * uvScale, z * uvScale],
      ]
      for (let i = 0; i < 6; i++) {
        b.pos.push(quad[i][0], quad[i][1], quad[i][2])
        b.norm.push(0, 1, 0)
        b.uv.push(uvs[i][0], uvs[i][1])
      }
    }

    for (let x = 0; x < LOT_W; x++) {
      for (let z = 0; z < LOT_H; z++) {
        const i = this.grid.idx(x, z)
        if (this.grid.pool[i]) continue
        const f = this.grid.floor[i]
        push(f, x, z, f === Floor.None ? 0 : 0.02, f === Floor.None ? 1 : 1)
      }
    }

    for (const [matIdx, b] of byMat) {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3))
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.norm, 3))
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2))
      const mesh = new THREE.Mesh(geo, mats.floors[matIdx] ?? mats.floors[0])
      mesh.receiveShadow = true
      mesh.name = `floor-${matIdx}`
      this.floorGroup.add(mesh)
    }

    // skirting: a thin slab under indoor floors so edges do not float
    const edges: number[] = []
    for (let x = 0; x < LOT_W; x++) {
      for (let z = 0; z < LOT_H; z++) {
        const i = this.grid.idx(x, z)
        if (this.grid.floor[i] === Floor.None || this.grid.pool[i]) continue
        const x0 = (x - LOT_W / 2) * TILE, z0 = (z - LOT_H / 2) * TILE
        edges.push(x0, z0)
      }
    }
    if (edges.length) {
      const slabGeo = new THREE.BoxGeometry(TILE, 0.06, TILE)
      const slab = new THREE.InstancedMesh(
        slabGeo, new THREE.MeshStandardMaterial({ color: 0xd8d2c6, roughness: 0.9 }), edges.length / 2)
      const m = new THREE.Matrix4()
      for (let k = 0; k < edges.length / 2; k++) {
        m.makeTranslation(edges[k * 2] + TILE / 2, -0.012, edges[k * 2 + 1] + TILE / 2)
        slab.setMatrixAt(k, m)
      }
      slab.instanceMatrix.needsUpdate = true
      slab.receiveShadow = true
      this.floorGroup.add(slab)
    }
  }

  // ------------------------------------------------------------ walls

  rebuildWalls() {
    this.wallGroup.clear()
    this.walls = []
    for (let x = 0; x < LOT_W; x++) {
      for (let z = 0; z < LOT_H; z++) {
        const i = this.grid.idx(x, z)
        if (this.grid.wallN[i]) this.addWall('n', x, z, this.grid.doorN[i] === 1)
        if (this.grid.wallW[i]) this.addWall('w', x, z, this.grid.doorW[i] === 1)
      }
    }
  }

  private addWall(axis: 'n' | 'w', x: number, z: number, door: boolean) {
    const [wx, wz] = this.grid.tileToWorld(x, z)
    const holder = new THREE.Group()
    const matSide = mats.wallInner

    if (!door) {
      const m = new THREE.Mesh(this.wallGeo, matSide)
      m.castShadow = true
      m.receiveShadow = true
      m.position.y = WALL_H / 2
      holder.add(m)
    } else {
      // doorway: two jambs and a lintel
      const jambW = 0.21
      for (const s of [-1, 1]) {
        const jamb = new THREE.Mesh(new THREE.BoxGeometry(jambW, WALL_H, WALL_T), matSide)
        jamb.position.set(s * (0.5 - jambW / 2), WALL_H / 2, 0)
        jamb.castShadow = true; jamb.receiveShadow = true
        holder.add(jamb)
      }
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(1, WALL_H - 2.1, WALL_T), matSide)
      lintel.position.set(0, 2.1 + (WALL_H - 2.1) / 2, 0)
      lintel.castShadow = true; lintel.receiveShadow = true
      holder.add(lintel)
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.06, WALL_T + 0.04), mats.wallTop)
      frame.position.set(0, 2.11, 0)
      holder.add(frame)
    }
    // capping strip so the tops read cleanly when walls are lowered
    const cap = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.07, WALL_T + 0.05), mats.wallTop)
    cap.position.y = WALL_H
    holder.add(cap)

    if (axis === 'n') holder.position.set(wx, 0, wz - TILE / 2)
    else { holder.position.set(wx - TILE / 2, 0, wz); holder.rotation.y = Math.PI / 2 }

    this.wallGroup.add(holder)
    this.walls.push({ mesh: holder as unknown as THREE.Mesh, axis, x, z, target: 1, current: 1 })
  }

  /** Lower the walls nearest the camera so the interior stays visible. */
  updateCutaway(azimuth: number, dt: number) {
    const cosA = Math.cos(azimuth)
    const sinA = Math.sin(azimuth)
    for (const w of this.walls) {
      let t = 1
      if (this.wallMode === 'down') t = 0.16
      else if (this.wallMode === 'cutaway') {
        // Drop a wall only when it stands between the camera and a room it
        // encloses; walls on the far side of the house stay up.
        let hide = false
        if (w.axis === 'n' && Math.abs(cosA) > 0.06) {
          const rz = cosA > 0 ? w.z - 1 : w.z
          hide = this.grid.isIndoors(w.x, rz)
        } else if (w.axis === 'w' && Math.abs(sinA) > 0.06) {
          const rx = sinA > 0 ? w.x - 1 : w.x
          hide = this.grid.isIndoors(rx, w.z)
        }
        t = hide ? 0.16 : 1
      }
      w.target = t
      w.current += (w.target - w.current) * Math.min(1, dt * 7)
      w.mesh.scale.y = w.current
      w.mesh.visible = w.current > 0.02
    }
  }

  // ------------------------------------------------------------ pool

  rebuildPool() {
    this.poolGroup.clear()
    this.waterMesh = null
    const grid = this.grid
    const tiles: { x: number; z: number }[] = []
    for (let x = 0; x < LOT_W; x++) for (let z = 0; z < LOT_H; z++) {
      if (grid.pool[grid.idx(x, z)]) tiles.push({ x, z })
    }
    if (!tiles.length) return

    // floor of the pool
    const pos: number[] = [], norm: number[] = [], uv: number[] = []
    const addQuad = (a: number[], b: number[], c: number[], d: number[], n: number[]) => {
      for (const v of [a, b, c, a, c, d]) { pos.push(v[0], v[1], v[2]); norm.push(n[0], n[1], n[2]) }
      const uvs = [[0, 0], [0, 1], [1, 1], [0, 0], [1, 1], [1, 0]]
      for (const t of uvs) uv.push(t[0], t[1])
    }
    for (const t of tiles) {
      const x0 = (t.x - LOT_W / 2) * TILE, z0 = (t.z - LOT_H / 2) * TILE
      const x1 = x0 + TILE, z1 = z0 + TILE
      const y = -POOL_DEPTH
      addQuad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], [0, 1, 0])
      // side walls where the pool meets solid ground
      const neighbours: [number, number, number[][], number[]][] = [
        [0, -1, [[x0, 0, z0], [x1, 0, z0], [x1, y, z0], [x0, y, z0]], [0, 0, 1]],
        [0, 1, [[x1, 0, z1], [x0, 0, z1], [x0, y, z1], [x1, y, z1]], [0, 0, -1]],
        [-1, 0, [[x0, 0, z1], [x0, 0, z0], [x0, y, z0], [x0, y, z1]], [1, 0, 0]],
        [1, 0, [[x1, 0, z0], [x1, 0, z1], [x1, y, z1], [x1, y, z0]], [-1, 0, 0]],
      ]
      for (const [dx, dz, quad, n] of neighbours) {
        if (grid.isPool(t.x + dx, t.z + dz)) continue
        addQuad(quad[0], quad[1], quad[2], quad[3], n)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    const shell = new THREE.Mesh(geo, mats.poolWall)
    shell.receiveShadow = true
    this.poolGroup.add(shell)

    // coping stones around the rim
    const coping = new THREE.MeshStandardMaterial({ color: 0xdcd6c8, roughness: 0.8 })
    const rim = new THREE.Group()
    for (const t of tiles) {
      for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        if (grid.isPool(t.x + dx, t.z + dz)) continue
        const [wx, wz] = grid.tileToWorld(t.x + dx, t.z + dz)
        const b = new THREE.Mesh(
          new THREE.BoxGeometry(dx !== 0 ? 0.34 : TILE, 0.1, dz !== 0 ? 0.34 : TILE), coping)
        b.position.set(wx - dx * 0.33, 0.05, wz - dz * 0.33)
        b.receiveShadow = true
        rim.add(b)
      }
    }
    this.poolGroup.add(rim)

    // water surface — one plane per tile so the wave shader has vertices to move
    const wpos: number[] = []
    const wuv: number[] = []
    for (const t of tiles) {
      const x0 = (t.x - LOT_W / 2) * TILE, z0 = (t.z - LOT_H / 2) * TILE
      const seg = 2
      for (let a = 0; a < seg; a++) {
        for (let b = 0; b < seg; b++) {
          const sx = x0 + (a / seg) * TILE, sz = z0 + (b / seg) * TILE
          const ex = x0 + ((a + 1) / seg) * TILE, ez = z0 + ((b + 1) / seg) * TILE
          const quad = [[sx, sz], [sx, ez], [ex, ez], [sx, sz], [ex, ez], [ex, sz]]
          for (const [px, pz] of quad) { wpos.push(px, pz, 0); wuv.push(px, pz) }
        }
      }
    }
    const wgeo = new THREE.BufferGeometry()
    wgeo.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3))
    wgeo.setAttribute('uv', new THREE.Float32BufferAttribute(wuv, 2))
    wgeo.computeVertexNormals()
    const water = new THREE.Mesh(wgeo, mats.water)
    water.rotation.x = -Math.PI / 2
    water.position.y = WATER_Y
    water.renderOrder = 5
    this.waterMesh = water
    this.poolGroup.add(water)
  }

  get hasWater() { return this.waterMesh !== null }

  static get poolDepth() { return POOL_DEPTH }
  static get wallHeight() { return WALL_H }
}
