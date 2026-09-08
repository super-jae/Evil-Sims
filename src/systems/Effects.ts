import * as THREE from 'three'

const MAX_PARTICLES = 2600

const PART_VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (300.0 / max(0.001, -mv.z));
  gl_Position = projectionMatrix * mv;
}`

const PART_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = dot(p, p);
  if (d > 0.25) discard;
  float a = smoothstep(0.25, 0.02, d);
  gl_FragColor = vec4(vColor, a * vAlpha);
}`

interface Particle {
  alive: boolean
  x: number; y: number; z: number
  vx: number; vy: number; vz: number
  life: number; maxLife: number
  size: number; sizeEnd: number
  r: number; g: number; b: number
  r2: number; g2: number; b2: number
  drag: number
  gravity: number
  alpha: number
}

interface FloatLabel {
  el: HTMLDivElement
  x: number; y: number; z: number
  life: number
  maxLife: number
}

export class Effects {
  readonly group = new THREE.Group()
  private points: THREE.Points
  private geo = new THREE.BufferGeometry()
  private positions = new Float32Array(MAX_PARTICLES * 3)
  private sizes = new Float32Array(MAX_PARTICLES)
  private alphas = new Float32Array(MAX_PARTICLES)
  private colors = new Float32Array(MAX_PARTICLES * 3)
  private pool: Particle[] = []
  private cursor = 0

  private labels: FloatLabel[] = []
  private labelLayer: HTMLDivElement

  /** Reusable flickering lights assigned to the strongest fires. */
  private fireLights: THREE.PointLight[] = []

