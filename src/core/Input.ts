import * as THREE from 'three'

export interface PointerState {
  x: number; y: number          // pixels
  ndc: THREE.Vector2            // normalised device coords
  down: boolean
  button: number
  dragged: boolean
}

type DownHandler = (p: PointerState, ev: PointerEvent) => boolean | void

/**
 * Sims-style camera rig: orbits a ground-plane focus point with damped motion.
 * Rotation snaps to 45-degree steps with Q/E the way the real game does, but
 * free-rotates while the right mouse button is held.
 */
export class CameraRig {
  focus = new THREE.Vector3(0, 0, 0)
  private focusGoal = new THREE.Vector3(0, 0, 0)
  azimuth = Math.PI * 0.25
  private azimuthGoal = Math.PI * 0.25
  polar = 0.86
  private polarGoal = 0.86
  distance = 26
  private distanceGoal = 26

  minDistance = 6
  maxDistance = 62
  /** Height of the point the camera orbits and aims at. */
  lookHeight = 0.9
  bounds = 22
  /** Set true to hide the roof/upper walls automatically when zoomed in low. */
  cutawayActive = false

  private shakeAmp = 0
  private shakeTime = 0

  constructor(private camera: THREE.PerspectiveCamera) {}

  rotateBy(d: number) { this.azimuthGoal += d }
  snapRotate(dir: number) {
    const step = Math.PI / 4
    this.azimuthGoal = Math.round(this.azimuthGoal / step) * step + dir * step
  }
  zoomBy(d: number) {
    this.distanceGoal = THREE.MathUtils.clamp(this.distanceGoal * (1 + d), this.minDistance, this.maxDistance)
  }
  setPolar(v: number) { this.polar = this.polarGoal = v }
  pitchBy(d: number) {
    this.polarGoal = THREE.MathUtils.clamp(this.polarGoal + d, 0.20, 1.34)
  }
  /** Pan in screen space, scaled so panning feels the same at every zoom. */
  pan(dx: number, dz: number) {
    const s = this.distance * 0.0016
    const sin = Math.sin(this.azimuth), cos = Math.cos(this.azimuth)
    this.focusGoal.x += (-dx * cos - dz * sin) * s
    this.focusGoal.z += (-dx * -sin - dz * cos) * s
    this.clampFocus()
  }
  panWorld(dx: number, dz: number) {
    const sin = Math.sin(this.azimuth), cos = Math.cos(this.azimuth)
    this.focusGoal.x += dx * cos - dz * sin
    this.focusGoal.z += dx * sin + dz * cos
    this.clampFocus()
  }
  private clampFocus() {
    this.focusGoal.x = THREE.MathUtils.clamp(this.focusGoal.x, -this.bounds, this.bounds)
    this.focusGoal.z = THREE.MathUtils.clamp(this.focusGoal.z, -this.bounds, this.bounds)
  }
  lookAt(p: THREE.Vector3, zoom?: number) {
    this.focusGoal.set(p.x, 0, p.z)
    this.clampFocus()
    if (zoom !== undefined) this.distanceGoal = THREE.MathUtils.clamp(zoom, this.minDistance, this.maxDistance)
  }
  shake(amp: number) { this.shakeAmp = Math.max(this.shakeAmp, amp) }

