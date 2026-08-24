import type { AnimName } from '../world/ObjectTypes'
import type { IGame } from '../types'
import type { Sim } from './Sim'
import { audio } from '../core/Audio'

export interface SocialCtx {
  actor: Sim
  target: Sim
  game: IGame
}

export interface SocialDef {
  id: string
  label: string
  /** Drives the menu styling. */
  tone: 'friendly' | 'mean' | 'cruel'
  /** In-game minutes. */
  duration: number
  anim: AnimName
  targetAnim: AnimName
  /** Relationship change, actor -> target. The target feels it harder. */
  relation: number
  hint?: string
  /** Shown in red — this one can end somebody. */
  danger?: string
  requires?: (ctx: SocialCtx) => boolean
  /** Runs the moment the sims are in position. */
  onStart?: (ctx: SocialCtx) => void
  /** Runs when the interaction completes. */
  apply: (ctx: SocialCtx) => void
  /** Relative desire for an unprompted sim. 0 means player-only. */
  autonomy?: (ctx: SocialCtx) => number
}

/** Everyone close enough to enjoy the show. */
function witnesses(ctx: SocialCtx, radius = 7): Sim[] {
  return ctx.game.sims.filter((s) =>
    s !== ctx.actor && s !== ctx.target && s.alive && s.pos.distanceTo(ctx.target.pos) < radius)
}

function react(target: Sim, text: string) {
  target.say(text, 3)
}

/** Bystanders find cruelty funny, which is its own problem for them. */
function amuseWitnesses(ctx: SocialCtx, amount: number) {
  for (const w of witnesses(ctx)) {
    w.hysteria += amount * w.traits.mirth
    w.needs.fun = Math.min(100, w.needs.fun + amount * 0.5)
    if (ctx.game.rand.chance(0.4)) {
      audio.play('laugh', w.pos)
      w.say('😂', 2)
    }
  }
}

const hostility = (ctx: SocialCtx) => -ctx.game.relationships.get(ctx.actor, ctx.target) / 100

