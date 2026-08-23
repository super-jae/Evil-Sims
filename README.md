# Evil Sims

A life-simulation game in the shape of The Sims, with one difference: the household
is not something you nurture. It is something you dismantle, creatively.

You start with four sims, a furnished house, a swimming pool and §18,000. The sims
look after themselves perfectly well if you leave them alone — they cook, sleep,
shower, swim, gossip and read. Left unattended for a week, nobody dies. Everything
that happens to them from here is your doing.

Runs entirely in the browser. Three.js for rendering, Web Audio for sound. **No art
or audio assets** — every texture, mesh, animation, sound effect and piece of music
is generated procedurally at runtime.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm run build      # typecheck + production bundle into dist/
npm run preview    # serve the production build
```

Requires a WebGL2 browser. There is no server component and no network access.

## Controls

| | |
|---|---|
| **Left click** | Select a sim / open an object's action menu |
| **Right click** | Context menu (objects and sims) |
| **Left drag a sim** | Pick them up and carry them. Drop them wherever you like. Pools count. |
| **Left drag empty ground** | Pan |
| **Right drag** | Orbit and pitch the camera |
| **Wheel** | Zoom |
| **W A S D** / arrows | Pan (hold **Shift** to move faster) |
| **Q** / **E** | Snap-rotate 45° |
| **0 1 2 3** | Pause / normal / fast / ultra |
| **Space** | Pause toggle |
| **B** | Toggle Build mode |
| **R** | Rotate the object you are placing |
| **Shift+W** | Cycle wall display (cutaway / up / down) |
| **Tab** | Cycle through living sims |
| **F** | Center the camera on the selected sim |
| **L** | Devious Deeds ledger |
| **M** | Mute |
| **Esc** | Close menus, cancel placement |

## How you actually do it

The game does not kill sims for you. Every death is a consequence you arranged out of
ordinary household objects. Some worked examples:

- **Buy a propane gas grill and put it in the living room.** Indoors, ignition risk is
  about eleven times higher, and it scales with how much soft furnishing is nearby. Sell
  the smoke alarm so nobody gets an early warning, and sell the fire extinguisher so no
  brave sim can fight it. Then order your worst cook to grill something.
- **Sell the pool ladder while somebody is swimming.** The lip of a pool is only
  crossable at a ladder. Without one there is no path out, stamina drains, and that is
  that. (Selling it *before* they swim just means nobody gets in — you need them in the
  water first, or you can pick a sim up and drop them in.)
- **Break a television, soak a sim, then order the repair.** Any sim who is wet, or
  standing in a puddle, has a very high chance of completing the circuit. Showers,
  baths, sinks, hot tubs and bladder accidents all leave a sim soaking wet for a while.
- **Sell every toilet, then serve espresso.** Each cup drains the bladder hard. When it
  hits zero they have an accident, and the shame is multiplied by every sim who sees it.
  Repeat until mortification finishes the job.
- **Sell the beds and the sofas.** A sim who collapses on the floorboards does not
  actually rest. Sleep debt accumulates until exhaustion kills them.
- **Order a starving, exhausted, caffeinated sim onto the treadmill.** Left alone a sim
  knows when to stop. Ordered to run, they do not.
- **Wall a sim into a room** with the wall tool and remove the door. Then remove the
  fridge.
- **Lock the rubbish bin** so nobody can empty it, and wait for the flies.

The devious catalog also stocks a Murphy bed that occasionally folds people away, a
chest freezer large enough to climb into, a steam sauna with a thermostat you can jam
at maximum, a carnivorous Devouring Plant that lures hungry sims with cake, and a
home-built orbital rocket.

Objects that can go wrong are marked with **☠** in the catalog and explain exactly
how in their tooltip. Nothing is hidden from you.

## The eighteen ways to go

Immolation · Drowning · Starvation · Exhaustion · Electrocution · Overexertion ·
Mortification · Hysteria · Devoured · Rocket Failure · Steam · Freezing · Vermin ·
Murphy Bed · Pufferfish · Rage · Meteorite · Old Age

Old Age is in there as an insult. If a sim dies of natural causes on your watch, the
ledger says so.

## Devious Deeds

28 achievements, each worth points, tracked in the ledger (**L**). One per death type,
plus meta-deeds: cause five different kinds of death, lose three sims to a single fire,
kill somebody who had no way out of the room, finish a household having earned more from
selling than you spent buying. Your total maps to a rank, from *Suspiciously Nice Player*
up to *Architect of Misfortune*.

## What is simulated

**Sims** have seven needs (hunger, bladder, hygiene, energy, fun, social, comfort) that
decay at rates modified by three traits drawn from a pool of twenty. They pick their own
actions by scoring every reachable interaction on the lot against their current
deficits, walk there with A*, and can be interrupted by emergencies. They gain skill in
cooking, handiness, fitness, swimming, comedy and logic, and skill is what stands between
them and most of the ways they can die. They hold conversations, they panic and flee
outdoors when there is a fire, and a brave one will fight it if an extinguisher exists.

Beyond needs they track body temperature, wetness, swim stamina, sleep debt, rage,
embarrassment and hysteria — the state that drives the less obvious deaths.

**Fire** starts from heat sources, spreads tile to tile at a rate set by the fuel on each
tile (carpet and rugs burn fastest, tile and marble barely at all), does not cross walls,
is stopped by water and puddles, consumes objects into charred wrecks, and burns itself
out once the fuel is gone.

**The lot** is a 34×34 tile grid with floors, walls, doorways and an excavatable pool.
Enclosure is computed by flood-filling from the lot boundary, which is what makes
"indoors" mean something to the grill, and what lets the game notice you have sealed
someone in.

**Build mode** has buy, sell, wall, door, floor, pool and erase tools. Selling refunds
90%. Everything you can place, you can sell — including the things keeping your sims
alive.

## Technical notes

Everything is generated at runtime, so the whole game is one ~200 KB gzipped bundle with
no asset loading:

- **Textures** — grass, wood, ceramic, carpet, concrete, marble and plaster are drawn to
  canvases with value-noise and FBM at boot.
- **Meshes** — ~45 objects and the sims themselves are built from primitives. Sims use a
  hand-built joint hierarchy with 24 hand-authored procedural animation poses that blend
  into each other, plus blinking, head tracking and mouth shapes.
- **Sound** — a Web Audio synthesiser. Adaptive music (calm / tense / chaos / dirge) that
  follows what is happening on the lot, formant-filtered nonsense speech with a per-sim
  voice, and every sound effect built from oscillators and filtered noise.
- **Rendering** — ACES tone mapping, PCF soft shadows, a full day/night cycle with a
  procedural sky and stars, bloom, a heat-shimmer grade that responds to how much of the
  lot is on fire, a custom animated water shader with caustics, a GPU particle system and
  instanced decals for puddles and scorch marks. Resolution scales adaptively to hold
  frame rate.

## Architecture

```
src/
  core/       Engine (renderer, sky, post) · Input & camera rig · GameClock · AudioEngine · Rand
  world/      Grid + A* · procedural Materials · Meshes · Catalog (objects & interactions)
              WorldObject · Lot (floor/wall/pool geometry, cutaway)
  sim/        Sim (needs, autonomy, task queue) · SimMesh (rig + animation) · Needs · Traits
  systems/    Fire · Puddles · Effects (particles) · Decals · Deaths & Deeds
  ui/         UI (HUD, catalog, menus, ledger) · Controls (input → actions)
  Game.ts     Orchestration, build tools, death sequences, the Grim Reaper
```

Objects are data: an `ObjectDef` carries a footprint, flags (flammable, electrical,
plumbing, bed, seat, ladder, breakable…), a procedural mesh builder, and a list of
interactions with need deltas and lifecycle hooks. Adding a new object — or a new way to
die — means adding one entry to the catalog.

## On the brief

The original ask was for graphics, sound and controls to equal or surpass The Sims 4.
That is a decade of work by a large studio with a full art pipeline, and this is a
from-scratch browser game with zero art assets, so it does not match that bar and it
would be dishonest to claim otherwise. What it does do is run the whole thing —
rendering, animation, audio and simulation — procedurally, at 60fps, in a tab, with the
Sims-style camera and interaction model intact, and with a systems layer built
specifically around the thing you actually asked for.
