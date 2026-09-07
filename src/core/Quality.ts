export type QualityId = 'low' | 'medium' | 'high' | 'ultra'

export interface QualitySettings {
  id: QualityId
  label: string
  /** Max device-pixel ratio. Further reduced on huge windows. */
  pixelRatio: number
  shadowSize: number
  shadowSoft: boolean
  gtao: boolean
  gtaoSamples: number
  gtaoDenoise: number
  bloom: boolean
  smaa: boolean
  tilt: boolean
  highPerformance: boolean
  maxFps: number
  /** Seconds between shadow-map rebuilds. */
  shadowInterval: number
  skyWidth: number
  skyHeight: number
}

export const QUALITY: Record<QualityId, QualitySettings> = {
  low: {
    id: 'low', label: 'Low',
    pixelRatio: 1, shadowSize: 1024, shadowSoft: false,
    gtao: false, gtaoSamples: 0, gtaoDenoise: 0,
    bloom: false, smaa: false, tilt: false,
    highPerformance: false, maxFps: 60, shadowInterval: 2.0,
    skyWidth: 16, skyHeight: 12,
  },
  medium: {
    id: 'medium', label: 'Medium',
    pixelRatio: 1.15, shadowSize: 1024, shadowSoft: false,
    gtao: false, gtaoSamples: 0, gtaoDenoise: 0,
    bloom: true, smaa: true, tilt: false,
    highPerformance: false, maxFps: 60, shadowInterval: 1.0,
    skyWidth: 24, skyHeight: 16,
  },
  high: {
    id: 'high', label: 'High',
    pixelRatio: 1.25, shadowSize: 1536, shadowSoft: false,
    gtao: true, gtaoSamples: 8, gtaoDenoise: 8,
    bloom: true, smaa: true, tilt: false,
    highPerformance: false, maxFps: 60, shadowInterval: 0.5,
    skyWidth: 32, skyHeight: 20,
  },
  ultra: {
    id: 'ultra', label: 'Ultra',
    pixelRatio: 1.75, shadowSize: 2048, shadowSoft: true,
    gtao: true, gtaoSamples: 16, gtaoDenoise: 12,
    bloom: true, smaa: true, tilt: true,
    highPerformance: true, maxFps: 60, shadowInterval: 0.12,
    skyWidth: 40, skyHeight: 24,
  },
}

const KEY = 'evil-sims-quality'
const ORDER: QualityId[] = ['low', 'medium', 'high', 'ultra']

export function defaultQualityId(): QualityId {
  try {
    const coarse = window.matchMedia?.('(pointer: coarse)').matches
    const small = window.innerWidth <= 720 || window.innerHeight <= 500
    return coarse || small ? 'medium' : 'high'
  } catch {
    return 'high'
  }
}

export function loadQuality(): QualitySettings {
  try {
    const v = localStorage.getItem(KEY)
    if (v && v in QUALITY) return QUALITY[v as QualityId]
  } catch { /* private mode */ }
  return QUALITY[defaultQualityId()]
}

export function saveQuality(id: QualityId) {
  try { localStorage.setItem(KEY, id) } catch { /* ignore */ }
}

export function nextQualityId(id: QualityId): QualityId {
  return ORDER[(ORDER.indexOf(id) + 1) % ORDER.length]
}

/** Cap retina on large desktops so a 1440p window is not rendered at 5K. */
export function resolvePixelRatio(q: QualitySettings): number {
  const dpr = window.devicePixelRatio || 1
  const pixels = (window.innerWidth || 1) * (window.innerHeight || 1)
  let cap = q.pixelRatio
  if (pixels > 1920 * 1200) cap = Math.min(cap, 1)
  else if (pixels > 1600 * 900) cap = Math.min(cap, 1.15)
  return Math.min(dpr, cap)
}
