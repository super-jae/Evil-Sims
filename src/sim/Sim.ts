import * as THREE from 'three'
import { SimAvatar, type SimLook, type Expression } from './SimMesh'
import { NEED_KEYS, NEED_META, makeNeeds, clampNeeds, needScore, moodFor, type NeedKey, type Needs } from './Needs'
import { bundleTraits, type TraitBundle } from './Traits'
import { SOCIALS, type SocialDef, type SocialCtx } from './Socials'
import type { AnimName, Interaction, InteractionCtx, SkillKey } from '../world/ObjectTypes'
import type { WorldObject } from '../world/WorldObject'
import type { IGame } from '../types'
import type { TilePos } from '../world/Grid'
import { audio } from '../core/Audio'

export interface Task {
  label: string
  obj: WorldObject | null
  inter: Interaction | null
  stand: TilePos | null
  anim: AnimName
  /** In-game minutes. Negative means "until interrupted". */
  duration: number
  needs?: Partial<Record<NeedKey, number>>
  forced: boolean
  phase: 'route' | 'perform'
  elapsed: number
  /** Emergency tasks cannot be displaced by autonomy. */
  priority: number
  /** In-game minutes spent walking to `stand`, for the stuck watchdog. */
  routeElapsed?: number
  onFinish?: (sim: Sim, game: IGame) => void
  onTick?: (sim: Sim, game: IGame, dtMin: number) => void
  tag?: string
  partner?: Sim
  /** Set when this task is one sim doing something to another. */
  social?: SocialDef
}

export interface Buff {
  id: string
  label: string
  kind: 'good' | 'bad' | 'evil'
  minutesLeft: number
}

const WALK_SPEED = 1.35      // meters per in-game minute
const RUN_SPEED = 2.9
const SWIM_SPEED = 0.72

export class Sim {
  static nextId = 1
  readonly id = Sim.nextId++
  name: string
  surname: string
  avatar: SimAvatar
  traits: TraitBundle
  needs: Needs = makeNeeds(76)
  skills: Record<SkillKey, number> = { cooking: 0, handiness: 0, fitness: 0, swimming: 0, comedy: 0, logic: 0 }

  pos = new THREE.Vector3()
  facing = 0
  private facingGoal = 0
  path: TilePos[] | null = null
  pathIndex = 0
  private repathCooldown = 0

  queue: Task[] = []
  task: Task | null = null
  anim: AnimName = 'idle'
  buffs: Buff[] = []
  thought = ''
  thoughtTimer = 0

  dead = false
  deathId: string | null = null
  isGhost = false
  /** Minutes spent on fire. */
  burning = 0
  /** Minutes of remaining wetness — the ingredient in electrocutions. */
  soaked = 0
  inPool = false
  swimStamina = 100
  /** 50 is comfortable; 0 freezes, 100 cooks. */
  bodyTemp = 50
  hysteria = 0
  rage = 0
  embarrassment = 0
  panicTimer = 0
  /** Minutes spent with the need pinned at zero. */
  starving = 0
  sleepless = 0
  ageDays = 0
  lifespanDays = 0
  /** Set while the sim is being dragged by the player. */
  held = false
  /** Set by systems that own the sim's body this frame (drowning, being eaten). */
  captured: string | null = null
  espressos = 0
  lastMealQuality = 0

  private stepTimer = 0
  private voiceTimer = 0
  /** Seconds of remaining mouth movement from speech. */
  private talkTimer = 0
  /** In-game minutes before this sim will start another social of its own accord. */
  socialCooldown = 0
  /** Where the sim was last frame, for locking the walk cycle to real travel. */
  private lastAvatarPos = new THREE.Vector3()

  constructor(name: string, surname: string, look: SimLook, traitIds: string[], lifespan: number) {
    this.name = name
    this.surname = surname
    this.avatar = new SimAvatar(look)
    this.traits = bundleTraits(traitIds)
    this.lifespanDays = lifespan
  }

  get fullName() { return `${this.name} ${this.surname}` }
  get moodScore() { return needScore(this.needs) }
  get mood() { return moodFor(this.moodScore) }
  get alive() { return !this.dead }

  tileOf(game: IGame): TilePos { return game.grid.worldToTile(this.pos.x, this.pos.z) }

  say(text: string, seconds = 3) {
    this.thought = text
    this.thoughtTimer = seconds
  }

  addBuff(id: string, label: string, kind: Buff['kind'], minutes: number) {
    const existing = this.buffs.find((b) => b.id === id)
    if (existing) { existing.minutesLeft = Math.max(existing.minutesLeft, minutes); return }
    this.buffs.push({ id, label, kind, minutesLeft: minutes })
  }
  hasBuff(id: string) { return this.buffs.some((b) => b.id === id) }
  removeBuff(id: string) { this.buffs = this.buffs.filter((b) => b.id !== id) }

  gainSkill(key: SkillKey, amount: number) {
    this.skills[key] = Math.min(10, this.skills[key] + amount)
  }

  // ------------------------------------------------------------------ tasks

  clearTask(game: IGame) {
    if (this.task?.obj) {
      if (this.task.obj.inUseBy === this) this.task.obj.inUseBy = null
      if (this.task.obj.reservedBy === this) this.task.obj.reservedBy = null
    }
    this.task = null
    this.path = null
  }

  enqueue(task: Task, front = false) {
    if (front) this.queue.unshift(task)
    else this.queue.push(task)
  }

  /** Player-directed interaction: jumps the queue and cancels autonomy. */
  command(game: IGame, obj: WorldObject, inter: Interaction) {
    const stand = inter.stand === 'on' ? obj.centerTile() : obj.useTile(game.grid)
    this.queue = this.queue.filter((t) => t.forced)
    this.enqueue({
      label: `${inter.label} — ${obj.def.name}`,
      obj, inter, stand,
      anim: inter.anim ?? 'stand_use',
      duration: inter.duration,
      needs: inter.needs,
      forced: true, phase: 'route', elapsed: 0, priority: 5,
    }, true)
    if (this.task && this.task.priority < 8) this.clearTask(game)
    this.say(inter.label, 2)
  }

  /** A free tile next to `target` that this sim can actually reach. */
  socialStandTile(game: IGame, target: Sim): TilePos | null {
    const grid = game.grid
    const me = this.tileOf(game)
    const pt = target.tileOf(game)
    const spot = grid.findNearest(pt.x, pt.z, (x, z) =>
      grid.walkable(x, z) && !grid.isPool(x, z) && !(x === pt.x && z === pt.z), { allowStart: false })
    if (!spot) return null
    if (!grid.findPath(me.x, me.z, spot.x, spot.z, { avoidPool: true, allowSolidGoal: true })) return null
    return spot
  }

  /** Player-directed: walk over and do something to another sim. */
  commandSocial(game: IGame, target: Sim, social: SocialDef): boolean {
    if (!this.alive || !target.alive || target === this) return false
    const stand = this.socialStandTile(game, target)
    if (!stand) {
      this.say(`I cannot get to ${target.name}.`, 3)
      game.notify(`<b>${this.name}</b> cannot reach <b>${target.name}</b>.`, 'warn', '🚧')
      return false
    }
    this.queue = this.queue.filter((t) => t.forced)
    this.enqueue({
      label: `${social.label} — ${target.name}`,
      obj: null, inter: null, stand, anim: social.anim,
      duration: social.duration, forced: true, phase: 'route', elapsed: 0,
      priority: 5, tag: 'social', partner: target, social,
    }, true)
    if (this.task && this.task.priority < 8) this.clearTask(game)
    this.say(social.label, 2)
    return true
  }

  simpleTask(label: string, anim: AnimName, duration: number, priority = 1, stand: TilePos | null = null): Task {
    return {
      label, obj: null, inter: null, stand, anim, duration,
      forced: false, phase: stand ? 'route' : 'perform', elapsed: 0, priority,
    }
  }

  // ------------------------------------------------------------------ update

  update(game: IGame, dtMin: number, dtReal: number) {
    if (this.dead) { this.updateGhost(dtMin, dtReal); return }

    this.thoughtTimer -= dtReal
    if (this.thoughtTimer <= 0) this.thought = ''

    this.tickNeeds(game, dtMin)
    this.tickBuffs(dtMin)
    this.tickStatus(game, dtMin)
    if (this.dead) return

    if (!this.held && !this.captured) {
      this.tickTask(game, dtMin)
      this.move(game, dtMin)
    }
    this.updateAvatar(game, dtReal)
  }

  /** 1 = a proper bed, 0.55 = a sofa, 0.2 = the floor. */
  private restQuality(): number {
    const flags = this.task?.obj?.def.flags
    if (flags?.bed) return 1
    if (flags?.seat) return 0.55
    return 0.2
  }

