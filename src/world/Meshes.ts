import * as THREE from 'three'
import { mats } from './Materials'

// ---------------------------------------------------------------- primitives

const M = (name: string) => mats.palette[name]

export function shadow(o: THREE.Object3D, cast = true, receive = true): THREE.Object3D {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) { c.castShadow = cast; c.receiveShadow = receive }
  })
  return o
}

export function grp(...children: THREE.Object3D[]) {
  const g = new THREE.Group()
  for (const c of children) if (c) g.add(c)
  return g
}

function place<T extends THREE.Object3D>(m: T, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): T {
  m.position.set(x, y, z)
  m.rotation.set(rx, ry, rz)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

export function box(w: number, h: number, d: number, mat: string | THREE.Material,
  x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof mat === 'string' ? M(mat) : mat)
  return place(m, x, y, z, rx, ry, rz)
}

function roundedRect(w: number, h: number, r: number) {
  const s = new THREE.Shape()
  const x = -w / 2, y = -h / 2
  r = Math.min(r, w / 2 - 0.001, h / 2 - 0.001)
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r)
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y)
  return s
}

/** Box with rounded vertical edges — reads much softer than a raw cube. */
export function rbox(w: number, h: number, d: number, r: number, mat: string | THREE.Material,
  x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const bevel = Math.min(r * 0.4, 0.018)
  const geo = new THREE.ExtrudeGeometry(roundedRect(w, h, r), {
    depth: Math.max(0.001, d - bevel * 2), bevelEnabled: true, bevelThickness: bevel,
    bevelSize: bevel, bevelSegments: 3, curveSegments: 6,
  })
  geo.translate(0, 0, -d / 2 + bevel)
  geo.computeVertexNormals()
  const m = new THREE.Mesh(geo, typeof mat === 'string' ? M(mat) : mat)
  return place(m, x, y, z, rx, ry, rz)
}

export function cyl(rt: number, rb: number, h: number, seg: number, mat: string | THREE.Material,
  x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), typeof mat === 'string' ? M(mat) : mat)
  return place(m, x, y, z, rx, ry, rz)
}

export function sph(r: number, mat: string | THREE.Material, x = 0, y = 0, z = 0, seg = 16) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(6, seg / 2)), typeof mat === 'string' ? M(mat) : mat)
  return place(m, x, y, z)
}

export function cone(r: number, h: number, mat: string | THREE.Material, x = 0, y = 0, z = 0, seg = 12) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), typeof mat === 'string' ? M(mat) : mat)
  return place(m, x, y, z)
}

export function tor(r: number, tube: number, mat: string | THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 20), typeof mat === 'string' ? M(mat) : mat)
  return place(m, x, y, z, rx, ry)
}

/** Four tapered legs at the corners of a w x d frame. */
function legs(w: number, d: number, h: number, mat: string, r = 0.035, inset = 0.07) {
  const g = new THREE.Group()
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(cyl(r * 0.8, r, h, 8, mat, sx * (w / 2 - inset), h / 2, sz * (d / 2 - inset)))
  }
  return g
}

function cushion(w: number, h: number, d: number, mat: string, x: number, y: number, z: number) {
  return rbox(w, h, d, Math.min(w, h) * 0.35, mat, x, y, z)
}

// ---------------------------------------------------------------- builders

export type Builder = () => THREE.Object3D