  update(dt: number) {
    const k = 1 - Math.pow(0.0018, dt)
    this.focus.lerp(this.focusGoal, k)
    this.azimuth += (this.azimuthGoal - this.azimuth) * k
    this.polar += (this.polarGoal - this.polar) * k
    this.distance += (this.distanceGoal - this.distance) * k

    const r = this.distance
    const y = Math.sin(this.polar) * r
    const h = Math.cos(this.polar) * r
    this.camera.position.set(
      this.focus.x + Math.sin(this.azimuth) * h,
      this.lookHeight + Math.max(0.15, y),
      this.focus.z + Math.cos(this.azimuth) * h,
    )
    this.camera.lookAt(this.focus.x, this.lookHeight, this.focus.z)

    if (this.shakeAmp > 0.0005) {
      this.shakeTime += dt * 34
      this.camera.position.x += Math.sin(this.shakeTime * 1.7) * this.shakeAmp
      this.camera.position.y += Math.cos(this.shakeTime * 2.3) * this.shakeAmp * 0.7
      this.camera.position.z += Math.sin(this.shakeTime * 1.1 + 2) * this.shakeAmp
      this.shakeAmp *= Math.pow(0.02, dt)
    }
    this.cutawayActive = this.polar < 0.62 || this.distance < 15
  }
}

export class Input {
  readonly pointer: PointerState = {
    x: 0, y: 0, ndc: new THREE.Vector2(), down: false, button: -1, dragged: false,
  }
  readonly keys = new Set<string>()
  /** When true the current left-drag is being consumed by the game, not the camera. */
  suppressPan = false

  private raycaster = new THREE.Raycaster()
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private lastX = 0
  private lastY = 0
  private downX = 0
  private downY = 0

  onDown: DownHandler = () => {}
  onUp: (p: PointerState, ev: PointerEvent) => void = () => {}
  onMove: (p: PointerState, ev: PointerEvent) => void = () => {}
  onClick: (p: PointerState, ev: PointerEvent) => void = () => {}
  onRightClick: (p: PointerState, ev: PointerEvent) => void = () => {}
  onKey: (code: string, ev: KeyboardEvent) => void = () => {}
  onWheelZoom: (delta: number) => void = () => {}
  /** Fired when a gesture is abandoned rather than finished (blur, cancel). */
  onCancel: () => void = () => {}

  constructor(
    private el: HTMLCanvasElement,
    private camera: THREE.PerspectiveCamera,
    private rig: CameraRig,
  ) {
    el.addEventListener('contextmenu', this.blockMenu)
    el.addEventListener('pointerdown', this.handleDown)
    window.addEventListener('pointermove', this.handleMove)
    window.addEventListener('pointerup', this.handleUp)
    el.addEventListener('wheel', this.handleWheel, { passive: false })
    window.addEventListener('keydown', this.handleKeyDown)
    window.addEventListener('keyup', this.handleKeyUp)
    // A gesture can end without a pointerup: alt-tab, a lost pointer capture, a
    // touch cancelled by the browser. Any of those used to leave the input in a
    // half-pressed state, which broke drag-to-pan and stranded a carried sim.
    el.addEventListener('pointercancel', this.handleCancel)
    window.addEventListener('blur', this.handleCancel)
  }

  private blockMenu = (e: Event) => e.preventDefault()

  private setPointer(ev: PointerEvent) {
    const r = this.el.getBoundingClientRect()
    this.pointer.x = ev.clientX - r.left
    this.pointer.y = ev.clientY - r.top
    this.pointer.ndc.set((this.pointer.x / r.width) * 2 - 1, -(this.pointer.y / r.height) * 2 + 1)
  }

  private handleDown = (ev: PointerEvent) => {
    this.setPointer(ev)
    this.pointer.down = true
    this.pointer.button = ev.button
    this.pointer.dragged = false
    this.suppressPan = false
    this.lastX = ev.clientX; this.lastY = ev.clientY
    this.downX = ev.clientX; this.downY = ev.clientY
    try { this.el.setPointerCapture(ev.pointerId) } catch { /* synthetic / already released */ }
    this.onDown(this.pointer, ev)
  }

