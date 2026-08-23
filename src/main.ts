import './style.css'
import { Game } from './Game'
import { UI } from './ui/UI'
import { Controls } from './ui/Controls'
import { audio } from './core/Audio'
import { SOCIALS } from './sim/Socials'

const canvas = document.getElementById('viewport') as HTMLCanvasElement
const uiRoot = document.getElementById('ui') as HTMLElement
const boot = document.getElementById('boot') as HTMLElement
const bootBar = boot.querySelector('.boot-bar i') as HTMLElement
const bootStatus = boot.querySelector('.boot-status') as HTMLElement
const startBtn = document.getElementById('boot-start') as HTMLButtonElement

const STEPS: [string, number][] = [
  ['Mixing procedural textures…', 12],
  ['Pouring the foundations…', 30],
  ['Hanging the curtains (highly flammable)…', 48],
  ['Filling the swimming pool…', 64],
  ['Installing one (1) pool ladder…', 76],
  ['Waking the household…', 90],
  ['Sharpening the scythe…', 100],
]

let game: Game
let ui: UI
let controls: Controls

async function boot0() {
  let i = 0
  const advance = async () => {
    if (i >= STEPS.length) return
    const [text, pct] = STEPS[i++]
    bootStatus.textContent = text
    bootBar.style.width = `${pct}%`
    await new Promise((r) => setTimeout(r, 90))
  }

  await advance()
  game = new Game(canvas, uiRoot)
  await advance()
  await advance()
  game.createWorld()
  await advance()
  await advance()
  ui = new UI(uiRoot, game)
  controls = new Controls(game, ui)
  ui.setMode('live')
  // debug handle: lets the browser console (and the smoke tests) drive the game
  ;(window as unknown as Record<string, unknown>).__game = game
  ;(window as unknown as Record<string, unknown>).__socials = SOCIALS
  ui.refresh()
  await advance()
  await advance()

  // draw one frame behind the boot screen so there is no flash of empty canvas
  game.engine.setTimeOfDay(game.clock.hour)
  game.engine.render(0.016)

  bootStatus.textContent = 'Ready.'
  startBtn.hidden = false
}

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true
  await audio.init()
  audio.setVolumes(0.8, 0.34, 0.85)
  audio.setMood('calm')
  boot.classList.add('hidden')
  setTimeout(() => boot.remove(), 900)
  game.notify(
    'Four sims. One lot. No supervision. <b>Sell something load-bearing.</b>',
    'death', '💀')
  start()
})

// ------------------------------------------------------------------ loop

let last = performance.now()
let frameAccum = 0
let frameCount = 0
let qualityScale = 1

function frame(now: number) {
  requestAnimationFrame(frame)
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now

  game.update(dt)
  controls.update(dt)
  ui.tick(dt)

  // adaptive resolution so heavy fires do not tank the framerate
  frameAccum += dt
  frameCount++
  if (frameAccum > 1.5) {
    const avg = frameAccum / frameCount
    if (avg > 0.024 && qualityScale > 0.62) qualityScale -= 0.14
    else if (avg < 0.0135 && qualityScale < 1) qualityScale = Math.min(1, qualityScale + 0.1)
    game.engine.setQualityScale(qualityScale)
    frameAccum = 0
    frameCount = 0
  }
}

function start() {
  last = performance.now()
  requestAnimationFrame(frame)
}

boot0().catch((err) => {
  console.error(err)
  bootStatus.textContent = 'Something went wrong. Check the console.'
})

// pause when the tab is hidden so sims do not starve in the background
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game) {
    game.clock.setSpeed(0)
    audio.stopAllLoops()
    ui?.refresh()
  }
})
