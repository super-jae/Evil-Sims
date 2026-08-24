import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js'

/** Color keyframes for the day/night cycle, keyed by hour. */
interface SkyKey {
  hour: number
  top: THREE.Color
  bottom: THREE.Color
  sun: THREE.Color
  sunIntensity: number
  ambient: THREE.Color
  ambientIntensity: number
  fog: THREE.Color
}

const key = (
  hour: number, top: number, bottom: number, sun: number,
  sunIntensity: number, ambient: number, ambientIntensity: number, fog: number,
): SkyKey => ({
  hour,
  top: new THREE.Color(top), bottom: new THREE.Color(bottom), sun: new THREE.Color(sun),
  sunIntensity, ambient: new THREE.Color(ambient), ambientIntensity, fog: new THREE.Color(fog),
})

const SKY_KEYS: SkyKey[] = [
  key(0, 0x05060f, 0x0d1226, 0x4a5c99, 0.14, 0x2a3355, 0.42, 0x0a0e1e),
  key(5, 0x0d1430, 0x2a2244, 0x6a5a9a, 0.22, 0x35325e, 0.50, 0x151a30),
  key(7, 0x3a5a9c, 0xf0a878, 0xffc9a0, 1.30, 0x8f9cc4, 0.86, 0xc8a68e),
  key(10, 0x4f8ce0, 0xa8d0f5, 0xfff4e0, 2.10, 0xb2c8e4, 1.00, 0xc4dcf2),
  key(14, 0x3f7fd8, 0x9ecbf2, 0xfff8ec, 2.20, 0xb0c6e2, 1.02, 0xbfd8f0),
  key(18, 0x2f5aa8, 0xf7b071, 0xffb070, 1.25, 0x9c92bc, 0.80, 0xd0a488),
  key(20, 0x141a3c, 0x53356a, 0x9a6cb0, 0.42, 0x554a80, 0.58, 0x2a2242),
  key(22, 0x070912, 0x141a33, 0x5a6aa8, 0.18, 0x2e3760, 0.46, 0x0d1224),
  key(24, 0x05060f, 0x0d1226, 0x4a5c99, 0.14, 0x2a3355, 0.42, 0x0a0e1e),
]

const SKY_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop, uBottom, uSunColor;
uniform vec3 uSunDir;
uniform float uStars;
varying vec3 vWorld;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

