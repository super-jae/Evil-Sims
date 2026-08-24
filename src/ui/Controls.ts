import * as THREE from 'three'
import type { Game } from '../Game'
import type { UI } from './UI'
import type { Sim } from '../sim/Sim'
import { audio } from '../core/Audio'
import { CATALOG_BY_ID } from '../world/Catalog'

/** Translates pointer and keyboard input into game actions. */
export class Controls {
  private pendingSim: Sim | null = null
  private painting = false
  private dirtyFloors = false
  private dirtyWalls = false
  private dirtyPool = false
  private dirtyTimer = 0
  private painted = new Set<string>()

  constructor(private game: Game, private ui: UI) {
    const input = game.input

    input.onDown = (p) => {
      ui.closeMenu()
      if (game.mode === 'live') {
        if (p.button === 0) {
          const sim = game.pickSim()
          if (sim) { this.pendingSim = sim; input.suppressPan = true }
        }
      } else if (p.button === 0) {
        input.suppressPan = true
        this.painting = true
        this.painted.clear()
        this.applyTool()
      }
    }

    input.onMove = (p) => {
      if (game.mode === 'live') {
        if (this.pendingSim && p.down && p.dragged && !game.dragging) {
          game.beginDrag(this.pendingSim)
          this.pendingSim = null
        }
        this.updateHover(p.x, p.y)
      } else {
        this.updatePreview()
        if (this.painting && p.down) this.applyTool()
      }
    }

    input.onUp = () => {
      if (game.dragging) game.endDrag()
      this.pendingSim = null
      this.painting = false
      this.flush(true)
    }

    input.onClick = () => {
      if (game.mode !== 'live') return
      const r = game.engine.renderer.domElement.getBoundingClientRect()
      const mx = r.left + input.pointer.x + 8
      const my = r.top + input.pointer.y - 8
      const sim = game.pickSim()
      if (sim) {
        const actor = game.selected
        // clicking a *different* sim offers what the selected one can do to them,
        // which is far more discoverable than requiring a right-click
        if (actor && actor.alive && actor !== sim && sim.alive) {
          ui.openSimMenu(sim, mx, my)
        } else {
          game.selectSim(sim)
        }
        audio.play('click')
        return
      }
      const obj = game.pickObject()
      if (obj) ui.openObjectMenu(obj, mx, my)
    }

    input.onRightClick = () => {
      if (game.mode !== 'live') return
      const r = game.engine.renderer.domElement.getBoundingClientRect()
      const x = r.left + input.pointer.x + 8
      const y = r.top + input.pointer.y - 8
      const sim = game.pickSim()
      if (sim) { ui.openSimMenu(sim, x, y); return }
      const obj = game.pickObject()
      if (obj) ui.openObjectMenu(obj, x, y)
    }

    input.onCancel = () => {
      if (game.dragging) game.endDrag()
      this.pendingSim = null
      this.painting = false
      ui.hideTooltip()
      this.flush(true)
    }

    input.onKey = (code, ev) => this.onKey(code, ev)
  }

  private onKey(code: string, ev: KeyboardEvent) {
    const g = this.game
    switch (code) {
      case 'Space': g.clock.togglePause(); this.ui.refresh(); break
      case 'Digit0': g.clock.setSpeed(0); this.ui.refresh(); break
      case 'Digit1': g.clock.setSpeed(1); this.ui.refresh(); break
      case 'Digit2': g.clock.setSpeed(2); this.ui.refresh(); break
      case 'Digit3': g.clock.setSpeed(3); this.ui.refresh(); break
      case 'KeyQ': g.rig.snapRotate(-1); break
      case 'KeyE': g.rig.snapRotate(1); break
      case 'KeyR':
        if (g.mode === 'build') {
          g.build.rot = ((g.build.rot + 1) % 4) as 0 | 1 | 2 | 3
          audio.play('click')
          this.updatePreview()
        }
        break
      case 'KeyB': this.ui.setMode(g.mode === 'build' ? 'live' : 'build'); break
      case 'KeyL': this.ui.toggleLedger(); break
      case 'KeyW':
        if (ev.shiftKey) { this.ui.cycleWalls() }
        break
      case 'KeyM':
        audio.enabled = !audio.enabled
        if (!audio.enabled) audio.stopAllLoops()
        break
      case 'KeyF':
        if (g.selected) g.rig.lookAt(g.selected.pos, 13)
        break
      case 'Home':
      case 'KeyC':
        g.frameHousehold()
        break
      case 'Tab': {
        ev.preventDefault()
        const alive = g.sims.filter((s) => s.alive)
        if (!alive.length) break
        const i = g.selected ? alive.indexOf(g.selected) : -1
        g.selectSim(alive[(i + 1) % alive.length])
        break
      }
      case 'Escape':
        this.ui.closeMenu()
        this.ui.toggleLedger(false)
        if (g.mode === 'build') {
          g.build.defId = null
          g.setGhostPreview(null, 0, 0, 0, true)
        }
        break
      default: break
    }
  }

  // ---------------------------------------------------------------- build

  private updatePreview() {
    const g = this.game
    if (g.mode !== 'build' || g.build.tool !== 'object' || !g.build.defId) {
      g.setGhostPreview(null, 0, 0, 0, true)
      return
    }
    const def = CATALOG_BY_ID.get(g.build.defId)
    const t = g.hoveredTile()
    if (!def || !t) { g.setGhostPreview(null, 0, 0, 0, true); return }
    const valid = g.canPlace(def, t.x, t.z, g.build.rot) && g.funds >= def.price
    g.setGhostPreview(def, t.x, t.z, g.build.rot, valid)
  }

