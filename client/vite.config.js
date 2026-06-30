import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'Vermeer Fantasy Racing',
        short_name: 'Fantasy Racing',
        description: 'Predict the finishing order of races and earn points.',
        theme_color: '#ffc425',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  build: {
    chunckSizweWarningLimit: 1000,
    sourcemap: false,
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptinos: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
	    return 'vendor';
	  }
	},
      },
    },
  },
  server: {
    port: 5173,
  },
});
