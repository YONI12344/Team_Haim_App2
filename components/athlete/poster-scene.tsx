'use client'

import { useId } from 'react'
import { cn } from '@/lib/utils'

/**
 * The athlete app's signature: one flat silkscreen landscape (sky, sun, sea,
 * hills, cypress row, a road running to the horizon) re-inked per training
 * phase, so the season visibly moves from dawn (base) to the night before
 * the race. Pure SVG, four-to-six flat inks per phase, a halftone plane and
 * a print grain — no raster assets.
 */

export type SceneTime = 'dawn' | 'midday' | 'golden' | 'dusk' | 'night'

interface Inks {
  sky: string
  sun: string
  far: string
  sea: string
  near: string
  trees: string
  road: string
  roadEdge: string
}

const INKS: Record<SceneTime, Inks> = {
  dawn:   { sky: '#E6B574', sun: '#F7E4B5', far: '#7C9189', sea: '#3F7C84', near: '#B9642F', trees: '#1E4F3A', road: '#EFE6D2', roadEdge: '#16223A' },
  midday: { sky: '#0E6E7A', sun: '#F4E3B6', far: '#5F8E7F', sea: '#0A5660', near: '#C9962C', trees: '#1E4F3A', road: '#EFE6D2', roadEdge: '#16223A' },
  golden: { sky: '#D6852C', sun: '#F8DA8E', far: '#8B5B3A', sea: '#5E4536', near: '#B4532A', trees: '#263A2C', road: '#F0D8A6', roadEdge: '#16223A' },
  dusk:   { sky: '#56698A', sun: '#E8B477', far: '#3C4D6A', sea: '#2B3956', near: '#6D5877', trees: '#1A2835', road: '#D8CDB6', roadEdge: '#0F1826' },
  night:  { sky: '#16223A', sun: '#EFE6D2', far: '#223350', sea: '#1A2944', near: '#2C3B58', trees: '#0E1724', road: '#C9962C', roadEdge: '#0E1724' },
}

/** Training phase (JourneyStage.type) → time of day in the scene. */
export function sceneTimeForStage(stageType?: string | null): SceneTime {
  switch (stageType) {
    case 'base': return 'dawn'
    case 'build': return 'midday'
    case 'peak': return 'golden'
    case 'taper': return 'dusk'
    case 'race_week': return 'night'
    default: return 'midday'
  }
}

// Deterministic star field for the night scene.
const STARS = Array.from({ length: 26 }, (_, i) => ({
  x: (i * 97 + 31) % 390,
  y: ((i * 53 + 17) % 88) + 6,
  r: i % 5 === 0 ? 1.6 : 0.9,
}))

