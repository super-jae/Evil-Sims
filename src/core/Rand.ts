/** Small, fast, seedable PRNG (mulberry32) so runs can be reproduced. */
export class Rand {
  private s: number
  constructor(seed = 0x9e3779b9) { this.s = seed >>> 0 }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0
    let t = this.s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  range(a: number, b: number) { return a + this.next() * (b - a) }
  int(a: number, b: number) { return Math.floor(this.range(a, b + 1)) }
  chance(p: number) { return this.next() < p }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)] }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
  }
  /** Roughly normal via the sum of three uniforms. */
  gauss(mean = 0, sd = 1) {
    return mean + ((this.next() + this.next() + this.next()) / 3 - 0.5) * 3.46 * sd
  }
}

export const rand = new Rand(Math.floor(Math.random() * 0xffffffff))
