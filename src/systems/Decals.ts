import * as THREE from 'three'

const VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aAlpha;
attribute float aSeed;
varying vec3 vColor;
varying float vAlpha;
varying vec2 vUv;
varying float vSeed;
void main() {
  vColor = aColor; vAlpha = aAlpha; vUv = uv; vSeed = aSeed;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}`

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uWobble;
varying vec3 vColor;
varying float vAlpha;
varying vec2 vUv;
varying float vSeed;
void main() {
  vec2 p = vUv - 0.5;
  float ang = atan(p.y, p.x);
  float r = length(p);
  // irregular blobby outline rather than a perfect circle
  float edge = 0.44 + sin(ang * 3.0 + vSeed * 9.0) * 0.045 + sin(ang * 5.0 - vSeed * 4.0) * 0.03;
  float a = smoothstep(edge, edge - 0.09, r);
  float shimmer = 1.0 + sin(uTime * 2.0 + vSeed * 20.0 + r * 24.0) * uWobble;
  if (a <= 0.005) discard;
  gl_FragColor = vec4(vColor * shimmer, a * vAlpha);
}`

/** Instanced flat decals (puddles, scorch marks) drawn just above the floor. */
export class DecalLayer {
  readonly mesh: THREE.InstancedMesh
  private colors: Float32Array
  private alphas: Float32Array
  private seeds: Float32Array
  private capacity: number
  private count = 0
  private mat: THREE.ShaderMaterial

  constructor(capacity: number, y: number, wobble = 0.0) {
    this.capacity = capacity
    const geo = new THREE.PlaneGeometry(1, 1)
    geo.rotateX(-Math.PI / 2)
    this.colors = new Float32Array(capacity * 3)
    this.alphas = new Float32Array(capacity)
    this.seeds = new Float32Array(capacity)
    geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(this.colors, 3))
    geo.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(this.alphas, 1))
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(this.seeds, 1))
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uWobble: { value: wobble } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    })
    this.mesh = new THREE.InstancedMesh(geo, this.mat, capacity)
    this.mesh.frustumCulled = false
    this.mesh.count = 0
    this.mesh.position.y = y
    this.mesh.renderOrder = 3
  }

  begin() { this.count = 0 }

  add(x: number, z: number, size: number, color: THREE.Color, alpha: number, seed: number, rot = 0) {
    if (this.count >= this.capacity) return
    const i = this.count++
    const m = new THREE.Matrix4()
    m.makeRotationY(rot)
    m.scale(new THREE.Vector3(size, 1, size))
    m.setPosition(x, 0, z)
    this.mesh.setMatrixAt(i, m)
    this.colors[i * 3] = color.r
    this.colors[i * 3 + 1] = color.g
    this.colors[i * 3 + 2] = color.b
    this.alphas[i] = alpha
    this.seeds[i] = seed
  }

  end(time: number) {
    this.mesh.count = this.count
    this.mesh.instanceMatrix.needsUpdate = true
    ;(this.mesh.geometry.getAttribute('aColor') as THREE.InstancedBufferAttribute).needsUpdate = true
    ;(this.mesh.geometry.getAttribute('aAlpha') as THREE.InstancedBufferAttribute).needsUpdate = true
    ;(this.mesh.geometry.getAttribute('aSeed') as THREE.InstancedBufferAttribute).needsUpdate = true
    this.mat.uniforms.uTime.value = time
  }
}
