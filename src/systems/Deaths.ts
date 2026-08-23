export type DeathId =
  | 'fire' | 'drowning' | 'starvation' | 'exhaustion' | 'electrocution'
  | 'overexertion' | 'mortification' | 'hysteria' | 'cowplant' | 'rocket'
  | 'steam' | 'freezing' | 'vermin' | 'murphy' | 'pufferfish' | 'rage'
  | 'meteor' | 'oldage'

export interface DeathDef {
  id: DeathId
  name: string
  icon: string
  /** Filled in as "<Name> <obituary>." */
  obituary: string
  color: string
  /** Deed unlocked by causing this death. */
  deed?: string
}

export const DEATHS: Record<DeathId, DeathDef> = {
  fire:          { id: 'fire', name: 'Immolation', icon: '🔥', obituary: 'was reduced to a tasteful pile of ash', color: '#ff7a3d', deed: 'grillmaster' },
  drowning:      { id: 'drowning', name: 'Drowning', icon: '🌊', obituary: 'swam their last lap', color: '#4aa9e8', deed: 'ladderless' },
  starvation:    { id: 'starvation', name: 'Starvation', icon: '🍽', obituary: 'forgot how eating works, permanently', color: '#c9a24a', deed: 'hungergames' },
  exhaustion:    { id: 'exhaustion', name: 'Exhaustion', icon: '😴', obituary: 'fell asleep and simply kept going', color: '#7a8fd0', deed: 'insomniac' },
  electrocution: { id: 'electrocution', name: 'Electrocution', icon: '⚡', obituary: 'completed a circuit they should not have', color: '#ffe14a', deed: 'shocking' },
  overexertion:  { id: 'overexertion', name: 'Overexertion', icon: '💪', obituary: 'achieved peak fitness, then stopped', color: '#ff5c58', deed: 'overtrained' },
  mortification: { id: 'mortification', name: 'Mortification', icon: '😳', obituary: 'died of pure, undiluted embarrassment', color: '#ff8ab0', deed: 'bladderbreaker' },
  hysteria:      { id: 'hysteria', name: 'Hysteria', icon: '🤣', obituary: 'laughed, and could not stop, and then stopped', color: '#ffd166', deed: 'comedygold' },
  cowplant:      { id: 'cowplant', name: 'Devoured', icon: '🐄', obituary: 'was eaten by the salad', color: '#57e389', deed: 'feedingtime' },
  rocket:        { id: 'rocket', name: 'Rocket Failure', icon: '🚀', obituary: 'reached low orbit in several pieces', color: '#ff9d3d', deed: 'houston' },
  steam:         { id: 'steam', name: 'Steam', icon: '♨️', obituary: 'was gently poached', color: '#e8d5c0', deed: 'saunaspecial' },
  freezing:      { id: 'freezing', name: 'Freezing', icon: '🧊', obituary: 'became a very disappointed popsicle', color: '#8fd8ff', deed: 'coldstorage' },
  vermin:        { id: 'vermin', name: 'Vermin', icon: '🪰', obituary: 'was carried off by the flies, mostly', color: '#8a9a4a', deed: 'verminous' },
  murphy:        { id: 'murphy', name: 'Murphy Bed', icon: '🛏', obituary: 'was folded neatly into the wall', color: '#b08a5a', deed: 'snapped' },
  pufferfish:    { id: 'pufferfish', name: 'Pufferfish', icon: '🐡', obituary: 'trusted a home cook', color: '#a8e04a', deed: 'chefspecial' },
  rage:          { id: 'rage', name: 'Rage', icon: '😡', obituary: 'popped a blood vessel out of sheer principle', color: '#ff4a4a', deed: 'seeingred' },
  meteor:        { id: 'meteor', name: 'Meteorite', icon: '☄️', obituary: 'was selected, personally, by the cosmos', color: '#c08aff', deed: 'stargazer' },
  oldage:        { id: 'oldage', name: 'Old Age', icon: '⏳', obituary: 'died peacefully of natural causes, which is frankly a failure on your part', color: '#98a0b4', deed: 'naturalcauses' },
}

export interface DeedDef {
  id: string
  name: string
  icon: string
  desc: string
  points: number
}

