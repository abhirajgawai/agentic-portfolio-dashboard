/**
 * src/lib/index.ts — Barrel re-exports for commonly-used lib hooks.
 * Enables `import { useTheme, usePrivacy, useDensity } from '@/lib'`.
 */

export { useTheme, ThemeProvider } from './theme'
export { usePrivacy, PrivacyProvider } from './privacy'
export { useDensity, DensityProvider } from './density'