  private tickNeeds(game: IGame, dtMin: number) {
    const d = this.traits.decay
    const rest = this.anim === 'sleep' ? this.restQuality() : 0
    for (const k of NEED_KEYS) {
      let rate = NEED_META[k].decay * d[k]
      if (k === 'energy' && this.anim === 'sleep') {
        // dozing on the floorboards is not rest; it barely keeps them upright
        rate = rest >= 0.5 ? -(0.35 + rest) : (this.needs.energy < 7 ? -0.5 : rate)
      }
      if (k === 'bladder' && this.espressos > 0) rate *= 1 + this.espressos * 0.5
      if (k === 'comfort' && (this.anim === 'sit' || this.anim === 'sleep')) rate = -0.5
      this.needs[k] -= rate * dtMin
    }
    if (this.inPool) this.needs.hygiene = Math.min(100, this.needs.hygiene + 0.05 * dtMin)
    clampNeeds(this.needs)

    // ---- lethal need thresholds
    if (this.needs.hunger <= 0.01) {
      this.starving += dtMin
      if (this.starving > 60 && !this.hasBuff('starving')) {
        this.addBuff('starving', 'Starving', 'bad', 999)
        this.say('I could eat a... anything.', 4)
      }
      // roughly 22 in-game hours at zero
      if (this.starving > 900) { game.kill(this, 'starvation'); return }
    } else if (this.starving > 0) {
      this.starving = Math.max(0, this.starving - dtMin * 2)
      if (this.starving === 0) this.removeBuff('starving')
    }

    // sleep debt: only real rest clears it
    if (this.needs.energy <= 9) {
      this.sleepless += dtMin
      if (this.sleepless > 90 && !this.hasBuff('sleepless')) {
        this.addBuff('sleepless', 'Beyond Exhausted', 'bad', 999)
      }
      if (this.sleepless > 1080) { game.kill(this, 'exhaustion'); return }
    } else if (this.needs.energy > 45) {
      this.sleepless = Math.max(0, this.sleepless - dtMin * 2)
      if (this.sleepless === 0) this.removeBuff('sleepless')
    }

    // ---- emotional pressure
    if (this.needs.fun <= 6) this.rage += dtMin * 0.05 * this.traits.temper
    if (this.needs.social <= 6) this.rage += dtMin * 0.03 * this.traits.temper
    if (this.needs.comfort <= 6) this.rage += dtMin * 0.04 * this.traits.temper
    if (this.needs.hygiene <= 6) this.embarrassment += dtMin * 0.02 * this.traits.shame
    this.rage = Math.max(0, Math.min(100, this.rage - dtMin * 0.012))
    this.embarrassment = Math.max(0, Math.min(100, this.embarrassment - dtMin * 0.042))
    this.hysteria = Math.max(0, Math.min(100, this.hysteria - dtMin * 0.05))

    if (this.rage >= 100) { game.kill(this, 'rage'); return }
    if (this.embarrassment >= 100) { game.kill(this, 'mortification'); return }
    if (this.hysteria >= 100) { game.kill(this, 'hysteria'); return }

    if (this.rage > 70 && !this.hasBuff('furious')) this.addBuff('furious', 'Furious', 'bad', 60)
    if (this.embarrassment > 70 && !this.hasBuff('mortified')) this.addBuff('mortified', 'Mortified', 'bad', 60)
    if (this.hysteria > 70 && !this.hasBuff('hysterical')) this.addBuff('hysterical', 'Hysterical', 'evil', 60)

    // ---- ageing
    this.ageDays += dtMin / 1440
    if (this.ageDays >= this.lifespanDays) { game.kill(this, 'oldage'); return }
  }

  private tickBuffs(dtMin: number) {
    for (const b of this.buffs) b.minutesLeft -= dtMin
    this.buffs = this.buffs.filter((b) => b.minutesLeft > 0)
    if (this.espressos > 0) {
      this.espressos = Math.max(0, this.espressos - dtMin / 240)
    }
    this.socialCooldown = Math.max(0, this.socialCooldown - dtMin)
  }

  private tickStatus(game: IGame, dtMin: number) {
    const grid = game.grid
    const t = this.tileOf(game)
    this.inPool = grid.isPool(t.x, t.z)

    // --- on fire
    if (this.burning > 0) {
      this.burning += dtMin
      this.needs.hygiene = 0
      this.bodyTemp = Math.min(90, this.bodyTemp + dtMin * 4)
      if (this.inPool || game.puddleAt(t.x, t.z)) {
        this.burning = 0
        this.addBuff('singed', 'Singed But Alive', 'bad', 240)
        this.avatar.tint(null)
        game.notify(`<b>${this.name}</b> put themselves out. How disappointing.`, 'warn', '💧')
      } else if (this.burning > 12) {
        game.kill(this, 'fire'); return
      }
    }

    // --- wet / puddles
    if (this.inPool) this.soaked = Math.max(this.soaked, 90)
    if (game.puddleAt(t.x, t.z)) this.soaked = Math.max(this.soaked, 45)
    if (this.soaked > 0) this.soaked = Math.max(0, this.soaked - dtMin)

    // --- body temperature drifts back to comfortable
    this.bodyTemp += (50 - this.bodyTemp) * Math.min(1, dtMin * 0.012)
    if (this.bodyTemp <= 2) { game.kill(this, 'freezing'); return }
    if (this.bodyTemp >= 98) { game.kill(this, 'steam'); return }
    if (this.bodyTemp < 18 && !this.hasBuff('freezing')) this.addBuff('freezing', 'Freezing', 'bad', 30)
    if (this.bodyTemp > 82 && !this.hasBuff('overheating')) this.addBuff('overheating', 'Overheating', 'bad', 30)

    // --- swimming
    if (this.inPool) {
      const canGetOut = grid.canReach(t.x, t.z, (x, z) => !grid.isPool(x, z) || grid.poolExit[grid.idx(x, z)] === 1)
      const drain = canGetOut ? 0.25 : 1.5
      this.swimStamina -= dtMin * drain / Math.max(0.35, this.traits.swim)
      this.swimStamina -= dtMin * (this.needs.energy < 20 ? 0.5 : 0)
      if (this.swimStamina < 45 && !canGetOut && !this.hasBuff('trappedwater')) {
        this.addBuff('trappedwater', 'No Way Out', 'evil', 999)
        this.say('...where are the steps?', 5)
        game.notify(`<b>${this.name}</b> cannot find a way out of the pool.`, 'danger', '🌊')
      }
      if (this.swimStamina <= 0) { game.kill(this, 'drowning'); return }
    } else if (this.swimStamina < 100) {
      this.swimStamina = Math.min(100, this.swimStamina + dtMin * 1.2)
      this.removeBuff('trappedwater')
    }

    // --- bladder failure
    if (this.needs.bladder <= 0.01 && !this.hasBuff('wetself')) {
      this.wetSelf(game)
    }

    // --- panic response to nearby fire
    if (this.panicTimer > 0) this.panicTimer -= dtMin
  }

