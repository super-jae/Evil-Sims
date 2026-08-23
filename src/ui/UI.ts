import { Game } from '../Game'
import { CATALOG, CATEGORIES, CATALOG_BY_ID } from '../world/Catalog'
import { Floor } from '../world/Grid'
import { NEED_KEYS, NEED_META, needColor } from '../sim/Needs'
import { TRAIT_BY_ID } from '../sim/Traits'
import { DEATHS, DEEDS, rankFor } from '../systems/Deaths'
import type { Sim } from '../sim/Sim'
import type { WorldObject } from '../world/WorldObject'
import type { Interaction } from '../world/ObjectTypes'
import type { NoteKind } from '../types'
import type { Category } from '../world/ObjectTypes'
import type { BuildTool } from '../Game'
import { audio } from '../core/Audio'

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html) e.innerHTML = html
  return e
}

const FLOOR_SWATCHES: { id: Floor; label: string; glyph: string }[] = [
  { id: Floor.Wood, label: 'Wood', glyph: '🟫' },
  { id: Floor.Tile, label: 'Tile', glyph: '⬜' },
  { id: Floor.Carpet, label: 'Carpet', glyph: '🟪' },
  { id: Floor.Concrete, label: 'Concrete', glyph: '🔲' },
  { id: Floor.Marble, label: 'Marble', glyph: '◻️' },
  { id: Floor.None, label: 'Remove', glyph: '🌱' },
]

const TOOLS: { id: BuildTool; label: string; glyph: string; hint: string }[] = [
  { id: 'object', label: 'Buy', glyph: '🛍', hint: 'Click to place. <kbd>R</kbd> rotates.' },
  { id: 'sell', label: 'Sell', glyph: '💰', hint: 'Click any object to sell it back at 90%.' },
  { id: 'wall', label: 'Wall', glyph: '🧱', hint: 'Drag along tile edges to build walls.' },
  { id: 'door', label: 'Door', glyph: '🚪', hint: 'Click an existing wall to cut a doorway.' },
  { id: 'floor', label: 'Floor', glyph: '🪵', hint: 'Drag to lay flooring.' },
  { id: 'pool', label: 'Pool', glyph: '🏊', hint: 'Drag to excavate. Ladders are sold separately.' },
  { id: 'erase', label: 'Erase', glyph: '🧨', hint: 'Removes walls, floors and pool tiles.' },
]

export class UI {
  private root: HTMLElement
  private game: Game

  private fundsEl!: HTMLElement
  private clockEl!: HTMLElement
  private deathsEl!: HTMLElement
  private pointsEl!: HTMLElement
  private rosterEl!: HTMLElement
  private needsEl!: HTMLElement
  private catalogEl!: HTMLElement
  private catGrid!: HTMLElement
  private catTabs!: HTMLElement
  private toolRow!: HTMLElement
  private notesEl!: HTMLElement
  private ctxEl!: HTMLElement
  private ledgerEl!: HTMLElement
  private scrimEl!: HTMLElement
  private hintEl!: HTMLElement
  private tooltipEl!: HTMLElement
  private endCardEl!: HTMLElement
  private speedBtns: HTMLButtonElement[] = []
  private modeBtns: HTMLButtonElement[] = []
  private wallBtn!: HTMLButtonElement

  private activeCategory: Category = 'kitchen'
  private accum = 0

  constructor(root: HTMLElement, game: Game) {
    this.root = root
    this.game = game
    this.buildTopBar()
    this.buildRoster()
    this.buildNeeds()
    this.buildCatalog()
    this.buildNotes()
    this.buildContextMenu()
    this.buildLedger()
    this.buildMisc()

    game.onNotify = (t, k, i) => this.notify(t, k, i)
    game.onStateChange = () => this.refresh()
    game.onGameOver = () => this.showEndCard()
  }

  // ------------------------------------------------------------------ chrome