  private applyTool() {
    const g = this.game
    const tool = g.build.tool
    if (tool === 'object') {
      const t = g.hoveredTile()
      if (!t || !g.build.defId) return
      const key = `o${t.x},${t.z}`
      if (this.painted.has(key)) return
      this.painted.add(key)
      g.placeObject(g.build.defId, t.x, t.z, g.build.rot)
      this.updatePreview()
      return
    }
    if (tool === 'sell') {
      const obj = g.pickObject()
      if (obj) g.sellObject(obj)
      return
    }
    if (tool === 'wall' || tool === 'door') {
      const e = g.hoveredEdge()
      if (!e) return
      const key = `${tool}${e.axis}${e.x},${e.z}`
      if (this.painted.has(key)) return
      this.painted.add(key)
      if (g.toggleWall(e.x, e.z, e.axis, false, tool === 'door')) {
        this.dirtyWalls = true
        audio.play(tool === 'door' ? 'sell' : 'place')
      }
      return
    }
    if (tool === 'floor') {
      const t = g.hoveredTile()
      if (!t) return
      const key = `f${t.x},${t.z}`
      if (this.painted.has(key)) return
      this.painted.add(key)
      if (g.paintFloor(t.x, t.z)) this.dirtyFloors = true
      return
    }
    if (tool === 'pool') {
      const t = g.hoveredTile()
      if (!t) return
      const key = `p${t.x},${t.z}`
      if (this.painted.has(key)) return
      this.painted.add(key)
      if (g.digPool(t.x, t.z, false)) { this.dirtyPool = true; this.dirtyFloors = true }
      return
    }
    if (tool === 'erase') {
      const e = g.hoveredEdge()
      const t = g.hoveredTile()
      const p = g.input.groundPoint()
      // erase the wall if the cursor is genuinely near an edge, otherwise the tile
      let nearEdge = false
      if (e && p) {
        const [wx, wz] = g.grid.tileToWorld(e.x, e.z)
        const ex = e.axis === 'w' ? wx - 0.5 : wx
        const ez = e.axis === 'n' ? wz - 0.5 : wz
        nearEdge = Math.hypot(p.x - ex, p.z - ez) < 0.3
      }
      if (nearEdge && e) {
        const key = `e${e.axis}${e.x},${e.z}`
        if (this.painted.has(key)) return
        this.painted.add(key)
        if (g.toggleWall(e.x, e.z, e.axis, true, false)) { this.dirtyWalls = true; audio.play('sell') }
        return
      }
      if (!t) return
      const key = `x${t.x},${t.z}`
      if (this.painted.has(key)) return
      this.painted.add(key)
      if (g.grid.pool[g.grid.idx(t.x, t.z)]) {
        if (g.digPool(t.x, t.z, true)) { this.dirtyPool = true; this.dirtyFloors = true; audio.play('sell') }
      } else {
        const prev = g.build.floor
        g.build.floor = 0
        if (g.paintFloor(t.x, t.z)) { this.dirtyFloors = true; audio.play('sell') }
        g.build.floor = prev
      }
    }
  }

  /** Rebuild dirty lot geometry, throttled so painting stays smooth. */
  flush(force = false) {
    if (!this.dirtyFloors && !this.dirtyWalls && !this.dirtyPool) return
    if (!force && this.dirtyTimer > 0) return
    this.dirtyTimer = 0.12
    this.game.rebuildLot(this.dirtyFloors, this.dirtyWalls, this.dirtyPool)
    this.dirtyFloors = this.dirtyWalls = this.dirtyPool = false
    this.ui.refresh()
  }

  // ---------------------------------------------------------------- hover

  private updateHover(x: number, y: number) {
    const g = this.game
    const obj = g.pickObject()
    const sim = obj ? null : g.pickSim()
    const rect = g.engine.renderer.domElement.getBoundingClientRect()
    if (obj) {
      const status: string[] = []
      if (obj.broken) status.push('<span class="warn">broken</span>')
      if (obj.onFire) status.push('<span class="danger">ON FIRE</span>')
      if (obj.charred) status.push('destroyed')
      if (obj.locked) status.push('locked')
      if (obj.grime > 50) status.push('filthy')
      if (obj.inUseBy) status.push(`in use by ${obj.inUseBy.name}`)
      this.ui.showTooltip(rect.left + x, rect.top + y,
        `<b>${obj.def.glyph} ${obj.def.name}</b><br/>${obj.def.desc}` +
        (status.length ? `<br/>${status.join(' · ')}` : '') +
        (obj.def.lethal ? `<br/><span class="danger">☠ ${obj.def.lethal}</span>` : ''))
    } else if (sim) {
      this.ui.showTooltip(rect.left + x, rect.top + y,
        `<b>${sim.fullName}</b><br/><span style="color:${sim.mood.color}">${sim.mood.label}</span>` +
        `${sim.task ? `<br/>${sim.task.label}` : ''}`)
    } else {
      this.ui.hideTooltip()
    }
  }

  update(dt: number) {
    this.dirtyTimer = Math.max(0, this.dirtyTimer - dt)
    this.flush()
    if (this.game.mode === 'build') this.updatePreview()
  }
}
