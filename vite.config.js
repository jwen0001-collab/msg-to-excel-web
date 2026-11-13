import { defineConfig } from 'vite';

// relative base: works at https://<user>.github.io/msg-to-excel-web/ and from any folder
export default defineConfig(({ mode }) => ({
  base: './',
  define: { 'import.meta.env.VITE_AI_RELAY_PATH': JSON.stringify(mode === 'vercel' ? '/api/chat' : '') },
  build: { chunkSizeWarningLimit: 2000 },
}));
