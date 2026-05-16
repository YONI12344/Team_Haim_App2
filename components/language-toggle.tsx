'use client'

import { Globe } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/contexts/language-context'
import { cn } from '@/lib/utils'

interface LanguageToggleProps {
  variant?: 'default' | 'ghost' | 'outline'
  className?: string
  size?: 'sm' | 'default' | 'lg' | 'icon'
}

/**
 * Small EN ⇄ עברית switcher used in headers and on the landing page.
 * Toggles the global language (and document direction / lang via the
 * LanguageProvider's effect).
 */
export function LanguageToggle({
  variant = 'ghost',
  className,
  size = 'sm',
}: LanguageToggleProps) {
  const { language, setLanguage, t } = useLanguage()

  const next = language === 'en' ? 'he' : 'en'

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={() => setLanguage(next)}
      aria-label={t.languageToggleAria}
      className={cn(
        'gap-2 font-medium text-navy hover:bg-navy/10 border border-transparent hover:border-navy/20 transition-luxury',
        className,
      )}
    >
      <Globe className="h-4 w-4" />
      <span>{t.languageToggle}</span>
    </Button>
  )
}
