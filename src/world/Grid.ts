/**
 * The lot is a fixed grid of 1m tiles. Everything — floors, walls, pools,
 * object footprints and pathfinding — is expressed in tile coordinates.
 */

export const LOT_W = 34
export const LOT_H = 34
export const TILE = 1

/** Floor material ids. 0 means bare terrain. */
export const enum Floor { None = 0, Wood = 1, Tile = 2, Carpet = 3, Concrete = 4, Marble = 5 }

export interface TilePos { x: number; z: number }

export class Grid {
  readonly w = LOT_W
  readonly h = LOT_H

  floor = new Uint8Array(LOT_W * LOT_H)
  /** 1 when the tile has been excavated into a swimming pool. */
  pool = new Uint8Array(LOT_W * LOT_H)
  /** Wall on the -Z edge of the tile. */
  wallN = new Uint8Array(LOT_W * LOT_H)
  /** Wall on the -X edge of the tile. */
  wallW = new Uint8Array(LOT_W * LOT_H)
  /** Doorway flags on the matching wall arrays (wall still renders, movement allowed). */
  doorN = new Uint8Array(LOT_W * LOT_H)
  doorW = new Uint8Array(LOT_W * LOT_H)
  /** Object id + 1 occupying a tile, or 0. */
  objAt = new Int32Array(LOT_W * LOT_H)
  /** 1 when the occupying object blocks movement. */
  solid = new Uint8Array(LOT_W * LOT_H)
  /** 1 when a tile has a pool ladder / step-out point on it. */
  poolExit = new Uint8Array(LOT_W * LOT_H)
  /** 1 when a tile is sealed off from the lot boundary by walls. */
  indoor = new Uint8Array(LOT_W * LOT_H)

  idx(x: number, z: number) { return z * LOT_W + x }
  inBounds(x: number, z: number) { return x >= 0 && z >= 0 && x < LOT_W && z < LOT_H }

  /** World-space center of a tile. */
  tileToWorld(x: number, z: number): [number, number] {
    return [(x - LOT_W / 2 + 0.5) * TILE, (z - LOT_H / 2 + 0.5) * TILE]
  }
  worldToTile(wx: number, wz: number): TilePos {
    return { x: Math.floor(wx / TILE + LOT_W / 2), z: Math.floor(wz / TILE + LOT_H / 2) }
  }
  /** Continuous tile-space coordinate (used for smooth sim positions). */
  worldToTileF(wx: number, wz: number): { x: number; z: number } {
    return { x: wx / TILE + LOT_W / 2 - 0.5, z: wz / TILE + LOT_H / 2 - 0.5 }
  }

  isPool(x: number, z: number) { return this.inBounds(x, z) && this.pool[this.idx(x, z)] === 1 }

  /** True when walls fully enclose the tile — doors count as solid here. */
  isIndoors(x: number, z: number) {
    return this.inBounds(x, z) && this.indoor[this.idx(x, z)] === 1
  }

  /** Wall test that ignores doorways, for enclosure and line-of-sight checks. */
  wallBlocks(ax: number, az: number, bx: number, bz: number): boolean {
    if (ax === bx) {
      const z = Math.max(az, bz)
      if (!this.inBounds(ax, z)) return true
      return this.wallN[this.idx(ax, z)] === 1
    }
    if (az === bz) {
      const x = Math.max(ax, bx)
      if (!this.inBounds(x, az)) return true
      return this.wallW[this.idx(x, az)] === 1
    }
    return false
  }

