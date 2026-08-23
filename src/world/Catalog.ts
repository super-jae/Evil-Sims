import { BUILDERS, ensurePalette } from './Meshes'
import type { Category, Interaction, InteractionCtx, ObjectDef } from './ObjectTypes'
import type { NeedKey } from '../sim/Needs'
import { audio } from '../core/Audio'

// ---------------------------------------------------------------- helpers

function tileOf(ctx: InteractionCtx) {
  return ctx.obj.centerTile()
}

function isIndoors(ctx: InteractionCtx): boolean {
  const t = tileOf(ctx)
  return ctx.game.grid.isIndoors(t.x, t.z)
}

/** How much fuel sits within two tiles of the object. */
function fuelNearby(ctx: InteractionCtx): number {
  const c = ctx.obj.centerWorld
  let fuel = 0
  for (const o of ctx.game.objects) {
    if (o === ctx.obj || o.charred) continue
    const d = o.centerWorld.distanceTo(c)
    if (d < 3.2) fuel += o.flammability * (1 - d / 3.2)
  }
  // capped: a cluttered room is more dangerous, but not unboundedly so
  return Math.min(2.4, fuel)
}

/** Roll for ignition. `base` is the chance per in-game minute at skill 0. */
function rollFire(ctx: InteractionCtx, base: number, dtMin: number, multiplier = 1) {
  const sim = ctx.sim
  const skill = ctx.obj.def.category === 'kitchen' ? sim.skills.cooking : sim.skills.handiness
  const p = base * dtMin * sim.traits.clumsiness * multiplier * (1 - Math.min(0.82, skill / 12))
  if (ctx.game.rand.next() < p) {
    const t = tileOf(ctx)
    ctx.game.startFire(t.x, t.z, 1)
    return true
  }
  return false
}

/** Standing in a puddle while poking at mains voltage. */
function rollShock(ctx: InteractionCtx, dtMin: number) {
  const { sim, game, obj } = ctx
  const t = sim.tileOf(game)
  const wet = sim.soaked > 0 || game.puddleAt(t.x, t.z) || sim.inPool
  const base = wet ? 0.055 : 0.004
  const p = base * dtMin * sim.traits.clumsiness * (1 - Math.min(0.8, sim.skills.handiness / 12))
  if (game.rand.next() < p) {
    game.spark(sim.pos.x, 1.1, sim.pos.z, 30, 0xffee66)
    audio.play('zap', sim.pos)
    if (wet && game.rand.next() < 0.82) {
      game.kill(sim, 'electrocution')
      return true
    }
    sim.needs.fun -= 30
    sim.rage += 18
    sim.addBuff('zapped', 'Zapped', 'bad', 180)
    game.notify(`<b>${sim.name}</b> got a nasty shock.`, 'warn', '⚡')
    obj.broken = true
  }
  return false
}

/** Standard autonomy desire: how badly a sim wants to fix one need. */
const desireFrom = (ctx: InteractionCtx, key: NeedKey, weight: number) =>
  weight * Math.pow(1 - ctx.sim.needs[key] / 100, 2.4)

// ---------------------------------------------------------------- shared interactions

const SIT: Interaction = {
  id: 'sit', label: 'Sit Down', duration: 60, anim: 'sit', stand: 'on',
  needs: { comfort: 1.1, energy: 0.12 },
  autonomy: (c) => desireFrom(c, 'comfort', 4.5),
  endWhen: (c) => c.sim.needs.comfort > 96,
}

const NAP: Interaction = {
  id: 'nap', label: 'Take a Nap', duration: 180, anim: 'sleep', stand: 'on',
  autonomy: (c) => desireFrom(c, 'energy', 5) * 0.7,
  endWhen: (c) => c.sim.needs.energy > 92,
}

// ---------------------------------------------------------------- catalog