  private buildTopBar() {
    const bar = el('div', '')
    bar.id = 'topbar'

    const left = el('div', 'hud-group')
    const funds = el('div', 'hud-chip panel', '<span class="lbl">Funds</span><span class="val" id="funds-v">§0</span>')
    funds.id = 'funds'
    const deaths = el('div', 'hud-chip panel', '<span class="lbl">Deaths</span><span class="val" id="deaths-v">0</span>')
    deaths.id = 'deaths'
    const pts = el('div', 'hud-chip panel', '<span class="lbl">Devious</span><span class="val" id="pts-v">0</span>')
    left.append(funds, deaths, pts)
    this.fundsEl = funds.querySelector('#funds-v')!
    this.deathsEl = deaths.querySelector('#deaths-v')!
    this.pointsEl = pts.querySelector('#pts-v')!

    const center = el('div', 'hud-group')
    const clock = el('div', 'hud-chip panel', '<span class="lbl" id="clock-d">Day 1</span><span class="val" id="clock-v">8:00 AM</span>')
    clock.id = 'clock'
    const speeds = el('div', 'btn-row panel')
    const icons = ['⏸', '▶', '▶▶', '▶▶▶']
    icons.forEach((ic, i) => {
      const b = el('button', 'icon-btn', ic) as HTMLButtonElement
      b.title = ['Pause', 'Normal speed', 'Fast', 'Ultra'][i] + ` (${i})`
      b.onclick = () => { this.game.clock.setSpeed(i); audio.play('click'); this.refresh() }
      this.speedBtns.push(b)
      speeds.appendChild(b)
    })
    center.append(clock, speeds)
    this.clockEl = clock.querySelector('#clock-v')!

    const right = el('div', 'hud-group')
    const modes = el('div', 'btn-row panel')
    for (const [id, label] of [['live', 'Live'], ['build', 'Build']] as const) {
      const b = el('button', 'icon-btn mode-btn', label) as HTMLButtonElement
      b.dataset.mode = id
      b.onclick = () => this.setMode(id)
      this.modeBtns.push(b)
      modes.appendChild(b)
    }
    const extras = el('div', 'btn-row panel')
    this.wallBtn = el('button', 'icon-btn', '🧱') as HTMLButtonElement
    this.wallBtn.title = 'Cycle wall display (W)'
    this.wallBtn.onclick = () => this.cycleWalls()
    const ledgerBtn = el('button', 'icon-btn', '📓') as HTMLButtonElement
    ledgerBtn.title = 'Devious Deeds ledger (L)'
    ledgerBtn.onclick = () => this.toggleLedger()
    const muteBtn = el('button', 'icon-btn', '🔊') as HTMLButtonElement
    muteBtn.title = 'Mute (M)'
    muteBtn.onclick = () => {
      audio.enabled = !audio.enabled
      muteBtn.textContent = audio.enabled ? '🔊' : '🔇'
      if (!audio.enabled) audio.stopAllLoops()
    }
    extras.append(this.wallBtn, ledgerBtn, muteBtn)
    right.append(extras, modes)

    bar.append(left, center, right)
    this.root.appendChild(bar)
  }

  private buildRoster() {
    this.rosterEl = el('div')
    this.rosterEl.id = 'roster'
    this.root.appendChild(this.rosterEl)
  }

  private buildNeeds() {
    this.needsEl = el('div', 'panel')
    this.needsEl.id = 'needs'
    this.root.appendChild(this.needsEl)
  }

