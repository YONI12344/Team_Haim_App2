'use client'

import Body, { type ExtendedBodyPart, type Slug } from 'react-muscle-highlighter'
import { cn } from '@/lib/utils'
import { BODY_AREAS, parseAreaKey, type BodyView } from '@/lib/rehab'

export type BodySide = 'left' | 'right' | 'both' | null

export interface BodySpot {
  areaKey: string
  side?: BodySide
}

// Poster inks (app/globals.css): the body is printed in a warm grey on the
// stock, outlined in ink; a painful spot is stamped in rust.
const INK = '#16223A'
const BODY_FILL = '#CFC5AE'
const SEAM = '#EFE6D2'
const PAIN = '#B4532A'
const HAIR = '#A99F88'

// Every part the models draw. The library's own data paints them all dark
// grey, so each one gets the poster fill explicitly.
const ALL_SLUGS: Slug[] = [
  'abs', 'adductors', 'ankles', 'biceps', 'calves', 'chest', 'deltoids', 'feet', 'forearm', 'gluteal', 'hamstring',
  'hands', 'hair', 'head', 'knees', 'lower-back', 'neck', 'obliques', 'quadriceps', 'tibialis', 'trapezius', 'triceps', 'upper-back',
]

// The model library's left/right is the viewer's left/right. Facing us
// (front view) that's the athlete's opposite side; from behind it matches.
function toBodySide(view: BodyView, screen: 'left' | 'right' | undefined): BodySide {
  if (!screen) return null
  if (view === 'back') return screen
  return screen === 'left' ? 'right' : 'left'
}
function toScreenSide(view: BodyView, side: BodySide): 'left' | 'right' | undefined {
  if (side !== 'left' && side !== 'right') return undefined
  if (view === 'back') return side
  return side === 'left' ? 'right' : 'left'
}

const PICKABLE: Record<BodyView, Set<string>> = {
  front: new Set(BODY_AREAS.filter((a) => a.view === 'front').map((a) => a.slug)),
  back: new Set(BODY_AREAS.filter((a) => a.view === 'back').map((a) => a.slug)),
}

/**
 * Front and back of the body side by side. Tap a spot to pick it (onPick
 * gets the area key and the athlete's own side); spots already reported
 * are stamped in rust. Without onPick it's a read-only picture.
 */
export function BodyMap({ spots, onPick, gender = 'male', labels, className }: {
  spots: BodySpot[]
  onPick?: (spot: { areaKey: string; side: BodySide }) => void
  gender?: 'male' | 'female'
  labels: Record<BodyView, string>
  className?: string
}) {
  const views: BodyView[] = ['front', 'back']
  return (
    <div className={cn('grid grid-cols-2 gap-3', className)}>
      {views.map((view) => {
        // One entry per body part: two spots on the same part (left and
        // right) light up both sides.
        const bySlug = new Map<string, BodySide>()
        for (const spot of spots) {
          const parsed = parseAreaKey(spot.areaKey)
          if (!parsed || parsed.view !== view) continue
          const prev = bySlug.get(parsed.slug)
          bySlug.set(parsed.slug, prev === undefined ? (spot.side ?? null) : prev === spot.side ? prev : 'both')
        }
        if (bySlug.has('head')) bySlug.set('hair', bySlug.get('head') ?? null)
        const data: ExtendedBodyPart[] = ALL_SLUGS.map((slug) => (
          bySlug.has(slug)
            ? { slug, side: toScreenSide(view, bySlug.get(slug) ?? null), styles: { fill: PAIN } }
            : { slug, styles: { fill: slug === 'hair' ? HAIR : BODY_FILL } }
        ))
        return (
          <figure key={view} className="m-0">
            <div
              className={cn(
                'mx-auto max-w-[180px] [&_svg]:h-auto [&_svg]:w-full',
                onPick && '[&_path]:transition-opacity [&_path:hover]:opacity-75',
              )}
            >
              <Body
                data={data}
                side={view}
                gender={gender}
                border={INK}
                defaultFill={BODY_FILL}
                defaultStroke={SEAM}
                defaultStrokeWidth={1.5}
                onBodyPartPress={onPick ? (part, screen) => {
                  const slug = part.slug === 'hair' ? 'head' : part.slug
                  if (!slug || !PICKABLE[view].has(slug)) return
                  onPick({ areaKey: `${view}:${slug}`, side: toBodySide(view, screen) })
                } : undefined}
              />
            </div>
            <figcaption className="poster-caps mt-1.5 text-center text-[17px] text-ink/70">{labels[view]}</figcaption>
          </figure>
        )
      })}
    </div>
  )
}