void main() {
  vec3 dir = normalize(vWorld);
  float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(uBottom, uTop, pow(h, 0.72));

  // sun disc + halo
  float d = max(dot(dir, normalize(uSunDir)), 0.0);
  col += uSunColor * pow(d, 720.0) * 6.0;
  col += uSunColor * pow(d, 12.0) * 0.16;

  // stars fade in at night
  if (uStars > 0.001 && dir.y > 0.02) {
    vec3 g = floor(dir * 260.0);
    float s = hash(g);
    float tw = step(0.9975, s) * (0.55 + 0.45 * sin(s * 90.0));
    col += vec3(tw) * uStars * smoothstep(0.02, 0.35, dir.y);
  }
  gl_FragColor = vec4(col, 1.0);
}`


/**
 * Threshold bloom over an HDR buffer.
 *
 * The stock UnrealBloomPass ignored its threshold entirely against this
 * composer's half-float target — every lit surface bloomed to white no matter
 * how high the threshold went, which points at non-finite values reaching the
 * high-pass. This does the same job in three render targets at half resolution,
 * clamps the input so an Inf cannot poison the blur, and only lets genuinely
 * emissive things through: fire, screens, the plumbob, the sun.
 */
class BloomPass extends Pass {
  strength: number
  threshold: number

  private rtBright: THREE.WebGLRenderTarget
  private rtA: THREE.WebGLRenderTarget
  private rtB: THREE.WebGLRenderTarget
  private brightMat: THREE.ShaderMaterial
  private blurMat: THREE.ShaderMaterial
  private compositeMat: THREE.ShaderMaterial
  private fsq: FullScreenQuad

  constructor(width: number, height: number, strength = 0.8, threshold = 1.15) {
    super()
    this.strength = strength
    this.threshold = threshold
    const opts = { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false }
    const w = Math.max(1, Math.floor(width / 2))
    const h = Math.max(1, Math.floor(height / 2))
    this.rtBright = new THREE.WebGLRenderTarget(w, h, opts)
    this.rtA = new THREE.WebGLRenderTarget(w, h, opts)
    this.rtB = new THREE.WebGLRenderTarget(w, h, opts)

    const quadVert = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`

    this.brightMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uThreshold: { value: threshold } },
      vertexShader: quadVert,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float uThreshold;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tDiffuse, vUv).rgb;
          // hard clamp: keeps an Inf or a runaway highlight from smearing the
          // whole frame once it is blurred
          c = min(max(c, vec3(0.0)), vec3(48.0));
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          float contrib = max(0.0, l - uThreshold) / max(l, 1e-4);
          gl_FragColor = vec4(c * contrib, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    })

    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() } },
      vertexShader: quadVert,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform vec2 uDir;
        varying vec2 vUv;
        void main() {
          vec4 sum = texture2D(tDiffuse, vUv) * 0.2270270270;
          sum += texture2D(tDiffuse, vUv + uDir * 1.3846153846) * 0.3162162162;
          sum += texture2D(tDiffuse, vUv - uDir * 1.3846153846) * 0.3162162162;
          sum += texture2D(tDiffuse, vUv + uDir * 3.2307692308) * 0.0702702703;
          sum += texture2D(tDiffuse, vUv - uDir * 3.2307692308) * 0.0702702703;
          gl_FragColor = sum;
        }`,
      depthTest: false, depthWrite: false,
    })

    this.compositeMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null }, tBloom: { value: null },
        uStrength: { value: strength }, uDebug: { value: 0 },
      },
      vertexShader: quadVert,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform sampler2D tBloom;
        uniform float uStrength;
        uniform float uDebug;
        varying vec2 vUv;
        void main() {
          vec4 base = texture2D(tDiffuse, vUv);
          vec3 bloom = texture2D(tBloom, vUv).rgb;
          gl_FragColor = vec4(mix(base.rgb + bloom * uStrength, bloom, uDebug), base.a);
        }`,
      depthTest: false, depthWrite: false,
    })

    this.fsq = new FullScreenQuad(this.brightMat)
  }

  /** Renders only the bloom contribution, for diagnosing thresholds. */
  set debug(on: boolean) { this.compositeMat.uniforms.uDebug.value = on ? 1 : 0 }

  setSize(width: number, height: number) {
    const w = Math.max(1, Math.floor(width / 2))
    const h = Math.max(1, Math.floor(height / 2))
    this.rtBright.setSize(w, h)
    this.rtA.setSize(w, h)
    this.rtB.setSize(w, h)
  }

  private draw(renderer: THREE.WebGLRenderer, mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) {
    this.fsq.material = mat
    renderer.setRenderTarget(target)
    // EffectComposer turns autoClear off, so be explicit
    if (target) renderer.clear(true, false, false)
    this.fsq.render(renderer)
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget) {
    const w = this.rtBright.width, h = this.rtBright.height

    this.brightMat.uniforms.tDiffuse.value = readBuffer.texture
    this.brightMat.uniforms.uThreshold.value = this.threshold
    this.draw(renderer, this.brightMat, this.rtBright)

    // two separable passes, widening on the second for a softer falloff
    let src: THREE.WebGLRenderTarget = this.rtBright
    for (const scale of [1, 2.4]) {
      ;(this.blurMat.uniforms.uDir.value as THREE.Vector2).set(scale / w, 0)
      this.blurMat.uniforms.tDiffuse.value = src.texture
      this.draw(renderer, this.blurMat, this.rtA)
      ;(this.blurMat.uniforms.uDir.value as THREE.Vector2).set(0, scale / h)
      this.blurMat.uniforms.tDiffuse.value = this.rtA.texture
      this.draw(renderer, this.blurMat, this.rtB)
      src = this.rtB
    }

    this.compositeMat.uniforms.tDiffuse.value = readBuffer.texture
    this.compositeMat.uniforms.tBloom.value = src.texture
    this.compositeMat.uniforms.uStrength.value = this.strength
    this.draw(renderer, this.compositeMat, this.renderToScreen ? null : writeBuffer)
  }

  dispose() {
    this.rtBright.dispose(); this.rtA.dispose(); this.rtB.dispose()
    this.brightMat.dispose(); this.blurMat.dispose(); this.compositeMat.dispose()
    this.fsq.dispose()
  }
}

/**
 * Separable tilt-shift blur. Sharpness is a horizontal band on screen and
 * everything above and below it defocuses, which is what gives the Sims its
 * dollhouse feel. Screen-space rather than depth-based, so it costs one extra
 * texture read pass and needs no depth buffer.
 */
const TiltShiftShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uDir: { value: new THREE.Vector2(1 / 1024, 0) },
    uAmount: { value: 3.0 },
    uFocus: { value: 0.55 },
    uRange: { value: 0.22 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uDir;
    uniform float uAmount, uFocus, uRange;
    varying vec2 vUv;
    void main() {
      float d = abs(vUv.y - uFocus);
      float coc = clamp((d - uRange) / max(0.0001, 1.0 - uRange), 0.0, 1.0);
      float r = pow(coc, 1.5) * uAmount;
      if (r < 0.3) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
      vec2 s = uDir * r;
      // 5-tap linear-sampled gaussian
      vec4 sum = texture2D(tDiffuse, vUv) * 0.2270270270;
      sum += texture2D(tDiffuse, vUv + s * 1.3846153846) * 0.3162162162;
      sum += texture2D(tDiffuse, vUv - s * 1.3846153846) * 0.3162162162;
      sum += texture2D(tDiffuse, vUv + s * 3.2307692308) * 0.0702702703;
      sum += texture2D(tDiffuse, vUv - s * 3.2307692308) * 0.0702702703;
      gl_FragColor = sum;
    }`,
}

/** Cheap vignette + subtle chromatic warmth applied after bloom. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVignette: { value: 0.40 },
    uHeat: { value: 0.0 },
    uDesat: { value: 0.0 },
    uTime: { value: 0.0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette, uHeat, uDesat, uTime;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      // heat-shimmer when the lot is on fire
      if (uHeat > 0.001) {
        uv.x += sin(uv.y * 90.0 + uTime * 7.0) * 0.0016 * uHeat;
        uv.y += cos(uv.x * 70.0 + uTime * 5.5) * 0.0012 * uHeat;
      }
      vec4 c = texture2D(tDiffuse, uv);
      c.rgb = mix(c.rgb, c.rgb * vec3(1.16, 0.86, 0.72), uHeat * 0.55);
      if (uDesat > 0.001) {
        float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
        c.rgb = mix(c.rgb, vec3(l) * vec3(0.92, 0.9, 1.05), uDesat);
      }
      vec2 p = vUv - 0.5;
      float v = 1.0 - dot(p, p) * uVignette;
      c.rgb *= clamp(v, 0.0, 1.0);
      gl_FragColor = c;
    }`,
}

export class Engine {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly composer: EffectComposer
  readonly sun: THREE.DirectionalLight
  readonly ambient: THREE.HemisphereLight
  readonly clock = new THREE.Clock()

  private skyMat!: THREE.ShaderMaterial
  private grade!: ShaderPass
  private bloom!: BloomPass
  private gtao!: GTAOPass
  private tiltH!: ShaderPass
  private tiltV!: ShaderPass
  private smaa!: SMAAPass
  /** Unit vector pointing from the lot toward the sun. */
  private sunDir = new THREE.Vector3(0.4, 0.8, 0.3)
  private shadowHalf = 24
  private fillLight: THREE.DirectionalLight
  private moon: THREE.DirectionalLight
  private canvas: HTMLCanvasElement
  private pixelRatioCap = 2