  private buildCatalog() {
    this.catalogEl = el('div', 'panel')
    this.catalogEl.id = 'catalog'

    this.toolRow = el('div', 'cat-tabs')
    for (const t of TOOLS) {
      const b = el('button', 'cat-tab', `${t.glyph} ${t.label}`) as HTMLButtonElement
      b.dataset.tool = t.id
      b.onclick = () => {
        this.game.build.tool = t.id
        audio.play('click')
        this.refreshCatalog()
        this.setHint(t.hint)
      }
      this.toolRow.appendChild(b)
    }

    this.catTabs = el('div', 'cat-tabs')
    for (const c of CATEGORIES) {
      const b = el('button', 'cat-tab', c.label) as HTMLButtonElement
      b.dataset.cat = c.id
      b.onclick = () => { this.activeCategory = c.id; audio.play('click'); this.refreshCatalog() }
      this.catTabs.appendChild(b)
    }

    this.catGrid = el('div', 'cat-grid')
    const foot = el('div', 'cat-foot',
      '<b>R</b> rotate &nbsp;•&nbsp; <b>Esc</b> cancel &nbsp;•&nbsp; drag to paint<br/>' +
      'Right-drag orbits. <kbd>Q</kbd>/<kbd>E</kbd> snap-rotate. Wheel zooms.')
    this.catalogEl.append(this.toolRow, this.catTabs, this.catGrid, foot)
    this.root.appendChild(this.catalogEl)
  }

  private buildNotes() {
    this.notesEl = el('div')
    this.notesEl.id = 'notes'
    this.root.appendChild(this.notesEl)
  }

  private buildContextMenu() {
    this.ctxEl = el('div', 'panel')
    this.ctxEl.id = 'ctx'
    this.root.appendChild(this.ctxEl)
    window.addEventListener('pointerdown', (e) => {
      if (!this.ctxEl.contains(e.target as Node)) this.closeMenu()
    }, true)
  }

  private buildLedger() {
    this.scrimEl = el('div')
    this.scrimEl.id = 'scrim'
    this.scrimEl.onclick = () => this.toggleLedger(false)
    this.ledgerEl = el('div', 'panel')
    this.ledgerEl.id = 'ledger'
    this.root.append(this.scrimEl, this.ledgerEl)
  }

  private buildMisc() {
    this.hintEl = el('div', 'panel')
    this.hintEl.id = 'hint'
    this.tooltipEl = el('div', 'panel')
    this.tooltipEl.id = 'tooltip'
    const vig = el('div'); vig.id = 'vig'
    this.endCardEl = el('div')
    this.endCardEl.id = 'endcard'
    this.root.append(vig, this.hintEl, this.tooltipEl, this.endCardEl)
    this.setHint('Click a sim to select. Right-click an object for actions. <kbd>Space</kbd> pauses.')
  }

  // ------------------------------------------------------------------ modes

  setMode(mode: 'live' | 'build') {
    this.game.mode = mode
    this.game.build.defId = mode === 'build' ? this.game.build.defId : null
    if (mode !== 'build') this.game.setGhostPreview(null, 0, 0, 0, true)
    this.closeMenu()
    audio.play('click')
    document.getElementById('viewport')?.classList.toggle('build', mode === 'build')
    this.catalogEl.classList.toggle('open', mode === 'build')
    for (const b of this.modeBtns) b.classList.toggle('active', b.dataset.mode === mode)
    this.setHint(mode === 'build'
      ? 'Pick a tool, then click the lot. Selling is how most of your plans begin.'
      : 'Click a sim to select. Right-click an object for actions. Drag a sim to carry them.')
    this.refreshCatalog()
  }

  cycleWalls() {
    const order = ['cutaway', 'up', 'down'] as const
    const i = order.indexOf(this.game.lot.wallMode as typeof order[number])
    const next = order[(i + 1) % order.length]
    this.game.setWallMode(next)
    this.wallBtn.textContent = next === 'up' ? '🏠' : next === 'down' ? '🔳' : '🧱'
    this.wallBtn.title = `Walls: ${next}`
    audio.play('click')
  }

  // ------------------------------------------------------------------ notify

