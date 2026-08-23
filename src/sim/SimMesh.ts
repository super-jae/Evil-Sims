import * as THREE from 'three'
import type { AnimName } from '../world/ObjectTypes'

export interface SimLook {
  skin: number
  hair: number
  hairStyle: 0 | 1 | 2 | 3
  shirt: number
  pants: number
  shoes: number
  height: number
  build: number
}

export const SKIN_TONES = [0xf2d3b6, 0xe8bd97, 0xd9a476, 0xbb8154, 0x8d5a36, 0x64402a, 0xf7dfc8, 0xa8724a]
// naturals repeated so dye jobs stay the exception rather than the rule
export const HAIR_COLORS = [
  0x241a12, 0x241a12, 0x36261a, 0x4a2f1c, 0x4a2f1c, 0x7a4a22,
  0x9c6b34, 0xc4a05a, 0xe8d9a8, 0x8a8a8a, 0xb9b4ad, 0xd44a6a, 0x3a6ad4,
]
export const CLOTH_COLORS = [
  0x4a6fa5, 0x9a4048, 0x4d7a56, 0xd8a03a, 0x6a4a8a, 0x2e2e38,
  0xd8cdb4, 0x3a8a8a, 0xc4547a, 0x7a5a3a, 0x5a7ad4, 0xa8483a,
]

const mat = (color: number, rough = 0.8, metal = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal })

/**
 * Skin needs light to bleed around the terminator, otherwise faces read as
 * painted plastic. This patches the standard direct-lighting term with a
 * wrapped N.L plus a warm scattering lobe near grazing angles — the cheap
 * stand-in for subsurface scattering that stylised characters actually want.
 */
function skinMaterial(color: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.66, metalness: 0 })
  m.onBeforeCompile = (shader) => {
    // onBeforeCompile hands over the shader with #include directives still
    // unresolved, so patch the chunk source and inline it.
    const chunk = THREE.ShaderChunk.lights_physical_pars_fragment
    const patched = chunk.replace(
      /float dotNL = saturate\( dot\( geometryNormal, directLight\.direction \) \);\s*vec3 irradiance = dotNL \* directLight\.color;/,
      `float rawNL = dot( geometryNormal, directLight.direction );
        float dotNL = saturate( ( rawNL + 0.42 ) / 1.42 );
        vec3 scatter = vec3( 0.55, 0.17, 0.11 ) * pow( saturate( 1.0 - abs( rawNL ) ), 2.0 ) * 0.5;
        vec3 irradiance = ( dotNL + scatter ) * directLight.color;`,
    )
    if (patched === chunk) {
      console.warn('skinMaterial: lighting chunk did not match; skin shading is inactive')
      return
    }
    const before = shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_physical_pars_fragment>', patched)
    if (shader.fragmentShader === before) {
      console.warn('skinMaterial: could not inline the lighting chunk; skin shading is inactive')
    }
  }
  m.customProgramCacheKey = () => 'evilsims-skin'
  return m
}

export type Expression =
  | 'neutral' | 'happy' | 'sad' | 'angry' | 'scared' | 'tired' | 'laugh' | 'dead'

interface FacePose {
  /** Brow height offset in meters. */
  brow: number
  /** Inner-brow tilt; positive raises the inner ends (sadness). */
  browTilt: number
  /** 0 = wide open, 1 = fully closed. Negative widens the eyes. */
  squint: number
  /** -1 = deep frown, +1 = broad smile. */
  smile: number
  /** Mouth openness. */
  open: number
}

const EXPRESSIONS: Record<Expression, FacePose> = {
  neutral: { brow: 0, browTilt: 0, squint: 0, smile: 0.12, open: 0 },
  happy: { brow: 0.010, browTilt: 0.05, squint: 0.28, smile: 1.0, open: 0.12 },
  sad: { brow: 0.006, browTilt: 0.42, squint: 0.12, smile: -0.85, open: 0 },
  angry: { brow: -0.012, browTilt: -0.55, squint: 0.42, smile: -0.55, open: 0.1 },
  scared: { brow: 0.016, browTilt: 0.22, squint: -0.45, smile: -0.35, open: 0.62 },
  tired: { brow: -0.004, browTilt: 0.18, squint: 0.58, smile: -0.28, open: 0.06 },
  laugh: { brow: 0.012, browTilt: 0.05, squint: 0.72, smile: 1.0, open: 0.8 },
  dead: { brow: 0, browTilt: 0, squint: 0.92, smile: -0.2, open: 0.22 },
}

interface Joint { obj: THREE.Object3D; base: THREE.Euler }

/** A pose is a sparse map of joint name -> [x, y, z] euler in radians. */
type Pose = Record<string, [number, number, number]>