  private wetSelf(game: IGame) {
    const t = this.tileOf(game)
    game.makePuddle(t.x, t.z, 'urine')
    this.needs.bladder = 42
    this.needs.hygiene = Math.max(0, this.needs.hygiene - 45)
    this.soaked = Math.max(this.soaked, 60)
    this.addBuff('wetself', 'Had An Accident', 'bad', 240)
    audio.play('toilet_fail', this.pos)
    // witnesses make it so much worse
    const witnesses = game.sims.filter((s) => s !== this && s.alive && s.pos.distanceTo(this.pos) < 7).length
    // capped so a single humiliating moment is never instantly fatal
    const shameHit = Math.min(42, 22 * this.traits.shame * (1 + witnesses * 0.45))
    this.embarrassment += shameHit
    for (const s of game.sims) {
      if (s === this || !s.alive) continue
      if (s.pos.distanceTo(this.pos) < 7) {
        s.hysteria += 16 * s.traits.mirth
        s.say('😂', 3)
        audio.play('laugh', s.pos)
      }
    }
    game.notify(
      `<b>${this.name}</b> had an accident${witnesses ? ` in front of ${witnesses} witness${witnesses > 1 ? 'es' : ''}` : ''}.`,
      'warn', '💦')
    this.say('Oh no. Oh no no no.', 4)
  }

  /** Called by the fire system when flames are close. */
  reactToDanger(game: IGame, dangerPos: THREE.Vector3, severity: number) {
    if (this.dead || this.held) return
    const fear = severity * this.traits.bravery
    if (fear < 0.35) return
    this.panicTimer = Math.max(this.panicTimer, 8)
    if (this.voiceTimer <= 0) {
      audio.play('panic', this.pos)
      this.voiceTimer = 2.5
    }
    if (this.task && this.task.priority >= 8) return
    // run to the furthest safe tile we can reach
    const grid = game.grid
    const t = this.tileOf(game)
    // outdoors and well clear of the flames, or failing that just well clear
    let safe = grid.findNearest(t.x, t.z, (x, z) => {
      if (grid.isPool(x, z) || grid.isIndoors(x, z)) return false
      const [wx, wz] = grid.tileToWorld(x, z)
      return Math.hypot(wx - dangerPos.x, wz - dangerPos.z) > 6
    }, { allowStart: false, avoidPool: true, maxNodes: 2500 })
    if (!safe) {
      safe = grid.findNearest(t.x, t.z, (x, z) => {
        const [wx, wz] = grid.tileToWorld(x, z)
        return Math.hypot(wx - dangerPos.x, wz - dangerPos.z) > 8 && !grid.isPool(x, z)
      }, { allowStart: false, avoidPool: true })
    }
    this.clearTask(game)
    this.task = {
      ...this.simpleTask('Panicking!', 'panic', 6, 9, safe),
      phase: safe ? 'route' : 'perform',
    }
    if (!safe) this.say('WE ARE ALL GOING TO DIE', 3)
  }

  // ------------------------------------------------------------------ task loop

  private tickTask(game: IGame, dtMin: number) {
    if (this.burning > 0) {
      if (this.task?.tag !== 'burning') {
        this.clearTask(game)
        this.task = { ...this.simpleTask('On fire!', 'burn', -1, 10), tag: 'burning' }
        // a burning sim runs for water if there is any
        const grid = game.grid
        const t = this.tileOf(game)
        const water = grid.findNearest(t.x, t.z, (x, z) => grid.isPool(x, z) || game.puddleAt(x, z), { allowStart: false })
        if (water && Math.random() < 0.5) { this.task.stand = water; this.task.phase = 'route' }
      }
      return
    }

    if (this.inPool && this.task && this.task.priority < 8) {
      // swimming overrides fussy animations
      this.task.anim = 'swim'
    }

    if (!this.task) {
      if (this.queue.length) {
        this.task = this.queue.shift()!
        if (this.task.obj) this.task.obj.reservedBy = this
      } else {
        const chosen = this.chooseAutonomy(game)
        if (chosen) {
          this.task = chosen
          if (chosen.obj) chosen.obj.reservedBy = this
        } else {
          this.task = this.wanderTask(game)
        }
      }
    }
    const task = this.task
    if (!task) return

    if (task.phase === 'route') {
      if (!task.stand) { task.phase = 'perform'; this.path = null }
      else if (this.arrivedAt(game, task.stand)) {
        task.phase = 'perform'
        task.routeElapsed = 0
        this.path = null
        if (task.obj) {
          task.obj.inUseBy = this
          this.faceToward(task.obj.centerWorld)
          if (task.inter?.onStart) {
            task.inter.onStart({ sim: this, obj: task.obj, game, elapsed: 0 })
          }
        }
      } else {
        this.ensurePath(game, task.stand)

        // Watchdog: no route may run forever. Without this, a task whose goal
        // becomes unreachable mid-walk leaves the sim jogging on the spot.
        task.routeElapsed = (task.routeElapsed ?? 0) + dtMin
        if (task.routeElapsed > 120) {
          if (task.priority < 8) {
            this.rage += 2 * this.traits.temper
            this.say('I give up.', 3)
            this.clearTask(game)
          } else {
            // an emergency still has to happen, so do it where they stand
            task.stand = null
            task.phase = 'perform'
            this.path = null
          }
          return
        }

        // Only animate locomotion when there is actually a step to take.
        const walking = !!this.path && this.pathIndex < this.path.length
        this.anim = this.inPool ? 'swim'
          : walking ? (this.panicTimer > 0 ? 'run' : 'walk')
          : (this.panicTimer > 0 ? 'panic' : 'idle')
        return
      }
    }

    // performing
    this.anim = this.inPool ? 'swim' : task.anim
    task.elapsed += dtMin

    if (task.needs) {
      for (const k in task.needs) {
        this.needs[k as NeedKey] += task.needs[k as NeedKey]! * dtMin
      }
      clampNeeds(this.needs)
    }
    if (task.obj && task.inter) {
      const ctx: InteractionCtx = { sim: this, obj: task.obj, game, elapsed: task.elapsed }
      task.inter.onTick?.(ctx, dtMin)
      task.obj.wear += dtMin
      if (task.inter.skill) this.gainSkill(task.inter.skill.key, task.inter.skill.rate * dtMin)
      if (task.obj.onFire || task.obj.charred || task.obj.locked) {
        this.finishTask(game, true)
        return
      }
      if (task.inter.endWhen?.(ctx)) { this.finishTask(game, false); return }
    }
    if (task.social && task.partner) {
      const target = task.partner
      if (!target.alive || target.held) { this.finishTask(game, true); return }
      if (target.pos.distanceTo(this.pos) > 3.6) { this.finishTask(game, true); return }
      this.faceToward(target.pos)
      // pin the target into a reaction so the exchange reads as one beat
      if (!target.task || target.task.priority <= 2) {
        target.clearTask(game)
        target.task = {
          ...target.simpleTask(`${this.name}: ${task.social.label}`, task.social.targetAnim,
            task.social.duration, 2),
          tag: 'social', partner: this,
          onTick: (o) => o.faceToward(this.pos),
        }
      }
    }

    task.onTick?.(this, game, dtMin)

    if (task.duration >= 0 && task.elapsed >= task.duration) this.finishTask(game, false)
  }

  private finishTask(game: IGame, aborted: boolean) {
    const task = this.task
    if (!task) return
    if (!aborted && task.obj && task.inter?.onFinish) {
      task.inter.onFinish({ sim: this, obj: task.obj, game, elapsed: task.elapsed })
    }
    if (!aborted && task.social && task.partner?.alive) {
      const ctx: SocialCtx = { actor: this, target: task.partner, game }
      task.social.apply(ctx)
      game.relationships.adjustMutual(this, task.partner, task.social.relation)
      game.noteSocial(this, task.partner, task.social)
      this.socialCooldown = 50
      task.partner.socialCooldown = Math.max(task.partner.socialCooldown, 25)
      clampNeeds(task.partner.needs)
      clampNeeds(this.needs)
    }
    if (!aborted) task.onFinish?.(this, game)
    this.clearTask(game)
  }