  notify(text: string, kind: NoteKind = 'info', icon = '') {
    const n = el('div', `note panel ${kind}`)
    n.innerHTML = `<span class="ico">${icon || (kind === 'death' ? '💀' : 'ℹ️')}</span><span class="txt">${text}</span>`
    this.notesEl.appendChild(n)
    while (this.notesEl.children.length > 5) this.notesEl.firstChild?.remove()
    const ttl = kind === 'death' ? 8500 : kind === 'danger' ? 6500 : 4800
    setTimeout(() => {
      n.classList.add('out')
      setTimeout(() => n.remove(), 320)
    }, ttl)
  }

  setHint(html: string) { this.hintEl.innerHTML = html }

  showTooltip(x: number, y: number, html: string) {
    this.tooltipEl.innerHTML = html
    this.tooltipEl.classList.add('open')
    const w = this.tooltipEl.offsetWidth, h = this.tooltipEl.offsetHeight
    this.tooltipEl.style.left = `${Math.min(window.innerWidth - w - 12, x + 16)}px`
    this.tooltipEl.style.top = `${Math.max(8, y - h - 12)}px`
  }
  hideTooltip() { this.tooltipEl.classList.remove('open') }

  // ------------------------------------------------------------------ menus

  closeMenu() { this.ctxEl.classList.remove('open') }

  openObjectMenu(obj: WorldObject, x: number, y: number) {
    const game = this.game
    const sim = game.selected
    this.ctxEl.innerHTML = ''
    const status: string[] = []
    if (obj.broken) status.push('broken')
    if (obj.onFire) status.push('on fire')
    if (obj.charred) status.push('destroyed')
    if (obj.locked) status.push('locked')
    if (obj.grime > 50) status.push('filthy')
    this.ctxEl.appendChild(el('div', 'ctx-title',
      `${obj.def.glyph} ${obj.def.name}${status.length ? ` · <span style="color:#ff5c58">${status.join(', ')}</span>` : ''}`))

    const add = (label: string, hint: string, cls: string, fn: () => void, disabled = false) => {
      const b = el('button', `ctx-item ${cls}`) as HTMLButtonElement
      b.innerHTML = `<span>${label}</span><span class="hint">${hint}</span>`
      b.disabled = disabled
      b.onclick = () => { fn(); this.closeMenu() }
      b.onmouseenter = () => audio.play('hover')
      this.ctxEl.appendChild(b)
    }

    if (sim && sim.alive && obj.def.interactions?.length && !obj.charred) {
      for (const inter of obj.def.interactions as Interaction[]) {
        const ctx = { sim, obj, game, elapsed: 0 }
        const ok = !inter.requires || inter.requires(ctx)
        const cls = inter.danger ? 'evil' : ''
        add(inter.label, inter.danger ? '☠' : `${inter.duration}m`, cls,
          () => { sim.command(game, obj, inter); audio.play('confirm') }, !ok || obj.locked)
      }
    }
    if (!obj.charred) {
      add(obj.locked ? 'Unlock (allow use)' : 'Lock (forbid use)', obj.locked ? '🔓' : '🔒', 'danger',
        () => { obj.locked = !obj.locked; audio.play(obj.locked ? 'cancel' : 'confirm') })
    }
    add(`Sell`, `+§${Math.round(obj.def.price * (obj.charred ? 0.1 : 0.9))}`, 'danger',
      () => game.sellObject(obj), obj.def.id === 'gravestone')

    if (obj.def.lethal) {
      const tip = el('div', 'ctx-title', `<span style="color:#b06cff">☠ ${obj.def.lethal}</span>`)
      tip.style.borderBottom = 'none'
      tip.style.borderTop = '1px solid var(--stroke)'
      tip.style.marginTop = '4px'
      this.ctxEl.appendChild(tip)
    }
    this.placeMenu(x, y)
  }