export const DEEDS: DeedDef[] = [
  { id: 'grillmaster', name: 'Grillmaster', icon: '🔥', desc: 'Burn a sim to death.', points: 100 },
  { id: 'ladderless', name: 'Ladderless', icon: '🪜', desc: 'Drown a sim.', points: 120 },
  { id: 'hungergames', name: 'Hunger Games', icon: '🍽', desc: 'Starve a sim.', points: 90 },
  { id: 'insomniac', name: 'Insomniac', icon: '😴', desc: 'Exhaust a sim to death.', points: 90 },
  { id: 'shocking', name: 'Shocking', icon: '⚡', desc: 'Electrocute a sim.', points: 140 },
  { id: 'overtrained', name: 'Overtrained', icon: '💪', desc: 'Kill a sim through exercise.', points: 130 },
  { id: 'bladderbreaker', name: 'Bladder Breaker', icon: '😳', desc: 'Mortify a sim to death.', points: 160 },
  { id: 'comedygold', name: 'Comedy Gold', icon: '🤣', desc: 'Make a sim laugh themselves to death.', points: 150 },
  { id: 'feedingtime', name: 'Feeding Time', icon: '🐄', desc: 'Feed a sim to the Devouring Plant.', points: 180 },
  { id: 'houston', name: 'Houston, We Have A Problem', icon: '🚀', desc: 'Lose a sim to a rocket mishap.', points: 200 },
  { id: 'saunaspecial', name: 'Sauna Special', icon: '♨️', desc: 'Steam a sim.', points: 150 },
  { id: 'coldstorage', name: 'Cold Storage', icon: '🧊', desc: 'Freeze a sim.', points: 150 },
  { id: 'verminous', name: 'Verminous', icon: '🪰', desc: 'Let the flies take a sim.', points: 130 },
  { id: 'snapped', name: 'Snapped', icon: '🛏', desc: 'Fold a sim into a Murphy bed.', points: 170 },
  { id: 'chefspecial', name: "Chef's Special", icon: '🐡', desc: 'Serve a fatal pufferfish dinner.', points: 160 },
  { id: 'seeingred', name: 'Seeing Red', icon: '😡', desc: 'Enrage a sim to death.', points: 140 },
  { id: 'stargazer', name: 'Stargazer', icon: '☄️', desc: 'Arrange a meteorite delivery.', points: 250 },
  { id: 'naturalcauses', name: 'Natural Causes', icon: '⏳', desc: 'Fail so completely that a sim dies of old age.', points: 10 },

  // meta deeds
  { id: 'firstblood', name: 'First Blood', icon: '💀', desc: 'Cause your first death.', points: 50 },
  { id: 'fullhouse', name: 'Full House', icon: '🏚', desc: 'Empty the household entirely.', points: 400 },
  { id: 'varietypack', name: 'Variety Pack', icon: '🎭', desc: 'Cause five different kinds of death.', points: 220 },
  { id: 'rubegoldberg', name: 'Rube Goldberg', icon: '⚙️', desc: 'Lose three sims to a single fire.', points: 260 },
  { id: 'speedrun', name: 'Speedrun', icon: '⏱', desc: 'Cause a death within the first in-game day.', points: 120 },
  { id: 'trapped', name: 'Sealed Unit', icon: '🧱', desc: 'Kill a sim who had no way out of the room.', points: 150 },
  { id: 'frugal', name: 'Frugal Evil', icon: '🪙', desc: 'Cause a death having sold more than you bought.', points: 140 },
  { id: 'plumbing', name: 'Plumbing Problems', icon: '🚽', desc: 'Sell every toilet while a sim is desperate.', points: 90 },
  { id: 'demolition', name: 'Demolition', icon: '🔨', desc: 'Sell 20 objects.', points: 60 },

  // social cruelty
  { id: 'bully', name: 'Bully', icon: '🗣', desc: 'Land 15 cruel social interactions.', points: 90 },
  { id: 'nemesis', name: 'Nemesis', icon: '💔', desc: 'Drive a relationship all the way to Nemesis.', points: 130 },
  { id: 'pariah', name: 'Pariah', icon: '🚫', desc: 'Make every other sim hostile toward one of them.', points: 180 },
  { id: 'pushed', name: 'Pushed', icon: '🤾', desc: 'Drown a sim you shoved into the pool yourself.', points: 220 },
  { id: 'socialmurder', name: 'Social Murder', icon: '😶‍🌫️', desc: 'Mortify a sim to death after tormenting them at least five times.', points: 240 },
  { id: 'sleepdeprived', name: 'Sleep Deprivation', icon: '⏰', desc: 'Rudely wake the same sim five times.', points: 150 },
  { id: 'brawler', name: 'Fight Club', icon: '👊', desc: 'Stage three fights.', points: 110 },
  { id: 'arsonist', name: 'Arsonist', icon: '🧯', desc: 'Have four fires burning at once.', points: 120 },
]

export const DEED_BY_ID = new Map(DEEDS.map((d) => [d.id, d]))

export const RANKS: { min: number; title: string }[] = [
  { min: 2200, title: 'Architect of Misfortune' },
  { min: 1500, title: 'Landlord of the Damned' },
  { min: 950, title: 'Devious Mastermind' },
  { min: 560, title: 'Household Menace' },
  { min: 280, title: 'Careless Caretaker' },
  { min: 90, title: 'Amateur Hour' },
  { min: 0, title: 'Suspiciously Nice Player' },
]

export function rankFor(points: number) {
  for (const r of RANKS) if (points >= r.min) return r.title
  return RANKS[RANKS.length - 1].title
}
