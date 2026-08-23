import * as THREE from 'three'

/** Small deterministic value-noise used by every procedural texture. */
function noise2(x: number, y: number, seed: number) {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453
  return s - Math.floor(s)
}
function fbm(x: number, y: number, seed: number, octaves = 4) {
  let v = 0, a = 0.5, f = 1
  for (let i = 0; i < octaves; i++) {
    const xi = Math.floor(x * f), yi = Math.floor(y * f)
    const xf = x * f - xi, yf = y * f - yi
    const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf)
    const n00 = noise2(xi, yi, seed + i), n10 = noise2(xi + 1, yi, seed + i)
    const n01 = noise2(xi, yi + 1, seed + i), n11 = noise2(xi + 1, yi + 1, seed + i)
    v += a * ((n00 * (1 - u) + n10 * u) * (1 - w) + (n01 * (1 - u) + n11 * u) * w)
    a *= 0.5; f *= 2
  }
  return v
}

function makeCanvas(size: number) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  return { c, g: c.getContext('2d')! }
}

function finish(c: HTMLCanvasElement, repeat: number, aniso = 8): THREE.Texture {
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat, repeat)
  t.anisotropy = aniso
  t.colorSpace = THREE.SRGBColorSpace
  t.needsUpdate = true
  return t
}

/**
 * Derives a tangent-space normal map from a colour canvas by treating its
 * luminance as a height field and running a Sobel filter over it. Costs one
 * pass at boot and gives every procedural surface real relief under lighting,
 * which is most of what separates "flat coloured shape" from "material".
 */
function normalFromCanvas(c: HTMLCanvasElement, strength: number, repeat: number): THREE.Texture {
  const g = c.getContext('2d')!
  const w = c.width, h = c.height
  const src = g.getImageData(0, 0, w, h).data
  const out = new Uint8Array(w * h * 4)
  const lum = (x: number, y: number) => {
    const xi = ((x % w) + w) % w
    const yi = ((y % h) + h) % h
    const i = (yi * w + xi) * 4
    return (src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114) / 255
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Sobel over the height field
      const tl = lum(x - 1, y - 1), t = lum(x, y - 1), tr = lum(x + 1, y - 1)
      const l = lum(x - 1, y), r = lum(x + 1, y)
      const bl = lum(x - 1, y + 1), b = lum(x, y + 1), br = lum(x + 1, y + 1)
      const dx = (tl + 2 * l + bl) - (tr + 2 * r + br)
      const dy = (tl + 2 * t + tr) - (bl + 2 * b + br)
      let nx = dx * strength, ny = dy * strength
      const nz = 1
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
      nx /= len; ny /= len
      const i = (y * w + x) * 4
      out[i] = (nx * 0.5 + 0.5) * 255
      out[i + 1] = (ny * 0.5 + 0.5) * 255
      out[i + 2] = (nz / len * 0.5 + 0.5) * 255
      out[i + 3] = 255
    }
  }
  const tex = new THREE.DataTexture(out, w, h, THREE.RGBAFormat)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(repeat, repeat)
  tex.anisotropy = 4
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return tex
}

/**
 * Roughness variation from the same luminance: darker parts of a texture read
 * as recessed grout, grain or pile, and those should scatter more light.
 */
function roughnessFromCanvas(c: HTMLCanvasElement, lo: number, hi: number, repeat: number): THREE.Texture {
  const g = c.getContext('2d')!
  const w = c.width, h = c.height
  const src = g.getImageData(0, 0, w, h).data
  const out = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const j = i * 4
    const v = (src[j] * 0.299 + src[j + 1] * 0.587 + src[j + 2] * 0.114) / 255
    const rough = (hi + (lo - hi) * v) * 255
    out[j] = 0
    out[j + 1] = rough      // three samples roughness from the green channel
    out[j + 2] = 0
    out[j + 3] = 255
  }
  const tex = new THREE.DataTexture(out, w, h, THREE.RGBAFormat)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(repeat, repeat)
  tex.anisotropy = 4
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.needsUpdate = true
  return tex
}

// ---------------------------------------------------------------- generators

function grassTexture(): HTMLCanvasElement {
  const S = 256
  const { c, g } = makeCanvas(S)
  const img = g.createImageData(S, S)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = fbm(x / 11, y / 11, 3, 4)
      const blade = noise2(x, y, 11)
      const v = n * 0.65 + blade * 0.35
      const i = (y * S + x) * 4
      img.data[i] = 42 + v * 52
      img.data[i + 1] = 84 + v * 74
      img.data[i + 2] = 34 + v * 40
      img.data[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  // scattered clover / dry patches
  for (let i = 0; i < 220; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 2 + Math.random() * 7
    g.fillStyle = `rgba(${90 + Math.random() * 60},${120 + Math.random() * 60},${50},${0.12 + Math.random() * 0.18})`
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill()
  }
  return c
}

function woodTexture(): HTMLCanvasElement {
  const S = 256
  const { c, g } = makeCanvas(S)
  g.fillStyle = '#8a5a34'; g.fillRect(0, 0, S, S)
  const planks = 4
  const ph = S / planks
  for (let p = 0; p < planks; p++) {
    const base = 108 + Math.random() * 40
    const off = Math.random() * 40
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < S; x++) {
        const grain = fbm((x + off) / 34, (p * 97 + y) / 3.2, 7, 3)
        const ring = Math.sin((x + off) * 0.06 + grain * 7) * 0.5 + 0.5
        const v = base + ring * 34 + grain * 22
        g.fillStyle = `rgb(${v | 0},${(v * 0.63) | 0},${(v * 0.36) | 0})`
        g.fillRect(x, p * ph + y, 1, 1)
      }
    }
    g.fillStyle = 'rgba(30,16,6,.5)'
    g.fillRect(0, p * ph, S, 1.4)
  }
  return c
}

function tileTexture(): HTMLCanvasElement {
  const S = 256
  const { c, g } = makeCanvas(S)
  const n = 4, ts = S / n
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = 214 + Math.random() * 26
      g.fillStyle = `rgb(${v | 0},${(v * 0.99) | 0},${(v * 0.95) | 0})`
      g.fillRect(i * ts, j * ts, ts - 1.5, ts - 1.5)
      // subtle speckle
      for (let k = 0; k < 40; k++) {
        g.fillStyle = `rgba(140,140,150,${Math.random() * 0.14})`
        g.fillRect(i * ts + Math.random() * ts, j * ts + Math.random() * ts, 1.5, 1.5)
      }
    }
  }
  g.fillStyle = '#b6b3ac'
  for (let i = 0; i <= n; i++) {
    g.fillRect(i * ts - 1.5, 0, 1.5, S)
    g.fillRect(0, i * ts - 1.5, S, 1.5)
  }
  return c
}