export const BUILDERS: Record<string, Builder> = {

  // ============================================================ kitchen
  fridge: () => grp(
    rbox(0.86, 1.82, 0.74, 0.07, 'white', 0, 0.91, 0),
    box(0.86, 0.02, 0.02, 'steel', 0, 1.16, 0.375),
    box(0.05, 0.42, 0.05, 'chrome', 0.3, 1.42, 0.39),
    box(0.05, 0.72, 0.05, 'chrome', 0.3, 0.66, 0.39),
    box(0.2, 0.13, 0.02, 'black', -0.2, 1.5, 0.38),
    box(0.86, 0.05, 0.7, 'black', 0, 0.025, 0),
  ),

  counter: () => grp(
    rbox(0.98, 0.86, 0.62, 0.03, 'cream', 0, 0.45, 0.02),
    rbox(1.0, 0.06, 0.66, 0.02, 'marbleTop' in mats.palette ? 'marbleTop' : 'stone', 0, 0.9, 0),
    box(0.9, 0.02, 0.02, 'chrome', 0, 0.62, 0.34),
    box(0.98, 0.09, 0.5, 'black', 0, 0.045, 0),
  ),

  stove: () => grp(
    rbox(0.94, 0.84, 0.64, 0.04, 'steel', 0, 0.42, 0),
    box(0.96, 0.05, 0.66, 'black', 0, 0.87, 0),
    ...[[-0.22, -0.15], [0.22, -0.15], [-0.22, 0.16], [0.22, 0.16]].map(([x, z]) =>
      cyl(0.11, 0.11, 0.02, 14, 'black', x, 0.9, z)),
    ...[[-0.22, -0.15], [0.22, -0.15], [-0.22, 0.16], [0.22, 0.16]].map(([x, z]) =>
      tor(0.075, 0.012, 'grim', x, 0.905, z, Math.PI / 2)),
    rbox(0.74, 0.44, 0.03, 0.02, 'glass', 0, 0.44, 0.33),
    box(0.8, 0.04, 0.05, 'chrome', 0, 0.7, 0.34),
    ...[-0.3, -0.1, 0.1, 0.3].map((x) => cyl(0.035, 0.035, 0.03, 10, 'chrome', x, 0.78, 0.34, Math.PI / 2)),
  ),

  grill: () => grp(
    box(0.06, 0.5, 0.06, 'black', -0.36, 0.25, -0.2),
    box(0.06, 0.5, 0.06, 'black', 0.36, 0.25, -0.2),
    cyl(0.09, 0.09, 0.1, 12, 'rubber', -0.36, 0.05, 0.2, Math.PI / 2),
    cyl(0.09, 0.09, 0.1, 12, 'rubber', 0.36, 0.05, 0.2, Math.PI / 2),
    box(0.06, 0.42, 0.06, 'black', -0.36, 0.29, 0.2),
    box(0.06, 0.42, 0.06, 'black', 0.36, 0.29, 0.2),
    rbox(0.92, 0.24, 0.56, 0.06, 'black', 0, 0.62, 0),
    rbox(0.94, 0.22, 0.58, 0.1, 'steel', 0, 0.8, -0.02),
    box(0.8, 0.02, 0.02, 'chrome', 0, 0.86, 0.28),
    // the propane tank that makes this such a poor indoor choice
    cyl(0.13, 0.13, 0.34, 12, 'warn', 0.0, 0.19, -0.02),
    cyl(0.04, 0.04, 0.07, 8, 'chrome', 0.0, 0.39, -0.02),
    box(0.16, 0.09, 0.02, 'black', 0.0, 0.75, 0.29),
  ),

  microwave: () => grp(
    rbox(0.56, 0.32, 0.4, 0.03, 'steel', 0, 0.16, 0),
    rbox(0.36, 0.24, 0.02, 0.02, 'glass', -0.08, 0.16, 0.21),
    box(0.12, 0.2, 0.015, 'black', 0.19, 0.16, 0.205),
    box(0.09, 0.03, 0.008, 'screenOn', 0.19, 0.24, 0.212),
  ),

  espresso: () => grp(
    rbox(0.34, 0.42, 0.34, 0.04, 'black', 0, 0.21, 0),
    box(0.3, 0.06, 0.3, 'chrome', 0, 0.45, 0),
    cyl(0.055, 0.055, 0.1, 10, 'chrome', 0, 0.16, 0.15),
    box(0.14, 0.02, 0.12, 'chrome', 0, 0.09, 0.15),
    cyl(0.03, 0.03, 0.07, 8, 'white', 0, 0.125, 0.15),
    box(0.1, 0.05, 0.01, 'screenOn', 0, 0.36, 0.175),
    cyl(0.025, 0.025, 0.03, 8, 'chrome', -0.1, 0.29, 0.175, Math.PI / 2),
  ),

  trash: () => grp(
    cyl(0.21, 0.17, 0.6, 14, 'steel', 0, 0.3, 0),
    cyl(0.225, 0.225, 0.04, 14, 'black', 0, 0.62, 0),
    box(0.1, 0.02, 0.06, 'chrome', 0, 0.65, 0),
  ),

  // ============================================================ bathroom
  toilet: () => grp(
    rbox(0.42, 0.42, 0.24, 0.06, 'porcelain', 0, 0.55, -0.24),
    box(0.36, 0.03, 0.04, 'porcelain', 0, 0.78, -0.24),
    cyl(0.03, 0.03, 0.06, 8, 'chrome', 0.17, 0.7, -0.14, 0, 0, Math.PI / 2),
    cyl(0.2, 0.15, 0.36, 16, 'porcelain', 0, 0.18, 0.04),
    cyl(0.22, 0.22, 0.06, 16, 'porcelain', 0, 0.39, 0.05),
    tor(0.19, 0.035, 'white', 0, 0.43, 0.05, Math.PI / 2),
  ),

  shower: () => grp(
    box(0.98, 0.06, 0.98, 'porcelain', 0, 0.03, 0),
    box(0.06, 2.0, 0.98, 'porcelain', -0.46, 1.0, 0),
    box(0.98, 2.0, 0.06, 'porcelain', 0, 1.0, -0.46),
    rbox(0.9, 1.9, 0.02, 0.01, 'glass', 0, 1.0, 0.46),
    cyl(0.02, 0.02, 0.28, 8, 'chrome', -0.3, 1.86, -0.32, 0, 0, Math.PI / 3),
    cyl(0.075, 0.075, 0.03, 12, 'chrome', -0.17, 1.78, -0.32),
    cyl(0.022, 0.022, 0.08, 8, 'chrome', -0.42, 1.1, -0.2, 0, 0, Math.PI / 2),
  ),

  tub: () => grp(
    rbox(1.62, 0.56, 0.78, 0.09, 'porcelain', 0, 0.28, 0),
    rbox(1.44, 0.44, 0.62, 0.08, 'glass', 0, 0.34, 0),
    cyl(0.02, 0.02, 0.14, 8, 'chrome', -0.68, 0.6, 0),
    cyl(0.02, 0.02, 0.1, 8, 'chrome', -0.63, 0.66, 0, 0, 0, Math.PI / 2),
    ...[-1, 1].map((s) => cyl(0.018, 0.018, 0.05, 6, 'chrome', -0.68, 0.58, s * 0.11)),
  ),

  sink: () => grp(
    box(0.1, 0.62, 0.1, 'porcelain', 0, 0.31, -0.16),
    rbox(0.56, 0.16, 0.42, 0.05, 'porcelain', 0, 0.7, 0),
    cyl(0.19, 0.16, 0.1, 14, 'porcelain', 0, 0.72, 0.02),
    cyl(0.02, 0.02, 0.18, 8, 'chrome', 0, 0.86, -0.16),
    cyl(0.017, 0.017, 0.12, 8, 'chrome', 0, 0.93, -0.1, Math.PI / 2.4),
  ),

  // ============================================================ bedroom
  bedSingle: () => grp(
    legs(1.0, 2.0, 0.26, 'woodDark', 0.04, 0.1),
    rbox(1.0, 0.16, 2.0, 0.04, 'wood', 0, 0.34, 0),
    rbox(0.94, 0.2, 1.9, 0.08, 'fabricCream', 0, 0.52, 0),
    rbox(0.86, 0.12, 0.42, 0.06, 'white', 0, 0.66, -0.68),
    rbox(0.94, 0.06, 1.2, 0.04, 'fabricBlue', 0, 0.64, 0.32),
    box(1.02, 0.6, 0.08, 'woodDark', 0, 0.6, -1.0),
  ),

  bedDouble: () => grp(
    legs(1.6, 2.05, 0.26, 'woodDark', 0.045, 0.1),
    rbox(1.6, 0.16, 2.05, 0.05, 'wood', 0, 0.34, 0),
    rbox(1.52, 0.24, 1.95, 0.09, 'fabricCream', 0, 0.54, 0),
    rbox(0.6, 0.13, 0.42, 0.06, 'white', -0.4, 0.7, -0.7),
    rbox(0.6, 0.13, 0.42, 0.06, 'white', 0.4, 0.7, -0.7),
    rbox(1.52, 0.07, 1.25, 0.05, 'fabricRed', 0, 0.68, 0.34),
    rbox(1.66, 0.72, 0.09, 0.04, 'woodDark', 0, 0.66, -1.03),
  ),

  murphyBed: () => grp(
    box(1.66, 2.1, 0.4, 'woodDark', 0, 1.05, -0.28),
    rbox(1.5, 1.9, 0.16, 0.05, 'wood', 0, 1.02, -0.02),
    rbox(1.4, 1.76, 0.14, 0.07, 'fabricCream', 0, 1.02, 0.08),
    cyl(0.05, 0.05, 1.5, 8, 'chrome', 0, 0.06, 0.06, 0, 0, Math.PI / 2),
    box(0.24, 0.05, 0.05, 'gold', 0, 1.94, 0.1),
    box(1.66, 0.06, 0.44, 'woodDark', 0, 2.12, -0.26),
  ),

  // ============================================================ living
  sofa: () => grp(
    box(2.0, 0.14, 0.9, 'woodDark', 0, 0.14, 0),
    ...[-1, 1].map((s) => cyl(0.04, 0.04, 0.16, 8, 'woodDark', s * 0.85, 0.08, 0.32)),
    ...[-1, 1].map((s) => cyl(0.04, 0.04, 0.16, 8, 'woodDark', s * 0.85, 0.08, -0.32)),
    cushion(0.62, 0.2, 0.78, 'fabricBlue', -0.64, 0.32, 0.03),
    cushion(0.62, 0.2, 0.78, 'fabricBlue', 0, 0.32, 0.03),
    cushion(0.62, 0.2, 0.78, 'fabricBlue', 0.64, 0.32, 0.03),
    rbox(2.0, 0.66, 0.24, 0.1, 'fabricBlue', 0, 0.58, -0.34),
    rbox(0.24, 0.5, 0.9, 0.1, 'fabricBlue', -0.9, 0.48, 0),
    rbox(0.24, 0.5, 0.9, 0.1, 'fabricBlue', 0.9, 0.48, 0),
    cushion(0.34, 0.12, 0.32, 'fabricCream', -0.5, 0.5, -0.16),
  ),

  armchair: () => grp(
    box(0.92, 0.14, 0.88, 'woodDark', 0, 0.14, 0),
    ...[-1, 1].map((s) => cyl(0.04, 0.04, 0.16, 8, 'woodDark', s * 0.34, 0.08, 0.3)),
    ...[-1, 1].map((s) => cyl(0.04, 0.04, 0.16, 8, 'woodDark', s * 0.34, 0.08, -0.3)),
    cushion(0.66, 0.2, 0.72, 'fabricGreen', 0, 0.32, 0.04),
    rbox(0.92, 0.66, 0.22, 0.1, 'fabricGreen', 0, 0.58, -0.33),
    rbox(0.22, 0.48, 0.86, 0.1, 'fabricGreen', -0.36, 0.46, 0),
    rbox(0.22, 0.48, 0.86, 0.1, 'fabricGreen', 0.36, 0.46, 0),
  ),

  diningChair: () => grp(
    legs(0.44, 0.44, 0.45, 'wood', 0.024, 0.05),
    rbox(0.46, 0.06, 0.46, 0.03, 'wood', 0, 0.48, 0),
    rbox(0.42, 0.5, 0.05, 0.03, 'wood', 0, 0.75, -0.2),
    cushion(0.38, 0.05, 0.38, 'fabricRed', 0, 0.53, 0),
  ),

  diningTable: () => grp(
    legs(1.9, 0.94, 0.72, 'woodDark', 0.045, 0.09),
    rbox(2.0, 0.07, 1.0, 0.02, 'wood', 0, 0.75, 0),
    box(1.8, 0.06, 0.06, 'woodDark', 0, 0.68, 0.4),
    box(1.8, 0.06, 0.06, 'woodDark', 0, 0.68, -0.4),
  ),

  coffeeTable: () => grp(
    legs(0.96, 0.56, 0.36, 'woodDark', 0.03, 0.06),
    rbox(1.04, 0.05, 0.6, 0.02, 'glass', 0, 0.39, 0),
    rbox(0.9, 0.04, 0.48, 0.02, 'wood', 0, 0.18, 0),
  ),

  bookshelf: () => {
    const g = grp(
      box(1.0, 2.0, 0.06, 'woodDark', 0, 1.0, -0.15),
      box(0.06, 2.0, 0.32, 'woodDark', -0.47, 1.0, 0),
      box(0.06, 2.0, 0.32, 'woodDark', 0.47, 1.0, 0),
      box(1.0, 0.05, 0.32, 'woodDark', 0, 0.02, 0),
    )
    const colors = ['fabricRed', 'fabricBlue', 'fabricGreen', 'gold', 'terracotta', 'cream']
    for (let s = 0; s < 4; s++) {
      const y = 0.42 + s * 0.46
      g.add(box(0.94, 0.04, 0.32, 'woodDark', 0, y, 0))
      let x = -0.44
      while (x < 0.4) {
        const w = 0.03 + (((s * 7 + x * 31) | 0) % 5) * 0.008
        const h = 0.22 + (((s * 13 + x * 17) | 0) % 6) * 0.018
        g.add(box(w, h, 0.24, colors[Math.abs(((s * 5 + x * 23) | 0)) % colors.length], x + w / 2, y + 0.02 + h / 2, 0))
        x += w + 0.005
      }
    }
    return g
  },

  fireplace: () => grp(
    box(1.7, 1.3, 0.5, 'stone', 0, 0.65, -0.2),
    box(1.9, 0.12, 0.62, 'stone', 0, 1.36, -0.16),
    box(1.0, 0.8, 0.3, 'grim', 0, 0.4, 0.04),
    box(1.06, 0.06, 0.36, 'black', 0, 0.82, 0.04),
    ...[-1, 0, 1].map((i) => cyl(0.05, 0.05, 0.5, 6, 'woodDark', i * 0.16, 0.14, 0.05, 0, 0.4 + i, Math.PI / 2)),
    box(1.02, 0.05, 0.34, 'black', 0, 0.05, 0.04),
  ),

  rug: () => {
    const g = new THREE.Group()
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 1.9), M('fabricRed'))
    m.rotation.x = -Math.PI / 2
    m.position.y = 0.012
    m.receiveShadow = true
    const b = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.6), M('fabricCream'))
    b.rotation.x = -Math.PI / 2
    b.position.y = 0.016
    b.receiveShadow = true
    g.add(m, b)
    return g
  },

  curtains: () => grp(
    cyl(0.018, 0.018, 1.7, 8, 'gold', 0, 2.15, 0, 0, 0, Math.PI / 2),
    ...[-1, 1].map((s) => rbox(0.34, 1.9, 0.08, 0.03, 'fabricRed', s * 0.6, 1.2, 0)),
    ...[-1, 1].map((s) => rbox(0.2, 1.9, 0.06, 0.03, 'fabricCream', s * 0.32, 1.2, -0.02)),
  ),

  plant: () => {
    const g = grp(
      cyl(0.2, 0.15, 0.3, 12, 'terracotta', 0, 0.15, 0),
      cyl(0.19, 0.19, 0.04, 12, 'dirt', 0, 0.3, 0),
      cyl(0.03, 0.04, 0.7, 6, 'leafDark', 0, 0.65, 0),
    )
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.4
      const h = 0.75 + (i % 3) * 0.18
      const leaf = sph(0.19, i % 2 ? 'leaf' : 'leafDark', Math.cos(a) * 0.2, h, Math.sin(a) * 0.2, 10)
      leaf.scale.set(1.5, 0.42, 1.0)
      leaf.rotation.set(0.2, a, 0.35)
      g.add(leaf)
    }
    return g
  },

  lamp: () => grp(
    cyl(0.16, 0.18, 0.03, 14, 'black', 0, 0.015, 0),
    cyl(0.022, 0.022, 1.4, 8, 'chrome', 0, 0.7, 0),
    cyl(0.22, 0.15, 0.3, 14, 'fabricCream', 0, 1.52, 0),
    sph(0.07, 'screenOn', 0, 1.45, 0, 10),
  ),

  // ============================================================ electronics
  tv: () => grp(
    box(0.5, 0.04, 0.32, 'black', 0, 0.02, 0),
    box(0.1, 0.36, 0.08, 'black', 0, 0.2, 0),
    rbox(1.5, 0.9, 0.07, 0.02, 'black', 0, 0.86, 0),
    rbox(1.42, 0.82, 0.02, 0.01, 'screenOn', 0, 0.86, 0.045),
    box(0.06, 0.006, 0.006, 'screenOn', 0.6, 0.4, 0.05),
  ),

  computer: () => grp(
    box(0.34, 0.02, 0.2, 'black', 0, 0.01, -0.06),
    cyl(0.02, 0.02, 0.16, 8, 'chrome', 0, 0.09, -0.06),
    rbox(0.62, 0.4, 0.03, 0.015, 'black', 0, 0.37, -0.06),
    rbox(0.58, 0.36, 0.01, 0.01, 'screenOn', 0, 0.37, -0.04),
    rbox(0.44, 0.02, 0.16, 0.01, 'white', 0, 0.02, 0.16),
    rbox(0.09, 0.025, 0.13, 0.03, 'white', 0.3, 0.02, 0.16),
    rbox(0.2, 0.42, 0.44, 0.02, 'black', -0.42, 0.21, 0.02),
    box(0.02, 0.03, 0.02, 'screenOn', -0.33, 0.36, 0.02),
  ),

  stereo: () => grp(
    rbox(0.34, 0.9, 0.3, 0.03, 'black', -0.5, 0.45, 0),
    rbox(0.34, 0.9, 0.3, 0.03, 'black', 0.5, 0.45, 0),
    cyl(0.11, 0.11, 0.03, 14, 'rubber', -0.5, 0.6, 0.16, Math.PI / 2),
    cyl(0.11, 0.11, 0.03, 14, 'rubber', 0.5, 0.6, 0.16, Math.PI / 2),
    cyl(0.06, 0.06, 0.03, 12, 'rubber', -0.5, 0.28, 0.16, Math.PI / 2),
    cyl(0.06, 0.06, 0.03, 12, 'rubber', 0.5, 0.28, 0.16, Math.PI / 2),
    rbox(0.5, 0.24, 0.3, 0.02, 'steel', 0, 0.12, 0),
    box(0.3, 0.06, 0.01, 'screenOn', 0, 0.16, 0.155),
  ),

  spaceHeater: () => grp(
    rbox(0.42, 0.5, 0.24, 0.05, 'white', 0, 0.25, 0),
    box(0.32, 0.3, 0.02, 'grim', 0, 0.27, 0.12),
    ...[0, 1, 2, 3].map((i) => box(0.3, 0.02, 0.03, 'terracotta', 0, 0.16 + i * 0.075, 0.115)),
    cyl(0.03, 0.03, 0.02, 10, 'warn', 0.14, 0.06, 0.12, Math.PI / 2),
  ),

  telescope: () => grp(
    ...[0, 1, 2].map((i) => cyl(0.02, 0.02, 1.2, 6, 'chrome',
      Math.cos(i * 2.1) * 0.24, 0.6, Math.sin(i * 2.1) * 0.24, Math.cos(i * 2.1) * 0.3, 0, -Math.sin(i * 2.1) * 0.3)),
    sph(0.06, 'black', 0, 1.2, 0, 10),
    cyl(0.1, 0.13, 0.9, 14, 'white', 0, 1.5, 0.06, -0.6),
    cyl(0.05, 0.05, 0.16, 10, 'black', 0.0, 1.16, -0.24, -0.6),
    cyl(0.11, 0.11, 0.02, 14, 'glass', 0.0, 1.86, 0.34, -0.6),
  ),

  // ============================================================ fitness
  treadmill: () => grp(
    box(0.76, 0.16, 1.5, 'black', 0, 0.13, 0.06),
    box(0.62, 0.04, 1.34, 'rubber', 0, 0.23, 0.06),
    ...[-1, 1].map((s) => cyl(0.03, 0.03, 0.9, 8, 'steel', s * 0.34, 0.63, -0.6, 0.35)),
    box(0.76, 0.06, 0.1, 'steel', 0, 1.02, -0.78),
    rbox(0.44, 0.3, 0.05, 0.02, 'black', 0, 1.12, -0.76, -0.35),
    rbox(0.36, 0.22, 0.01, 0.01, 'screenOn', 0, 1.13, -0.735, -0.35),
    ...[-1, 1].map((s) => cyl(0.028, 0.028, 0.5, 8, 'steel', s * 0.34, 0.9, -0.5, 0, 0, Math.PI / 2)),
  ),

  weightBench: () => grp(
    box(0.4, 0.1, 1.3, 'black', 0, 0.42, 0),
    rbox(0.44, 0.14, 1.3, 0.06, 'rubber', 0, 0.52, 0),
    ...[-1, 1].map((s) => box(0.08, 0.44, 0.08, 'steel', 0, 0.22, s * 0.55)),
    ...[-1, 1].map((s) => box(0.7, 0.06, 0.06, 'steel', 0, 0.02, s * 0.55)),
    ...[-1, 1].map((s) => cyl(0.04, 0.04, 1.1, 8, 'steel', s * 0.42, 0.75, -0.5)),
    cyl(0.022, 0.022, 1.5, 8, 'chrome', 0, 1.28, -0.5, 0, 0, Math.PI / 2),
    ...[-1, 1].map((s) => cyl(0.17, 0.17, 0.05, 16, 'grim', s * 0.6, 1.28, -0.5, 0, 0, Math.PI / 2)),
    ...[-1, 1].map((s) => cyl(0.17, 0.17, 0.05, 16, 'grim', s * 0.68, 1.28, -0.5, 0, 0, Math.PI / 2)),
  ),

  yogaMat: () => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.03, 1.8), M('fabricGreen'))
    m.position.y = 0.015
    m.receiveShadow = true
    return grp(m)
  },

  // ============================================================ outdoor / pool
  poolLadder: () => grp(
    ...[-1, 1].map((s) => cyl(0.03, 0.03, 1.5, 8, 'chrome', s * 0.22, 0.35, 0.1, 0.35)),
    ...[0, 1, 2].map((i) => cyl(0.022, 0.022, 0.5, 8, 'chrome', 0, 0.3 - i * 0.36, 0.02 + i * 0.13, 0, 0, Math.PI / 2)),
    ...[-1, 1].map((s) => tor(0.16, 0.028, 'chrome', s * 0.22, 0.86, 0.0, 0, Math.PI / 2)),
  ),

  divingBoard: () => grp(
    box(0.5, 0.9, 0.5, 'concreteBase' in mats.palette ? 'concreteBase' : 'stone', 0, 0.45, -0.7),
    rbox(0.56, 0.07, 1.9, 0.03, 'white', 0, 0.94, 0.28),
    ...[-1, 1].map((s) => cyl(0.02, 0.02, 0.7, 8, 'chrome', s * 0.3, 1.28, -0.5)),
    ...[-1, 1].map((s) => cyl(0.018, 0.018, 1.0, 8, 'chrome', s * 0.3, 1.6, -0.05, 0.5)),
  ),

  hotTub: () => grp(
    cyl(1.0, 0.96, 0.86, 20, 'woodDark', 0, 0.43, 0),
    cyl(0.9, 0.9, 0.06, 20, 'wood', 0, 0.88, 0),
    cyl(0.84, 0.84, 0.5, 20, 'glass', 0, 0.5, 0),
    cyl(0.85, 0.85, 0.02, 20, 'porcelain', 0, 0.24, 0),
    box(0.34, 0.24, 0.16, 'black', 0.86, 0.62, 0.4),
    box(0.2, 0.05, 0.02, 'screenOn', 0.86, 0.66, 0.49),
  ),

  sauna: () => grp(
    box(2.0, 2.2, 2.0, 'wood', 0, 1.1, 0),
    box(1.9, 0.06, 1.9, 'woodDark', 0, 2.2, 0),
    rbox(0.7, 1.8, 0.06, 0.02, 'woodDark', 0.6, 0.9, 1.0),
    rbox(0.44, 0.6, 0.02, 0.01, 'glass', 0.6, 1.3, 1.03),
    box(0.14, 0.05, 0.05, 'gold', 0.28, 0.95, 1.06),
    box(0.24, 0.2, 0.16, 'steel', -0.9, 1.5, 1.02),
    box(0.14, 0.06, 0.01, 'screenOn', -0.9, 1.55, 1.11),
  ),

  deepFreezer: () => grp(
    rbox(1.5, 0.92, 0.78, 0.05, 'white', 0, 0.46, 0),
    rbox(1.52, 0.1, 0.8, 0.04, 'steel', 0, 0.95, 0),
    box(0.3, 0.05, 0.05, 'chrome', 0, 0.94, 0.4),
    box(0.14, 0.08, 0.02, 'screenOn', -0.6, 0.72, 0.4),
    cyl(0.03, 0.03, 0.02, 10, 'warn', 0.6, 0.72, 0.4, Math.PI / 2),
  ),

  rocket: () => grp(
    cyl(0.36, 0.5, 3.0, 18, 'white', 0, 1.5, 0),
    cone(0.36, 0.9, 'fabricRed', 0, 3.45),
    ...[0, 1, 2].map((i) => {
      const a = (i / 3) * Math.PI * 2
      const f = box(0.06, 0.9, 0.6, 'fabricRed', Math.cos(a) * 0.5, 0.45, Math.sin(a) * 0.5, 0, -a)
      return f
    }),
    cyl(0.2, 0.3, 0.35, 14, 'grim', 0, 0.1, 0),
    sph(0.16, 'glass', 0, 2.3, 0.36, 12),
    box(0.6, 0.06, 0.6, 'steel', 0, 0.02, 0),
    ...[0, 1, 2, 3].map((i) => cyl(0.03, 0.03, 3.2, 6, 'steel',
      Math.cos(i * 1.57) * 0.85, 1.6, Math.sin(i * 1.57) * 0.85, 0.1 * Math.sin(i * 1.57), 0, -0.1 * Math.cos(i * 1.57))),
  ),

  cowplant: () => {
    const g = grp(
      cyl(0.5, 0.62, 0.22, 16, 'dirt', 0, 0.11, 0),
      cyl(0.16, 0.24, 1.5, 10, 'leafDark', 0, 0.85, -0.1),
    )
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      const leaf = sph(0.42, i % 2 ? 'leaf' : 'leafDark', Math.cos(a) * 0.5, 0.35 + (i % 3) * 0.12, Math.sin(a) * 0.5 - 0.1, 10)
      leaf.scale.set(1.3, 0.28, 0.8)
      leaf.rotation.set(0.1, a, 0.3)
      g.add(leaf)
    }
    // the head: a bovine flytrap
    const head = grp(
      sph(0.44, 'leaf', 0, 0, 0, 14),
      sph(0.3, 'fabricRed', 0, -0.12, 0.26, 12),
      ...[-1, 1].map((s) => sph(0.1, 'white', s * 0.2, 0.2, 0.3, 10)),
      ...[-1, 1].map((s) => sph(0.05, 'black', s * 0.2, 0.2, 0.37, 8)),
      ...[-1, 1].map((s) => cone(0.09, 0.26, 'bone', s * 0.36, 0.36, 0.02)),
      // the cake lure
      cyl(0.12, 0.13, 0.1, 12, 'cream', 0, 0.5, 0.34),
      cyl(0.125, 0.125, 0.02, 12, 'fabricRed', 0, 0.56, 0.34),
      cyl(0.012, 0.012, 0.09, 6, 'gold', 0, 0.62, 0.34),
    )
    head.position.set(0, 1.7, 0.1)
    head.name = 'head'
    head.scale.setScalar(1.05)
    g.add(head)
    return g
  },

  tree: () => {
    const g = grp(cyl(0.16, 0.26, 2.2, 10, 'woodDark', 0, 1.1, 0))
    for (let i = 0; i < 7; i++) {
      const a = i * 1.9
      const r = 0.5 + (i % 3) * 0.22
      const blob = sph(0.75 - (i % 3) * 0.1, i % 2 ? 'leaf' : 'leafDark',
        Math.cos(a) * r * 0.5, 2.3 + (i % 4) * 0.28, Math.sin(a) * r * 0.5, 12)
      blob.scale.set(1, 0.82, 1)
      g.add(blob)
    }
    return g
  },

  fence: () => grp(
    ...[-1, 1].map((s) => box(0.09, 1.0, 0.09, 'wood', s * 0.44, 0.5, 0)),
    box(1.0, 0.08, 0.05, 'wood', 0, 0.82, 0),
    box(1.0, 0.08, 0.05, 'wood', 0, 0.42, 0),
    ...[-0.28, 0, 0.28].map((x) => box(0.07, 0.95, 0.04, 'woodLight', x, 0.48, 0.02)),
  ),

  flowerbed: () => {
    const g = grp(
      box(1.9, 0.24, 0.9, 'wood', 0, 0.12, 0),
      box(1.74, 0.06, 0.74, 'dirt', 0, 0.24, 0),
    )
    const cols = ['fabricRed', 'gold', 'plumbob', 'fabricCream']
    for (let i = 0; i < 14; i++) {
      const x = -0.78 + (i % 7) * 0.26
      const z = i < 7 ? -0.17 : 0.17
      g.add(cyl(0.012, 0.012, 0.2, 5, 'leafDark', x, 0.34, z))
      g.add(sph(0.06, cols[i % cols.length], x, 0.46, z, 8))
    }
    return g
  },

  umbrella: () => grp(
    cyl(0.24, 0.26, 0.08, 14, 'stone', 0, 0.04, 0),
    cyl(0.03, 0.03, 2.3, 8, 'wood', 0, 1.15, 0),
    cone(1.3, 0.55, 'fabricRed', 0, 2.35, 0, 10),
    cyl(0.04, 0.04, 0.1, 6, 'wood', 0, 2.66, 0),
  ),

  // ============================================================ decor
  painting: () => grp(
    box(0.9, 0.7, 0.05, 'gold', 0, 1.6, 0),
    box(0.8, 0.6, 0.02, 'fabricBlue', 0, 1.6, 0.03),
    box(0.5, 0.3, 0.01, 'plumbob', -0.1, 1.5, 0.045),
  ),

  mirror: () => grp(
    rbox(0.7, 1.2, 0.06, 0.04, 'gold', 0, 1.3, 0),
    rbox(0.6, 1.1, 0.02, 0.03, 'glass', 0, 1.3, 0.04),
  ),

  statue: () => grp(
    box(0.5, 0.2, 0.5, 'stone', 0, 0.1, 0),
    cyl(0.16, 0.2, 0.9, 12, 'bone', 0, 0.65, 0),
    sph(0.19, 'bone', 0, 1.24, 0, 14),
    box(0.34, 0.06, 0.06, 'bone', 0, 1.0, 0.06, 0, 0, 0.4),
  ),

  smokeAlarm: () => grp(
    cyl(0.13, 0.13, 0.05, 16, 'white', 0, 2.42, 0),
    cyl(0.1, 0.1, 0.02, 16, 'black', 0, 2.39, 0),
    sph(0.014, 'fabricRed', 0.05, 2.39, 0.02, 8),
    box(0.06, 0.02, 0.02, 'steel', 0, 2.45, 0.1),
  ),

  extinguisher: () => grp(
    box(0.16, 0.2, 0.06, 'steel', 0, 1.15, -0.06),
    cyl(0.075, 0.085, 0.44, 14, 'fabricRed', 0, 1.05, 0),
    cyl(0.03, 0.03, 0.07, 10, 'black', 0, 1.3, 0),
    cyl(0.014, 0.014, 0.16, 8, 'black', 0.06, 1.3, 0.04, 0, 0, -0.8),
    box(0.1, 0.09, 0.005, 'cream', 0, 1.02, 0.088),
  ),

  reaper: () => {
    const g = grp(
      cone(0.42, 1.9, 'grim', 0, 0.95, 0, 14),
      cyl(0.19, 0.26, 0.34, 12, 'grim', 0, 1.86, 0),
      sph(0.15, 'bone', 0, 1.94, 0.04, 14),
      sph(0.05, 'black', -0.06, 1.97, 0.13, 8),
      sph(0.05, 'black', 0.06, 1.97, 0.13, 8),
      box(0.14, 0.05, 0.03, 'black', 0, 1.86, 0.13),
      cyl(0.2, 0.24, 0.3, 12, 'grim', 0, 2.02, -0.03),
      cyl(0.022, 0.022, 2.4, 8, 'woodDark', 0.42, 1.2, 0),
    )
    const blade = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.028, 6, 14, Math.PI * 0.8), M('chrome'))
    blade.position.set(0.42, 2.34, 0.16)
    blade.rotation.set(Math.PI / 2, 0, 0.5)
    blade.castShadow = true
    g.add(blade)
    return g
  },

  gravestone: () => grp(
    box(0.7, 0.12, 0.5, 'stone', 0, 0.06, 0),
    rbox(0.5, 0.78, 0.14, 0.24, 'stone', 0, 0.5, 0),
    box(0.3, 0.05, 0.02, 'grim', 0, 0.6, 0.08),
    box(0.05, 0.3, 0.02, 'grim', 0, 0.45, 0.08),
  ),
}

/** Extra palette entries some builders reference lazily. */
export function ensurePalette() {
  if (!mats.palette.marbleTop) {
    mats.palette.marbleTop = new THREE.MeshStandardMaterial({ color: 0x2b2e36, roughness: 0.22, metalness: 0.1 })
  }
  if (!mats.palette.concreteBase) {
    mats.palette.concreteBase = new THREE.MeshStandardMaterial({ color: 0x9a9892, roughness: 0.9 })
  }
}