export class SimAvatar {
  readonly root = new THREE.Group()
  /** Everything below the root that should sway/bob as one. */
  private body = new THREE.Group()
  private joints: Record<string, Joint> = {}
  private current: Record<string, THREE.Euler> = {}
  private materials: THREE.MeshStandardMaterial[] = []
  private headGroup!: THREE.Group
  private eyeL!: THREE.Mesh
  private eyeR!: THREE.Mesh
  private browL!: THREE.Mesh
  private browR!: THREE.Mesh
  private mouthArc!: THREE.Mesh
  private mouthOpen!: THREE.Mesh
  private jaw!: THREE.Mesh
  private browBaseY = 0
  private jawBaseY = 0
  private face: FacePose = { ...EXPRESSIONS.neutral }
  private faceGoal: FacePose = { ...EXPRESSIONS.neutral }
  /** Extra mouth opening layered on top of the expression (talking, eating). */
  private mouthDrive = 0
  private plumbob!: THREE.Mesh
  private ghostMode = false

  private phase = Math.random() * 10
  /**
   * Walk cycle position, advanced by distance traveled rather than by time,
   * so feet stay planted instead of skating when the sim's speed changes.
   */
  private gait = Math.random() * 10
  private blinkTimer = Math.random() * 4
  /** Vertical offset applied by the current animation (crouching, sitting, swimming). */
  private yOffset = 0
  private yOffsetTarget = 0
  private lean = 0
  private leanTarget = 0

  readonly look: SimLook

  constructor(look: SimLook) {
    this.look = look
    this.root.add(this.body)
    this.build()
  }

  private addJoint(name: string, parent: THREE.Object3D, x: number, y: number, z: number) {
    const j = new THREE.Group()
    j.position.set(x, y, z)
    parent.add(j)
    this.joints[name] = { obj: j, base: j.rotation.clone() }
    this.current[name] = new THREE.Euler(0, 0, 0)
    return j
  }

  private limb(parent: THREE.Object3D, len: number, r: number, m: THREE.Material, taper = 0.86) {
    const geo = new THREE.CapsuleGeometry(r, Math.max(0.001, len - r * 2), 6, 14)
    const mesh = new THREE.Mesh(geo, m)
    mesh.position.y = -len / 2
    mesh.scale.z = taper
    mesh.castShadow = true
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }

  private build() {
    const L = this.look
    const s = L.height
    const skinM = skinMaterial(L.skin)
    const hairM = mat(L.hair, 0.72)
    const shirtM = mat(L.shirt, 0.88)
    const pantsM = mat(L.pants, 0.9)
    const shoeM = mat(L.shoes, 0.55)
    const eyeWhiteM = mat(0xffffff, 0.3)
    const eyeM = mat(0x1a1a22, 0.25)
    this.materials.push(skinM, hairM, shirtM, pantsM, shoeM, eyeWhiteM, eyeM)

    const bw = 1 + L.build * 0.22

    // hips ------------------------------------------------------------------
    const hips = this.addJoint('hips', this.body, 0, 0.88 * s, 0)
    const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.13 * bw, 0.1, 6, 16), pantsM)
    pelvis.scale.z = 0.72
    pelvis.castShadow = true
    hips.add(pelvis)

    // torso -----------------------------------------------------------------
    const spine = this.addJoint('spine', hips, 0, 0.06 * s, 0)
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.155 * bw, 0.3 * s, 6, 18), shirtM)
    torso.position.y = 0.22 * s
    torso.scale.set(1, 1, 0.66)
    torso.castShadow = true
    torso.receiveShadow = true
    spine.add(torso)
    // collar
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.05, 16), shirtM)
    collar.position.y = 0.44 * s
    spine.add(collar)

    // head ------------------------------------------------------------------
    const neck = this.addJoint('neck', spine, 0, 0.44 * s, 0)
    const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.07, 14), skinM)
    neckMesh.position.y = 0.03
    neck.add(neckMesh)

    const head = this.addJoint('head', neck, 0, 0.08 * s, 0)
    this.headGroup = head as THREE.Group
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.135, 26, 20), skinM)
    skull.scale.set(0.94, 1.08, 0.98)
    skull.position.y = 0.1
    skull.castShadow = true
    head.add(skull)
    const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), skinM)
    jaw.scale.set(0.88, 0.7, 0.9)
    jaw.position.set(0, 0.035, 0.022)
    jaw.castShadow = true
    head.add(jaw)
    this.jaw = jaw
    this.jawBaseY = jaw.position.y

    // ears
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6), skinM)
      ear.scale.set(0.5, 1, 0.7)
      ear.position.set(sx * 0.125, 0.095, -0.005)
      head.add(ear)
    }

    // eyes
    const mkEye = (sx: number) => {
      const g = new THREE.Group()
      const white = new THREE.Mesh(new THREE.SphereGeometry(0.034, 12, 10), eyeWhiteM)
      white.scale.set(1, 0.86, 0.6)
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), eyeM)
      pupil.position.z = 0.024
      g.add(white, pupil)
      g.position.set(sx * 0.056, 0.105, 0.104)
      head.add(g)
      return white
    }
    this.eyeL = mkEye(-1)
    this.eyeR = mkEye(1)

    // brows — driven by expression, so keep handles on them
    const mkBrow = (sx: number) => {
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.012, 0.013), hairM)
      brow.position.set(sx * 0.056, 0.15, 0.112)
      brow.rotation.z = sx * 0.12
      head.add(brow)
      return brow
    }
    this.browL = mkBrow(-1)
    this.browR = mkBrow(1)
    this.browBaseY = this.browL.position.y

    // nose + mouth
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.05, 8), skinM)
    nose.rotation.x = Math.PI / 2
    nose.position.set(0, 0.075, 0.128)
    head.add(nose)
    // Mouth is a torus arc so it can genuinely curve into a smile or a frown,
    // plus a dark ellipsoid behind it for openness.
    const lipM = mat(0x8a4a52, 0.5)
    this.mouthOpen = new THREE.Mesh(new THREE.SphereGeometry(0.034, 14, 10), mat(0x40222a, 0.7))
    this.mouthOpen.position.set(0, 0.026, 0.108)
    this.mouthOpen.scale.set(1, 0.05, 0.5)
    head.add(this.mouthOpen)
    this.mouthArc = new THREE.Mesh(
      new THREE.TorusGeometry(0.042, 0.0092, 6, 16, Math.PI), lipM)
    this.mouthArc.position.set(0, 0.03, 0.113)
    head.add(this.mouthArc)

    // hair
    switch (L.hairStyle) {
      case 0: { // short crop
        const h = new THREE.Mesh(new THREE.SphereGeometry(0.144, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.58), hairM)
        h.position.set(0, 0.1, -0.006); h.scale.set(0.98, 1.12, 1.02); h.castShadow = true
        head.add(h); break
      }
      case 1: { // bob
        const h = new THREE.Mesh(new THREE.SphereGeometry(0.155, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.78), hairM)
        h.position.y = 0.098; h.scale.set(1.0, 1.1, 1.02); h.castShadow = true
        head.add(h)
        for (const sx of [-1, 1]) {
          const side = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.14, 4, 8), hairM)
          side.position.set(sx * 0.125, 0.03, -0.01)
          head.add(side)
        }
        break
      }
      case 2: { // tall / afro — sits on the skull rather than swallowing it
        const h = new THREE.Mesh(new THREE.SphereGeometry(0.152, 20, 16), hairM)
        h.position.set(0, 0.148, -0.012)
        h.scale.set(1.06, 1.0, 1.04)
        h.castShadow = true
        head.add(h)
        const back = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), hairM)
        back.position.set(0, 0.06, -0.05)
        back.scale.set(1.0, 0.9, 0.8)
        head.add(back)
        break
      }
      default: { // bald with a fringe of dignity
        const h = new THREE.Mesh(new THREE.TorusGeometry(0.118, 0.026, 6, 18), hairM)
        h.rotation.x = Math.PI / 2
        h.position.y = 0.055
        head.add(h); break
      }
    }

    // arms ------------------------------------------------------------------
    for (const side of ['L', 'R'] as const) {
      const sx = side === 'L' ? -1 : 1
      const shoulder = this.addJoint(`arm${side}`, spine, sx * 0.175 * bw, 0.4 * s, 0)
      this.limb(shoulder, 0.28 * s, 0.048, shirtM)
      const elbow = this.addJoint(`fore${side}`, shoulder, 0, -0.28 * s, 0)
      this.limb(elbow, 0.26 * s, 0.042, skinM)
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), skinM)
      hand.scale.set(0.8, 1.1, 0.6)
      hand.position.y = -0.27 * s
      hand.castShadow = true
      elbow.add(hand)
    }

    // legs ------------------------------------------------------------------
    for (const side of ['L', 'R'] as const) {
      const sx = side === 'L' ? -1 : 1
      const hip = this.addJoint(`leg${side}`, hips, sx * 0.075 * bw, -0.02, 0)
      this.limb(hip, 0.44 * s, 0.062, pantsM)
      const knee = this.addJoint(`shin${side}`, hip, 0, -0.44 * s, 0)
      this.limb(knee, 0.4 * s, 0.05, pantsM)
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.06, 0.19), shoeM)
      foot.position.set(0, -0.4 * s + 0.02, 0.045)
      foot.castShadow = true
      knee.add(foot)
    }

    // plumbob ---------------------------------------------------------------
    const pb = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.11),
      new THREE.MeshStandardMaterial({
        color: 0x57e389, emissive: 0x2ea55f, emissiveIntensity: 1.6,
        roughness: 0.15, transparent: true, opacity: 0.92,
      }),
    )
    pb.scale.set(1, 1.7, 1)
    pb.position.y = 1.72 * s + 0.28
    pb.visible = false
    this.root.add(pb)
    this.plumbob = pb
  }

  setSelected(on: boolean) { this.plumbob.visible = on }

  setPlumbobColor(hex: string) {
    const m = this.plumbob.material as THREE.MeshStandardMaterial
    m.color.set(hex)
    m.emissive.set(hex)
  }

  setGhost(on: boolean) {
    if (this.ghostMode === on) return
    this.ghostMode = on
    this.root.traverse((c) => {
      const m = c as THREE.Mesh
      if (!m.isMesh) return
      const mm = m.material as THREE.MeshStandardMaterial
      if (!mm || !mm.isMeshStandardMaterial) return
      mm.transparent = on
      mm.opacity = on ? 0.36 : 1
      mm.emissive.setHex(on ? 0x2a5a8a : 0x000000)
      mm.emissiveIntensity = on ? 0.9 : 0
      mm.depthWrite = !on
    })
    this.plumbob.visible = false
  }

  /** Tint the whole sim, e.g. charred black or hypothermic blue. */
  tint(color: number | null, amount = 1) {
    this.root.traverse((c) => {
      const m = c as THREE.Mesh
      if (!m.isMesh) return
      const mm = m.material as THREE.MeshStandardMaterial
      if (!mm || !mm.isMeshStandardMaterial) return
      if (color === null) { mm.emissive.setHex(0x000000); mm.emissiveIntensity = 0; return }
      mm.emissive.setHex(color)
      mm.emissiveIntensity = amount
    })
  }

  // ---------------------------------------------------------------- poses

  private pose(anim: AnimName, t: number, speed: number): Pose {
    const breathe = Math.sin(t * 1.6) * 0.03

    switch (anim) {
      case 'walk':
      case 'run': {
        const amp = anim === 'run' ? 1.5 : 1
        const w = this.gait
        const sw = Math.sin(w)
        this.yOffsetTarget = Math.abs(Math.sin(w)) * 0.035 * amp
        this.leanTarget = anim === 'run' ? 0.22 : 0.06
        return {
          hips: [0, sw * 0.06, 0],
          spine: [0.02 + breathe, -sw * 0.08, 0],
          neck: [-sw * 0.02, 0, 0],
          armL: [sw * 0.75 * amp, 0, 0.1],
          armR: [-sw * 0.75 * amp, 0, -0.1],
          foreL: [-Math.max(0, sw) * 0.5 * amp - 0.15, 0, 0],
          foreR: [-Math.max(0, -sw) * 0.5 * amp - 0.15, 0, 0],
          legL: [-sw * 0.72 * amp, 0, 0],
          legR: [sw * 0.72 * amp, 0, 0],
          shinL: [Math.max(0, sw) * 0.9 * amp, 0, 0],
          shinR: [Math.max(0, -sw) * 0.9 * amp, 0, 0],
        }
      }
      case 'swim': {
        this.yOffsetTarget = -0.52 + Math.sin(t * 2.2) * 0.03
        this.leanTarget = 0.1
        return {
          hips: [0, Math.sin(t * 2) * 0.12, 0],
          spine: [0.1, 0, 0],
          neck: [-0.25, 0, 0],
          armL: [-2.2 + Math.sin(t * 4) * 1.4, 0.3, 0.5],
          armR: [-2.2 + Math.sin(t * 4 + Math.PI) * 1.4, -0.3, -0.5],
          foreL: [-0.5, 0, 0], foreR: [-0.5, 0, 0],
          legL: [Math.sin(t * 5) * 0.4 - 0.1, 0, 0.12],
          legR: [Math.sin(t * 5 + Math.PI) * 0.4 - 0.1, 0, -0.12],
          shinL: [0.3, 0, 0], shinR: [0.3, 0, 0],
        }
      }
      case 'sit': {
        this.yOffsetTarget = -0.42
        this.leanTarget = 0
        return {
          hips: [0, 0, 0],
          spine: [0.06 + breathe, 0, 0],
          armL: [-0.35, 0, 0.16], armR: [-0.35, 0, -0.16],
          foreL: [-0.6, 0, 0], foreR: [-0.6, 0, 0],
          legL: [-1.5, 0, 0.06], legR: [-1.5, 0, -0.06],
          shinL: [1.45, 0, 0], shinR: [1.45, 0, 0],
        }
      }
      case 'sleep': {
        this.yOffsetTarget = -0.55
        this.leanTarget = -1.5
        return {
          hips: [0, 0, 0],
          spine: [0.05 + Math.sin(t * 0.8) * 0.04, 0, 0],
          neck: [0.1, Math.sin(t * 0.4) * 0.2, 0],
          armL: [0.2, 0, 0.5], armR: [0.2, 0, -0.5],
          foreL: [-0.3, 0, 0], foreR: [-0.3, 0, 0],
          legL: [0.05, 0, 0.07], legR: [0.05, 0, -0.07],
          shinL: [0.12, 0, 0], shinR: [0.12, 0, 0],
        }
      }
      case 'toilet': {
        this.yOffsetTarget = -0.38
        this.leanTarget = 0.12
        return {
          spine: [0.2 + breathe, 0, 0],
          neck: [0.25, 0, 0],
          armL: [-0.5, 0, 0.3], armR: [-0.5, 0, -0.3],
          foreL: [-0.9, 0, 0], foreR: [-0.9, 0, 0],
          legL: [-1.45, 0, 0.1], legR: [-1.45, 0, -0.1],
          shinL: [1.4, 0, 0], shinR: [1.4, 0, 0],
        }
      }
      case 'shower': {
        this.yOffsetTarget = 0
        this.leanTarget = 0
        return {
          spine: [breathe, Math.sin(t * 1.1) * 0.22, 0],
          neck: [-0.2, 0, 0],
          armL: [-2.2 + Math.sin(t * 2) * 0.3, 0, 0.5],
          armR: [-2.0 + Math.cos(t * 2.3) * 0.3, 0, -0.5],
          foreL: [-1.5, 0, 0], foreR: [-1.4, 0, 0],
          legL: [0, 0, 0.05], legR: [0, 0, -0.05],
        }
      }
      case 'cook': {
        this.yOffsetTarget = 0
        this.leanTarget = 0.1
        return {
          spine: [0.14, Math.sin(t * 2.4) * 0.14, 0],
          neck: [0.2, 0, 0],
          armL: [-1.1 + Math.sin(t * 4) * 0.28, 0.2, 0.42],
          armR: [-1.2 + Math.cos(t * 4.6) * 0.34, -0.2, -0.42],
          foreL: [-0.9, 0, 0], foreR: [-1.1, 0, 0],
        }
      }
      case 'eat': {
        this.yOffsetTarget = -0.42
        this.leanTarget = 0.08
        const bite = Math.max(0, Math.sin(t * 3))
        return {
          spine: [0.12, 0, 0],
          neck: [0.1 - bite * 0.1, 0, 0],
          armL: [-0.4, 0, 0.2], armR: [-1.1 - bite * 0.7, -0.3, -0.35],
          foreL: [-0.8, 0, 0], foreR: [-1.5 - bite * 0.5, 0, 0],
          legL: [-1.5, 0, 0.06], legR: [-1.5, 0, -0.06],
          shinL: [1.45, 0, 0], shinR: [1.45, 0, 0],
        }
      }
      case 'read': {
        this.yOffsetTarget = -0.4
        this.leanTarget = 0.06
        return {
          spine: [0.14, 0, 0], neck: [0.28, 0, 0],
          armL: [-1.35, 0.25, 0.3], armR: [-1.35, -0.25, -0.3],
          foreL: [-0.55, 0, 0], foreR: [-0.55, 0, 0],
          legL: [-1.5, 0, 0.06], legR: [-1.5, 0, -0.06],
          shinL: [1.45, 0, 0], shinR: [1.45, 0, 0],
        }
      }
      case 'type': {
        this.yOffsetTarget = -0.42
        this.leanTarget = 0.14
        return {
          spine: [0.16, 0, 0], neck: [0.2, 0, 0],
          armL: [-1.25 + Math.sin(t * 9) * 0.06, 0.15, 0.28],
          armR: [-1.25 + Math.sin(t * 9 + 1) * 0.06, -0.15, -0.28],
          foreL: [-0.85, 0, 0], foreR: [-0.85, 0, 0],
          legL: [-1.5, 0, 0.06], legR: [-1.5, 0, -0.06],
          shinL: [1.45, 0, 0], shinR: [1.45, 0, 0],
        }
      }
      case 'watch': {
        this.yOffsetTarget = -0.42
        this.leanTarget = -0.1
        return {
          spine: [-0.05 + breathe, 0, 0], neck: [-0.06, Math.sin(t * 0.3) * 0.1, 0],
          armL: [-0.2, 0, 0.42], armR: [-0.2, 0, -0.42],
          foreL: [-0.4, 0, 0], foreR: [-0.4, 0, 0],
          legL: [-1.45, 0, 0.08], legR: [-1.4, 0, -0.08],
          shinL: [1.3, 0, 0], shinR: [1.35, 0, 0],
        }
      }
      case 'dance': {
        this.yOffsetTarget = Math.abs(Math.sin(t * 6)) * 0.07
        this.leanTarget = Math.sin(t * 3) * 0.16
        return {
          hips: [0, Math.sin(t * 3) * 0.4, 0],
          spine: [0, Math.sin(t * 3 + 1) * 0.3, Math.sin(t * 6) * 0.12],
          neck: [Math.sin(t * 6) * 0.1, 0, 0],
          armL: [-1.6 + Math.sin(t * 6) * 0.9, 0.4, 0.7],
          armR: [-1.6 + Math.cos(t * 6) * 0.9, -0.4, -0.7],
          foreL: [-1.0, 0, 0], foreR: [-1.0, 0, 0],
          legL: [Math.sin(t * 6) * 0.3, 0, 0.1], legR: [Math.cos(t * 6) * 0.3, 0, -0.1],
          shinL: [Math.max(0, Math.sin(t * 6)) * 0.6, 0, 0],
          shinR: [Math.max(0, Math.cos(t * 6)) * 0.6, 0, 0],
        }
      }
      case 'lift': {
        this.yOffsetTarget = -0.34 + Math.sin(t * 2.6) * 0.05
        this.leanTarget = 0.05
        const push = (Math.sin(t * 2.6) + 1) / 2
        return {
          spine: [0.05, 0, 0],
          armL: [-2.0 - push * 0.9, 0.2, 0.55], armR: [-2.0 - push * 0.9, -0.2, -0.55],
          foreL: [-1.6 + push * 1.3, 0, 0], foreR: [-1.6 + push * 1.3, 0, 0],
          legL: [-1.3, 0, 0.1], legR: [-1.3, 0, -0.1],
          shinL: [1.2, 0, 0], shinR: [1.2, 0, 0],
        }
      }
      case 'repair': {
        this.yOffsetTarget = -0.24
        this.leanTarget = 0.2
        return {
          spine: [0.3, 0, 0], neck: [0.3, 0, 0],
          armL: [-1.5 + Math.sin(t * 8) * 0.3, 0.3, 0.4],
          armR: [-1.4 + Math.cos(t * 8) * 0.35, -0.3, -0.4],
          foreL: [-1.1, 0, 0], foreR: [-1.2, 0, 0],
          legL: [-0.7, 0, 0.14], legR: [-0.7, 0, -0.14],
          shinL: [0.8, 0, 0], shinR: [0.8, 0, 0],
        }
      }
      case 'panic': {
        this.yOffsetTarget = Math.abs(Math.sin(t * 14)) * 0.06
        this.leanTarget = Math.sin(t * 9) * 0.2
        return {
          hips: [0, Math.sin(t * 11) * 0.5, 0],
          spine: [-0.1, Math.sin(t * 13) * 0.4, 0],
          neck: [-0.2, Math.sin(t * 15) * 0.5, 0],
          armL: [-2.8 + Math.sin(t * 16) * 0.4, 0.4, 0.8],
          armR: [-2.8 + Math.cos(t * 16) * 0.4, -0.4, -0.8],
          foreL: [-0.4, 0, 0], foreR: [-0.4, 0, 0],
          legL: [Math.sin(t * 14) * 0.5, 0, 0], legR: [-Math.sin(t * 14) * 0.5, 0, 0],
          shinL: [Math.max(0, Math.sin(t * 14)) * 0.9, 0, 0],
          shinR: [Math.max(0, -Math.sin(t * 14)) * 0.9, 0, 0],
        }
      }
      case 'burn': {
        this.yOffsetTarget = Math.abs(Math.sin(t * 20)) * 0.05
        this.leanTarget = Math.sin(t * 12) * 0.3
        return {
          hips: [0, Math.sin(t * 17) * 0.7, 0],
          spine: [-0.2, Math.sin(t * 19) * 0.5, Math.sin(t * 23) * 0.2],
          neck: [-0.45, 0, 0],
          armL: [-3.0, 0.5, 1.0], armR: [-3.0, -0.5, -1.0],
          foreL: [-0.2, 0, 0], foreR: [-0.2, 0, 0],
          legL: [Math.sin(t * 18) * 0.6, 0, 0], legR: [-Math.sin(t * 18) * 0.6, 0, 0],
          shinL: [0.6, 0, 0], shinR: [0.6, 0, 0],
        }
      }
      case 'drown': {
        this.yOffsetTarget = -0.7 + Math.sin(t * 3) * 0.14
        this.leanTarget = 0.35
        return {
          spine: [0.2, 0, 0], neck: [-0.5, 0, 0],
          armL: [-3.0 + Math.sin(t * 7) * 0.6, 0.3, 0.7],
          armR: [-3.0 + Math.cos(t * 7) * 0.6, -0.3, -0.7],
          foreL: [-0.3, 0, 0], foreR: [-0.3, 0, 0],
          legL: [0.3, 0, 0.1], legR: [-0.2, 0, -0.1],
        }
      }
      case 'zap': {
        this.yOffsetTarget = 0.05
        this.leanTarget = -0.1
        const j = Math.sin(t * 60)
        return {
          hips: [0, j * 0.1, 0],
          spine: [-0.2 + j * 0.08, j * 0.12, j * 0.1],
          neck: [-0.3, j * 0.2, 0],
          armL: [-2.6, 0.6 + j * 0.2, 1.1], armR: [-2.6, -0.6 - j * 0.2, -1.1],
          foreL: [-0.1, 0, 0], foreR: [-0.1, 0, 0],
          legL: [0.1, 0, 0.2], legR: [0.1, 0, -0.2],
        }
      }
      case 'collapse': {
        this.yOffsetTarget = -0.78
        this.leanTarget = -1.42
        return {
          spine: [0.1, 0, 0], neck: [0.2, 0.3, 0],
          armL: [0.6, 0, 0.9], armR: [0.4, 0, -1.1],
          foreL: [-0.4, 0, 0], foreR: [-0.3, 0, 0],
          legL: [0.15, 0, 0.3], legR: [0.1, 0, -0.24],
          shinL: [0.3, 0, 0], shinR: [0.5, 0, 0],
        }
      }
      case 'cry': {
        this.yOffsetTarget = -0.05
        this.leanTarget = 0.24
        return {
          spine: [0.24 + Math.sin(t * 7) * 0.06, 0, 0],
          neck: [0.3, 0, 0],
          armL: [-2.5, 0.3, 0.5], armR: [-2.5, -0.3, -0.5],
          foreL: [-1.5, 0, 0], foreR: [-1.5, 0, 0],
          legL: [0, 0, 0.06], legR: [0, 0, -0.06],
        }
      }
      case 'laugh': {
        this.yOffsetTarget = Math.abs(Math.sin(t * 9)) * 0.05
        this.leanTarget = -0.3 + Math.sin(t * 9) * 0.1
        return {
          spine: [-0.28, 0, Math.sin(t * 9) * 0.08],
          neck: [-0.4, 0, 0],
          armL: [-0.9, 0.2, 0.6], armR: [-0.9, -0.2, -0.6],
          foreL: [-1.6, 0, 0], foreR: [-1.6, 0, 0],
          legL: [0.1, 0, 0.08], legR: [0.1, 0, -0.08],
          shinL: [0.2, 0, 0], shinR: [0.2, 0, 0],
        }
      }
      case 'wave': {
        this.yOffsetTarget = 0
        this.leanTarget = 0
        return {
          spine: [breathe, 0, 0],
          armR: [-2.6, -0.2, -0.5 + Math.sin(t * 8) * 0.4],
          foreR: [-0.4, 0, 0],
          armL: [-0.1, 0, -0.12], foreL: [-0.25, 0, 0],
        }
      }
      case 'stand_use': {
        this.yOffsetTarget = 0
        this.leanTarget = 0.06
        return {
          spine: [0.08 + breathe, Math.sin(t * 1.4) * 0.06, 0],
          neck: [0.14, 0, 0],
          armL: [-1.0 + Math.sin(t * 2.4) * 0.12, 0.15, 0.35],
          armR: [-1.0 + Math.cos(t * 2.6) * 0.12, -0.15, -0.35],
          foreL: [-0.8, 0, 0], foreR: [-0.8, 0, 0],
        }
      }
      default: { // idle
        this.yOffsetTarget = 0
        this.leanTarget = 0
        const idleSway = Math.sin(t * 0.7)
        return {
          hips: [0, idleSway * 0.05, 0],
          spine: [breathe, -idleSway * 0.04, 0],
          neck: [Math.sin(t * 0.5) * 0.05, Math.sin(t * 0.31) * 0.18, 0],
          armL: [-0.08 + Math.sin(t * 0.9) * 0.05, 0, 0.13],
          armR: [-0.08 + Math.cos(t * 0.85) * 0.05, 0, -0.13],
          foreL: [-0.2, 0, 0], foreR: [-0.2, 0, 0],
          legL: [0, 0, 0.03], legR: [0, 0, -0.03],
        }
      }
    }
  }

  /**
   * Advance the animation. `distance` is how far the sim actually moved this
   * frame, in meters; passing it locks the walk cycle to ground travel so feet
   * stay planted instead of skating.
   */
  update(dt: number, anim: AnimName, speed: number, blend = 9, distance = -1) {
    this.phase += dt
    if (distance >= 0) {
      // one full two-step cycle per 1.35 m of travel
      this.gait += distance * (Math.PI * 2 / 1.35)
    } else {
      this.gait += dt * 8 * Math.max(0.4, speed)
    }
    const target = this.pose(anim, this.phase, speed)
    const k = 1 - Math.pow(0.0001, dt * (blend / 9))

    for (const name in this.joints) {
      const j = this.joints[name]
      const t = target[name] ?? [0, 0, 0]
      const c = this.current[name]
      c.x += (t[0] - c.x) * k
      c.y += (t[1] - c.y) * k
      c.z += (t[2] - c.z) * k
      j.obj.rotation.set(j.base.x + c.x, j.base.y + c.y, j.base.z + c.z)
    }

    this.yOffset += (this.yOffsetTarget - this.yOffset) * k
    this.lean += (this.leanTarget - this.lean) * k
    this.body.position.y = this.yOffset
    this.body.rotation.x = this.lean

    // blinking, then the expression rig on top of it
    this.blinkTimer -= dt
    if (this.blinkTimer < 0) this.blinkTimer = 2 + Math.random() * 4
    const lidded = this.blinkTimer < 0.12 ? 0.1 : 1
    this.updateFace(dt, lidded)

    // plumbob spin
    this.plumbob.rotation.y += dt * 1.5
    this.plumbob.position.y = 1.72 * this.look.height + 0.28 + Math.sin(this.phase * 2) * 0.03
  }

  /** Extra mouth opening layered over the expression — talking, eating, screaming. */
  setMouth(open: number) { this.mouthDrive = open }

  setExpression(name: Expression) {
    const target = EXPRESSIONS[name]
    this.faceGoal.brow = target.brow
    this.faceGoal.browTilt = target.browTilt
    this.faceGoal.squint = target.squint
    this.faceGoal.smile = target.smile
    this.faceGoal.open = target.open
  }

  /** Eases the face toward its target pose and drives the rig from it. */
  private updateFace(dt: number, lidded: number) {
    const k = 1 - Math.pow(0.0006, dt)
    const f = this.face, g = this.faceGoal
    f.brow += (g.brow - f.brow) * k
    f.browTilt += (g.browTilt - f.browTilt) * k
    f.squint += (g.squint - f.squint) * k
    f.smile += (g.smile - f.smile) * k
    f.open += (g.open - f.open) * k

    for (const [brow, side] of [[this.browL, -1], [this.browR, 1]] as [THREE.Mesh, number][]) {
      brow.position.y = this.browBaseY + f.brow
      // inner ends of the brows are the ones that move; sign flips per side
      brow.rotation.z = side * 0.12 + side * f.browTilt * 0.5
      brow.position.z = 0.112 - Math.abs(f.browTilt) * 0.004
    }

    const eyeOpen = Math.max(0.04, (1 - f.squint * 0.85)) * lidded
    this.eyeL.scale.y = 0.86 * eyeOpen
    this.eyeR.scale.y = 0.86 * eyeOpen

    // arc flips between smile and frown; magnitude sets how pronounced it is
    const smile = f.smile
    this.mouthArc.rotation.z = smile >= 0 ? Math.PI : 0
    const curve = 0.22 + Math.abs(smile) * 1.05
    this.mouthArc.scale.set(1 + Math.abs(smile) * 0.22, curve, 1)
    this.mouthArc.position.y = 0.03 - smile * 0.006

    const open = Math.min(1.6, f.open + this.mouthDrive)
    this.mouthOpen.scale.set(1 + open * 0.25, 0.05 + open * 0.95, 0.5 + open * 0.3)
    this.mouthOpen.position.y = 0.026 - open * 0.012
    this.jaw.position.y = this.jawBaseY - open * 0.016
  }

  lookAt(target: THREE.Vector3 | null) {
    if (!target) return
    const world = new THREE.Vector3()
    this.headGroup.getWorldPosition(world)
    const dir = target.clone().sub(world)
    const localYaw = Math.atan2(dir.x, dir.z) - this.root.rotation.y
    const clamped = THREE.MathUtils.clamp(
      ((localYaw + Math.PI) % (Math.PI * 2)) - Math.PI, -1.0, 1.0)
    this.current.neck.y += (clamped * 0.6 - this.current.neck.y) * 0.1
  }

  dispose() {
    this.root.traverse((c) => {
      const m = c as THREE.Mesh
      if (m.isMesh) m.geometry.dispose()
    })
    for (const m of this.materials) m.dispose()
    this.root.removeFromParent()
  }
}