  /**
   * Picks an unprompted social. Every mean social scores off how much this sim
   * already dislikes the target, so a household at peace stays civil — the
   * player has to sour something first, after which it sustains itself.
   */
  private findSpitefulSocial(game: IGame): { score: number; task: Task } | null {
    if (this.socialCooldown > 0 || this.burning > 0 || this.panicTimer > 0) return null
    let best: { score: number; social: SocialDef; target: Sim } | null = null

    for (const target of game.sims) {
      if (target === this || !target.alive || target.held || target.captured) continue
      if (target.burning > 0) continue
      const dist = target.pos.distanceTo(this.pos)
      if (dist > 16) continue
      for (const social of SOCIALS) {
        if (!social.autonomy) continue
        const ctx: SocialCtx = { actor: this, target, game }
        if (social.requires && !social.requires(ctx)) continue
        const score = social.autonomy(ctx) / (1 + dist * 0.09)
        if (score <= 0) continue
        if (!best || score > best.score) best = { score, social, target }
      }
    }
    if (!best || best.score < 1.1) return null

    const stand = this.socialStandTile(game, best.target)
    if (!stand) return null
    return {
      score: best.score,
      task: {
        label: `${best.social.label} — ${best.target.name}`,
        obj: null, inter: null, stand, anim: best.social.anim,
        duration: best.social.duration, forced: false, phase: 'route', elapsed: 0,
        priority: 2, tag: 'social', partner: best.target, social: best.social,
      },
    }
  }

  /** Walk over to another sim and talk at them for a while. */
  private findChatPartner(game: IGame): Task | null {
    const grid = game.grid
    const t = this.tileOf(game)
    const candidates = game.sims.filter((s) =>
      s !== this && s.alive && !s.held && !s.captured && s.burning === 0 && s.panicTimer <= 0)
    if (!candidates.length) return null
    candidates.sort((a, b) => a.pos.distanceTo(this.pos) - b.pos.distanceTo(this.pos))
    for (const partner of candidates.slice(0, 3)) {
      const pt = partner.tileOf(game)
      const spot = grid.findNearest(pt.x, pt.z, (x, z) =>
        grid.walkable(x, z) && !grid.isPool(x, z) && !(x === t.x && z === t.z), { allowStart: false })
      if (!spot) continue
      if (!grid.findPath(t.x, t.z, spot.x, spot.z, { avoidPool: true })) continue
      return {
        label: `Chat with ${partner.name}`,
        obj: null, inter: null, stand: spot, anim: 'wave',
        duration: 26, forced: false, phase: 'route', elapsed: 0, priority: 2,
        tag: 'social', partner,
        needs: { social: 2.1, fun: 0.6 },
        onTick: (sim, g, dt) => {
          if (!partner.alive) { sim.clearTask(g); return }
          if (partner.pos.distanceTo(sim.pos) > 3.4) { sim.clearTask(g); return }
          sim.faceToward(partner.pos)
          partner.needs.social = Math.min(100, partner.needs.social + dt * 1.6)
          partner.needs.fun = Math.min(100, partner.needs.fun + dt * 0.4)
          // hold the other sim in place so the conversation reads as one
          if (!partner.task || partner.task.priority <= 1) {
            partner.clearTask(g)
            partner.task = {
              ...partner.simpleTask(`Chat with ${sim.name}`, 'wave', 24, 2),
              tag: 'social', partner: sim,
              onTick: (o) => o.faceToward(sim.pos),
            }
          }
          if (g.rand.next() < dt * 0.09) {
            const speaker = g.rand.chance(0.5) ? sim : partner
            const mood = speaker.moodScore > 65 ? 'happy' : speaker.moodScore < 30 ? 'sad' : 'neutral'
            const syllables = 2 + Math.floor(g.rand.next() * 3)
            audio.speak(speaker.id * 37 + 11, syllables, mood, speaker.pos)
            speaker.talkTimer = syllables * 0.16
          }
        },
      }
    }
    return null
  }

  private wanderTask(game: IGame): Task {
    const grid = game.grid
    const t = this.tileOf(game)
    // most of the time a contented sim just stands about
    if (game.rand.next() < 0.45) {
      return this.simpleTask('Relaxing', 'idle', 8 + game.rand.next() * 20, 0)
    }
    let target: TilePos | null = null
    for (let i = 0; i < 8; i++) {
      const x = t.x + Math.floor((Math.random() - 0.5) * 12)
      const z = t.z + Math.floor((Math.random() - 0.5) * 12)
      if (grid.walkable(x, z) && !grid.isPool(x, z)) { target = { x, z }; break }
    }
    return {
      ...this.simpleTask('Wandering', 'walk', 6, 0, target),
      phase: target ? 'route' : 'perform',
    }
  }

  // ------------------------------------------------------------------ autonomy

