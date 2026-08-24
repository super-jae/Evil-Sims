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
| **C** / **Home** | Center the camera back on the household |
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

## Turning them against each other

Select one sim, then **click another sim** — everything the first can do to the second
appears in the menu, from a compliment down to starting a brawl. Three ways in, so it is
hard to miss:

- **Click another sim** in the world while one is selected
- **Click a name in the Relationships list** in the selected sim's panel
- **Right-click** any sim

Every sim holds a private opinion of every other, from **Devoted** down to **Nemesis**,
shown in the panel of whoever is selected. The menu header names the pair and the
current standing, so you always know who is about to do what to whom.

The point is not the insult itself. Each cruelty feeds a system that can kill:

| Do this | Because |
|---|---|
| **Insult**, **Blame Them for Everything**, **Pick an Argument** | Rage accumulates, and a sim who fills the meter dies of it. Arguing is cheap and repeatable, and angers the instigator too |
| **Slap Them**, **Shove Them** | Knocks them off whatever they were doing and enrages them |
| **Spit On Them** | Destroys their hygiene, which makes every later humiliation land harder |
| **Throw a Drink in Their Face** | Soaks them for hours and leaves a puddle. Wet sim plus broken appliance equals electrocution |
| **Give Them a Wedgie** | Humiliation that scales with the size of the audience |
| **Mock Their Grief** | Only once somebody has died. Rage and shame together, and about as cruel as this gets |
| **Mock Their Appearance**, **Laugh at Their Misfortune** | Embarrassment, which is how mortification kills. Mocking hits far harder on a sim who has not showered, and laughing is only available while they are already having a bad time |
| **Tell a Cruel Joke** | The target is humiliated, but everyone *watching* finds it hilarious — and hysteria is its own cause of death |
| **Wake Them Up Rudely** | Only while they sleep. Costs energy and adds two hours of sleep debt, which is the road to death by exhaustion |
| **Steal Their Meal** | Only while they eat. A sim who never finishes a meal starves eventually |
| **Shove Them Into the Pool** | Requires water within reach of them. With the ladder sold, that is a drowning |
| **Start a Fight** | Both come away exhausted and filthy; the loser is enraged and humiliated |
| **Spread Rumors** | Turns the entire rest of the household against them at once |

Nineteen interactions in all. Cruelty is contagious: sims never start on each other
unprompted while everyone is on neutral terms — but once you have soured a relationship, or spread a rumor, they carry
on by themselves. In testing, souring a single pair produced nine more unprompted acts
of cruelty and one sim who raged themselves to death without further help.

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

35 achievements, each worth points, tracked in the ledger (**L**). One per death type,
plus meta-deeds: cause five different kinds of death, lose three sims to a single fire,
kill somebody who had no way out of the room, finish a household having earned more from
selling than you spent buying, drive a relationship all the way to Nemesis, make every
sim hostile toward one of them, or mortify somebody to death after tormenting them at
least five times. Your total maps to a rank, from *Suspiciously Nice Player*
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

Everything is generated at runtime, so the whole game is one ~245 KB gzipped bundle with
no asset loading (about 40 KB of that is SMAA's lookup textures):

- **Textures** — grass, wood, ceramic, carpet, concrete, marble and plaster are drawn to
  canvases with value-noise and FBM at boot.
  Their luminance is then run through a Sobel filter to derive tangent-space normal
  maps and through a ramp to derive roughness variation, so grout, grain, pile and
  plaster tooth all catch light rather than being painted-on color.
- **Meshes** — ~45 objects and the sims themselves are built from primitives. Sims use a
  hand-built joint hierarchy with 24 hand-authored procedural animation poses that blend
  into each other. The walk cycle is driven by distance traveled rather than by time,
  so feet stay planted instead of skating when a sim speeds up or slows down.
- **Faces** — a driven rig rather than a fixed mesh: brows move and tilt at the inner
  ends, eyes squint or widen, the jaw drops, and the mouth is a torus arc that flips and
  deepens between a smile and a frown. Eight expressions ease into one another and are
  chosen from sim state — mood, rage, embarrassment, hysteria, exhaustion, panic, fire,
  death — with speech driving the mouth on top of whatever expression is showing.
- **Sound** — a Web Audio synthesizer. Adaptive music (calm / tense / chaos / dirge) that
  follows what is happening on the lot, formant-filtered nonsense speech with a per-sim
  voice, and every sound effect built from oscillators and filtered noise.
- **Rendering** — ACES tone mapping, ground-contact ambient occlusion, PCF soft shadows
  from a frustum that follows the camera and snaps to the texel grid, a full day/night
  cycle with a procedural sky and stars, subsurface-approximating skin shading, threshold
  bloom over the HDR buffer, tilt-shift defocus for the dollhouse framing, SMAA, a
  heat-shimmer grade that responds to how much of the lot is on fire, a custom animated
  water shader with caustics, a GPU particle system and instanced decals for puddles and
  scorch marks. Resolution scales adaptively to hold frame rate, dropping ambient
  occlusion, defocus and anti-aliasing first.

## Architecture

```
src/
  core/       Engine (renderer, sky, post) · Input & camera rig · GameClock · AudioEngine · Rand
  world/      Grid + A* · procedural Materials · Meshes · Catalog (objects & interactions)
              WorldObject · Lot (floor/wall/pool geometry, cutaway)
  sim/        Sim (needs, autonomy, task queue) · SimMesh (rig + animation) · Needs · Traits
              Relationships (who loathes whom) · Socials (sim-to-sim interactions)
  systems/    Fire · Puddles · Effects (particles) · Decals · Deaths & Deeds
  ui/         UI (HUD, catalog, menus, ledger) · Controls (input → actions)
  Game.ts     Orchestration, build tools, death sequences, the Grim Reaper
```

Objects are data: an `ObjectDef` carries a footprint, flags (flammable, electrical,
plumbing, bed, seat, ladder, breakable…), a procedural mesh builder, and a list of
interactions with need deltas and lifecycle hooks. Adding a new object — or a new way to
die — means adding one entry to the catalog.

Sim-to-sim interactions follow the same shape: a `SocialDef` carries a duration, the
animation each party plays, a relationship delta, an optional precondition, and an
`apply` hook. Its `autonomy` function decides whether a sim would do it unprompted,
which is what makes feuds sustain themselves.

## On the brief

The original ask was for graphics, sound and controls to equal or surpass The Sims 4.
That is a decade of work by a large studio with a full art pipeline, and this is a
from-scratch browser game with zero art assets, so it does not match that bar and it
would be dishonest to claim otherwise. What it does do is run the whole thing —
rendering, animation, audio and simulation — procedurally, at 60fps, in a tab, with the
Sims-style camera and interaction model intact, and with a systems layer built
specifically around the thing you actually asked for.

The technique gap has since been closed as far as it usefully can be: ambient occlusion,
derived normal and roughness maps, subsurface skin shading, a driven facial rig,
tilt-shift defocus, sharper shadows and a gait-locked walk cycle. What remains is the
part no amount of technique substitutes for — sculpted heads, painted texture sets, and a
hand-authored animation library.
