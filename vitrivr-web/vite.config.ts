import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Proxy API requests to the backend server during development, as an alternitive to adding CORS headers to the backend. See faceSearch.ts for usage.
  server: {
    proxy: {
      '/face-api': {
        target: 'http://127.0.0.1:8888',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/face-api/, ''),
      },
    },
  },
})