  openSimMenu(sim: Sim, x: number, y: number) {
    const game = this.game
    this.ctxEl.innerHTML = ''
    this.ctxEl.appendChild(el('div', 'ctx-title', `${sim.fullName} · ${sim.mood.label}`))
    const add = (label: string, hint: string, cls: string, fn: () => void, disabled = false) => {
      const b = el('button', `ctx-item ${cls}`) as HTMLButtonElement
      b.innerHTML = `<span>${label}</span><span class="hint">${hint}</span>`
      b.disabled = disabled
      b.onclick = () => { fn(); this.closeMenu() }
      this.ctxEl.appendChild(b)
    }
    add('Select', '👁', '', () => game.selectSim(sim), !sim.alive)
    add('Follow with camera', '🎥', '', () => game.rig.lookAt(sim.pos, 13))
    add('Cancel all actions', '✖', '', () => { sim.clearTask(game); sim.queue = [] }, !sim.alive)
    add('Pick up and carry', '✋', 'evil', () => game.beginDrag(sim), !sim.alive)
    if (sim.alive) {
      add('Tell a hilarious joke', '🤣', 'evil', () => {
        sim.hysteria += 22 * sim.traits.mirth
        sim.needs.fun = Math.min(100, sim.needs.fun + 14)
        sim.anim = 'laugh'
        audio.play('laugh', sim.pos)
        game.floatText(sim.pos.x, 1.9, sim.pos.z, 'HA HA HA', '#ffd166')
      })
      add('Point out their failings', '😢', 'evil', () => {
        sim.embarrassment += 18 * sim.traits.shame
        sim.rage += 12 * sim.traits.temper
        sim.needs.fun -= 16
        sim.anim = 'cry'
        game.floatText(sim.pos.x, 1.9, sim.pos.z, '💔', '#ff8ab0')
      })
    }
    this.placeMenu(x, y)
  }

  private placeMenu(x: number, y: number) {
    this.ctxEl.classList.add('open')
    const w = this.ctxEl.offsetWidth, h = this.ctxEl.offsetHeight
    this.ctxEl.style.left = `${Math.min(window.innerWidth - w - 10, Math.max(8, x))}px`
    this.ctxEl.style.top = `${Math.min(window.innerHeight - h - 10, Math.max(8, y))}px`
  }

  // ------------------------------------------------------------------ ledger

  toggleLedger(force?: boolean) {
    const open = force ?? !this.ledgerEl.classList.contains('open')
    if (open) this.renderLedger()
    this.ledgerEl.classList.toggle('open', open)
    this.scrimEl.classList.toggle('open', open)
    audio.play('click')
  }

  private renderLedger() {
    const g = this.game
    this.ledgerEl.innerHTML = ''
    const close = el('button', 'close-x', '✕') as HTMLButtonElement
    close.onclick = () => this.toggleLedger(false)
    this.ledgerEl.append(
      close,
      el('h2', '', 'DEVIOUS DEEDS'),
      el('div', 'sub', `${g.deedPoints} points · ${rankFor(g.deedPoints)} · ${g.deaths.length} departed`),
    )
    const scroll = el('div', 'ledger-scroll')

    if (g.deaths.length) {
      scroll.appendChild(el('div', 'sub', 'THE DEPARTED'))
      for (const d of [...g.deaths].reverse()) {
        const def = DEATHS[d.death]
        const row = el('div', 'deed done')
        row.innerHTML =
          `<div class="ico">${def.icon}</div><div><div class="nm">${d.name}</div>` +
          `<div class="ds">${def.name} · Day ${d.day}, ${d.time}${d.detail ? ` — ${d.detail}` : ''}</div></div>`
        scroll.appendChild(row)
      }
      scroll.appendChild(el('div', 'sub', ''))
    }

    scroll.appendChild(el('div', 'sub', 'DEEDS'))
    const sorted = [...DEEDS].sort((a, b) =>
      Number(g.deeds.has(b.id)) - Number(g.deeds.has(a.id)) || a.points - b.points)
    for (const d of sorted) {
      const done = g.deeds.has(d.id)
      const row = el('div', `deed ${done ? 'done' : 'locked'}`)
      row.innerHTML =
        `<div class="ico">${done ? d.icon : '🔒'}</div>` +
        `<div><div class="nm">${d.name}</div><div class="ds">${d.desc}</div></div>` +
        `<div class="pts">${d.points}</div>`
      scroll.appendChild(row)
    }
    this.ledgerEl.appendChild(scroll)
  }

