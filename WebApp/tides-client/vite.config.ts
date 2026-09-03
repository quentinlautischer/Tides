import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { version } from './package.json'

// package.json is the single source of truth for the version, exposed to the app as
// __APP_VERSION__ so the header can show it without shipping the manifest or asking the API.
//
// Imported rather than read with fs on purpose. Vite restarts the dev server when this config or
// anything it imports changes, so a static import makes a version bump take effect immediately;
// with fs the bump was invisible until something else happened to touch this file. That matters
// because `define` is a static replacement only in a build - in dev the value is injected as a
// global fixed at server start, so a stale dev server keeps serving the old number.

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5062',
        changeOrigin: true,
      },
    },
  },
})