export const SOCIALS: SocialDef[] = [
  // ------------------------------------------------------------- friendly
  {
    id: 'compliment', label: 'Pay a Compliment', tone: 'friendly',
    duration: 12, anim: 'wave', targetAnim: 'wave', relation: 14,
    hint: 'Useful for repairing a friendship you want to betray later.',
    apply: (c) => {
      c.target.needs.social = Math.min(100, c.target.needs.social + 22)
      c.target.needs.fun = Math.min(100, c.target.needs.fun + 12)
      c.target.embarrassment = Math.max(0, c.target.embarrassment - 12)
      c.target.rage = Math.max(0, c.target.rage - 10)
      react(c.target, 'That is kind of you.')
    },
    autonomy: (c) => Math.max(0, c.game.relationships.get(c.actor, c.target) / 100) * 1.2,
  },

  // ------------------------------------------------------------- mean
  {
    id: 'insult', label: 'Insult Them', tone: 'mean',
    duration: 10, anim: 'taunt', targetAnim: 'recoil', relation: -14,
    hint: 'Builds rage. Rage, left to accumulate, is fatal.',
    apply: (c) => {
      c.target.rage += 16 * c.target.traits.temper
      c.target.embarrassment += 8 * c.target.traits.shame
      c.target.needs.social -= 18
      c.target.needs.fun -= 10
      c.actor.needs.fun = Math.min(100, c.actor.needs.fun + 8)
      audio.speak(c.actor.id * 37 + 11, 4, 'angry', c.actor.pos)
      react(c.target, 'Excuse me?')
    },
    autonomy: (c) => hostility(c) * 2.2,
  },
  {
    id: 'mock', label: 'Mock Their Appearance', tone: 'mean',
    duration: 12, anim: 'taunt', targetAnim: 'cower', relation: -16,
    hint: 'Lands far harder on a sim who has not showered.',
    apply: (c) => {
      const filth = 1 + (100 - c.target.needs.hygiene) / 45
      c.target.embarrassment += 18 * c.target.traits.shame * filth
      c.target.needs.fun -= 14
      c.actor.needs.fun = Math.min(100, c.actor.needs.fun + 10)
      amuseWitnesses(c, 8)
      react(c.target, 'I showered... recently.')
    },
    autonomy: (c) => hostility(c) * 1.6 * (c.target.needs.hygiene < 40 ? 2 : 1),
  },
  {
    id: 'blame', label: 'Blame Them for Everything', tone: 'mean',
    duration: 14, anim: 'argue', targetAnim: 'argue', relation: -18,
    hint: 'The fastest way to fill a rage meter.',
    apply: (c) => {
      c.target.rage += 26 * c.target.traits.temper
      c.target.needs.social -= 22
      c.actor.rage += 6
      audio.speak(c.actor.id * 37 + 11, 5, 'angry', c.actor.pos)
      react(c.target, 'That is not remotely fair.')
    },
    autonomy: (c) => hostility(c) * 1.8,
  },
  {
    id: 'cruelJoke', label: 'Tell a Cruel Joke About Them', tone: 'mean',
    duration: 14, anim: 'laugh', targetAnim: 'cower', relation: -15,
    hint: 'Everyone watching finds it hilarious. Hysteria is also fatal.',
    apply: (c) => {
      c.target.embarrassment += 16 * c.target.traits.shame
      c.target.needs.fun -= 16
      c.actor.needs.fun = Math.min(100, c.actor.needs.fun + 16)
      c.actor.hysteria += 10 * c.actor.traits.mirth
      amuseWitnesses(c, 18)
      audio.play('laugh', c.actor.pos)
      react(c.target, 'Everyone is laughing at me.')
    },
    autonomy: (c) => hostility(c) * 1.4 * c.actor.traits.mirth,
  },
  {
    id: 'laughAt', label: 'Laugh at Their Misfortune', tone: 'cruel',
    duration: 10, anim: 'laugh', targetAnim: 'cry', relation: -22,
    hint: 'Only available while they are visibly having a bad time.',
    danger: 'Kicks a sim who is already down. Mortification is cumulative.',
    requires: (c) => c.target.buffs.some((b) => b.kind === 'bad') || c.target.needs.hygiene < 25,
    apply: (c) => {
      c.target.embarrassment += 30 * c.target.traits.shame
      c.target.rage += 12 * c.target.traits.temper
      c.target.needs.fun -= 24
      c.actor.needs.fun = Math.min(100, c.actor.needs.fun + 20)
      amuseWitnesses(c, 22)
      audio.play('laugh', c.actor.pos)
      c.game.floatText(c.target.pos.x, 1.9, c.target.pos.z, '😳', '#ff8ab0')
      react(c.target, 'I want to disappear.')
    },
    autonomy: (c) => hostility(c) * 1.5,
  },
  {
    id: 'argue', label: 'Pick an Argument', tone: 'mean',
    duration: 20, anim: 'argue', targetAnim: 'argue', relation: -12,
    hint: 'A shouting match. Both of them come away angrier than they went in.',
    apply: (c) => {
      c.target.rage += 20 * c.target.traits.temper
      c.actor.rage += 9 * c.actor.traits.temper
      c.target.needs.social -= 16
      c.target.needs.fun -= 12
      c.actor.needs.fun -= 4
      audio.speak(c.actor.id * 37 + 11, 5, 'angry', c.actor.pos)
      audio.speak(c.target.id * 37 + 11, 4, 'angry', c.target.pos)
      c.game.floatText(c.target.pos.x, 2.0, c.target.pos.z, '💢', '#ff8a4a')
      react(c.target, 'You never listen!')
    },
    autonomy: (c) => hostility(c) * 2.0 * c.actor.traits.temper,
  },
  {
    id: 'spit', label: 'Spit On Them', tone: 'cruel',
    duration: 6, anim: 'taunt', targetAnim: 'recoil', relation: -32,
    hint: 'Filthy, humiliating, and it ruins whatever washing they had done.',
    apply: (c) => {
      c.target.needs.hygiene = Math.max(0, c.target.needs.hygiene - 38)
      c.target.embarrassment += 24 * c.target.traits.shame
      c.target.rage += 26 * c.target.traits.temper
      c.target.soaked = Math.max(c.target.soaked, 20)
      c.target.addBuff('spatupon', 'Spat Upon', 'bad', 300)
      c.game.floatText(c.target.pos.x, 1.9, c.target.pos.z, '💧', '#a8e04a')
      amuseWitnesses(c, 16)
      react(c.target, 'Did you just — ?')
    },
    autonomy: (c) => Math.max(0, hostility(c) - 0.55) * 1.8,
  },
  {
    id: 'throwDrink', label: 'Throw a Drink in Their Face', tone: 'cruel',
    duration: 8, anim: 'shove', targetAnim: 'recoil', relation: -30,
    hint: 'Leaves them soaking wet for hours.',
    danger: 'A wet sim plus a broken appliance is an electrocution.',
    apply: (c) => {
      c.target.soaked = Math.max(c.target.soaked, 160)
      c.target.needs.hygiene = Math.max(0, c.target.needs.hygiene - 18)
      c.target.embarrassment += 22 * c.target.traits.shame
      c.target.rage += 22 * c.target.traits.temper
      c.target.needs.comfort -= 24
      const t = c.target.tileOf(c.game)
      c.game.makePuddle(t.x, t.z, 'water')
      c.game.splash(c.target.pos.x, 1.2, c.target.pos.z)
      audio.play('splash', c.target.pos)
      amuseWitnesses(c, 16)
      react(c.target, 'It is in my EYES.')
    },
    autonomy: () => 0,
  },
  {
    id: 'wedgie', label: 'Give Them a Wedgie', tone: 'cruel',
    duration: 8, anim: 'shove', targetAnim: 'cower', relation: -28,
    hint: 'Pure humiliation, and far worse with an audience.',
    apply: (c) => {
      const crowd = 1 + witnesses(c).length * 0.5
      c.target.embarrassment += 22 * c.target.traits.shame * crowd
      c.target.needs.comfort -= 32
      c.target.rage += 16 * c.target.traits.temper
      c.target.clearTask(c.game)
      amuseWitnesses(c, 20)
      c.game.floatText(c.target.pos.x, 1.9, c.target.pos.z, '😖', '#ff8ab0')
      react(c.target, 'WHY.')
    },
    autonomy: (c) => Math.max(0, hostility(c) - 0.4) * 1.2 * c.actor.traits.mirth,
  },
  {
    id: 'mockGrief', label: 'Mock Their Grief', tone: 'cruel',
    duration: 14, anim: 'laugh', targetAnim: 'cry', relation: -45,
    hint: 'Only once somebody in the household has died.',
    danger: 'About as cruel as this game gets. Rage and shame both spike.',
    requires: (c) => c.game.sims.some((s) => s.dead),
    apply: (c) => {
      c.target.embarrassment += 26 * c.target.traits.shame
      c.target.rage += 34 * c.target.traits.temper
      c.target.needs.fun -= 30
      c.target.needs.social -= 25
      c.target.addBuff('grieving', 'Grief Mocked', 'bad', 600)
      c.game.floatText(c.target.pos.x, 1.9, c.target.pos.z, '💔', '#b06cff')
      react(c.target, 'They were my family.')
    },
    autonomy: () => 0,
  },
  {
    id: 'rumor', label: 'Spread Rumors About Them', tone: 'mean',
    duration: 18, anim: 'wave', targetAnim: 'idle', relation: -10,
    hint: 'Turns the rest of the household against them.',
    requires: (c) => c.game.sims.some((s) => s !== c.actor && s !== c.target && s.alive),
    apply: (c) => {
      const others = c.game.sims.filter((s) => s !== c.actor && s !== c.target && s.alive)
      for (const o of others) {
        c.game.relationships.adjust(o, c.target, -22)
        c.game.relationships.adjust(c.target, o, -8)
      }
      c.target.needs.social -= 20
      c.target.embarrassment += 10 * c.target.traits.shame
      c.game.notify(
        `<b>${c.actor.name}</b> has been telling everyone about <b>${c.target.name}</b>.`, 'warn', '🗣')
    },
    autonomy: (c) => hostility(c) * 1.1,
  },

  // ------------------------------------------------------------- physical
  {
    id: 'scare', label: 'Scare Them', tone: 'mean',
    duration: 6, anim: 'taunt', targetAnim: 'panic', relation: -12,
    hint: 'Interrupts whatever they were doing. Works on sleepers.',
    apply: (c) => {
      c.target.panicTimer = Math.max(c.target.panicTimer, 6)
      c.target.needs.comfort -= 25
      c.target.needs.fun -= 12
      c.target.rage += 8 * c.target.traits.temper
      c.target.clearTask(c.game)
      audio.play('panic', c.target.pos)
      react(c.target, 'AAAH!')
      amuseWitnesses(c, 6)
    },
    autonomy: (c) => hostility(c) * 0.8,
  },
  {
    id: 'wake', label: 'Wake Them Up Rudely', tone: 'cruel',
    duration: 5, anim: 'shove', targetAnim: 'recoil', relation: -20,
    hint: 'Only while they are asleep.',
    danger: 'Enough of these and they never sleep properly again.',
    requires: (c) => c.target.anim === 'sleep',
    apply: (c) => {
      c.target.needs.energy = Math.max(0, c.target.needs.energy - 30)
      c.target.sleepless += 120
      c.target.rage += 22 * c.target.traits.temper
      c.target.needs.comfort -= 30
      c.target.clearTask(c.game)
      c.target.addBuff('rudeawakening', 'Rudely Awakened', 'bad', 300)
      audio.play('panic', c.target.pos)
      react(c.target, 'I was ASLEEP.')
    },
    autonomy: () => 0,
  },
  {
    id: 'stealMeal', label: 'Steal Their Meal', tone: 'cruel',
    duration: 8, anim: 'eat', targetAnim: 'cry', relation: -24,
    hint: 'Only while they are eating.',
    danger: 'A sim who never finishes a meal eventually stops needing them.',
    requires: (c) => c.target.anim === 'eat',
    apply: (c) => {
      const stolen = Math.min(45, c.target.needs.hunger)
      c.target.needs.hunger -= stolen
      c.actor.needs.hunger = Math.min(100, c.actor.needs.hunger + stolen * 0.7)
      c.target.rage += 24 * c.target.traits.temper
      c.target.embarrassment += 10 * c.target.traits.shame
      c.target.clearTask(c.game)
      audio.play('eat', c.actor.pos)
      react(c.target, 'That was MINE.')
      amuseWitnesses(c, 10)
    },
    autonomy: (c) => (c.actor.needs.hunger < 25 ? hostility(c) * 1.5 : 0),
  },
  {
    id: 'shove', label: 'Shove Them', tone: 'mean',
    duration: 6, anim: 'shove', targetAnim: 'recoil', relation: -26,
    hint: 'Knocks them off their feet and off their task.',
    apply: (c) => {
      c.target.needs.comfort -= 30
      c.target.rage += 20 * c.target.traits.temper
      c.target.embarrassment += 10 * c.target.traits.shame
      c.target.clearTask(c.game)
      c.target.panicTimer = Math.max(c.target.panicTimer, 2)
      audio.play('place', c.target.pos)
      amuseWitnesses(c, 8)
    },
    autonomy: (c) => hostility(c) * 0.9 * c.actor.traits.temper,
  },
  {
    id: 'shovePool', label: 'Shove Them Into the Pool', tone: 'cruel',
    duration: 6, anim: 'shove', targetAnim: 'panic', relation: -40,
    hint: 'Requires water within arm’s reach of them.',
    danger: 'If the ladder is gone, this is a drowning.',
    requires: (c) => !!poolBeside(c.target, c.game),
    apply: (c) => {
      const tile = poolBeside(c.target, c.game)
      if (!tile) return
      const [wx, wz] = c.game.grid.tileToWorld(tile.x, tile.z)
      c.target.pos.set(wx, 0, wz)
      c.target.path = null
      c.target.clearTask(c.game)
      c.target.soaked = 140
      c.target.swimStamina = Math.min(c.target.swimStamina, 74)
      c.target.needs.fun -= 20
      c.target.embarrassment += 16 * c.target.traits.shame
      c.target.rage += 18 * c.target.traits.temper
      c.game.splash(wx, 0, wz)
      audio.play('splash', c.target.pos)
      amuseWitnesses(c, 20)
      c.game.notify(`<b>${c.actor.name}</b> shoved <b>${c.target.name}</b> into the pool.`, 'danger', '🌊')
    },
    autonomy: () => 0,
  },
  {
    id: 'slap', label: 'Slap Them', tone: 'cruel',
    duration: 8, anim: 'slap', targetAnim: 'recoil', relation: -34,
    hint: 'Both parties come away angrier.',
    apply: (c) => {
      c.target.rage += 34 * c.target.traits.temper
      c.target.embarrassment += 18 * c.target.traits.shame
      c.target.needs.comfort -= 25
      c.actor.rage += 10
      c.target.clearTask(c.game)
      audio.play('place', c.target.pos)
      c.game.floatText(c.target.pos.x, 1.9, c.target.pos.z, '💢', '#ff5c58')
      amuseWitnesses(c, 12)
      react(c.target, 'You will regret that.')
    },
    autonomy: (c) => Math.max(0, hostility(c) - 0.5) * 2.4 * c.actor.traits.temper,
  },
  {
    id: 'fight', label: 'Start a Fight', tone: 'cruel',
    duration: 26, anim: 'argue', targetAnim: 'argue', relation: -45,
    hint: 'Exhausting, filthy, and humiliating for whoever loses.',
    danger: 'Two tired sims brawling is a cardiac event waiting to happen.',
    apply: (c) => {
      const roll = (s: Sim) => s.skills.fitness + s.needs.energy / 25 + c.game.rand.range(0, 4)
      const actorWins = roll(c.actor) >= roll(c.target)
      const winner = actorWins ? c.actor : c.target
      const loser = actorWins ? c.target : c.actor
      for (const s of [c.actor, c.target]) {
        s.needs.energy = Math.max(0, s.needs.energy - 32)
        s.needs.hygiene = Math.max(0, s.needs.hygiene - 34)
        s.needs.comfort = Math.max(0, s.needs.comfort - 30)
        s.gainSkill('fitness', 0.3)
      }
      loser.rage += 34 * loser.traits.temper
      loser.embarrassment += 26 * loser.traits.shame
      loser.addBuff('beaten', 'Lost a Fight', 'bad', 480)
      winner.needs.fun = Math.min(100, winner.needs.fun + 24)
      winner.addBuff('victor', 'Won a Fight', 'good', 300)
      c.game.relationships.adjust(loser, winner, -20)
      c.game.spark(c.target.pos.x, 1.2, c.target.pos.z, 14, 0xffdd66)
      c.game.floatText(c.target.pos.x, 2.1, c.target.pos.z, '💥', '#ffd166')
      amuseWitnesses(c, 14)
      c.game.notify(`<b>${winner.name}</b> won a fight with <b>${loser.name}</b>.`, 'danger', '👊')
    },
    autonomy: (c) => Math.max(0, hostility(c) - 0.7) * 2.6 * c.actor.traits.temper,
  },
]

export const SOCIAL_BY_ID = new Map(SOCIALS.map((s) => [s.id, s]))

/** A pool tile the target could plausibly be pushed into. */
export function poolBeside(target: Sim, game: IGame): { x: number; z: number } | null {
  const t = target.tileOf(game)
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const x = t.x + dx, z = t.z + dz
    if (game.grid.isPool(x, z)) return { x, z }
  }
  return null
}