  private handleMove = (ev: PointerEvent) => {
    const dx = ev.clientX - this.lastX
    const dy = ev.clientY - this.lastY
    this.lastX = ev.clientX; this.lastY = ev.clientY
    this.setPointer(ev)

    if (this.pointer.down) {
      const totalMove = Math.abs(ev.clientX - this.downX) + Math.abs(ev.clientY - this.downY)
      if (totalMove > 5) this.pointer.dragged = true

      if (this.pointer.button === 2) {
        // right-drag orbits
        this.rig.rotateBy(-dx * 0.006)
        this.rig.pitchBy(dy * 0.004)
      } else if (this.pointer.button === 1) {
        this.rig.pan(dx, dy)
      } else if (this.pointer.button === 0 && !this.suppressPan && this.pointer.dragged) {
        this.rig.pan(dx, dy)
      }
    }
    this.onMove(this.pointer, ev)
  }

  private handleUp = (ev: PointerEvent) => {
    if (!this.pointer.down) return
    this.setPointer(ev)
    const wasDragged = this.pointer.dragged
    const button = this.pointer.button
    this.pointer.down = false
    this.onUp(this.pointer, ev)
    if (!wasDragged) {
      if (button === 2) this.onRightClick(this.pointer, ev)
      else if (button === 0) this.onClick(this.pointer, ev)
    }
    this.resetPointer()
  }

  /** Return the pointer to a known-good resting state. */
  private resetPointer() {
    this.pointer.down = false
    this.pointer.dragged = false
    this.pointer.button = -1
    this.suppressPan = false
  }

  private handleCancel = () => {
    this.keys.clear()
    const wasDown = this.pointer.down
    this.resetPointer()
    if (wasDown) this.onCancel()
  }

  private handleWheel = (ev: WheelEvent) => {
    ev.preventDefault()
    const d = Math.sign(ev.deltaY) * 0.13
    this.rig.zoomBy(d)
    this.onWheelZoom(d)
  }

  private handleKeyDown = (ev: KeyboardEvent) => {
    const t = ev.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
    if (!this.keys.has(ev.code)) this.onKey(ev.code, ev)
    this.keys.add(ev.code)
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(ev.code)) ev.preventDefault()
  }
  private handleKeyUp = (ev: KeyboardEvent) => { this.keys.delete(ev.code) }

  /** Keyboard panning + rotation, called every frame. */
  update(dt: number) {
    const k = this.keys
    const speed = (k.has('ShiftLeft') ? 2.2 : 1) * dt * 620
    let dx = 0, dy = 0
    if (k.has('KeyW') || k.has('ArrowUp')) dy += speed
    if (k.has('KeyS') || k.has('ArrowDown')) dy -= speed
    if (k.has('KeyA') || k.has('ArrowLeft')) dx += speed
    if (k.has('KeyD') || k.has('ArrowRight')) dx -= speed
    if (dx || dy) this.rig.pan(dx, dy)
  }

  dispose() {
    const el = this.el
    el.removeEventListener('contextmenu', this.blockMenu)
    el.removeEventListener('pointerdown', this.handleDown)
    window.removeEventListener('pointermove', this.handleMove)
    window.removeEventListener('pointerup', this.handleUp)
    el.removeEventListener('wheel', this.handleWheel)
    window.removeEventListener('keydown', this.handleKeyDown)
    window.removeEventListener('keyup', this.handleKeyUp)
    el.removeEventListener('pointercancel', this.handleCancel)
    window.removeEventListener('blur', this.handleCancel)
    this.keys.clear()
    this.resetPointer()
  }

  /** Where the cursor ray meets the ground plane (y = 0). */
  groundPoint(out = new THREE.Vector3()): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.pointer.ndc, this.camera)
    return this.raycaster.ray.intersectPlane(this.groundPlane, out)
  }

  /** Where the cursor ray meets an arbitrary horizontal plane. */
  planePoint(y: number, out = new THREE.Vector3()): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.pointer.ndc, this.camera)
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y)
    return this.raycaster.ray.intersectPlane(plane, out)
  }

  raycast(objects: THREE.Object3D[], recursive = true): THREE.Intersection[] {
    this.raycaster.setFromCamera(this.pointer.ndc, this.camera)
    return this.raycaster.intersectObjects(objects, recursive)
  }
}
