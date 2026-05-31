import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite + React for the demo frontend. `base: './'` keeps asset URLs relative so the
// built bundle works behind CloudFront (or any static host) without rewriting paths.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5173 },
})
