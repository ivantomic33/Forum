import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// F-20 — CSP/HSTS/frame-ancestors i za frontend (Helmet pokriva samo API).
import { securityHeadersPlugin } from './scripts/security-headers.mjs';

export default defineConfig({
  plugins: [react(), securityHeadersPlugin()],
  server: {
    port: 5173,
    open: false,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Vendor chunkovi se keširaju dugo; editor se učitava zasebno
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'query-vendor': ['@tanstack/react-query'],
        },
      },
    },
  },
});