function carpetTexture(): HTMLCanvasElement {
  const S = 256
  const { c, g } = makeCanvas(S)
  const img = g.createImageData(S, S)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = fbm(x / 2.4, y / 2.4, 21, 2)
      const i = (y * S + x) * 4
      img.data[i] = 96 + n * 44
      img.data[i + 1] = 74 + n * 36
      img.data[i + 2] = 92 + n * 42
      img.data[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  return c
}

function concreteTexture(): HTMLCanvasElement {
  const S = 256
  const { c, g } = makeCanvas(S)
  const img = g.createImageData(S, S)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = fbm(x / 26, y / 26, 33, 5) * 0.7 + Math.random() * 0.3
      const v = 128 + n * 56
      const i = (y * S + x) * 4
      img.data[i] = img.data[i + 1] = v
      img.data[i + 2] = v * 1.02
      img.data[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  return c
}

function marbleTexture(): HTMLCanvasElement {
  const S = 256
  const { c, g } = makeCanvas(S)
  const img = g.createImageData(S, S)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = fbm(x / 40, y / 40, 5, 5)
      const veins = Math.abs(Math.sin((x * 0.03 + y * 0.017 + n * 5) * 3.2))
      const v = 232 - Math.pow(1 - veins, 12) * 130
      const i = (y * S + x) * 4
      img.data[i] = v; img.data[i + 1] = v * 0.99; img.data[i + 2] = v * 0.97
      img.data[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  return c
}

function plasterTexture(tint: [number, number, number]): HTMLCanvasElement {
  const S = 128
  const { c, g } = makeCanvas(S)
  const img = g.createImageData(S, S)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = fbm(x / 9, y / 9, 44, 3) * 0.4 + 0.75
      const i = (y * S + x) * 4
      img.data[i] = tint[0] * n; img.data[i + 1] = tint[1] * n; img.data[i + 2] = tint[2] * n
      img.data[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  return c
}

/**
 * Builds a full PBR material from one procedural canvas: colour, derived
 * normal relief and derived roughness variation, all from the same source.
 */
function surface(c: HTMLCanvasElement, o: {
  repeat: number
  roughness: number
  metalness?: number
  normalStrength?: number
  normalScale?: number
  roughLo?: number
  roughHi?: number
  color?: number
  anisotropy?: number
}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map: finish(c, o.repeat, o.anisotropy ?? 16),
    roughness: o.roughness,
    metalness: o.metalness ?? 0,
  })
  if (o.color !== undefined) mat.color.setHex(o.color)
  if (o.normalStrength) {
    mat.normalMap = normalFromCanvas(c, o.normalStrength, o.repeat)
    const n = o.normalScale ?? 1
    mat.normalScale = new THREE.Vector2(n, n)
  }
  if (o.roughLo !== undefined && o.roughHi !== undefined) {
    mat.roughnessMap = roughnessFromCanvas(c, o.roughLo, o.roughHi, o.repeat)
  }
  return mat
}

// ---------------------------------------------------------------- water shader

const WATER_VERT = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec3 vWorld;
varying float vWave;
void main() {
  vUv = uv;
  vec3 p = position;
  float w = sin(p.x * 2.1 + uTime * 1.6) * 0.024 + cos(p.y * 2.7 - uTime * 1.2) * 0.02
          + sin((p.x + p.y) * 4.3 + uTime * 2.4) * 0.010;
  p.z += w;
  vWave = w;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`

const WATER_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uShallow, uDeep, uSunDir, uSunColor;
uniform float uTurbid;
varying vec2 vUv;
varying vec3 vWorld;
varying float vWave;

float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1,0)), f.x), mix(h(i + vec2(0,1)), h(i + vec2(1,1)), f.x), f.y);
}

void main() {
  vec2 p = vWorld.xz;
  // animated caustic bands
  float c = n2(p * 2.4 + vec2(uTime * 0.22, -uTime * 0.16));
  c += n2(p * 5.1 - vec2(uTime * 0.31, uTime * 0.19)) * 0.5;
  c = pow(c / 1.5, 3.0);

  vec3 col = mix(uDeep, uShallow, clamp(vWave * 7.0 + 0.26, 0.0, 1.0));
  col = mix(col, vec3(0.42, 0.36, 0.28), uTurbid * 0.75);
  col += uSunColor * c * 0.22 * (1.0 - uTurbid * 0.7);

  // fresnel-ish rim toward the horizon
  vec3 v = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - clamp(v.y, 0.0, 1.0), 3.2);
  col = mix(col, uSunColor * 0.7, fres * 0.24);

  // specular glints
  vec3 nrm = normalize(vec3(-dFdx(vWave) * 22.0, 1.0, -dFdy(vWave) * 22.0));
  float spec = pow(max(dot(reflect(-normalize(uSunDir), nrm), v), 0.0), 40.0);
  col += uSunColor * spec * 0.7;

  gl_FragColor = vec4(col, 0.955);
}`

export class MaterialLibrary {
  floors: THREE.Material[] = []
  grass!: THREE.MeshStandardMaterial
  wallInner!: THREE.MeshStandardMaterial
  wallOuter!: THREE.MeshStandardMaterial
  wallTop!: THREE.MeshStandardMaterial
  poolWall!: THREE.MeshStandardMaterial
  water!: THREE.ShaderMaterial
  ghost!: THREE.MeshStandardMaterial
  invalid!: THREE.MeshStandardMaterial

  /** Shared palette so objects stay visually consistent. */
  readonly palette: Record<string, THREE.MeshStandardMaterial> = {}

  build() {
    this.grass = surface(grassTexture(), {
      repeat: 0.34, roughness: 0.95, normalStrength: 2.6, normalScale: 0.85,
      roughLo: 0.82, roughHi: 1.0,
    })

    this.floors[0] = this.grass
    this.floors[1] = surface(woodTexture(), {
      repeat: 1, roughness: 0.62, normalStrength: 3.4, normalScale: 0.7,
      roughLo: 0.42, roughHi: 0.78,
    })
    this.floors[2] = surface(tileTexture(), {
      repeat: 1, roughness: 0.32, normalStrength: 5.0, normalScale: 1.0,
      roughLo: 0.16, roughHi: 0.72,
    })
    this.floors[3] = surface(carpetTexture(), {
      repeat: 2, roughness: 0.98, normalStrength: 2.2, normalScale: 0.6,
      roughLo: 0.9, roughHi: 1.0, anisotropy: 8,
    })
    this.floors[4] = surface(concreteTexture(), {
      repeat: 1, roughness: 0.85, normalStrength: 2.4, normalScale: 0.8,
      roughLo: 0.7, roughHi: 0.95, anisotropy: 8,
    })
    this.floors[5] = surface(marbleTexture(), {
      repeat: 1, roughness: 0.18, metalness: 0.06, normalStrength: 1.2, normalScale: 0.35,
      roughLo: 0.1, roughHi: 0.34,
    })

    this.wallInner = surface(plasterTexture([228, 224, 214]), {
      repeat: 1, roughness: 0.9, normalStrength: 2.0, normalScale: 0.5, anisotropy: 8,
    })
    this.wallOuter = surface(plasterTexture([196, 186, 170]), {
      repeat: 1, roughness: 0.94, normalStrength: 2.4, normalScale: 0.6, anisotropy: 8,
    })
    this.wallTop = new THREE.MeshStandardMaterial({ color: 0xe6e2d8, roughness: 0.85 })
    this.poolWall = surface(tileTexture(), {
      repeat: 1, roughness: 0.28, normalStrength: 5.0, normalScale: 0.9, color: 0x6aa8c4,
      roughLo: 0.14, roughHi: 0.6,
    })

    this.water = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uShallow: { value: new THREE.Color(0x3fb6d8) },
        uDeep: { value: new THREE.Color(0x08405e) },
        uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
        uSunColor: { value: new THREE.Color(0xfff4e0) },
        uTurbid: { value: 0 },
      },
      vertexShader: WATER_VERT, fragmentShader: WATER_FRAG,
      transparent: true, side: THREE.DoubleSide, depthWrite: false,
    })

    this.ghost = new THREE.MeshStandardMaterial({
      color: 0x57e389, transparent: true, opacity: 0.44, emissive: 0x1c8a4a, emissiveIntensity: 0.6,
    })
    this.invalid = new THREE.MeshStandardMaterial({
      color: 0xff5c58, transparent: true, opacity: 0.44, emissive: 0x8a1c1c, emissiveIntensity: 0.6,
    })

    const p = (name: string, color: number, roughness: number, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) => {
      this.palette[name] = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra })
    }
    p('white', 0xf2f1ec, 0.55)
    p('porcelain', 0xfbfbf8, 0.16)
    p('cream', 0xe8ddc6, 0.7)
    p('wood', 0x8a5a34, 0.66)
    p('woodDark', 0x4e3320, 0.62)
    p('woodLight', 0xc09a6b, 0.7)
    p('steel', 0xb8bec6, 0.28, 0.85)
    p('chrome', 0xdfe6ee, 0.1, 0.95)
    p('black', 0x1b1d22, 0.42)
    p('screen', 0x0a0d14, 0.12, 0.4, { emissive: 0x0a1a30, emissiveIntensity: 0.5 })
    p('screenOn', 0x9fd4ff, 0.1, 0.2, { emissive: 0x4a9de0, emissiveIntensity: 1.6 })
    p('fabricBlue', 0x4a6fa5, 0.9)
    p('fabricRed', 0x9a4048, 0.9)
    p('fabricGreen', 0x4d7a56, 0.9)
    p('fabricCream', 0xd8cdb4, 0.92)
    p('leaf', 0x3f7d43, 0.85)
    p('leafDark', 0x2c5c31, 0.85)
    p('dirt', 0x4a3628, 0.96)
    p('terracotta', 0xa9552f, 0.85)
    p('gold', 0xd9a441, 0.3, 0.8)
    p('glass', 0xbfe0f0, 0.05, 0.1, { transparent: true, opacity: 0.34 })
    p('rubber', 0x30343c, 0.95)
    p('warn', 0xe0a23a, 0.6)
    p('flesh', 0xd8a882, 0.72)
    p('bone', 0xe8e2d0, 0.6)
    p('stone', 0x8d8c88, 0.88)
    p('grim', 0x18141f, 0.9)
    p('plumbob', 0x57e389, 0.2, 0, { emissive: 0x2ea55f, emissiveIntensity: 1.4 })
  }

  updateWater(time: number, sunDir: THREE.Vector3, sunColor: THREE.Color, turbidity: number) {
    const u = this.water.uniforms
    u.uTime.value = time
    ;(u.uSunDir.value as THREE.Vector3).copy(sunDir)
    ;(u.uSunColor.value as THREE.Color).copy(sunColor)
    u.uTurbid.value = turbidity
  }
}

export const mats = new MaterialLibrary()
