/**
 * src/lib/theme.tsx — ThemeProvider + useTheme hook.
 * Reads localStorage → data-theme attr on <html> (+.dark class),
 * defaults to prefers-color-scheme; cycleTheme() for the T shortcut
 * (light→dark→system→light).
 */

import { createContext, useCallback, useContext, useEffect, useState } from 'react'

const THEME_KEY = 'portfolio.theme'

type Theme = 'light' | 'dark' | 'system'
type ResolvedTheme = 'light' | 'dark'

interface ThemeContextValue {
  theme: Theme
  setTheme: (t: Theme) => void
  cycleTheme: () => void
  /** The concrete light/dark the DOM is actually painted with right now
   *  ('system' resolved against prefers-color-scheme). Chart option memos
   *  that call resolveThemeColor()/getChartPalette() — which read computed
   *  CSS off <html> at option-build time — must depend on this, or a theme
   *  toggle repaints the DOM instantly while every <canvas> chart keeps the
   *  previous theme's colors until an unrelated re-render happens to fire. */
  resolvedTheme: ResolvedTheme
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function readInitialTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch { /* fall through */ }
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function resolveTheme(t: Theme): ResolvedTheme {
  return t === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : t
}

function applyTheme(resolved: ResolvedTheme) {
  const html = document.documentElement
  html.classList.toggle('dark', resolved === 'dark')
  html.dataset.theme = resolved
  html.style.colorScheme = resolved
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readInitialTheme)
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(readInitialTheme()))

  // Apply the theme whenever it (or the system preference) changes.
  useEffect(() => {
    const resolved = resolveTheme(theme)
    applyTheme(resolved)
    setResolvedTheme(resolved)
    try {
      window.localStorage.setItem(THEME_KEY, theme)
    } catch { /* storage unavailable — in-memory still works */ }
  }, [theme])

  const cycleTheme = useCallback(() => {
    setTheme(theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light')
  }, [theme])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, cycleTheme, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within <ThemeProvider>')
  return ctx
}

export type { ThemeContextValue }