  constructor(uiRoot: HTMLElement) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.pool.push({
        alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        life: 0, maxLife: 1, size: 1, sizeEnd: 1,
        r: 1, g: 1, b: 1, r2: 1, g2: 1, b2: 1, drag: 0.5, gravity: 0, alpha: 1,
      })
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1))
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1))
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3))
    this.geo.setDrawRange(0, MAX_PARTICLES)
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 300)

    const mat = new THREE.ShaderMaterial({
      vertexShader: PART_VERT, fragmentShader: PART_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })
    this.points = new THREE.Points(this.geo, mat)
    this.points.frustumCulled = false
    this.points.renderOrder = 20
    this.group.add(this.points)

    for (let i = 0; i < 5; i++) {
      const l = new THREE.PointLight(0xff7a2a, 0, 11, 1.7)
      l.visible = false
      this.fireLights.push(l)
      this.group.add(l)
    }

    this.labelLayer = document.createElement('div')
    this.labelLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;'
    uiRoot.appendChild(this.labelLayer)
  }

  private spawn(): Particle {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.pool[this.cursor]
      this.cursor = (this.cursor + 1) % MAX_PARTICLES
      if (!p.alive) return p
    }
    return this.pool[this.cursor]
  }

  private emit(o: {
    x: number; y: number; z: number
    vx?: number; vy?: number; vz?: number
    life?: number; size?: number; sizeEnd?: number
    color?: number; colorEnd?: number
    drag?: number; gravity?: number; alpha?: number
  }) {
    const p = this.spawn()
    p.alive = true
    p.x = o.x; p.y = o.y; p.z = o.z
    p.vx = o.vx ?? 0; p.vy = o.vy ?? 0; p.vz = o.vz ?? 0
    p.maxLife = o.life ?? 1
    p.life = p.maxLife
    p.size = o.size ?? 8
    p.sizeEnd = o.sizeEnd ?? p.size
    const c = new THREE.Color(o.color ?? 0xffffff)
    p.r = c.r; p.g = c.g; p.b = c.b
    const c2 = new THREE.Color(o.colorEnd ?? o.color ?? 0xffffff)
    p.r2 = c2.r; p.g2 = c2.g; p.b2 = c2.b
    p.drag = o.drag ?? 0.6
    p.gravity = o.gravity ?? 0
    p.alpha = o.alpha ?? 1
  }

  // -------------------------------------------------------------- emitters

  /** Continuous flame column. `intensity` roughly 0.4 (embers) to 2.5 (inferno). */
  fire(x: number, y: number, z: number, intensity: number, dt: number) {
    const n = Math.min(14, Math.max(1, Math.round(intensity * 16 * dt * 60 / 60)))
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const r = Math.random() * 0.32 * intensity
      this.emit({
        x: x + Math.cos(a) * r, y: y + Math.random() * 0.16, z: z + Math.sin(a) * r,
        vx: Math.cos(a) * 0.22, vy: 1.5 + Math.random() * 1.5 * intensity, vz: Math.sin(a) * 0.22,
        life: 0.5 + Math.random() * 0.5,
        size: 16 + Math.random() * 16 * intensity, sizeEnd: 3,
        color: 0xfff0a0, colorEnd: 0xd8300a, drag: 1.4, alpha: 0.95,
      })
    }
    if (Math.random() < dt * 12 * intensity) {
      this.emit({
        x, y: y + 0.4, z,
        vx: (Math.random() - 0.5) * 0.5, vy: 1.1 + Math.random(), vz: (Math.random() - 0.5) * 0.5,
        life: 2.2 + Math.random() * 1.6,
        size: 22, sizeEnd: 90,
        color: 0x3a3230, colorEnd: 0x14100e, drag: 0.5, alpha: 0.24,
      })
    }
  }

  smoke(x: number, y: number, z: number, count = 4) {
    for (let i = 0; i < count; i++) {
      this.emit({
        x: x + (Math.random() - 0.5) * 0.3, y, z: z + (Math.random() - 0.5) * 0.3,
        vx: (Math.random() - 0.5) * 0.3, vy: 0.5 + Math.random() * 0.6, vz: (Math.random() - 0.5) * 0.3,
        life: 2 + Math.random() * 2, size: 16, sizeEnd: 70,
        color: 0x6a6a6a, colorEnd: 0x1a1a1a, drag: 0.55, alpha: 0.22,
      })
    }
  }

  spark(x: number, y: number, z: number, count = 12, color = 0xffee66) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2
      const s = 1.2 + Math.random() * 3.5
      this.emit({
        x, y, z,
        vx: Math.cos(a) * s, vy: 1 + Math.random() * 3.4, vz: Math.sin(a) * s,
        life: 0.35 + Math.random() * 0.55, size: 6 + Math.random() * 6, sizeEnd: 1,
        color: 0xffffff, colorEnd: color, drag: 1.1, gravity: -7,
      })
    }
  }

  splash(x: number, y: number, z: number) {
    for (let i = 0; i < 34; i++) {
      const a = Math.random() * Math.PI * 2
      const s = 0.6 + Math.random() * 2.6
      this.emit({
        x, y: y + 0.05, z,
        vx: Math.cos(a) * s, vy: 1.4 + Math.random() * 3, vz: Math.sin(a) * s,
        life: 0.5 + Math.random() * 0.6, size: 8 + Math.random() * 8, sizeEnd: 2,
        color: 0xcfeeff, colorEnd: 0x4aa9e8, drag: 0.9, gravity: -8.5, alpha: 0.85,
      })
    }
  }

  steam(x: number, y: number, z: number, count = 3) {
    for (let i = 0; i < count; i++) {
      this.emit({
        x: x + (Math.random() - 0.5) * 0.5, y, z: z + (Math.random() - 0.5) * 0.5,
        vx: 0, vy: 0.7 + Math.random() * 0.5, vz: 0,
        life: 1.6, size: 18, sizeEnd: 56,
        color: 0xffffff, colorEnd: 0xd8e4ee, drag: 0.6, alpha: 0.2,
      })
    }
  }

  frost(x: number, y: number, z: number, count = 4) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2
      this.emit({
        x: x + Math.cos(a) * 0.4, y: y + Math.random() * 1.4, z: z + Math.sin(a) * 0.4,
        vx: 0, vy: -0.35, vz: 0,
        life: 1.6, size: 5, sizeEnd: 2,
        color: 0xdff4ff, colorEnd: 0x88c8ff, drag: 0.3, alpha: 0.8,
      })
    }
  }

  flies(x: number, y: number, z: number, dt: number) {
    if (Math.random() > dt * 24) return
    const a = Math.random() * Math.PI * 2
    this.emit({
      x: x + Math.cos(a) * 0.4, y: y + 0.3 + Math.random() * 0.5, z: z + Math.sin(a) * 0.4,
      vx: (Math.random() - 0.5) * 1.2, vy: (Math.random() - 0.5) * 0.9, vz: (Math.random() - 0.5) * 1.2,
      life: 0.5, size: 3.5, sizeEnd: 3, color: 0x2a2a1a, colorEnd: 0x556622, drag: 0.4, alpha: 1,
    })
  }

  /** The plume that marks a death. */
  deathBurst(x: number, y: number, z: number, color: number) {
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2
      const s = Math.random() * 2.4
      this.emit({
        x, y: y + Math.random() * 1.4, z,
        vx: Math.cos(a) * s, vy: 1.5 + Math.random() * 4, vz: Math.sin(a) * s,
        life: 1.4 + Math.random() * 1.6, size: 12 + Math.random() * 18, sizeEnd: 2,
        color: 0xffffff, colorEnd: color, drag: 0.75, alpha: 0.9,
      })
    }
  }

  // -------------------------------------------------------------- labels

  floatText(x: number, y: number, z: number, text: string, color = '#ffffff') {
    const el = document.createElement('div')
    el.textContent = text
    el.style.cssText = `position:absolute;transform:translate(-50%,-50%);font:bold 15px 'Trebuchet MS',sans-serif;` +
      `color:${color};text-shadow:0 2px 6px rgba(0,0,0,.85);white-space:nowrap;will-change:transform,opacity;`
    this.labelLayer.appendChild(el)
    this.labels.push({ el, x, y, z, life: 2.1, maxLife: 2.1 })
  }

  // -------------------------------------------------------------- update

  private tmp = new THREE.Vector3()

  update(dt: number, camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement,
    fires: { x: number; y: number; z: number; intensity: number }[]) {
    const dtc = Math.min(dt, 0.05)
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.pool[i]
      if (!p.alive) { this.sizes[i] = 0; this.alphas[i] = 0; continue }
      p.life -= dtc
      if (p.life <= 0) { p.alive = false; this.sizes[i] = 0; this.alphas[i] = 0; continue }
      const k = 1 - p.life / p.maxLife
      const damp = Math.pow(1 - Math.min(0.95, p.drag * 0.5), dtc * 60 / 60)
      p.vy += p.gravity * dtc
      p.vx *= damp; p.vy *= damp; p.vz *= damp
      p.x += p.vx * dtc; p.y += p.vy * dtc; p.z += p.vz * dtc
      this.positions[i * 3] = p.x
      this.positions[i * 3 + 1] = p.y
      this.positions[i * 3 + 2] = p.z
      this.sizes[i] = p.size + (p.sizeEnd - p.size) * k
      this.alphas[i] = p.alpha * (1 - k * k)
      this.colors[i * 3] = p.r + (p.r2 - p.r) * k
      this.colors[i * 3 + 1] = p.g + (p.g2 - p.g) * k
      this.colors[i * 3 + 2] = p.b + (p.b2 - p.b) * k
    }
    this.geo.attributes.position.needsUpdate = true
    ;(this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true
    ;(this.geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true
    ;(this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true

    // fire lights follow the strongest fires
    const sorted = fires.slice().sort((a, b) => b.intensity - a.intensity)
    for (let i = 0; i < this.fireLights.length; i++) {
      const l = this.fireLights[i]
      const f = sorted[i]
      if (!f) { l.visible = false; continue }
      l.visible = true
      l.position.set(f.x, f.y + 0.7, f.z)
      l.intensity = (2.6 + Math.sin(performance.now() * 0.02 + i) * 0.9) * Math.min(2.4, f.intensity)
      l.distance = 8 + f.intensity * 5
    }

    // floating labels
    const rect = canvas.getBoundingClientRect()
    for (let i = this.labels.length - 1; i >= 0; i--) {
      const l = this.labels[i]
      l.life -= dt
      if (l.life <= 0) { l.el.remove(); this.labels.splice(i, 1); continue }
      const k = 1 - l.life / l.maxLife
      this.tmp.set(l.x, l.y + k * 1.1, l.z).project(camera)
      const sx = (this.tmp.x * 0.5 + 0.5) * rect.width
      const sy = (-this.tmp.y * 0.5 + 0.5) * rect.height
      const visible = this.tmp.z < 1
      l.el.style.opacity = visible ? String(Math.min(1, l.life * 1.6)) : '0'
      l.el.style.transform = `translate(-50%,-50%) translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) scale(${(1 + k * 0.25).toFixed(2)})`
    }
  }

  clearLabels() {
    for (const l of this.labels) l.el.remove()
    this.labels = []
  }

  dispose() {
    this.clearLabels()
    this.labelLayer.remove()
    this.geo.dispose()
    ;(this.points.material as THREE.Material).dispose()
    this.group.removeFromParent()
  }
}
