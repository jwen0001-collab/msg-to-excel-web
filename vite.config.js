import { defineConfig } from 'vite';

// relative base: works at https://<user>.github.io/msg-to-excel-web/ and from any folder
export default defineConfig({ base: './', build: { chunkSizeWarningLimit: 2000 } });
