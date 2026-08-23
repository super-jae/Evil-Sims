/** Game clock. One real second at speed 1 is one in-game minute. */
export class GameClock {
  /** Total elapsed in-game minutes since the household moved in. */
  minutes = 8 * 60
  speed = 1
  private prevSpeed = 1

  static readonly SPEEDS = [0, 1, 3, 8] as const

  get hour() { return (this.minutes / 60) % 24 }
  get day() { return Math.floor(this.minutes / 1440) + 1 }
  get isNight() { const h = this.hour; return h < 6 || h >= 20 }

  get dayName() {
    const names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    return names[(this.day - 1) % 7]
  }

  get label() {
    const h24 = Math.floor(this.hour)
    const m = Math.floor(this.minutes % 60)
    const ampm = h24 < 12 ? 'AM' : 'PM'
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
  }

  setSpeed(s: number) {
    if (s !== 0) this.prevSpeed = s
    this.speed = s
  }

  togglePause() { this.setSpeed(this.speed === 0 ? this.prevSpeed : 0) }

  /** Advance the clock. `dt` is real seconds; returns in-game minutes elapsed. */
  advance(dt: number) {
    const mins = dt * GameClock.SPEEDS[this.speed] * 1
    this.minutes += mins
    return mins
  }
}
