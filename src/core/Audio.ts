/**
 * Fully procedural audio. Everything — music, voices, foley — is synthesised at
 * runtime with the Web Audio API, so the game ships with zero audio assets.
 */

type Vec = { x: number; y: number; z: number }

const NOTE = (semitonesFromA4: number) => 440 * Math.pow(2, semitonesFromA4 / 12)

/** Minor-key progressions the soundtrack wanders between. */
const PROGRESSIONS: Record<string, number[][]> = {
  calm: [[-9, -5, -2], [-4, 0, 3], [-7, -3, 0], [-2, 2, 5]],
  tense: [[-10, -6, -3], [-10, -5, -1], [-12, -8, -5], [-11, -7, -4]],
  chaos: [[-13, -7, -6], [-12, -6, -5], [-14, -8, -7], [-11, -5, -4]],
  dirge: [[-17, -13, -10], [-19, -15, -12], [-21, -17, -14], [-20, -14, -11]],
}

export type MusicMood = keyof typeof PROGRESSIONS

export class AudioEngine {
  ctx: AudioContext | null = null
  private master!: GainNode
  private musicBus!: GainNode
  private sfxBus!: GainNode
  private voiceBus!: GainNode
  private reverb!: ConvolverNode
  private reverbSend!: GainNode
  private comp!: DynamicsCompressorNode

  enabled = true
  masterVolume = 0.8
  musicVolume = 0.4
  sfxVolume = 0.85

  private mood: MusicMood = 'calm'
  private moodGain = 0
  private nextBeat = 0
  private beatIndex = 0
  private bpm = 74
  private started = false

  /** Persistent looping emitters keyed by an id, e.g. one per active fire. */
  private loops = new Map<string, { gain: GainNode; stop: () => void }>()

  private listener: Vec = { x: 0, y: 12, z: 20 }
  private listenerRight: Vec = { x: 1, y: 0, z: 0 }

  /** Must be called from a user gesture. */
  async init() {
    if (this.ctx) return
    const Ctor = window.AudioContext || (window as any).webkitAudioContext
    if (!Ctor) { this.enabled = false; return }
    const ctx = new Ctor()
    this.ctx = ctx
    await ctx.resume().catch(() => {})

    this.comp = ctx.createDynamicsCompressor()
    this.comp.threshold.value = -14
    this.comp.knee.value = 22
    this.comp.ratio.value = 3.6
    this.comp.attack.value = 0.004
    this.comp.release.value = 0.22

    this.master = ctx.createGain()
    this.master.gain.value = this.masterVolume
    this.master.connect(this.comp)
    this.comp.connect(ctx.destination)

    this.reverb = ctx.createConvolver()
    this.reverb.buffer = this.makeImpulse(2.1, 2.6)
    this.reverbSend = ctx.createGain()
    this.reverbSend.gain.value = 0.28
    this.reverbSend.connect(this.reverb)
    this.reverb.connect(this.master)

    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.musicVolume
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = this.sfxVolume
    this.voiceBus = ctx.createGain(); this.voiceBus.gain.value = 0.5
    for (const bus of [this.musicBus, this.sfxBus, this.voiceBus]) {
      bus.connect(this.master)
      const send = ctx.createGain()
      send.gain.value = 0.2
      bus.connect(send); send.connect(this.reverbSend)
    }
    this.started = true
    this.nextBeat = ctx.currentTime + 0.4
  }