export const CATALOG: ObjectDef[] = [

  // ============================================================== KITCHEN
  {
    id: 'fridge', name: 'Refrigerator', glyph: '🧊', category: 'kitchen', price: 1100,
    size: [1, 1], height: 1.85, build: BUILDERS.fridge,
    desc: 'Holds food. Sims cannot eat if there is nothing to eat.',
    flags: { solid: true, wallish: true, electrical: true, flammable: 0.05 },
    interactions: [{
      id: 'eat', label: 'Grab a Snack', duration: 22, anim: 'eat',
      needs: { hunger: 2.6, fun: 0.1 },
      onStart: (c) => { audio.play('eat', c.sim.pos); c.sim.say('Cold and adequate.', 3) },
      onTick: (c, dt) => { if (c.game.rand.next() < dt * 0.06) audio.play('eat', c.sim.pos) },
      endWhen: (c) => c.sim.needs.hunger > 96,
    }],
  },
  {
    id: 'counter', name: 'Kitchen Counter', glyph: '🍽', category: 'kitchen', price: 320,
    size: [1, 1], height: 0.92, build: BUILDERS.counter,
    desc: 'Surface. Fills out a kitchen and blocks escape routes nicely.',
    flags: { solid: true, wallish: true, flammable: 0.25 },
  },
  {
    id: 'stove', name: 'Electric Range', glyph: '🔥', category: 'kitchen', price: 900,
    size: [1, 1], height: 0.9, build: BUILDERS.stove,
    desc: 'Cooks a proper meal. Low-skill cooks start kitchen fires.',
    lethal: 'Unskilled cooks set the kitchen alight.',
    flags: { solid: true, wallish: true, electrical: true, heatSource: true, flammable: 0.15 },
    interactions: [
      {
        id: 'cook', label: 'Cook a Meal', duration: 42, anim: 'cook',
        needs: { hunger: 1.9, fun: 0.15 },
        skill: { key: 'cooking', rate: 0.006 },
        autonomy: (c) => desireFrom(c, 'hunger', 7),
        onStart: (c) => audio.startLoop(`sizzle${c.obj.id}`, 'sizzle', c.obj.centerWorld),
        onTick: (c, dt) => {
          rollFire(c, 0.00034, dt, 1 + fuelNearby(c) * 1.2)
        },
        onFinish: (c) => {
          audio.stopLoop(`sizzle${c.obj.id}`)
          c.sim.lastMealQuality = c.sim.skills.cooking
          if (c.sim.skills.cooking > 4) c.sim.addBuff('goodmeal', 'Well Fed', 'good', 240)
        },
        hint: 'Fire risk rises with clutter and falls with skill.',
      },
      {
        id: 'pufferfish', label: 'Prepare Pufferfish', duration: 50, anim: 'cook',
        needs: { hunger: 2.0 }, hidden: true,
        skill: { key: 'cooking', rate: 0.01 },
        danger: 'A cook below level 7 will almost certainly get it wrong.',
        onStart: (c) => c.sim.say('How hard can it be?', 4),
        onFinish: (c) => {
          const skill = c.sim.skills.cooking
          const p = Math.max(0.06, 0.92 - skill * 0.12)
          if (c.game.rand.next() < p) {
            c.sim.say('...that tingles.', 3)
            c.game.after(6, () => { if (!c.sim.dead) c.game.kill(c.sim, 'pufferfish') })
          } else {
            c.game.notify(`<b>${c.sim.name}</b> prepared the pufferfish correctly. Annoying.`, 'warn', '🐡')
          }
        },
      },
    ],
  },
  {
    id: 'grill', name: 'Propane Gas Grill', glyph: '🍖', category: 'kitchen', price: 780,
    size: [1, 1], height: 0.9, build: BUILDERS.grill,
    desc: 'Meant for the garden. Nothing physically prevents you from putting it in the lounge.',
    lethal: 'Indoors, with a rug nearby, this is a house fire with a lid.',
    flags: { solid: true, heatSource: true, flammable: 0.4 },
    interactions: [{
      id: 'cook', label: 'Grill Something', duration: 38, anim: 'cook',
      needs: { hunger: 2.1, fun: 0.3 },
      skill: { key: 'cooking', rate: 0.005 },
      autonomy: (c) => desireFrom(c, 'hunger', 6.5),
      onStart: (c) => {
        audio.startLoop(`sizzle${c.obj.id}`, 'sizzle', c.obj.centerWorld)
        if (isIndoors(c)) c.sim.say('Is this allowed indoors?', 4)
      },
      onTick: (c, dt) => {
        const indoor = isIndoors(c) ? 11 : 1
        const cw = c.obj.centerWorld
        if (c.game.rand.next() < dt * 0.25) c.game.smoke(cw.x, 1.0, cw.z, 1)
        rollFire(c, 0.00060, dt, indoor * (1 + fuelNearby(c) * 1.5))
      },
      onFinish: (c) => audio.stopLoop(`sizzle${c.obj.id}`),
      hint: 'Indoor use multiplies the fire risk about elevenfold.',
    }],
  },
  {
    id: 'microwave', name: 'Microwave', glyph: '📻', category: 'kitchen', price: 260,
    size: [1, 1], height: 0.35, build: BUILDERS.microwave,
    desc: 'Fast, joyless calories.',
    flags: { electrical: true, flammable: 0.2, wallish: true },
    interactions: [{
      id: 'eat', label: 'Microwave a Meal', duration: 14, anim: 'stand_use',
      needs: { hunger: 3.2, fun: -0.1 },
      autonomy: (c) => desireFrom(c, 'hunger', 5.5),
      onTick: (c, dt) => rollFire(c, 0.00018, dt, 1 + fuelNearby(c)),
      endWhen: (c) => c.sim.needs.hunger > 94,
    }],
  },
  {
    id: 'espresso', name: 'Espresso Machine', glyph: '☕', category: 'kitchen', price: 640,
    size: [1, 1], height: 0.5, build: BUILDERS.espresso,
    desc: 'Energy now. Consequences shortly.',
    lethal: 'Each cup drains the bladder hard. Sell the toilets first.',
    flags: { electrical: true, wallish: true, flammable: 0.1 },
    interactions: [{
      id: 'espresso', label: 'Drink Espresso', duration: 9, anim: 'stand_use',
      needs: { energy: 3.4, fun: 0.8, bladder: -5.2 },
      autonomy: (c) => desireFrom(c, 'energy', 5) * (c.sim.needs.bladder > 30 ? 1 : 0.2),
      onFinish: (c) => {
        c.sim.espressos += 1
        c.sim.say('Another.', 2)
        if (c.sim.espressos >= 3) {
          c.sim.addBuff('jitters', 'Caffeine Jitters', 'bad', 240)
          c.sim.rage += 6
        }
      },
      hint: 'Jitters make exercise considerably more dangerous.',
    }],
  },
  {
    id: 'trash', name: 'Rubbish Bin', glyph: '🗑', category: 'kitchen', price: 90,
    size: [1, 1], height: 0.65, build: BUILDERS.trash,
    desc: 'Fills up. Attracts things.',
    lethal: 'Lock it so nobody empties it. The flies arrive within a day.',
    flags: { flammable: 0.55 },
    interactions: [{
      id: 'clean', label: 'Empty the Bin', duration: 12, anim: 'stand_use',
      needs: { hygiene: -0.6, fun: -0.3 },
      requires: (c) => c.obj.grime > 20,
      autonomy: (c) => (c.obj.grime > 55 && c.sim.traits.likes.has('clean') ? 3 : c.obj.grime > 85 ? 1.2 : 0),
      onFinish: (c) => { c.obj.grime = 0; c.obj.meta.flies = false },
    }],
  },

  // ============================================================== BATHROOM
  {
    id: 'toilet', name: 'Toilet', glyph: '🚽', category: 'bath', price: 380,
    size: [1, 1], height: 0.8, build: BUILDERS.toilet,
    desc: 'The single most load-bearing object in any household.',
    lethal: 'Its absence is the point.',
    flags: { solid: true, wallish: true, plumbing: true, wet: true, fireproof: true },
    interactions: [
      {
        id: 'toilet', label: 'Use Toilet', duration: 13, anim: 'toilet', stand: 'on',
        needs: { bladder: 8.5, hygiene: -0.35 },
        autonomy: (c) => desireFrom(c, 'bladder', 12),
        onFinish: (c) => {
          audio.play('flush', c.obj.centerWorld)
          c.obj.grime += 6
          c.sim.espressos = Math.max(0, c.sim.espressos - 1)
        },
        endWhen: (c) => c.sim.needs.bladder > 97,
      },
      {
        id: 'clean', label: 'Clean Toilet', duration: 18, anim: 'repair',
        needs: { hygiene: -0.8 },
        requires: (c) => c.obj.grime > 15,
        autonomy: (c) => (c.obj.grime > 55 ? 1.4 : 0),
        onFinish: (c) => { c.obj.grime = 0 },
      },
    ],
  },
  {
    id: 'shower', name: 'Shower', glyph: '🚿', category: 'bath', price: 720,
    size: [1, 1], height: 2.0, build: BUILDERS.shower,
    desc: 'Cleans a sim and leaves them soaking wet for a while afterwards.',
    lethal: 'A wet sim plus a broken television is a complete plan.',
    flags: { solid: true, wallish: true, plumbing: true, wet: true, breakable: 0.0009, fireproof: true },
    interactions: [
      {
        id: 'repair', label: 'Repair Shower', duration: 26, anim: 'repair',
        requires: (c) => c.obj.broken,
        skill: { key: 'handiness', rate: 0.006 },
        autonomy: (c) => (c.obj.broken ? 2.4 : 0),
        onStart: (c) => { c.sim.soaked = Math.max(c.sim.soaked, 60) },
        onTick: (c, dt) => {
          if (c.game.rand.next() < dt * 0.05) {
            const t = c.obj.centerTile()
            c.game.makePuddle(t.x, t.z, 'water')
          }
        },
        onFinish: (c) => { c.obj.broken = false },
      },
      {
      id: 'shower', label: 'Take a Shower', duration: 24, anim: 'shower', stand: 'on',
      needs: { hygiene: 4.2, comfort: 0.4, fun: 0.2 },
      autonomy: (c) => desireFrom(c, 'hygiene', 7),
      onStart: (c) => { audio.startLoop(`water${c.obj.id}`, 'water', c.obj.centerWorld); c.sim.soaked = 120 },
      onTick: (c, dt) => {
        if (c.game.rand.next() < dt * c.obj.def.flags!.breakable! * 1.6) {
          c.obj.broken = true
          const t = c.obj.centerTile()
          c.game.makePuddle(t.x, t.z, 'water')
          c.game.notify(`The shower is leaking.`, 'info', '💧')
        }
      },
      onFinish: (c) => {
        audio.stopLoop(`water${c.obj.id}`)
        c.sim.soaked = Math.max(c.sim.soaked, 100)
        const t = c.sim.tileOf(c.game)
        if (c.game.rand.next() < 0.45) c.game.makePuddle(t.x, t.z, 'water')
      },
      endWhen: (c) => c.sim.needs.hygiene > 97,
      }],
  },
  {
    id: 'tub', name: 'Bathtub', glyph: '🛁', category: 'bath', price: 1050,
    size: [2, 1], height: 0.6, build: BUILDERS.tub,
    desc: 'Comfort and hygiene at once.',
    lethal: 'An exhausted sim who falls asleep in the bath does not wake up.',
    flags: { solid: true, wallish: true, plumbing: true, wet: true, fireproof: true },
    interactions: [{
      id: 'bath', label: 'Take a Bath', duration: 46, anim: 'sit', stand: 'on',
      needs: { hygiene: 2.6, comfort: 2.0, fun: 0.5 },
      autonomy: (c) => desireFrom(c, 'hygiene', 5) + desireFrom(c, 'comfort', 3),
      onStart: (c) => { audio.startLoop(`water${c.obj.id}`, 'water', c.obj.centerWorld); c.sim.soaked = 140 },
      onTick: (c, dt) => {
        if (c.sim.needs.energy < 18 && c.game.rand.next() < dt * 0.022) {
          c.sim.say('...just resting my eyes...', 4)
          c.game.kill(c.sim, 'drowning', 'fell asleep in the bath')
        }
      },
      onFinish: (c) => audio.stopLoop(`water${c.obj.id}`),
    }],
  },
  {
    id: 'sink', name: 'Bathroom Sink', glyph: '🧼', category: 'bath', price: 260,
    size: [1, 1], height: 0.9, build: BUILDERS.sink,
    desc: 'A modest contribution to hygiene.',
    flags: { solid: true, wallish: true, plumbing: true, wet: true, breakable: 0.0012, fireproof: true },
    interactions: [
      {
        id: 'repair', label: 'Repair Sink', duration: 26, anim: 'repair',
        requires: (c) => c.obj.broken,
        skill: { key: 'handiness', rate: 0.006 },
        autonomy: (c) => (c.obj.broken ? 2.4 : 0),
        onStart: (c) => { c.sim.soaked = Math.max(c.sim.soaked, 60) },
        onTick: (c, dt) => {
          if (c.game.rand.next() < dt * 0.05) {
            const t = c.obj.centerTile()
            c.game.makePuddle(t.x, t.z, 'water')
          }
        },
        onFinish: (c) => { c.obj.broken = false },
      },
      {
      id: 'wash', label: 'Wash Up', duration: 7, anim: 'stand_use',
      needs: { hygiene: 2.2 },
      autonomy: (c) => desireFrom(c, 'hygiene', 3),
      onFinish: (c) => {
        if (c.game.rand.next() < 0.25) {
          const t = c.sim.tileOf(c.game)
          c.game.makePuddle(t.x, t.z, 'water')
        }
        c.sim.soaked = Math.max(c.sim.soaked, 40)
      },
      }],
  },

  // ============================================================== BEDROOM
  {
    id: 'bedSingle', name: 'Single Bed', glyph: '🛏', category: 'bed', price: 650,
    size: [1, 2], height: 0.8, build: BUILDERS.bedSingle,
    desc: 'Restores energy. Removing every bed is a slower kind of cruelty.',
    flags: { solid: true, bed: true, wallish: true, flammable: 0.7 },
    interactions: [{
      id: 'sleep', label: 'Sleep', duration: 480, anim: 'sleep', stand: 'on',
      needs: { comfort: 0.7 },
      autonomy: (c) => desireFrom(c, 'energy', 9) * (c.game.clock.isNight ? 1.5 : 0.8),
      endWhen: (c) => c.sim.needs.energy > 97,
      onFinish: (c) => c.sim.say('Morning.', 2),
      onTick: (c, dt) => { if (c.game.rand.next() < dt * 0.02) audio.play('snore', c.sim.pos) },
    }, NAP],
  },
  {
    id: 'bedDouble', name: 'Double Bed', glyph: '🛌', category: 'bed', price: 1250,
    size: [2, 2], height: 0.85, build: BUILDERS.bedDouble,
    desc: 'Sleeps two. Doubles as a social space.',
    flags: { solid: true, bed: true, wallish: true, flammable: 0.7 },
    interactions: [{
      id: 'sleep', label: 'Sleep', duration: 480, anim: 'sleep', stand: 'on',
      needs: { comfort: 0.9, social: 0.15 },
      autonomy: (c) => desireFrom(c, 'energy', 9.5) * (c.game.clock.isNight ? 1.5 : 0.8),
      endWhen: (c) => c.sim.needs.energy > 97,
      onTick: (c, dt) => { if (c.game.rand.next() < dt * 0.02) audio.play('snore', c.sim.pos) },
    }, NAP],
  },
  {
    id: 'murphyBed', name: 'Murphy Bed', glyph: '🗄', category: 'devious', price: 1600,
    size: [2, 1], height: 2.15, build: BUILDERS.murphyBed,
    desc: 'A bed that folds into the wall. Sometimes with occupants.',
    lethal: 'One in eight sleepers is folded away permanently.',
    flags: { solid: true, bed: true, wallish: true, flammable: 0.5 },
    interactions: [{
      id: 'sleep', label: 'Sleep', duration: 480, anim: 'sleep', stand: 'on',
      needs: { comfort: 0.5 },
      autonomy: (c) => desireFrom(c, 'energy', 8),
      endWhen: (c) => c.sim.needs.energy > 97,
      onStart: (c) => {
        const p = 0.13 * c.sim.traits.clumsiness
        if (c.game.rand.next() < p) {
          audio.play('explosion', c.obj.centerWorld)
          c.game.kill(c.sim, 'murphy')
        }
      },
      onTick: (c, dt) => {
        if (c.game.rand.next() < dt * 0.0008 * c.sim.traits.clumsiness) {
          audio.play('explosion', c.obj.centerWorld)
          c.game.kill(c.sim, 'murphy')
        }
      },
      danger: 'The mechanism is not certified for occupied folding.',
    }],
  },

  // ============================================================== LIVING
  {
    id: 'sofa', name: 'Sofa', glyph: '🛋', category: 'living', price: 720,
    size: [3, 1], height: 0.9, build: BUILDERS.sofa,
    desc: 'Comfort, naps, and a great deal of fuel.',
    flags: { solid: true, seat: true, wallish: true, flammable: 0.75 },
    interactions: [SIT, NAP],
  },
  {
    id: 'armchair', name: 'Armchair', glyph: '💺', category: 'living', price: 400,
    size: [1, 1], height: 0.9, build: BUILDERS.armchair,
    desc: 'One seat, generously stuffed with kindling.',
    flags: { solid: true, seat: true, flammable: 0.75 },
    interactions: [SIT],
  },
  {
    id: 'diningChair', name: 'Dining Chair', glyph: '🪑', category: 'living', price: 130,
    size: [1, 1], height: 0.9, build: BUILDERS.diningChair,
    desc: 'Somewhere to sit and eat.',
    flags: { solid: true, seat: true, flammable: 0.6 },
    interactions: [SIT],
  },
  {
    id: 'diningTable', name: 'Dining Table', glyph: '🍴', category: 'living', price: 380,
    size: [2, 1], height: 0.78, build: BUILDERS.diningTable,
    desc: 'Sims eat better, and together, at a table.',
    flags: { solid: true, flammable: 0.55 },
    interactions: [{
      id: 'meal', label: 'Have a Meal', duration: 30, anim: 'eat',
      needs: { hunger: 2.2, social: 1.1, comfort: 0.5 },
      requires: (c) => !!c.game.findObject('fridge'),
      autonomy: (c) => desireFrom(c, 'hunger', 6) + desireFrom(c, 'social', 2),
      endWhen: (c) => c.sim.needs.hunger > 96,
      onTick: (c, dt) => { if (c.game.rand.next() < dt * 0.08) audio.play('eat', c.sim.pos) },
    }],
  },
  {
    id: 'coffeeTable', name: 'Coffee Table', glyph: '🫖', category: 'living', price: 190,
    size: [2, 1], height: 0.42, build: BUILDERS.coffeeTable,
    desc: 'Decorative. Burns well.',
    flags: { solid: true, flammable: 0.5 },
  },
  {
    id: 'bookshelf', name: 'Bookshelf', glyph: '📚', category: 'living', price: 540,
    size: [1, 1], height: 2.0, build: BUILDERS.bookshelf,
    desc: 'Fun and logic. Also several hundred pages of accelerant.',
    flags: { solid: true, wallish: true, flammable: 0.95 },
    interactions: [{
      id: 'read', label: 'Read a Book', duration: 60, anim: 'read',
      needs: { fun: 1.5, comfort: 0.2 },
      skill: { key: 'logic', rate: 0.004 },
      autonomy: (c) => desireFrom(c, 'fun', 4.5),
      endWhen: (c) => c.sim.needs.fun > 94,
    }],
  },
  {
    id: 'fireplace', name: 'Open Fireplace', glyph: '🔥', category: 'living', price: 1400,
    size: [2, 1], height: 1.45, build: BUILDERS.fireplace,
    desc: 'An open flame, in the house, on purpose.',
    lethal: 'Put a rug in front of it and wait.',
    flags: { solid: true, wallish: true, heatSource: true, flammable: 0.25 },
    interactions: [{
      id: 'warm', label: 'Warm Up By The Fire', duration: 40, anim: 'stand_use',
      needs: { comfort: 1.4, fun: 0.6 },
      autonomy: (c) => desireFrom(c, 'comfort', 3) + (c.sim.bodyTemp < 35 ? 5 : 0),
      onStart: (c) => audio.startLoop(`fire${c.obj.id}`, 'fire', c.obj.centerWorld),
      onTick: (c, dt) => {
        c.sim.bodyTemp = Math.min(88, c.sim.bodyTemp + dt * 0.5)
        const cw = c.obj.centerWorld
        if (c.game.rand.next() < dt * 0.2) c.game.spark(cw.x, 0.6, cw.z + 0.1, 2, 0xff7a2a)
        rollFire(c, 0.00055, dt, 1 + fuelNearby(c) * 2.0)
      },
      onFinish: (c) => audio.stopLoop(`fire${c.obj.id}`),
    }],
  },
  {
    id: 'rug', name: 'Shag Rug', glyph: '🟥', category: 'decor', price: 220,
    size: [3, 2], height: 0.03, build: BUILDERS.rug,
    desc: 'Ties the room together. Also ties the fire together.',
    lethal: 'The fastest-spreading surface in the catalogue.',
    flags: { flammable: 1.0 },
  },
  {
    id: 'curtains', name: 'Heavy Curtains', glyph: '🪟', category: 'decor', price: 180,
    size: [2, 1], height: 2.3, build: BUILDERS.curtains,
    desc: 'Blocks light. Carries flame beautifully.',
    lethal: 'Fire climbs curtains to the ceiling in seconds.',
    flags: { flammable: 1.0, wallish: true },
  },
  {
    id: 'plant', name: 'Houseplant', glyph: '🪴', category: 'decor', price: 110,
    size: [1, 1], height: 1.1, build: BUILDERS.plant,
    desc: 'Cheerful. Harmless. For now.',
    flags: { solid: true, flammable: 0.35 },
    interactions: [{
      id: 'water', label: 'Water the Plant', duration: 8, anim: 'stand_use',
      needs: { fun: 0.8, comfort: 0.2 },
      autonomy: (c) => desireFrom(c, 'fun', 1.4),
      onFinish: (c) => {
        if (c.game.rand.next() < 0.3) {
          const t = c.sim.tileOf(c.game)
          c.game.makePuddle(t.x, t.z, 'water')
        }
      },
    }],
  },
  {
    id: 'lamp', name: 'Floor Lamp', glyph: '💡', category: 'decor', price: 150,
    size: [1, 1], height: 1.7, build: BUILDERS.lamp,
    desc: 'Light. Mains voltage. Tips over.',
    flags: { electrical: true, flammable: 0.3 },
  },

  // ============================================================== ELECTRONICS
  {
    id: 'tv', name: 'Flatscreen TV', glyph: '📺', category: 'electronics', price: 950,
    size: [2, 1], height: 1.3, build: BUILDERS.tv,
    desc: 'Excellent fun. Breaks with use, and someone has to fix it.',
    lethal: 'Repairing this while wet is the classic.',
    flags: { solid: true, wallish: true, electrical: true, breakable: 0.0016, flammable: 0.3 },
    interactions: [
      {
        id: 'watch', label: 'Watch TV', duration: 90, anim: 'watch',
        needs: { fun: 2.3, comfort: 0.5, energy: 0.1 },
        requires: (c) => !c.obj.broken,
        autonomy: (c) => desireFrom(c, 'fun', 6),
        onTick: (c, dt) => {
          if (c.sim.traits.mirth > 1.5 && c.game.rand.next() < dt * 0.02) {
            c.sim.hysteria += 3 * c.sim.traits.mirth
            audio.play('laugh', c.sim.pos)
          }
        },
        endWhen: (c) => c.sim.needs.fun > 96,
      },
      {
        id: 'comedy', label: 'Watch Comedy Marathon', duration: 200, anim: 'watch',
        needs: { fun: 3.0, comfort: 0.3, energy: -0.4 }, hidden: true,
        requires: (c) => !c.obj.broken,
        danger: 'Sims with a sense of humour can laugh themselves into a coffin.',
        onTick: (c, dt) => {
          c.sim.hysteria += dt * 0.5 * c.sim.traits.mirth
          if (c.game.rand.next() < dt * 0.08) { audio.play('laugh', c.sim.pos); c.sim.anim = 'laugh' }
        },
      },
      {
        id: 'repair', label: 'Repair TV', duration: 34, anim: 'repair',
        requires: (c) => c.obj.broken,
        skill: { key: 'handiness', rate: 0.008 },
        autonomy: (c) => (c.obj.broken ? 2.2 : 0),
        danger: 'Mains voltage plus a wet sim equals one fewer sim.',
        onStart: (c) => c.sim.say(c.sim.soaked > 0 ? 'I should dry off first. Probably.' : 'How hard can it be?', 4),
        onTick: (c, dt) => {
          const cw = c.obj.centerWorld
          if (c.game.rand.next() < dt * 0.2) c.game.spark(cw.x, 0.9, cw.z, 3, 0xffee66)
          rollShock(c, dt)
        },
        onFinish: (c) => { c.obj.broken = false; c.game.notify(`<b>${c.sim.name}</b> fixed the TV.`, 'info', '🔧') },
      },
    ],
  },
  {
    id: 'computer', name: 'Desktop Computer', glyph: '🖥', category: 'electronics', price: 1150,
    size: [1, 1], height: 0.6, build: BUILDERS.computer,
    desc: 'Fun, logic, and a second thing to electrocute yourself on.',
    flags: { solid: true, wallish: true, electrical: true, breakable: 0.0014, flammable: 0.3 },
    interactions: [
      {
        id: 'play', label: 'Play Games', duration: 90, anim: 'type',
        needs: { fun: 2.5, energy: -0.25, comfort: -0.2 },
        requires: (c) => !c.obj.broken,
        autonomy: (c) => desireFrom(c, 'fun', 6),
        skill: { key: 'logic', rate: 0.002 },
        endWhen: (c) => c.sim.needs.fun > 96,
      },
      {
        id: 'repair', label: 'Repair Computer', duration: 30, anim: 'repair',
        requires: (c) => c.obj.broken,
        skill: { key: 'handiness', rate: 0.008 },
        autonomy: (c) => (c.obj.broken ? 2 : 0),
        danger: 'Same voltage, same puddle, same result.',
        onTick: (c, dt) => { rollShock(c, dt) },
        onFinish: (c) => { c.obj.broken = false },
      },
    ],
  },
  {
    id: 'stereo', name: 'Sound System', glyph: '🔊', category: 'electronics', price: 560,
    size: [3, 1], height: 0.95, build: BUILDERS.stereo,
    desc: 'Dancing is fun, tiring and sweaty.',
    flags: { solid: true, wallish: true, electrical: true, breakable: 0.001, flammable: 0.3 },
    interactions: [{
      id: 'dance', label: 'Dance', duration: 60, anim: 'dance',
      needs: { fun: 2.8, energy: -1.0, hygiene: -0.7, comfort: -0.4 },
      requires: (c) => !c.obj.broken,
      autonomy: (c) => desireFrom(c, 'fun', 5.5),
      skill: { key: 'fitness', rate: 0.002 },
      onTick: (c, dt) => {
        if (c.sim.hasBuff('jitters') && c.sim.needs.energy < 15 && c.game.rand.next() < dt * 0.004) {
          c.game.kill(c.sim, 'overexertion', 'danced past the point of no return')
        }
      },
      endWhen: (c) => c.sim.needs.fun > 96 || (!c.sim.task?.forced && c.sim.needs.energy < 10),
    }],
  },
  {
    id: 'spaceHeater', name: 'Space Heater', glyph: '🌡', category: 'electronics', price: 280,
    size: [1, 1], height: 0.55, build: BUILDERS.spaceHeater,
    desc: 'Warms a room. Also warms curtains, rugs and sofas.',
    lethal: 'Place it against something soft and walk away.',
    flags: { electrical: true, heatSource: true, flammable: 0.3 },
    interactions: [{
      id: 'warm', label: 'Warm Up', duration: 25, anim: 'stand_use',
      needs: { comfort: 1.2 },
      autonomy: (c) => (c.sim.bodyTemp < 38 ? 6 : desireFrom(c, 'comfort', 1.6)),
      onTick: (c, dt) => {
        c.sim.bodyTemp = Math.min(84, c.sim.bodyTemp + dt * 0.7)
        rollFire(c, 0.00045, dt, 1 + fuelNearby(c) * 2.6)
      },
    }],
  },
  {
    id: 'telescope', name: 'Telescope', glyph: '🔭', category: 'electronics', price: 760,
    size: [1, 1], height: 2.0, build: BUILDERS.telescope,
    desc: 'Look at the stars. Occasionally the stars look back.',
    lethal: 'Prolonged stargazing has been known to attract a meteorite.',
    flags: { solid: true, outdoorOnly: true, flammable: 0.1 },
    interactions: [{
      id: 'stargaze', label: 'Stargaze', duration: 70, anim: 'stand_use',
      needs: { fun: 1.6, comfort: -0.2 },
      skill: { key: 'logic', rate: 0.005 },
      requires: (c) => c.game.clock.isNight,
      autonomy: (c) => (c.game.clock.isNight ? desireFrom(c, 'fun', 3.5) : 0),
      danger: 'Something up there notices being watched.',
      onTick: (c, dt) => {
        if (c.game.rand.next() < dt * 0.005) {
          c.game.notify('Something in the sky is getting brighter. And closer.', 'danger', '☄️')
          const sim = c.sim
          c.game.after(9, () => {
            if (sim.dead) return
            c.game.spark(sim.pos.x, 3, sim.pos.z, 60, 0xffaa44)
            audio.play('explosion', sim.pos)
            c.game.kill(sim, 'meteor')
          })
        }
      },
    }],
  },

  // ============================================================== FITNESS
  {
    id: 'treadmill', name: 'Treadmill', glyph: '🏃', category: 'fitness', price: 1350,
    size: [1, 2], height: 1.3, build: BUILDERS.treadmill,
    desc: 'Fitness at the cost of everything else.',
    lethal: 'Hungry, exhausted and caffeinated is a fatal combination.',
    flags: { solid: true, electrical: true, flammable: 0.25 },
    interactions: [{
      id: 'workout', label: 'Work Out', duration: 70, anim: 'run', stand: 'on',
      needs: { fun: 0.35, energy: -1.5, hunger: -0.9, hygiene: -1.5, comfort: -0.8 },
      skill: { key: 'fitness', rate: 0.006 },
      autonomy: (c) => (c.sim.traits.likes.has('workout') ? 2.4 : 0.3) * (c.sim.needs.energy > 45 ? 1 : 0.1),
      danger: 'Watch their energy and hunger while they run.',
      onTick: (c, dt) => {
        const s = c.sim
        s.bodyTemp = Math.min(92, s.bodyTemp + dt * 0.35)
        const strain =
          (s.needs.energy < 25 ? (25 - s.needs.energy) / 25 : 0) +
          (s.needs.hunger < 25 ? (25 - s.needs.hunger) / 25 : 0) +
          (s.hasBuff('jitters') ? 0.9 : 0)
        if (strain > 1.2 && c.game.rand.next() < dt * 0.12) {
          c.game.floatText(s.pos.x, 1.9, s.pos.z, '💗', '#ff5c58')
        }
        if (strain > 0 && c.game.rand.next() < dt * 0.0085 * strain * (1 - s.skills.fitness / 14)) {
          audio.play('heartbeat', s.pos)
          c.game.kill(s, 'overexertion')
        }
      },
      // left to their own devices a sim knows when to stop; ordered to run, they do not
      endWhen: (c) => !c.sim.task?.forced && (c.sim.needs.energy < 14 || c.sim.needs.hunger < 14),
    }],
  },
  {
    id: 'weightBench', name: 'Weight Bench', glyph: '🏋', category: 'fitness', price: 820,
    size: [1, 2], height: 1.35, build: BUILDERS.weightBench,
    desc: 'Heavy things, held above a soft throat.',
    lethal: 'A weak sim lifting heavy is asking for it.',
    flags: { solid: true, flammable: 0.2 },
    interactions: [{
      id: 'workout', label: 'Lift Weights', duration: 55, anim: 'lift', stand: 'on',
      needs: { fun: 0.3, energy: -1.6, hunger: -1.0, hygiene: -1.4, comfort: -0.9 },
      skill: { key: 'fitness', rate: 0.007 },
      autonomy: (c) => (c.sim.traits.likes.has('workout') ? 2.2 : 0.25) * (c.sim.needs.energy > 45 ? 1 : 0.1),
      danger: 'The bar comes down eventually. Ideally not on them.',
      onTick: (c, dt) => {
        const s = c.sim
        s.bodyTemp = Math.min(92, s.bodyTemp + dt * 0.3)
        const strain =
          (s.needs.energy < 30 ? (30 - s.needs.energy) / 30 : 0) +
          (s.needs.hunger < 30 ? (30 - s.needs.hunger) / 30 : 0) +
          (s.hasBuff('jitters') ? 0.8 : 0)
        if (strain > 1.2 && c.game.rand.next() < dt * 0.12) {
          c.game.floatText(s.pos.x, 1.9, s.pos.z, '💗', '#ff5c58')
        }
        if (strain > 0 && c.game.rand.next() < dt * 0.009 * strain * (1 - s.skills.fitness / 14)) {
          audio.play('heartbeat', s.pos)
          c.game.kill(s, 'overexertion')
        }
      },
      endWhen: (c) => !c.sim.task?.forced && (c.sim.needs.energy < 14 || c.sim.needs.hunger < 14),
    }],
  },
  {
    id: 'yogaMat', name: 'Yoga Mat', glyph: '🧘', category: 'fitness', price: 130,
    size: [1, 2], height: 0.05, build: BUILDERS.yogaMat,
    desc: 'Gentle. Boring. Safe.',
    flags: { flammable: 0.4 },
    interactions: [{
      id: 'yoga', label: 'Do Yoga', duration: 45, anim: 'sit', stand: 'on',
      needs: { comfort: 1.4, fun: 0.8, energy: -0.2 },
      skill: { key: 'fitness', rate: 0.003 },
      autonomy: (c) => desireFrom(c, 'comfort', 2.5),
    }],
  },

  // ============================================================== OUTDOOR
  {
    id: 'poolLadder', name: 'Pool Ladder', glyph: '🪜', category: 'outdoor', price: 110,
    size: [1, 1], height: 0.9, build: BUILDERS.poolLadder,
    desc: 'The only way in or out of a swimming pool.',
    lethal: 'Sell it while someone is swimming. That is the whole trick.',
    flags: { ladder: true, poolOnly: true, fireproof: true },
    interactions: [{
      id: 'swim', label: 'Go For a Swim', duration: 75, anim: 'swim', stand: 'on',
      needs: { fun: 1.9, hygiene: 0.55, comfort: 0.3, energy: -0.35 },
      skill: { key: 'swimming', rate: 0.005 },
      autonomy: (c) => desireFrom(c, 'fun', 3.4) * c.sim.traits.swim,
      onStart: (c) => {
        // strike out for the middle of the pool, well away from the steps
        const grid = c.game.grid
        const t = c.obj.centerTile()
        const deep = grid.findNearest(t.x, t.z, (x, z) =>
          grid.isPool(x, z) && grid.poolExit[grid.idx(x, z)] === 0, { allowStart: false })
        if (deep) {
          const [wx, wz] = grid.tileToWorld(deep.x, deep.z)
          c.sim.pos.set(wx, 0, wz)
          c.sim.path = null
          c.game.splash(wx, 0, wz)
          audio.play('splash', c.sim.pos)
        }
      },
      endWhen: (c) => c.sim.needs.fun > 93 || c.sim.swimStamina < 40,
      onFinish: (c) => {
        // climb back out at the ladder, if one is still there
        const grid = c.game.grid
        const t = c.obj.centerTile()
        const dry = grid.findNearest(t.x, t.z, (x, z) => !grid.isPool(x, z))
        if (dry) {
          const [wx, wz] = grid.tileToWorld(dry.x, dry.z)
          c.sim.pos.set(wx, 0, wz)
          c.sim.path = null
        }
      },
    }],
  },
  {
    id: 'divingBoard', name: 'Diving Board', glyph: '🤸', category: 'outdoor', price: 460,
    size: [1, 2], height: 1.6, build: BUILDERS.divingBoard,
    desc: 'Encourages sims to get into the pool of their own accord.',
    lethal: 'Convenient, if the ladder has gone missing.',
    flags: { solid: true, fireproof: true },
    interactions: [{
      id: 'swim', label: 'Dive In', duration: 40, anim: 'swim',
      needs: { fun: 2.2, hygiene: 0.6, energy: -0.5 },
      skill: { key: 'swimming', rate: 0.006 },
      autonomy: (c) => desireFrom(c, 'fun', 3.2) * c.sim.traits.swim,
      onStart: (c) => {
        const grid = c.game.grid
        const t = c.obj.centerTile()
        const water = grid.findNearest(t.x, t.z, (x, z) => grid.isPool(x, z))
        if (water) {
          const [wx, wz] = grid.tileToWorld(water.x, water.z)
          c.sim.pos.set(wx, 0, wz)
          c.game.splash(wx, 0, wz)
          audio.play('splash', c.sim.pos)
        }
      },
      endWhen: (c) => c.sim.needs.fun > 94,
    }],
  },
  {
    id: 'hotTub', name: 'Hot Tub', glyph: '🛀', category: 'outdoor', price: 3400,
    size: [2, 2], height: 0.95, build: BUILDERS.hotTub,
    desc: 'Warm, social, extremely wet, and wired to the mains.',
    lethal: 'Everything about this is a bad idea.',
    flags: { solid: true, electrical: true, wet: true, breakable: 0.002, fireproof: true },
    interactions: [
      {
        id: 'soak', label: 'Soak', duration: 60, anim: 'sit', stand: 'on',
        needs: { comfort: 2.4, fun: 1.6, social: 1.2, hygiene: 0.4 },
        requires: (c) => !c.obj.broken,
        autonomy: (c) => desireFrom(c, 'comfort', 4) + desireFrom(c, 'fun', 2),
        onStart: (c) => { c.sim.soaked = 160; audio.startLoop(`water${c.obj.id}`, 'water', c.obj.centerWorld) },
        onTick: (c, dt) => { c.sim.bodyTemp = Math.min(90, c.sim.bodyTemp + dt * 0.28) },
        onFinish: (c) => audio.stopLoop(`water${c.obj.id}`),
      },
      {
        id: 'repair', label: 'Repair Hot Tub', duration: 40, anim: 'repair',
        requires: (c) => c.obj.broken,
        skill: { key: 'handiness', rate: 0.007 },
        autonomy: (c) => (c.obj.broken ? 1.8 : 0),
        danger: 'Wet hands. Live wiring. Standing water.',
        onTick: (c, dt) => { rollShock(c, dt * 1.6) },
        onFinish: (c) => { c.obj.broken = false },
      },
    ],
  },
  {
    id: 'sauna', name: 'Steam Sauna', glyph: '♨️', category: 'devious', price: 2600,
    size: [2, 2], height: 2.25, build: BUILDERS.sauna,
    desc: 'Relaxing at a sensible temperature.',
    lethal: 'Set it to maximum and the door becomes a formality.',
    flags: { solid: true, electrical: true, flammable: 0.2 },
    interactions: [
      {
        id: 'sauna', label: 'Take a Sauna', duration: 50, anim: 'sit', stand: 'on',
        needs: { comfort: 1.8, hygiene: 1.2, fun: 0.6 },
        autonomy: (c) => desireFrom(c, 'comfort', 3),
        onStart: (c) => { c.obj.meta.running = true },
        onTick: (c, dt) => {
          const max = c.obj.meta.maxHeat ? 3.2 : 0.55
          c.sim.bodyTemp = Math.min(100, c.sim.bodyTemp + dt * max)
          const cw = c.obj.centerWorld
          if (c.game.rand.next() < dt * 0.25) c.game.smoke(cw.x, 1.6, cw.z, 1)
        },
        onFinish: (c) => { c.obj.meta.running = false },
      },
      {
        id: 'maxheat', label: 'Set Thermostat to Maximum', duration: 3, anim: 'stand_use',
        hidden: true,
        danger: 'Whoever is inside will be poached.',
        onFinish: (c) => {
          c.obj.meta.maxHeat = !c.obj.meta.maxHeat
          c.game.notify(
            c.obj.meta.maxHeat ? 'The sauna thermostat is jammed at maximum.' : 'The sauna is back to a survivable setting.',
            c.obj.meta.maxHeat ? 'danger' : 'info', '♨️')
        },
      },
    ],
  },
  {
    id: 'deepFreezer', name: 'Chest Freezer', glyph: '🧊', category: 'devious', price: 1500,
    size: [2, 1], height: 1.0, build: BUILDERS.deepFreezer,
    desc: 'Cold storage. Large enough for a person, if you are wondering.',
    lethal: 'Climbing in is a one-way trip.',
    flags: { solid: true, electrical: true, fireproof: true },
    interactions: [
      {
        id: 'icecream', label: 'Get Ice Cream', duration: 12, anim: 'stand_use',
        needs: { hunger: 1.6, fun: 1.2 },
        autonomy: (c) => desireFrom(c, 'fun', 2) + desireFrom(c, 'hunger', 2),
        onTick: (c, dt) => { c.sim.bodyTemp = Math.max(30, c.sim.bodyTemp - dt * 0.5) },
      },
      {
        id: 'climbin', label: 'Climb Inside', duration: 200, anim: 'sit', stand: 'on',
        hidden: true,
        danger: 'They will not climb back out.',
        onStart: (c) => c.sim.say('This seems ill-advised.', 4),
        onTick: (c, dt) => {
          c.sim.bodyTemp = Math.max(0, c.sim.bodyTemp - dt * 1.6)
          if (c.game.rand.next() < dt * 0.1) c.game.spark(c.sim.pos.x, 1.0, c.sim.pos.z, 2, 0x9fe4ff)
        },
      },
    ],
  },
  {
    id: 'rocket', name: 'Backyard Rocket', glyph: '🚀', category: 'devious', price: 7500,
    size: [2, 2], height: 4.0, build: BUILDERS.rocket,
    desc: 'A home-built orbital vehicle. Built at home. By hand.',
    lethal: 'Launching without handiness ends in a crater.',
    flags: { solid: true, outdoorOnly: true, flammable: 0.5 },
    interactions: [
      {
        id: 'build', label: 'Work on Rocket', duration: 60, anim: 'repair',
        needs: { fun: 1.2, energy: -0.5 },
        skill: { key: 'handiness', rate: 0.012 },
        autonomy: (c) => desireFrom(c, 'fun', 2),
        onTick: (c, dt) => {
          const cw = c.obj.centerWorld
          if (c.game.rand.next() < dt * 0.15) c.game.spark(cw.x, 1.0, cw.z, 3, 0xffcc66)
        },
        onFinish: (c) => { c.obj.meta.progress = Math.min(100, ((c.obj.meta.progress as number) ?? 0) + 25) },
      },
      {
        id: 'launch', label: 'Launch Rocket', duration: 20, anim: 'stand_use', stand: 'on',
        danger: 'Survival scales with handiness. Nothing else.',
        onStart: (c) => { c.sim.say('Five... four...', 4); audio.play('ignite', c.obj.centerWorld) },
        onFinish: (c) => {
          const chance = Math.max(0.08, 0.9 - c.sim.skills.handiness * 0.1 - (((c.obj.meta.progress as number) ?? 0) / 400))
          const cw = c.obj.centerWorld
          if (c.game.rand.next() < chance) {
            audio.play('explosion', cw)
            c.game.spark(cw.x, 1.6, cw.z, 90, 0xff9933)
            c.game.startFire(c.obj.centerTile().x, c.obj.centerTile().z, 2)
            c.game.kill(c.sim, 'rocket')
          } else {
            c.game.notify(`<b>${c.sim.name}</b> returned from space, unharmed and insufferable.`, 'warn', '🚀')
            c.sim.needs.fun = 100
            c.sim.addBuff('astronaut', 'Been To Space', 'good', 720)
          }
        },
      },
    ],
  },
  {
    id: 'cowplant', name: 'Devouring Plant', glyph: '🐄', category: 'devious', price: 1900,
    size: [2, 2], height: 2.3, build: BUILDERS.cowplant,
    desc: 'A large carnivorous plant that produces a cake to lure the hungry.',
    lethal: 'Starve a sim, then let them near the cake.',
    flags: { solid: true, outdoorOnly: false, flammable: 0.4 },
    interactions: [
      {
        id: 'eatcake', label: 'Eat The Cake', duration: 8, anim: 'stand_use',
        needs: { hunger: 1.0 },
        danger: 'Fitness is the only thing that gets them back out.',
        autonomy: (c) => (c.sim.needs.hunger < 25 ? 8 * (1 - c.sim.needs.hunger / 25) : 0),
        onStart: (c) => c.sim.say('Free cake!', 3),
        onFinish: (c) => {
          audio.play('chomp', c.obj.centerWorld)
          const escape = 0.12 + c.sim.skills.fitness * 0.055
          if (c.game.rand.next() > escape) {
            c.game.kill(c.sim, 'cowplant')
          } else {
            c.sim.needs.hygiene = 0
            c.sim.embarrassment += 30
            c.sim.addBuff('chewed', 'Recently Chewed', 'bad', 480)
            c.game.notify(`<b>${c.sim.name}</b> wriggled free of the plant.`, 'warn', '🐄')
          }
        },
      },
      {
        id: 'milk', label: 'Milk the Plant', duration: 20, anim: 'stand_use',
        needs: { fun: 0.6 },
        requires: (c) => !!c.obj.meta.fed,
        onFinish: (c) => { c.obj.meta.fed = false; c.game.earn(220) },
      },
    ],
  },
  {
    id: 'tree', name: 'Shade Tree', glyph: '🌳', category: 'outdoor', price: 240,
    size: [2, 2], height: 3.6, build: BUILDERS.tree,
    desc: 'Pleasant. Large. Extremely flammable in a dry season.',
    flags: { solid: true, outdoorOnly: true, flammable: 0.7 },
  },
  {
    id: 'fence', name: 'Garden Fence', glyph: '🚧', category: 'outdoor', price: 60,
    size: [1, 1], height: 1.0, build: BUILDERS.fence,
    desc: 'Blocks movement without blocking the view of what happens next.',
    flags: { solid: true, flammable: 0.6 },
  },
  {
    id: 'flowerbed', name: 'Flower Bed', glyph: '🌼', category: 'outdoor', price: 160,
    size: [2, 1], height: 0.5, build: BUILDERS.flowerbed,
    desc: 'Cheerful groundcover.',
    flags: { flammable: 0.5 },
  },
  {
    id: 'umbrella', name: 'Patio Umbrella', glyph: '⛱', category: 'outdoor', price: 210,
    size: [1, 1], height: 2.7, build: BUILDERS.umbrella,
    desc: 'Shade. Fabric. Height. A wonderful fire ladder.',
    flags: { solid: true, outdoorOnly: true, flammable: 0.9 },
  },

  {
    id: 'smokeAlarm', name: 'Smoke Alarm', glyph: '🚨', category: 'decor', price: 140,
    size: [1, 1], height: 2.5, build: BUILDERS.smokeAlarm,
    desc: 'Warns the household about fires early, which is rarely what you want.',
    lethal: 'Sell it and nobody finds out until the curtains go up.',
    flags: { wallish: true, fireproof: true },
  },
  {
    id: 'extinguisher', name: 'Fire Extinguisher', glyph: '🧯', category: 'decor', price: 190,
    size: [1, 1], height: 1.4, build: BUILDERS.extinguisher,
    desc: 'A brave sim will use this to put fires out.',
    lethal: 'Remove it and the fire wins by default.',
    flags: { wallish: true, fireproof: true },
  },

  // ============================================================== DECOR
  {
    id: 'painting', name: 'Framed Painting', glyph: '🖼', category: 'decor', price: 320,
    size: [1, 1], height: 2.0, build: BUILDERS.painting,
    desc: 'Art. Canvas and wood, mostly.',
    flags: { wallish: true, flammable: 0.8 },
  },
  {
    id: 'mirror', name: 'Full-Length Mirror', glyph: '🪞', category: 'decor', price: 280,
    size: [1, 1], height: 1.9, build: BUILDERS.mirror,
    desc: 'Sims like looking at themselves.',
    flags: { wallish: true, flammable: 0.2 },
    interactions: [{
      id: 'admire', label: 'Admire Self', duration: 20, anim: 'stand_use',
      needs: { fun: 1.4, comfort: 0.3 },
      autonomy: (c) => desireFrom(c, 'fun', 2.2),
      onFinish: (c) => {
        if (c.sim.needs.hygiene < 20) {
          c.sim.embarrassment += 12 * c.sim.traits.shame
          c.sim.say('Who is that?', 3)
        }
      },
    }],
  },
  {
    id: 'statue', name: 'Marble Statue', glyph: '🗿', category: 'decor', price: 900,
    size: [1, 1], height: 1.5, build: BUILDERS.statue,
    desc: 'Fireproof, heavy, entirely decorative.',
    flags: { solid: true, fireproof: true },
  },
]

export const CATALOG_BY_ID = new Map(CATALOG.map((d) => [d.id, d]))

/** Extra defs the game spawns itself and never sells. */
export const GRAVESTONE: ObjectDef = {
  id: 'gravestone', name: 'Gravestone', glyph: '🪦', category: 'decor', price: 0,
  size: [1, 1], height: 0.9, build: BUILDERS.gravestone,
  desc: 'A permanent record of your work.',
  flags: { solid: true, fireproof: true },
}

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'kitchen', label: 'Kitchen' },
  { id: 'bath', label: 'Bath' },
  { id: 'bed', label: 'Bedroom' },
  { id: 'living', label: 'Living' },
  { id: 'electronics', label: 'Tech' },
  { id: 'fitness', label: 'Fitness' },
  { id: 'outdoor', label: 'Outdoor' },
  { id: 'decor', label: 'Decor' },
  { id: 'devious', label: 'Devious' },
]

export function initCatalog() { ensurePalette() }
