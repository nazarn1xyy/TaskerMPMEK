import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: false },
      '/files': { target: 'http://localhost:3001' },
    },
  },
  build: {
    target: 'es2022',
    cssCodeSplit: true,
  },
})