  /**
   * Flood-fills from the lot boundary; anything the fill cannot reach without
   * passing through a wall is indoors. Recomputed whenever walls change.
   */
  recomputeIndoors() {
    this.indoor.fill(1)
    const queue: number[] = []
    for (let x = 0; x < LOT_W; x++) {
      for (let z = 0; z < LOT_H; z++) {
        if (x !== 0 && z !== 0 && x !== LOT_W - 1 && z !== LOT_H - 1) continue
        const i = this.idx(x, z)
        if (this.indoor[i] === 0) continue
        this.indoor[i] = 0
        queue.push(i)
      }
    }
    let head = 0
    while (head < queue.length) {
      const cur = queue[head++]
      const cx = cur % LOT_W, cz = (cur / LOT_W) | 0
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, nz = cz + dz
        if (!this.inBounds(nx, nz)) continue
        const ni = this.idx(nx, nz)
        if (this.indoor[ni] === 0) continue
        if (this.wallBlocks(cx, cz, nx, nz)) continue
        this.indoor[ni] = 0
        queue.push(ni)
      }
    }
  }

  /** Can a sim stand on this tile at all? */
  walkable(x: number, z: number): boolean {
    if (!this.inBounds(x, z)) return false
    const i = this.idx(x, z)
    if (this.solid[i]) return false
    return true
  }

  /** Is movement between two orthogonally-adjacent tiles blocked by a wall? */
  wallBetween(ax: number, az: number, bx: number, bz: number): boolean {
    if (ax === bx) {
      const z = Math.max(az, bz)
      if (!this.inBounds(ax, z)) return true
      const i = this.idx(ax, z)
      return this.wallN[i] === 1 && this.doorN[i] === 0
    }
    if (az === bz) {
      const x = Math.max(ax, bx)
      if (!this.inBounds(x, az)) return true
      const i = this.idx(x, az)
      return this.wallW[i] === 1 && this.doorW[i] === 0
    }
    return false
  }

  /**
   * The lip of a swimming pool is only crossable at a ladder. This is what
   * makes removing the ladder mid-swim so effective.
   */
  poolEdgeBlocked(ax: number, az: number, bx: number, bz: number): boolean {
    const a = this.isPool(ax, az), b = this.isPool(bx, bz)
    if (a === b) return false
    return this.poolExit[this.idx(ax, az)] === 0 && this.poolExit[this.idx(bx, bz)] === 0
  }

  /**
   * Full adjacency test including diagonal corner-cutting rules.
   * `ignoreSolid` lets a route finish *on* its target — a bed, a toilet, a
   * treadmill — which are all solid to everyone else.
   */
  canStep(ax: number, az: number, bx: number, bz: number, ignoreSolid = false): boolean {
    if (!ignoreSolid && !this.walkable(bx, bz)) return false
    if (ignoreSolid && !this.inBounds(bx, bz)) return false
    if (this.poolEdgeBlocked(ax, az, bx, bz)) return false
    const dx = bx - ax, dz = bz - az
    if (dx !== 0 && dz !== 0) {
      // diagonals need both orthogonal neighbors clear (no squeezing past corners)
      if (!this.walkable(ax + dx, az) || !this.walkable(ax, az + dz)) return false
      if (this.wallBetween(ax, az, ax + dx, az) || this.wallBetween(ax + dx, az, bx, bz)) return false
      if (this.wallBetween(ax, az, ax, az + dz) || this.wallBetween(ax, az + dz, bx, bz)) return false
      // never swim diagonally out of a pool edge
      if (this.isPool(ax, az) !== this.isPool(bx, bz)) return false
      return true
    }
    return !this.wallBetween(ax, az, bx, bz)
  }

  /** Movement cost multiplier: swimming and climbing out are slower. */
  stepCost(x: number, z: number): number {
    return this.pool[this.idx(x, z)] ? 2.2 : 1
  }

  private static readonly DIRS: [number, number, number][] = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142],
  ]

  /**
   * A* over the tile grid. `avoidPool` makes a sim refuse to enter water,
   * which is what makes selling the ladder lethal.
   */
  findPath(
    sx: number, sz: number, gx: number, gz: number,
    opts: { avoidPool?: boolean; maxNodes?: number; allowSolidGoal?: boolean } = {},
  ): TilePos[] | null {
    if (!this.inBounds(sx, sz) || !this.inBounds(gx, gz)) return null
    if (sx === gx && sz === gz) return []
    if (!opts.allowSolidGoal && !this.walkable(gx, gz)) return null

    const n = LOT_W * LOT_H
    const gScore = new Float32Array(n).fill(Infinity)
    const cameFrom = new Int32Array(n).fill(-1)
    const closed = new Uint8Array(n)
    const start = this.idx(sx, sz)
    gScore[start] = 0

    // binary heap of [f, index]
    const heapF: number[] = [0]
    const heapI: number[] = [start]
    const push = (f: number, i: number) => {
      heapF.push(f); heapI.push(i)
      let c = heapF.length - 1
      while (c > 0) {
        const p = (c - 1) >> 1
        if (heapF[p] <= heapF[c]) break
        ;[heapF[p], heapF[c]] = [heapF[c], heapF[p]]
        ;[heapI[p], heapI[c]] = [heapI[c], heapI[p]]
        c = p
      }
    }
    const pop = () => {
      const top = heapI[0]
      const lastF = heapF.pop()!, lastI = heapI.pop()!
      if (heapF.length) {
        heapF[0] = lastF; heapI[0] = lastI
        let p = 0
        for (;;) {
          const l = p * 2 + 1, r = l + 1
          let s = p
          if (l < heapF.length && heapF[l] < heapF[s]) s = l
          if (r < heapF.length && heapF[r] < heapF[s]) s = r
          if (s === p) break
          ;[heapF[p], heapF[s]] = [heapF[s], heapF[p]]
          ;[heapI[p], heapI[s]] = [heapI[s], heapI[p]]
          p = s
        }
      }
      return top
    }

    const heur = (x: number, z: number) => {
      const dx = Math.abs(x - gx), dz = Math.abs(z - gz)
      return (dx + dz) + (1.4142 - 2) * Math.min(dx, dz)
    }

    const maxNodes = opts.maxNodes ?? 6000
    let visited = 0
    const goal = this.idx(gx, gz)

    while (heapF.length && visited < maxNodes) {
      const cur = pop()
      if (cur === goal) {
        const out: TilePos[] = []
        let c = cur
        while (c !== start && c !== -1) {
          out.push({ x: c % LOT_W, z: (c / LOT_W) | 0 })
          c = cameFrom[c]
        }
        out.reverse()
        return out
      }
      if (closed[cur]) continue
      closed[cur] = 1
      visited++
      const cx = cur % LOT_W, cz = (cur / LOT_W) | 0

      for (const [dx, dz, base] of Grid.DIRS) {
        const nx = cx + dx, nz = cz + dz
        if (!this.inBounds(nx, nz)) continue
        const ni = this.idx(nx, nz)
        if (closed[ni]) continue
        if (opts.avoidPool && this.pool[ni] && ni !== goal) continue
        if (!this.canStep(cx, cz, nx, nz, opts.allowSolidGoal === true && ni === goal)) continue
        const g = gScore[cur] + base * this.stepCost(nx, nz)
        if (g < gScore[ni]) {
          gScore[ni] = g
          cameFrom[ni] = cur
          push(g + heur(nx, nz), ni)
        }
      }
    }
    return null
  }

  /**
   * Breadth-first flood from a tile, returning the closest tile that satisfies
   * `test`. Used for "find a reachable toilet", "find dry land", "flee the fire".
   */
  findNearest(
    sx: number, sz: number,
    test: (x: number, z: number) => boolean,
    opts: { avoidPool?: boolean; maxNodes?: number; allowStart?: boolean } = {},
  ): TilePos | null {
    if (!this.inBounds(sx, sz)) return null
    if (opts.allowStart !== false && test(sx, sz)) return { x: sx, z: sz }
    const seen = new Uint8Array(LOT_W * LOT_H)
    const queue: number[] = [this.idx(sx, sz)]
    seen[queue[0]] = 1
    const max = opts.maxNodes ?? 4000
    let head = 0
    while (head < queue.length && head < max) {
      const cur = queue[head++]
      const cx = cur % LOT_W, cz = (cur / LOT_W) | 0
      for (const [dx, dz] of Grid.DIRS) {
        const nx = cx + dx, nz = cz + dz
        if (!this.inBounds(nx, nz)) continue
        const ni = this.idx(nx, nz)
        if (seen[ni]) continue
        if (!this.canStep(cx, cz, nx, nz)) continue
        if (opts.avoidPool && this.pool[ni]) continue
        seen[ni] = 1
        if (test(nx, nz)) return { x: nx, z: nz }
        queue.push(ni)
      }
    }
    return null
  }

  /** Can a sim standing here reach any tile satisfying `test`? */
  canReach(sx: number, sz: number, test: (x: number, z: number) => boolean, opts?: { avoidPool?: boolean }) {
    return this.findNearest(sx, sz, test, opts) !== null
  }

  /** Free walkable tiles orthogonally/diagonally adjacent to a footprint. */
  adjacentFreeTiles(x: number, z: number, w: number, d: number): TilePos[] {
    const out: TilePos[] = []
    for (let ix = x - 1; ix <= x + w; ix++) {
      for (let iz = z - 1; iz <= z + d; iz++) {
        const inside = ix >= x && ix < x + w && iz >= z && iz < z + d
        if (inside) continue
        if (!this.inBounds(ix, iz) || !this.walkable(ix, iz)) continue
        out.push({ x: ix, z: iz })
      }
    }
    return out
  }
}
