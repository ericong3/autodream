import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/',
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'garage-glass': ['./src/components/GarageRenderedGlassMap.tsx','./src/components/GarageGlassSetup.tsx','./src/components/GarageJobGlassMap.tsx'],
          'garage-tint-control': ['./src/components/GarageTintPayments.tsx','./src/components/GarageTintUsage.tsx','./src/lib/garageTintControl.ts'],
          'vendor-react':    ['react', 'react-dom', 'react-router-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-dnd':      ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          'vendor-ui':       ['lucide-react', 'zustand', 'date-fns'],
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['icon-192.png', 'icon-512.png', 'logo.png'],
      manifest: {
        name: 'AutoDream',
        short_name: 'AutoDream',
        description: 'Car Dealership Management',
        theme_color: '#0a0f1e',
        background_color: '#0a0f1e',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
    }),
  ],
})