  /** 0..1 — how much of the lot is currently ablaze; drives the heat shimmer. */
  heat = 0
  /** 0..1 — drains color out of the world during a death sequence. */
  desat = 0

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, powerPreference: 'high-performance', stencil: false,
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.pixelRatioCap))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.32
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 500)
    this.camera.position.set(24, 22, 24)

    this.scene.fog = new THREE.Fog(0xbfd8f0, 60, 190)

    // --- sky dome ---
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color(0x4f8ce0) },
        uBottom: { value: new THREE.Color(0xa8d0f5) },
        uSunColor: { value: new THREE.Color(0xfff4e0) },
        uSunDir: { value: new THREE.Vector3(0.5, 0.6, 0.3) },
        uStars: { value: 0 },
      },
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      side: THREE.BackSide, depthWrite: false, fog: false,
    })
    const sky = new THREE.Mesh(new THREE.SphereGeometry(240, 40, 24), this.skyMat)
    sky.frustumCulled = false
    sky.renderOrder = -1000
    this.scene.add(sky)

    // --- lights ---
    this.sun = new THREE.DirectionalLight(0xfff4e0, 1.5)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(3072, 3072)
    this.sun.shadow.camera.near = 1
    this.sun.shadow.camera.far = 200
    this.sun.shadow.bias = -0.00035
    this.sun.shadow.normalBias = 0.022
    this.sun.shadow.radius = 1.6
    this.setShadowFocus(0, 0, 26)
    this.scene.add(this.sun, this.sun.target)

    this.ambient = new THREE.HemisphereLight(0xb2c8e4, 0x5d564a, 1.0)
    this.scene.add(this.ambient)

    // soft bounce from the opposite side so interiors never go pitch black
    this.fillLight = new THREE.DirectionalLight(0xa8c0e8, 0.3)
    this.fillLight.position.set(-18, 14, -12)
    this.scene.add(this.fillLight)

    this.moon = new THREE.DirectionalLight(0x8fa4e8, 0)
    this.moon.position.set(-20, 30, -18)
    this.scene.add(this.moon)

    // --- post processing ---
    const size = new THREE.Vector2()
    this.renderer.getSize(size)
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      // No MSAA here on purpose: an unresolved multisample target fed garbage
      // to the bloom's bright pass wherever geometry was small and detailed,
      // which blew every sim out to white. SMAA at the end of the chain does
      // the anti-aliasing instead.
      type: THREE.HalfFloatType, samples: 0, colorSpace: THREE.LinearSRGBColorSpace,
    })
    this.composer = new EffectComposer(this.renderer, rt)
    this.composer.addPass(new RenderPass(this.scene, this.camera))

    // Ground-contact ambient occlusion. Without this everything reads as
    // floating; it is the single largest perceived-quality win available.
    this.gtao = new GTAOPass(this.scene, this.camera, size.x, size.y)
    this.gtao.blendIntensity = 0.85
    this.gtao.updateGtaoMaterial({
      radius: 0.42, distanceExponent: 1.6, thickness: 0.55,
      distanceFallOff: 1.0, scale: 1.1, samples: 16,
    })
    this.gtao.updatePdMaterial({ lumaPhi: 8, depthPhi: 2, normalPhi: 4, radius: 3, rings: 2, samples: 12 })
    this.composer.addPass(this.gtao)

    // Runs on the linear HDR buffer, before tone mapping, so the threshold sits
    // above ordinary sunlit diffuse and only emissive things glow.
    this.bloom = new BloomPass(size.x, size.y, 0.7, 2.6)
    this.composer.addPass(this.bloom)
    this.grade = new ShaderPass(GradeShader)
    this.composer.addPass(this.grade)

    // two passes so the blur is separable; each needs its own uniform set
    const tilt = () => new ShaderPass({
      ...TiltShiftShader,
      uniforms: THREE.UniformsUtils.clone(TiltShiftShader.uniforms),
    })
    this.tiltH = tilt()
    this.tiltV = tilt()
    this.composer.addPass(this.tiltH)
    this.composer.addPass(this.tiltV)
    this.setTiltShift(3.0)

    this.composer.addPass(new OutputPass())

    this.smaa = new SMAAPass(size.x, size.y)
    this.composer.addPass(this.smaa)

    this.resize()
    window.addEventListener('resize', () => this.resize())
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.pixelRatioCap))
    this.renderer.setSize(w, h, false)
    this.composer.setSize(w, h)
    this.bloom?.setSize(w, h)
    this.gtao?.setSize(w, h)
    if (this.tiltH) {
      ;(this.tiltH.uniforms.uDir.value as THREE.Vector2).set(1 / w, 0)
      ;(this.tiltV.uniforms.uDir.value as THREE.Vector2).set(0, 1 / h)
    }
  }

  /**
   * Reduce resolution and drop effects when the frame budget is blown.
   *
   * Every threshold here is hysteretic: an effect needs a clearly better score
   * to come back than the one that dropped it. With a single threshold each,
   * a machine sitting near the boundary flipped ambient occlusion, anti-aliasing
   * and defocus on and off every second or so, and each flip reallocated the
   * render targets — which is what the visible blinking was.
   */
  setQualityScale(scale: number) {
    if (scale >= 0.90) this.gtao.enabled = true
    else if (scale <= 0.78) this.gtao.enabled = false

    if (scale >= 0.86) this.smaa.enabled = true
    else if (scale <= 0.72) this.smaa.enabled = false

    if (scale >= 0.84) this.tiltH.enabled = this.tiltV.enabled = true
    else if (scale <= 0.70) this.tiltH.enabled = this.tiltV.enabled = false

    const target = Math.max(0.7, Math.min(2, window.devicePixelRatio * scale))
    // reallocating every render target is itself a visible hitch, so only do it
    // for a change big enough to be worth it
    if (Math.abs(target - this.pixelRatioCap) < 0.1) return
    this.pixelRatioCap = target
    this.resize()
  }

  /**
   * Aims the shadow frustum at what the camera is looking at and shrinks it as
   * you zoom in, so a fixed shadow map buys far more texels per meter. The
   * focus is snapped to the texel grid to stop shadow edges crawling as the
   * camera moves.
   */
  setShadowFocus(x: number, z: number, cameraDistance: number) {
    const half = THREE.MathUtils.clamp(cameraDistance * 0.62, 11, 30)
    this.shadowHalf = half
    const cam = this.sun.shadow.camera
    cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half
    cam.updateProjectionMatrix()

    const texel = (half * 2) / this.sun.shadow.mapSize.x
    const sx = Math.round(x / texel) * texel
    const sz = Math.round(z / texel) * texel
    this.sun.target.position.set(sx, 0, sz)
    this.sun.target.updateMatrixWorld()
    this.sun.position.copy(this.sunDir).multiplyScalar(70).add(this.sun.target.position)
  }

  setAOEnabled(on: boolean) { this.gtao.enabled = on }

  /**
   * `amount` is the maximum blur radius in pixels; `focus` and `range` are the
   * center and half-height of the sharp band in normalized screen space.
   */
  setTiltShift(amount: number, focus = 0.56, range = 0.2) {
    for (const p of [this.tiltH, this.tiltV]) {
      p.uniforms.uAmount.value = amount
      p.uniforms.uFocus.value = focus
      p.uniforms.uRange.value = range
      p.enabled = amount > 0.05
    }
  }

  /** Blend the sky, sun and ambient lighting to match the in-game hour. */
  setTimeOfDay(hour: number) {
    const h = ((hour % 24) + 24) % 24
    let a = SKY_KEYS[0], b = SKY_KEYS[SKY_KEYS.length - 1]
    for (let i = 0; i < SKY_KEYS.length - 1; i++) {
      if (h >= SKY_KEYS[i].hour && h <= SKY_KEYS[i + 1].hour) { a = SKY_KEYS[i]; b = SKY_KEYS[i + 1]; break }
    }
    const t = b.hour === a.hour ? 0 : (h - a.hour) / (b.hour - a.hour)
    const u = this.skyMat.uniforms
    ;(u.uTop.value as THREE.Color).copy(a.top).lerp(b.top, t)
    ;(u.uBottom.value as THREE.Color).copy(a.bottom).lerp(b.bottom, t)
    ;(u.uSunColor.value as THREE.Color).copy(a.sun).lerp(b.sun, t)
    u.uStars.value = THREE.MathUtils.clamp(1 - Math.sin(((h - 5) / 14) * Math.PI) * 2.4, 0, 1)

    // sun arcs east -> west, peaking at noon
    const ang = ((h - 6) / 12) * Math.PI
    const elev = Math.sin(ang)
    this.sunDir.set(Math.cos(ang) * 34, Math.max(elev, -0.4) * 42, 14 + Math.cos(ang) * 6).normalize()
    this.sun.position.copy(this.sunDir).multiplyScalar(70).add(this.sun.target.position)
    ;(u.uSunDir.value as THREE.Vector3).copy(this.sunDir)

    this.sun.color.copy(a.sun).lerp(b.sun, t)
    this.sun.intensity = THREE.MathUtils.lerp(a.sunIntensity, b.sunIntensity, t)
    this.ambient.color.copy(a.ambient).lerp(b.ambient, t)
    this.ambient.intensity = THREE.MathUtils.lerp(a.ambientIntensity, b.ambientIntensity, t)
    this.moon.intensity = u.uStars.value * 0.30
    this.fillLight.intensity = 0.16 + this.sun.intensity * 0.14

    const fogCol = a.fog.clone().lerp(b.fog, t)
    ;(this.scene.fog as THREE.Fog).color.copy(fogCol)
  }

  render(dt: number) {
    const g = this.grade.uniforms
    g.uHeat.value += (this.heat - g.uHeat.value) * Math.min(1, dt * 2)
    g.uDesat.value += (this.desat - g.uDesat.value) * Math.min(1, dt * 3)
    g.uTime.value += dt
    this.bloom.strength = 0.7 + this.heat * 1.1
    this.composer.render(dt)
  }
}