  showEndCard() {
    const g = this.game
    const counts = new Map<string, number>()
    for (const d of g.deaths) counts.set(d.death, (counts.get(d.death) ?? 0) + 1)
    this.endCardEl.innerHTML = ''
    const inner = el('div', 'end-inner')
    inner.appendChild(el('h1', '', 'HOUSEHOLD VACANT'))
    inner.appendChild(el('div', 'rank', rankFor(g.deedPoints).toUpperCase()))
    const list = el('div', 'end-list')
    const row = (k: string, v: string) => {
      const r = el('div', 'end-row')
      r.innerHTML = `<span class="k">${k}</span><span class="v">${v}</span>`
      list.appendChild(r)
    }
    row('Sims departed', String(g.deaths.length))
    row('Distinct methods', String(g.deathTypes.size))
    row('Deeds unlocked', `${g.deeds.size} / ${DEEDS.length}`)
    row('Devious points', String(g.deedPoints))
    row('Days elapsed', String(g.clock.day))
    row('Objects sold', String(g.soldCount))
    row('Simoleons remaining', `§${Math.round(g.funds)}`)
    inner.appendChild(list)
    const methods = el('div', 'end-list')
    for (const [id, n] of counts) {
      const def = DEATHS[id as keyof typeof DEATHS]
      const r = el('div', 'end-row')
      r.innerHTML = `<span class="k">${def.icon} ${def.name}</span><span class="v">×${n}</span>`
      methods.appendChild(r)
    }
    inner.appendChild(methods)
    const again = el('button', '', 'NEW HOUSEHOLD') as HTMLButtonElement
    again.onclick = () => location.reload()
    inner.appendChild(again)
    this.endCardEl.appendChild(inner)
    this.endCardEl.classList.add('open')
    audio.setMood('dirge')
  }

  // ------------------------------------------------------------------ refresh

  refresh() {
    const g = this.game
    this.fundsEl.textContent = `§${Math.round(g.funds).toLocaleString()}`
    this.deathsEl.textContent = `${g.deaths.length} / ${g.sims.length}`
    this.pointsEl.textContent = String(g.deedPoints)
    const cd = document.getElementById('clock-d')
    if (cd) cd.textContent = `${g.clock.dayName} ${g.clock.day}`
    this.clockEl.textContent = g.clock.label
    for (let i = 0; i < this.speedBtns.length; i++) {
      this.speedBtns[i].classList.toggle('active', g.clock.speed === i)
    }
    for (const b of this.modeBtns) b.classList.toggle('active', b.dataset.mode === g.mode)
    this.renderRoster()
    this.renderNeeds()
    this.refreshCatalog()
  }

  /** Cheap per-frame updates (clock, bars) at a fixed rate. */
  tick(dt: number) {
    this.accum += dt
    if (this.accum < 0.22) return
    this.accum = 0
    this.clockEl.textContent = this.game.clock.label
    const cd = document.getElementById('clock-d')
    if (cd) cd.textContent = `${this.game.clock.dayName} ${this.game.clock.day}`
    this.renderRoster()
    this.renderNeeds()
    for (let i = 0; i < this.speedBtns.length; i++) {
      this.speedBtns[i].classList.toggle('active', this.game.clock.speed === i)
    }
  }