export function PosterScene({ time, className, children }: {
  time: SceneTime
  className?: string
  /** Overlaid content (e.g. a date stamp) positioned by the caller. */
  children?: React.ReactNode
}) {
  const ink = INKS[time]
  const uid = useId().replace(/:/g, '')
  const dots = `dots-${uid}`
  const grain = `grain-${uid}`
  const sunY = time === 'dawn' ? 118 : time === 'golden' ? 104 : time === 'dusk' ? 124 : 58
  const sunX = time === 'dawn' || time === 'dusk' ? 300 : time === 'golden' ? 92 : 270

  return (
    <div className={cn('relative overflow-hidden', className)}>
      <svg
        viewBox="0 0 390 230"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
        role="img"
        aria-hidden
      >
        <defs>
          <pattern id={dots} width="5" height="5" patternUnits="userSpaceOnUse">
            <circle cx="2.5" cy="2.5" r="0.95" fill={ink.roadEdge} opacity="0.28" />
          </pattern>
          <filter id={grain} x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" result="n" />
            <feColorMatrix in="n" values="0 0 0 0 0.09  0 0 0 0 0.13  0 0 0 0 0.22  0 0 0 0.16 0" />
            <feComposite in2="SourceGraphic" operator="in" />
          </filter>
        </defs>

        {/* Sky — one unbroken swath */}
        <rect width="390" height="230" fill={ink.sky} />

        {time === 'night' && STARS.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#EFE6D2" opacity={0.85} />
        ))}

        {/* Sun (moon at night), with printed rays by day */}
        <g className="poster-settle-slow">
          {time !== 'night' && (
            <g opacity="0.35" fill={ink.sun}>
              {Array.from({ length: 12 }, (_, i) => {
                const a = (i * Math.PI) / 6
                const x1 = sunX + Math.cos(a) * 30
                const y1 = sunY + Math.sin(a) * 30
                const x2 = sunX + Math.cos(a + 0.12) * 64
                const y2 = sunY + Math.sin(a + 0.12) * 64
                const x3 = sunX + Math.cos(a - 0.12) * 64
                const y3 = sunY + Math.sin(a - 0.12) * 64
                return <polygon key={i} points={`${x1},${y1} ${x2},${y2} ${x3},${y3}`} />
              })}
            </g>
          )}
          <circle cx={sunX} cy={sunY} r={time === 'night' ? 15 : 24} fill={ink.sun} />
          {time === 'night' && <circle cx={sunX + 7} cy={sunY - 4} r={13} fill={ink.sky} />}
        </g>

        {/* Far hills (Judean ridge) */}
        <path
          className="poster-settle-slow"
          d="M0 132 L34 118 L62 124 L98 104 L132 116 L170 98 L204 112 L238 102 L276 118 L312 106 L350 120 L390 110 L390 160 L0 160 Z"
          fill={ink.far}
        />

        {/* Sea band with two printed swell lines */}
        <rect x="0" y="140" width="390" height="22" fill={ink.sea} />
        <path d="M18 148 h40 M96 152 h58 M210 147 h44 M300 153 h52" stroke={ink.sun} strokeOpacity="0.45" strokeWidth="1.6" strokeLinecap="round" />

        {/* Near hills, ochre plane + halftone shading */}
        <path
          className="poster-settle"
          d="M0 170 C40 150 82 148 124 162 C160 174 196 150 238 150 C282 150 318 172 390 158 L390 230 L0 230 Z"
          fill={ink.near}
        />
        <path
          d="M0 170 C40 150 82 148 124 162 C160 174 196 150 238 150 C282 150 318 172 390 158 L390 230 L0 230 Z"
          fill={`url(#${dots})`}
          opacity="0.6"
        />

        {/* Road to the horizon — the run ahead */}
        <path className="poster-settle" d="M168 230 C176 204 188 184 196 168 C199 162 201 159 202 157 L206 157 C207 160 210 164 214 170 C226 188 246 210 262 230 Z" fill={ink.road} />
        <path d="M168 230 C176 204 188 184 196 168 C199 162 201 159 202 157" fill="none" stroke={ink.roadEdge} strokeWidth="2" />
        <path d="M262 230 C246 210 226 188 214 170 C210 164 207 160 206 157" fill="none" stroke={ink.roadEdge} strokeWidth="2" />
        <path d="M214 228 L211 214 M209 204 L207 194 M205.5 186 L204.6 179 M204 173 L203.6 168" stroke={ink.roadEdge} strokeWidth="1.8" strokeLinecap="round" opacity="0.7" />

        {/* Cypress row, foreground framing */}
        <g className="poster-settle" fill={ink.trees}>
          {[
            [18, 230, 16, 92], [42, 230, 12, 70], [312, 230, 14, 84], [338, 230, 18, 104], [366, 230, 13, 76],
            [120, 196, 8, 40], [134, 198, 7, 34], [282, 194, 8, 42],
          ].map(([x, base, w, h], i) => (
            <path key={i} d={`M${x} ${base - h} C${x + w * 0.62} ${base - h * 0.7} ${x + w * 0.58} ${base - h * 0.15} ${x + w * 0.5} ${base} L${x - w * 0.5} ${base} C${x - w * 0.58} ${base - h * 0.15} ${x - w * 0.62} ${base - h * 0.7} ${x} ${base - h} Z`} />
          ))}
        </g>

        {/* Print grain over everything */}
        <rect width="390" height="230" filter={`url(#${grain})`} fill="#fff" />
      </svg>
      {children}
    </div>
  )
}