  private chooseAutonomy(game: IGame): Task | null {
    const grid = game.grid
    const t = this.tileOf(game)

    // desperate measures first
    if (this.needs.energy <= 1.5) {
      const bed = this.bestObject(game, (o) =>
        (!!o.def.flags?.bed || !!o.def.flags?.seat) && o.isUsable && !o.inUseBy)
      if (!bed) {
        this.say('I will just... lie down here.', 4)
        return this.simpleTask('Collapsing', 'sleep', 180, 6)
      }
    }
    if (this.needs.bladder <= 4) {
      const loo = this.bestObject(game, (o) => o.def.id === 'toilet' && o.isUsable && !o.inUseBy)
      if (!loo) this.say('Where is the toilet?! WHERE IS THE TOILET?', 4)
    }

    let best: { score: number; obj: WorldObject; inter: Interaction; stand: TilePos } | null = null
    for (const obj of game.objects) {
      if (!obj.def.interactions?.length) continue
      if (!obj.isUsable) continue
      if (obj.inUseBy && obj.inUseBy !== this) continue
      if (obj.reservedBy && obj.reservedBy !== this) continue

      for (const inter of obj.def.interactions) {
        if (inter.hidden) continue
        const stand = inter.stand === 'on' ? obj.centerTile() : obj.useTile(grid)
        if (!stand) continue
        const dist = Math.hypot(stand.x - t.x, stand.z - t.z)
        if (dist > 40) continue
        const ctx: InteractionCtx = { sim: this, obj, game, elapsed: 0 }
        if (inter.requires && !inter.requires(ctx)) continue
        let score = inter.autonomy ? inter.autonomy(ctx) : this.defaultDesire(inter)
        if (score <= 0) continue
        if (this.traits.likes.has(inter.id)) score *= 1.5
        if (this.traits.dislikes.has(inter.id)) score *= 0.25
        score /= 1 + dist * 0.055
        if (best === null || score > best.score) best = { score, obj, inter, stand }
      }
    }

    // sims who already dislike each other need no encouragement from the player
    const spite = this.findSpitefulSocial(game)
    if (spite && spite.score > (best?.score ?? 0)) return spite.task

    // talking to someone is often the best thing on offer
    const socialWant = 6.5 * Math.pow(1 - this.needs.social / 100, 2.2)
    if (socialWant > (best?.score ?? 0) && socialWant > 0.5) {
      const chat = this.findChatPartner(game)
      if (chat) return chat
    }

    if (!best || best.score < 0.22) return null
    // reachability: this is where a walled-off room or a missing ladder bites
    const path = grid.findPath(t.x, t.z, best.stand.x, best.stand.z, {
      avoidPool: !this.inPool && this.traits.swim < 1.5 && !grid.isPool(best.stand.x, best.stand.z),
      allowSolidGoal: true,
    })
    if (!path) {
      if (Math.random() < 0.04) {
        this.say('I cannot get there.', 3)
        this.rage += 2.5 * this.traits.temper
      }
      return null
    }
    return {
      label: `${best.inter.label} — ${best.obj.def.name}`,
      obj: best.obj, inter: best.inter, stand: best.stand,
      anim: best.inter.anim ?? 'stand_use',
      duration: best.inter.duration,
      needs: best.inter.needs,
      forced: false, phase: 'route', elapsed: 0, priority: 1,
    }
  }

  private defaultDesire(inter: Interaction): number {
    if (!inter.needs) return 0
    let total = 0
    for (const k in inter.needs) {
      const gain = inter.needs[k as NeedKey]!
      if (gain <= 0) continue
      const deficit = 1 - this.needs[k as NeedKey] / 100
      total += gain * Math.pow(deficit, 2.4) * 12
    }
    return total
  }

  bestObject(game: IGame, test: (o: WorldObject) => boolean): WorldObject | null {
    const t = this.tileOf(game)
    let best: WorldObject | null = null
    let bestD = Infinity
    for (const o of game.objects) {
      if (!test(o)) continue
      const st = o.useTile(game.grid)
      if (!st) continue
      if (!game.grid.findPath(t.x, t.z, st.x, st.z, { avoidPool: true, allowSolidGoal: true })) continue
      const d = Math.hypot(st.x - t.x, st.z - t.z)
      if (d < bestD) { bestD = d; best = o }
    }
    return best
  }

  // ------------------------------------------------------------------ movement

  private arrivedAt(game: IGame, tile: TilePos) {
    const [wx, wz] = game.grid.tileToWorld(tile.x, tile.z)
    return Math.hypot(this.pos.x - wx, this.pos.z - wz) < 0.28
  }

  private ensurePath(game: IGame, goal: TilePos) {
    this.repathCooldown -= 1
    if (this.path && this.pathIndex < this.path.length) return
    if (this.repathCooldown > 0) return
    const t = this.tileOf(game)
    const avoid = !this.inPool && this.traits.swim < 1.5 && !game.grid.isPool(goal.x, goal.z)
    const p = game.grid.findPath(t.x, t.z, goal.x, goal.z, { avoidPool: avoid, allowSolidGoal: true })
    if (!p) {
      this.repathCooldown = 40
      // unreachable: give up on this task
      if (this.task && this.task.priority < 8) {
        this.rage += 1.5 * this.traits.temper
        this.clearTask(game)
      }
      return
    }
    // An empty path means the sim is already standing in the goal tile, but it
    // may be off-center after an interrupted walk - close enough to path to,
    // too far to count as arrived. Give it the tile center as a waypoint so it
    // finishes the last step instead of walking on the spot forever.
    this.path = p.length ? p : [{ x: goal.x, z: goal.z }]
    this.pathIndex = 0
  }