  private renderRoster() {
    const g = this.game
    this.rosterEl.innerHTML = ''
    for (const sim of g.sims) {
      const card = el('div', `sim-card panel ${g.selected === sim ? 'selected' : ''} ${sim.dead ? 'dead' : ''}`)
      const avatar = el('div', 'avatar', sim.name[0])
      avatar.style.background = `linear-gradient(160deg, #${sim.avatar.look.skin.toString(16).padStart(6, '0')}, #${sim.avatar.look.hair.toString(16).padStart(6, '0')})`
      const meta = el('div', 'sim-meta')
      const deathName = sim.deathId ? DEATHS[sim.deathId as keyof typeof DEATHS]?.name : ''
      meta.innerHTML =
        `<div class="sim-name">${sim.name}</div>` +
        `<div class="sim-mood" style="color:${sim.dead ? '#98a0b4' : sim.mood.color}">` +
        `${sim.dead ? deathName : sim.mood.label}</div>`
      const mini = el('div', 'mini-needs')
      for (const k of ['hunger', 'bladder', 'energy', 'hygiene'] as const) {
        const bar = el('div', 'mini-need')
        const fill = el('i')
        fill.style.width = `${sim.dead ? 0 : sim.needs[k]}%`
        fill.style.background = needColor(sim.needs[k])
        bar.appendChild(fill)
        mini.appendChild(bar)
      }
      card.append(avatar, meta, mini)
      card.onclick = () => { g.selectSim(sim); audio.play('click') }
      card.oncontextmenu = (e) => {
        e.preventDefault()
        this.openSimMenu(sim, e.clientX, e.clientY)
      }
      this.rosterEl.appendChild(card)
    }
  }

  private renderNeeds() {
    const sim = this.game.selected
    if (!sim) { this.needsEl.style.display = 'none'; return }
    this.needsEl.style.display = ''
    const parts: string[] = []
    parts.push(`<h3>${sim.fullName}</h3>`)
    if (sim.dead) {
      const d = DEATHS[sim.deathId as keyof typeof DEATHS]
      parts.push(`<div class="sub" style="color:#b06cff">${d?.icon ?? '💀'} ${d?.name ?? 'Deceased'}</div>`)
    } else {
      parts.push(`<div class="sub" style="color:${sim.mood.color}">${sim.mood.label} · age ${Math.floor(sim.ageDays)}d</div>`)
    }
    for (const k of NEED_KEYS) {
      const v = sim.dead ? 0 : sim.needs[k]
      const meta = NEED_META[k]
      parts.push(
        `<div class="need-row"><div class="need-head"><span class="n">${meta.glyph} ${meta.label}</span>` +
        `<span class="v">${Math.round(v)}</span></div>` +
        `<div class="need-bar ${v < meta.critical ? 'critical' : ''}"><i style="width:${v}%;background:${needColor(v)}"></i></div></div>`)
    }

    const tags: string[] = []
    for (const id of sim.traits.ids) {
      const t = TRAIT_BY_ID.get(id)
      if (t) tags.push(`<span class="tag" title="${t.desc}">${t.name}</span>`)
    }
    for (const b of sim.buffs) tags.push(`<span class="tag ${b.kind}">${b.label}</span>`)
    if (!sim.dead) {
      if (sim.soaked > 0) tags.push('<span class="tag bad">Soaking Wet</span>')
      if (sim.burning > 0) tags.push('<span class="tag bad">ON FIRE</span>')
      if (sim.inPool) tags.push(`<span class="tag">Swimming ${Math.round(sim.swimStamina)}%</span>`)
      if (sim.rage > 40) tags.push(`<span class="tag bad">Rage ${Math.round(sim.rage)}%</span>`)
      if (sim.embarrassment > 40) tags.push(`<span class="tag bad">Shame ${Math.round(sim.embarrassment)}%</span>`)
      if (sim.hysteria > 40) tags.push(`<span class="tag evil">Hysteria ${Math.round(sim.hysteria)}%</span>`)
      if (sim.bodyTemp < 30) tags.push(`<span class="tag bad">Cold ${Math.round(sim.bodyTemp)}°</span>`)
      if (sim.bodyTemp > 70) tags.push(`<span class="tag bad">Hot ${Math.round(sim.bodyTemp)}°</span>`)
      if (sim.espressos >= 1) tags.push(`<span class="tag">Espressos ×${Math.floor(sim.espressos)}</span>`)
    }
    parts.push(`<div class="tag-row">${tags.join('')}</div>`)

    if (!sim.dead) {
      parts.push(`<div class="action-line">${sim.task
        ? `<b>${sim.task.label}</b>${sim.task.phase === 'route' ? ' <i>(walking there)</i>' : ''}`
        : '<i>Idle</i>'}${sim.thought ? `<br/>“${sim.thought}”` : ''}</div>`)
      if (sim.queue.length) {
        parts.push(`<div class="queue">${sim.queue.map((q) => `<span class="q">${q.label}</span>`).join('')}</div>`)
      }
    }
    this.needsEl.innerHTML = parts.join('')
  }

