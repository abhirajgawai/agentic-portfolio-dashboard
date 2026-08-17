import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Chat textarea — an autosizing textarea for the chat input.
 * Grows with content up to a max height; Enter submits (handled by parent),
 * Shift+Enter inserts a newline.
 */

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  const ref = React.useRef<HTMLTextAreaElement>(null)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const resize = () => {
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`
    }
    resize()
    el.addEventListener('input', resize)
    return () => el.removeEventListener('input', resize)
  }, [])

  return (
    <textarea
      ref={ref}
      className={cn(
        'flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }