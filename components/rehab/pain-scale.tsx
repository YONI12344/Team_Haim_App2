'use client'

import { cn } from '@/lib/utils'
import { PAIN_ZONE_CLASSES, painZone } from '@/lib/rehab'

/**
 * 0-10 pain buttons in the rehab protocol's three zones (0-2 pine, 3-4
 * ochre, 5+ rust). Reads in the page's own direction, so in Hebrew 0 sits on
 * the right, like the printed handout's ruler.
 */
export function PainScale({ value, onChange, label, size = 'md' }: {
  value?: number | null
  onChange: (pain: number) => void
  label?: string
  size?: 'sm' | 'md'
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-11 gap-1">
      {Array.from({ length: 11 }, (_, n) => {
        const z = painZone(n)
        const selected = value === n
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(n)}
            className={cn(
              'tabular rounded-md border font-bold transition-[transform,background-color,color] duration-150 active:scale-95',
              size === 'sm' ? 'h-8 text-xs' : 'h-10 text-sm',
              selected ? PAIN_ZONE_CLASSES[z].solid : cn('border-border bg-card', PAIN_ZONE_CLASSES[z].text),
            )}
          >
            {n}
          </button>
        )
      })}
    </div>
  )
}

/** A read-only pain number in its zone colour, for history rows and stats. */
export function PainChip({ value, className }: { value: number | null | undefined; className?: string }) {
  if (value == null) return <span className={cn('tabular text-ink/40', className)}>-</span>
  return (
    <span className={cn('tabular inline-flex h-6 min-w-6 items-center justify-center rounded px-1.5 text-xs font-bold', PAIN_ZONE_CLASSES[painZone(value)].solid, className)}>
      {value}
    </span>
  )
}