  private refreshCatalog() {
    const g = this.game
    for (const b of Array.from(this.toolRow.children) as HTMLButtonElement[]) {
      b.classList.toggle('active', b.dataset.tool === g.build.tool)
    }
    const showItems = g.build.tool === 'object'
    const showFloors = g.build.tool === 'floor'
    this.catTabs.style.display = showItems ? '' : 'none'
    for (const b of Array.from(this.catTabs.children) as HTMLButtonElement[]) {
      b.classList.toggle('active', b.dataset.cat === this.activeCategory)
    }
    this.catGrid.innerHTML = ''

    if (showFloors) {
      for (const f of FLOOR_SWATCHES) {
        const it = el('div', `cat-item ${g.build.floor === f.id ? 'selected' : ''}`)
        it.innerHTML = `<span class="glyph">${f.glyph}</span><span class="nm">${f.label}</span>` +
          `<span class="pr">${f.id === Floor.None ? '+§4' : '§12'}</span>`
        it.onclick = () => { g.build.floor = f.id; audio.play('click'); this.refreshCatalog() }
        this.catGrid.appendChild(it)
      }
      return
    }
    if (!showItems) {
      const tool = TOOLS.find((t) => t.id === g.build.tool)!
      const note = el('div', 'cat-foot', `<b>${tool.label}</b><br/>${tool.hint}`)
      note.style.borderTop = 'none'
      this.catGrid.appendChild(note)
      return
    }

    for (const def of CATALOG) {
      if (def.category !== this.activeCategory) continue
      const afford = g.funds >= def.price
      const it = el('div', `cat-item ${g.build.defId === def.id ? 'selected' : ''} ${afford ? '' : 'unaffordable'}`)
      it.innerHTML = `<span class="glyph">${def.glyph}</span><span class="nm">${def.name}</span>` +
        `<span class="pr">§${def.price}</span>${def.lethal ? '<span class="lethal">☠</span>' : ''}`
      it.onclick = () => {
        if (!afford) { audio.play('cancel'); return }
        g.build.defId = def.id
        g.build.tool = 'object'
        audio.play('click')
        this.refreshCatalog()
        this.setHint(`${def.name} — ${def.desc}${def.lethal ? ` <span style="color:#b06cff">☠ ${def.lethal}</span>` : ''}`)
      }
      it.onmouseenter = (e) => {
        audio.play('hover')
        this.showTooltip(e.clientX, e.clientY,
          `<b>${def.name}</b> · §${def.price}<br/>${def.desc}` +
          (def.lethal ? `<br/><span class="danger">☠ ${def.lethal}</span>` : ''))
      }
      it.onmouseleave = () => this.hideTooltip()
      this.catGrid.appendChild(it)
    }
  }

  get selectedDef() {
    return this.game.build.defId ? CATALOG_BY_ID.get(this.game.build.defId) ?? null : null
  }
}
