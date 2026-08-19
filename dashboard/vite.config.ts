import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Vite dev server config for the M8 dashboard.
// - The Tailwind v4 plugin (@tailwindcss/vite) replaces the v3 tailwind.config
//   + postcss pipeline: the theme lives in CSS (@theme / @custom-variant in
//   src/index.css), there is no tailwind.config.js.
// - `/api/*` is proxied to the local FastAPI bridge (src/portfolio/bridge.py,
//   127.0.0.1:8000). `timeout` must be generous: POST /api/refresh runs the
//   pipeline (snapshot --all --force + export) and can take minutes.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // ECharts is inherently ~600KB minified (tree-shaken via echarts/core);
    // the accepted plan tradeoff. App chunk stays small and loads first.
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      output: {
        // Split the heavy vendor libs into stable chunks (ECharts is the
        // largest — it stays out of the app chunk so the shell loads fast).
        manualChunks: (id: string) => {
          if (id.includes('node_modules/echarts')) return 'echarts'
          if (id.includes('node_modules/react')) return 'react'
          if (id.includes('node_modules/@tanstack') || id.includes('node_modules/zod')) return 'data'
          return undefined
        },
      },
    },
  },
  server: {
    // Bind IPv4 explicitly — without `host`, Vite binds only [::1] on this
    // machine, so http://127.0.0.1:<port> refuses connections and the proxy
    // target (127.0.0.1:8000) is unreachable from a localhost-only origin.
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        timeout: 600000,
      },
    },
  },
})
