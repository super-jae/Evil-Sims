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

/** A grey-scale copy of a canvas, usable as a roughness or bump map. */
function toData(c: HTMLCanvasElement, repeat: number): THREE.Texture {
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat, repeat)
  t.anisotropy = 4
  t.needsUpdate = true
  return t
}

// ---------------------------------------------------------------- generators

function grassTexture(): { map: THREE.Texture; rough: THREE.Texture } {
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
  const { c: rc, g: rg } = makeCanvas(128)
  const rimg = rg.createImageData(128, 128)
  for (let i = 0; i < 128 * 128; i++) {
    const v = 190 + Math.random() * 55
    rimg.data[i * 4] = rimg.data[i * 4 + 1] = rimg.data[i * 4 + 2] = v
    rimg.data[i * 4 + 3] = 255
  }
  rg.putImageData(rimg, 0, 0)
  return { map: finish(c, 0.34, 16), rough: toData(rc, 0.34) }
}

function woodTexture(): THREE.Texture {
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
  return finish(c, 1, 16)
}

function tileTexture(): THREE.Texture {
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
  return finish(c, 1, 16)
}

function carpetTexture(): THREE.Texture {
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
  return finish(c, 2, 8)
}

function concreteTexture(): THREE.Texture {
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
  return finish(c, 1, 8)
}

function marbleTexture(): THREE.Texture {
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
  return finish(c, 1, 16)
}

function plasterTexture(tint: [number, number, number]): THREE.Texture {
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
  return finish(c, 1, 8)
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
    const g = grassTexture()
    this.grass = new THREE.MeshStandardMaterial({
      map: g.map, roughnessMap: g.rough, roughness: 0.95, metalness: 0,
    })

    const mk = (map: THREE.Texture, rough: number, metal = 0) =>
      new THREE.MeshStandardMaterial({ map, roughness: rough, metalness: metal })

    this.floors[0] = this.grass
    this.floors[1] = mk(woodTexture(), 0.62)
    this.floors[2] = mk(tileTexture(), 0.32)
    this.floors[3] = mk(carpetTexture(), 0.98)
    this.floors[4] = mk(concreteTexture(), 0.85)
    this.floors[5] = mk(marbleTexture(), 0.18, 0.06)

    this.wallInner = new THREE.MeshStandardMaterial({ map: plasterTexture([228, 224, 214]), roughness: 0.9 })
    this.wallOuter = new THREE.MeshStandardMaterial({ map: plasterTexture([196, 186, 170]), roughness: 0.94 })
    this.wallTop = new THREE.MeshStandardMaterial({ color: 0xe6e2d8, roughness: 0.85 })
    this.poolWall = new THREE.MeshStandardMaterial({ map: tileTexture(), roughness: 0.28, color: 0x6aa8c4 })

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