  private move(game: IGame, dtMin: number) {
    if (!this.path || this.pathIndex >= this.path.length) return
    const next = this.path[this.pathIndex]
    const [wx, wz] = game.grid.tileToWorld(next.x, next.z)
    const dx = wx - this.pos.x, dz = wz - this.pos.z
    const dist = Math.hypot(dx, dz)
    let speed = this.inPool ? SWIM_SPEED * this.traits.swim : (this.panicTimer > 0 || this.burning > 0 ? RUN_SPEED : WALK_SPEED)
    if (this.needs.energy < 18) speed *= 0.7
    if (this.hasBuff('freezing')) speed *= 0.6
    const step = speed * dtMin

    if (dist <= step || dist < 0.02) {
      this.pos.x = wx
      this.pos.z = wz
      this.pathIndex++
      this.stepTimer = 0
      if (!this.inPool) {
        audio.play(game.puddleAt(next.x, next.z) ? 'step_wet' : 'step', this.pos)
      }
    } else {
      this.pos.x += (dx / dist) * step
      this.pos.z += (dz / dist) * step
      this.facingGoal = Math.atan2(dx, dz)
    }
    this.anim = this.inPool ? 'swim' : (this.panicTimer > 0 || this.burning > 0 ? 'run' : 'walk')
  }

  faceToward(p: THREE.Vector3) {
    this.facingGoal = Math.atan2(p.x - this.pos.x, p.z - this.pos.z)
  }

  /** Which face this sim should be wearing right now. */
  private expressionFor(): Expression {
    if (this.dead) return 'dead'
    if (this.burning > 0 || this.panicTimer > 0) return 'scared'
    if (this.anim === 'laugh' || this.hysteria > 60) return 'laugh'
    if (this.anim === 'cry' || this.embarrassment > 60) return 'sad'
    if (this.rage > 55) return 'angry'
    if (this.anim === 'sleep' || this.needs.energy < 18 || this.hasBuff('sleepless')) return 'tired'
    const m = this.moodScore
    if (m > 70) return 'happy'
    if (m < 34) return 'sad'
    return 'neutral'
  }

  private updateAvatar(game: IGame, dtReal: number) {
    this.voiceTimer -= dtReal
    this.talkTimer -= dtReal
    // smooth turn
    let diff = this.facingGoal - this.facing
    while (diff > Math.PI) diff -= Math.PI * 2
    while (diff < -Math.PI) diff += Math.PI * 2
    this.facing += diff * Math.min(1, dtReal * 9)

    let y = 0
    const t = this.tileOf(game)
    if (game.grid.isPool(t.x, t.z)) y = -0.35
    this.avatar.root.position.set(this.pos.x, y, this.pos.z)
    this.avatar.root.rotation.y = this.facing

    const speed = this.anim === 'run' ? 2 : 1
    // ground distance covered since the last frame drives the walk cycle
    const moved = Math.hypot(this.pos.x - this.lastAvatarPos.x, this.pos.z - this.lastAvatarPos.z)
    this.lastAvatarPos.copy(this.pos)
    const locomotion = this.anim === 'walk' || this.anim === 'run'
    this.avatar.setExpression(this.expressionFor())
    this.avatar.update(dtReal, this.anim, speed, 9, locomotion ? moved : -1)
    const now = performance.now() * 0.001
    this.avatar.setMouth(
      this.talkTimer > 0 ? 0.28 + Math.sin(now * 19 + this.id) * 0.26 :
      this.anim === 'eat' ? 0.5 + Math.sin(now * 10) * 0.3 :
      this.anim === 'panic' || this.anim === 'burn' ? 0.9 : 0)

    // idle chatter
    if (this.voiceTimer <= 0 && Math.random() < dtReal * 0.05) {
      const emotion = this.moodScore > 65 ? 'happy' : this.moodScore < 30 ? 'sad' : 'neutral'
      const syllables = 2 + Math.floor(Math.random() * 3)
      audio.speak(this.id * 37 + 11, syllables, emotion, this.pos)
      this.talkTimer = syllables * 0.16
      this.voiceTimer = 5 + Math.random() * 8
    }
  }

  private updateGhost(dtMin: number, dtReal: number) {
    if (!this.isGhost) return
    this.avatar.setExpression('dead')
    this.pos.y = 0.55 + Math.sin(performance.now() * 0.0012 + this.id) * 0.22
    this.avatar.root.position.copy(this.pos)
    this.avatar.root.rotation.y += dtReal * 0.25
    this.avatar.update(dtReal, 'idle', 0.4, 3)
  }

  /** Freeze the body in a final pose and switch to spectral rendering. */
  becomeGhost() {
    this.isGhost = true
    this.avatar.setGhost(true)
    this.avatar.setSelected(false)
    this.anim = 'idle'
  }

  needSummary(): { key: NeedKey; value: number }[] {
    return NEED_KEYS.map((k) => ({ key: k, value: this.needs[k] }))
  }
}