  private makeImpulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!
    const len = Math.floor(ctx.sampleRate * seconds)
    const buf = ctx.createBuffer(2, len, ctx.sampleRate)
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c)
      for (let i = 0; i < len; i++) {
        const t = i / len
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (1 - t * 0.2)
      }
    }
    return buf
  }

  private noiseBuffer(seconds: number): AudioBuffer {
    const ctx = this.ctx!
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds))
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    return buf
  }

  setListener(pos: Vec, right: Vec) {
    this.listener = pos
    this.listenerRight = right
  }

  /** Distance attenuation + stereo pan for a world-space sound. */
  private spatial(at?: Vec): { gain: number; pan: number } {
    if (!at) return { gain: 1, pan: 0 }
    const dx = at.x - this.listener.x, dy = at.y - this.listener.y, dz = at.z - this.listener.z
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
    const gain = Math.min(1, 14 / (dist + 8))
    const len = Math.max(0.0001, Math.hypot(dx, dz))
    const pan = Math.max(-0.85, Math.min(0.85,
      ((dx / len) * this.listenerRight.x + (dz / len) * this.listenerRight.z) * Math.min(1, dist / 16)))
    return { gain, pan }
  }

  private chain(destination: GainNode, at?: Vec, extraGain = 1): { input: AudioNode; gain: GainNode } {
    const ctx = this.ctx!
    const sp = this.spatial(at)
    const g = ctx.createGain()
    g.gain.value = sp.gain * extraGain
    const panner = ctx.createStereoPanner()
    panner.pan.value = sp.pan
    g.connect(panner)
    panner.connect(destination)
    return { input: g, gain: g }
  }

  private env(node: AudioParam, t: number, peak: number, attack: number, decay: number) {
    node.cancelScheduledValues(t)
    node.setValueAtTime(0.0001, t)
    node.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack)
    node.exponentialRampToValueAtTime(0.0001, t + attack + decay)
  }

  // ---------------------------------------------------------------- primitives

  private tone(opts: {
    freq: number; type?: OscillatorType; dur?: number; gain?: number; attack?: number
    at?: Vec; bus?: GainNode; slideTo?: number; detune?: number; filter?: number; q?: number
    delay?: number
  }) {
    if (!this.started || !this.enabled) return
    const ctx = this.ctx!
    const t = ctx.currentTime + (opts.delay ?? 0)
    const dur = opts.dur ?? 0.25
    const { input, gain } = this.chain(opts.bus ?? this.sfxBus, opts.at, opts.gain ?? 0.3)
    const osc = ctx.createOscillator()
    osc.type = opts.type ?? 'sine'
    osc.frequency.setValueAtTime(opts.freq, t)
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slideTo), t + dur)
    if (opts.detune) osc.detune.value = opts.detune
    let node: AudioNode = osc
    if (opts.filter) {
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'; f.frequency.value = opts.filter; f.Q.value = opts.q ?? 1
      osc.connect(f); node = f
    }
    const vca = ctx.createGain()
    this.env(vca.gain, t, 1, opts.attack ?? 0.008, dur)
    node.connect(vca); vca.connect(input)
    osc.start(t); osc.stop(t + dur + (opts.attack ?? 0.01) + 0.06)
    setTimeout(() => gain.disconnect(), (dur + 0.4) * 1000 + (opts.delay ?? 0) * 1000)
  }

  private noise(opts: {
    dur?: number; gain?: number; at?: Vec; bus?: GainNode; type?: BiquadFilterType
    freq?: number; q?: number; sweepTo?: number; attack?: number; delay?: number
  }) {
    if (!this.started || !this.enabled) return
    const ctx = this.ctx!
    const t = ctx.currentTime + (opts.delay ?? 0)
    const dur = opts.dur ?? 0.2
    const { input, gain } = this.chain(opts.bus ?? this.sfxBus, opts.at, opts.gain ?? 0.3)
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer(dur + 0.1)
    const f = ctx.createBiquadFilter()
    f.type = opts.type ?? 'bandpass'
    f.frequency.setValueAtTime(opts.freq ?? 900, t)
    f.Q.value = opts.q ?? 1.2
    if (opts.sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, opts.sweepTo), t + dur)
    const vca = ctx.createGain()
    this.env(vca.gain, t, 1, opts.attack ?? 0.006, dur)
    src.connect(f); f.connect(vca); vca.connect(input)
    src.start(t); src.stop(t + dur + 0.1)
    setTimeout(() => gain.disconnect(), (dur + 0.4) * 1000 + (opts.delay ?? 0) * 1000)
  }

  // ------------------------------------------------------------------ one-shots

  play(name: string, at?: Vec) {
    if (!this.started || !this.enabled) return
    switch (name) {
      case 'click': this.tone({ freq: 880, type: 'triangle', dur: 0.06, gain: 0.16 }); break
      case 'hover': this.tone({ freq: 1560, type: 'sine', dur: 0.035, gain: 0.05 }); break
      case 'confirm':
        this.tone({ freq: 660, type: 'triangle', dur: 0.1, gain: 0.16 })
        this.tone({ freq: 990, type: 'triangle', dur: 0.14, gain: 0.13, delay: 0.07 })
        break
      case 'cancel': this.tone({ freq: 300, type: 'square', dur: 0.11, gain: 0.11, slideTo: 170, filter: 1400 }); break
      case 'cash':
        for (let i = 0; i < 4; i++)
          this.tone({ freq: 1400 + i * 260, type: 'triangle', dur: 0.11, gain: 0.1, delay: i * 0.035 })
        break
      case 'place':
        this.noise({ freq: 320, q: 0.9, dur: 0.13, gain: 0.3, at, sweepTo: 120 })
        this.tone({ freq: 150, type: 'sine', dur: 0.14, gain: 0.24, at, slideTo: 70 })
        break
      case 'sell':
        this.noise({ freq: 1800, q: 2, dur: 0.16, gain: 0.2, at, sweepTo: 380 })
        this.tone({ freq: 1200, type: 'triangle', dur: 0.12, gain: 0.1, at, slideTo: 2400 })
        break
      case 'step':
        this.noise({ freq: 260 + Math.random() * 130, q: 1.1, dur: 0.07, gain: 0.16, at, sweepTo: 110 })
        break
      case 'step_wet':
        this.noise({ freq: 900 + Math.random() * 400, q: 0.7, dur: 0.11, gain: 0.2, at, sweepTo: 200 })
        break
      case 'splash':
        this.noise({ freq: 1500, q: 0.5, dur: 0.5, gain: 0.5, at, sweepTo: 260 })
        this.noise({ freq: 420, q: 0.8, dur: 0.75, gain: 0.3, at, sweepTo: 130, delay: 0.05 })
        this.tone({ freq: 420, type: 'sine', dur: 0.3, gain: 0.12, at, slideTo: 900 })
        break
      case 'gurgle':
        for (let i = 0; i < 5; i++)
          this.tone({ freq: 220 + Math.random() * 200, type: 'sine', dur: 0.12, gain: 0.14, at, slideTo: 90, delay: i * 0.11 })
        this.noise({ freq: 700, q: 0.6, dur: 0.7, gain: 0.22, at, sweepTo: 150 })
        break
      case 'zap':
        this.noise({ freq: 4200, q: 0.4, dur: 0.28, gain: 0.55, at, sweepTo: 700 })
        for (let i = 0; i < 7; i++)
          this.tone({ freq: 90 + Math.random() * 2400, type: 'square', dur: 0.035, gain: 0.16, at, delay: i * 0.028 })
        this.tone({ freq: 60, type: 'sawtooth', dur: 0.4, gain: 0.28, at, filter: 900 })
        break
      case 'spark':
        this.noise({ freq: 5200, q: 1.6, dur: 0.07, gain: 0.2, at, sweepTo: 1800 })
        break
      case 'ignite':
        this.noise({ freq: 480, q: 0.4, dur: 0.9, gain: 0.5, at, sweepTo: 2600, attack: 0.1 })
        this.tone({ freq: 70, type: 'sawtooth', dur: 0.7, gain: 0.3, at, filter: 500 })
        break
      case 'explosion':
        this.noise({ freq: 260, q: 0.3, dur: 1.5, gain: 0.85, at, sweepTo: 55, attack: 0.005 })
        this.tone({ freq: 90, type: 'sine', dur: 1.1, gain: 0.55, at, slideTo: 26 })
        this.noise({ freq: 3000, q: 0.6, dur: 0.3, gain: 0.4, at, sweepTo: 400 })
        break
      case 'scream': this.scream(at, 1); break
      case 'panic': this.scream(at, 0.55); break
      case 'flush':
        this.noise({ freq: 700, q: 0.5, dur: 1.5, gain: 0.34, at, sweepTo: 220, attack: 0.15 })
        this.noise({ freq: 2200, q: 0.8, dur: 0.9, gain: 0.14, at, sweepTo: 700, delay: 0.3 })
        break
      case 'shower':
        this.noise({ freq: 3400, q: 0.35, dur: 1.6, gain: 0.16, at, attack: 0.25 })
        break
      case 'sizzle':
        this.noise({ freq: 2600, q: 0.5, dur: 0.9, gain: 0.16, at, attack: 0.2 })
        break
      case 'eat':
        this.noise({ freq: 400 + Math.random() * 300, q: 2.4, dur: 0.1, gain: 0.13, at, sweepTo: 180 })
        break
      case 'snore':
        this.tone({ freq: 82, type: 'sawtooth', dur: 1.1, gain: 0.13, at, filter: 260, slideTo: 62 })
        this.noise({ freq: 300, q: 1.6, dur: 1.0, gain: 0.07, at, sweepTo: 140 })
        break
      case 'toilet_fail':
        this.noise({ freq: 1100, q: 0.6, dur: 0.9, gain: 0.26, at, sweepTo: 260 })
        break
      case 'laugh': this.laugh(at); break
      case 'heartbeat':
        this.tone({ freq: 62, type: 'sine', dur: 0.16, gain: 0.4, at, slideTo: 40 })
        this.tone({ freq: 56, type: 'sine', dur: 0.2, gain: 0.3, at, slideTo: 34, delay: 0.19 })
        break
      case 'alarm':
        for (let i = 0; i < 3; i++) {
          this.tone({ freq: 2600, type: 'square', dur: 0.13, gain: 0.2, at, delay: i * 0.26 })
          this.tone({ freq: 2600, type: 'square', dur: 0.13, gain: 0.2, at, delay: i * 0.26 + 0.13 })
        }
        break
      case 'chomp':
        this.noise({ freq: 220, q: 0.9, dur: 0.3, gain: 0.5, at, sweepTo: 70 })
        this.tone({ freq: 130, type: 'sawtooth', dur: 0.35, gain: 0.3, at, slideTo: 45, filter: 700 })
        break
      case 'ghost':
        for (let i = 0; i < 6; i++)
          this.tone({ freq: 300 + i * 90, type: 'sine', dur: 1.5, gain: 0.06, at, slideTo: 120 + i * 30, delay: i * 0.08 })
        break
      case 'reaper': this.reaperSting(at); break
      case 'levelup':
        [0, 4, 7, 12].forEach((s, i) =>
          this.tone({ freq: NOTE(s - 5), type: 'triangle', dur: 0.35, gain: 0.13, delay: i * 0.09 }))
        break
      case 'deed':
        [0, 3, 7, 10, 14].forEach((s, i) =>
          this.tone({ freq: NOTE(s - 8), type: 'sine', dur: 0.6, gain: 0.11, delay: i * 0.07 }))
        break
      default: break
    }
  }

  private scream(at: Vec | undefined, intensity: number) {
    const base = 380 + Math.random() * 260
    for (let i = 0; i < 3; i++) {
      this.tone({
        freq: base * (1 + i * 0.02), type: 'sawtooth', dur: 0.5 + Math.random() * 0.35,
        gain: 0.16 * intensity, at, slideTo: base * (0.55 + Math.random() * 0.6),
        filter: 2400, q: 6, detune: (i - 1) * 22, delay: i * 0.01,
      })
    }
    this.noise({ freq: 1800, q: 1.2, dur: 0.45, gain: 0.09 * intensity, at, sweepTo: 700 })
  }

  private laugh(at?: Vec) {
    const base = 300 + Math.random() * 160
    for (let i = 0; i < 7; i++) {
      this.tone({
        freq: base * (1 - i * 0.045), type: 'sawtooth', dur: 0.1, gain: 0.13,
        at, filter: 1500, q: 4, delay: i * 0.13, slideTo: base * (0.8 - i * 0.04),
      })
    }
  }

  private reaperSting(at?: Vec) {
    ;[-24, -19, -17, -12].forEach((s, i) =>
      this.tone({ freq: NOTE(s), type: 'sawtooth', dur: 3.4, gain: 0.13, at, filter: 380, q: 2, delay: i * 0.05 }))
    this.noise({ freq: 180, q: 0.4, dur: 2.6, gain: 0.16, at, sweepTo: 55, attack: 0.5 })
    this.tone({ freq: NOTE(-36), type: 'sine', dur: 3.2, gain: 0.3, at })
  }

  /** Nonsense speech with a per-sim voice color — the game's "Simlish". */
  speak(seed: number, syllables = 3, emotion: 'neutral' | 'happy' | 'sad' | 'angry' | 'scared' = 'neutral', at?: Vec) {
    if (!this.started || !this.enabled) return
    const ctx = this.ctx!
    const voicePitch = 150 + (seed % 100) * 2.4
    const contour = { neutral: 1, happy: 1.22, sad: 0.8, angry: 1.05, scared: 1.5 }[emotion]
    const rate = { neutral: 0.14, happy: 0.11, sad: 0.2, angry: 0.1, scared: 0.08 }[emotion]
    for (let i = 0; i < syllables; i++) {
      const t0 = i * rate
      const f = voicePitch * contour * (0.85 + ((seed * (i + 3)) % 17) / 34)
      const dur = rate * (0.6 + ((seed * (i + 7)) % 11) / 22)
      const { input, gain } = this.chain(this.voiceBus, at, 0.5)
      const osc = ctx.createOscillator()
      osc.type = 'sawtooth'
      const t = ctx.currentTime + t0
      osc.frequency.setValueAtTime(f, t)
      osc.frequency.linearRampToValueAtTime(f * (emotion === 'sad' ? 0.85 : 1.1), t + dur)
      // two formants shape the vowel
      const f1 = ctx.createBiquadFilter()
      f1.type = 'bandpass'; f1.Q.value = 6
      f1.frequency.value = 380 + ((seed * (i + 1)) % 5) * 150
      const f2 = ctx.createBiquadFilter()
      f2.type = 'bandpass'; f2.Q.value = 8
      f2.frequency.value = 1100 + ((seed * (i + 2)) % 7) * 240
      const mix = ctx.createGain()
      const vca = ctx.createGain()
      this.env(vca.gain, t, 0.9, 0.025, dur)
      osc.connect(f1); osc.connect(f2)
      f1.connect(mix); f2.connect(mix); mix.connect(vca); vca.connect(input)
      osc.start(t); osc.stop(t + dur + 0.08)
      setTimeout(() => gain.disconnect(), (t0 + dur + 0.5) * 1000)
    }
  }

  // ------------------------------------------------------------------ loops

  /** Start (or refresh) a looping emitter such as a fire or a running shower. */
  startLoop(id: string, kind: 'fire' | 'water' | 'hum' | 'sizzle', at?: Vec) {
    if (!this.started || !this.enabled) return
    if (this.loops.has(id)) { this.moveLoop(id, at); return }
    const ctx = this.ctx!
    const { input, gain } = this.chain(this.sfxBus, at, 1)
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer(2)
    src.loop = true
    const f = ctx.createBiquadFilter()
    const vca = ctx.createGain()
    vca.gain.value = 0.0001
    let osc: OscillatorNode | null = null
    switch (kind) {
      case 'fire':
        f.type = 'lowpass'; f.frequency.value = 900; f.Q.value = 0.8
        vca.gain.linearRampToValueAtTime(0.30, ctx.currentTime + 0.6); break
      case 'water':
        f.type = 'highpass'; f.frequency.value = 2200; f.Q.value = 0.5
        vca.gain.linearRampToValueAtTime(0.13, ctx.currentTime + 0.5); break
      case 'sizzle':
        f.type = 'bandpass'; f.frequency.value = 3200; f.Q.value = 0.7
        vca.gain.linearRampToValueAtTime(0.10, ctx.currentTime + 0.4); break
      case 'hum':
        f.type = 'lowpass'; f.frequency.value = 260
        osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 60
        osc.connect(f); osc.start()
        vca.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 0.4); break
    }
    src.connect(f); f.connect(vca); vca.connect(input)
    src.start()
    this.loops.set(id, {
      gain,
      stop: () => {
        const t = ctx.currentTime
        vca.gain.cancelScheduledValues(t)
        vca.gain.setValueAtTime(vca.gain.value, t)
        vca.gain.linearRampToValueAtTime(0.0001, t + 0.35)
        setTimeout(() => { try { src.stop(); osc?.stop(); gain.disconnect() } catch { /* already stopped */ } }, 500)
      },
    })
  }

  moveLoop(id: string, at?: Vec) {
    const l = this.loops.get(id)
    if (!l || !this.ctx) return
    const sp = this.spatial(at)
    l.gain.gain.setTargetAtTime(sp.gain, this.ctx.currentTime, 0.15)
  }

  stopLoop(id: string) {
    const l = this.loops.get(id)
    if (!l) return
    l.stop()
    this.loops.delete(id)
  }

  stopAllLoops() { for (const id of [...this.loops.keys()]) this.stopLoop(id) }

  async suspend() { await this.ctx?.suspend().catch(() => {}) }
  async resume() { if (this.ctx?.state === 'suspended') await this.ctx.resume().catch(() => {}) }

  // ------------------------------------------------------------------ music

  setMood(m: MusicMood) { this.mood = m }

  setVolumes(master: number, music: number, sfx: number) {
    this.masterVolume = master; this.musicVolume = music; this.sfxVolume = sfx
    if (!this.started) return
    this.master.gain.value = master
    this.musicBus.gain.value = music
    this.sfxBus.gain.value = sfx
    this.voiceBus.gain.value = sfx * 0.6
  }

  /** Called every frame; schedules the next musical beat when one is due. */
  update(dt: number) {
    if (!this.started || !this.enabled || this.musicVolume <= 0.001) return
    const ctx = this.ctx!
    this.moodGain = Math.min(1, this.moodGain + dt * 0.4)
    const beatDur = 60 / this.bpm
    while (ctx.currentTime + 0.25 > this.nextBeat) {
      this.scheduleBeat(this.nextBeat, this.beatIndex)
      this.nextBeat += beatDur
      this.beatIndex++
    }
  }

  private scheduleBeat(t: number, i: number) {
    const ctx = this.ctx!
    const prog = PROGRESSIONS[this.mood]
    const chord = prog[Math.floor(i / 4) % prog.length]
    const beatInBar = i % 4
    const dark = this.mood === 'chaos' || this.mood === 'dirge'

    const voice = (semi: number, dur: number, gain: number, type: OscillatorType, det = 0) => {
      const osc = ctx.createOscillator()
      osc.type = type
      osc.frequency.value = NOTE(semi)
      osc.detune.value = det
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.setValueAtTime(dark ? 700 : 1500, t)
      f.frequency.exponentialRampToValueAtTime(dark ? 260 : 520, t + dur)
      f.Q.value = 1.4
      const vca = ctx.createGain()
      this.env(vca.gain, t, gain, 0.09, dur)
      osc.connect(f); f.connect(vca); vca.connect(this.musicBus)
      osc.start(t); osc.stop(t + dur + 0.2)
    }

    if (beatInBar === 0) {
      // pad
      chord.forEach((s, k) => {
        voice(s, 2.3, 0.10, 'sawtooth', -6 + k * 5)
        voice(s + 12, 1.9, 0.035, 'triangle', 5)
      })
      // bass
      voice(chord[0] - 24, 1.4, 0.15, 'sine')
    }
    if (beatInBar === 2) voice(chord[0] - 24, 0.7, 0.10, 'sine')

    // sparse melody / arpeggio
    if (this.mood !== 'dirge' && (i % 8 === 3 || i % 8 === 6)) {
      const s = chord[(i / 3 | 0) % chord.length] + 12
      voice(s, 0.55, 0.07, 'triangle')
    }

    // percussion picks up as things get worse
    if (this.mood === 'tense' || this.mood === 'chaos') {
      if (beatInBar === 0 || beatInBar === 2) {
        const src = ctx.createBufferSource()
        src.buffer = this.noiseBuffer(0.14)
        const f = ctx.createBiquadFilter()
        f.type = 'lowpass'; f.frequency.value = 180
        const vca = ctx.createGain()
        this.env(vca.gain, t, 0.22, 0.004, 0.13)
        src.connect(f); f.connect(vca); vca.connect(this.musicBus)
        src.start(t); src.stop(t + 0.2)
      }
      if (this.mood === 'chaos' && beatInBar % 2 === 1) {
        const src = ctx.createBufferSource()
        src.buffer = this.noiseBuffer(0.08)
        const f = ctx.createBiquadFilter()
        f.type = 'highpass'; f.frequency.value = 6000
        const vca = ctx.createGain()
        this.env(vca.gain, t, 0.07, 0.002, 0.06)
        src.connect(f); f.connect(vca); vca.connect(this.musicBus)
        src.start(t); src.stop(t + 0.12)
      }
    }
    if (this.mood === 'dirge' && beatInBar === 0 && i % 8 === 0) {
      // funeral bell
      voice(chord[0] - 12, 3.2, 0.09, 'sine')
      voice(chord[0] - 12 + 0.15, 3.0, 0.05, 'sine')
    }
  }
}

export const audio = new AudioEngine()
