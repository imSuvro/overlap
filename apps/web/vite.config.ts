import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const DEV_SERVER = 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxied rather than pointed at an absolute URL, so the client uses same-origin relative
    // paths in development exactly as it does in production behind the Worker. One code path,
    // no environment-specific base URL to get wrong.
    proxy: {
      '/api': { target: DEV_SERVER, changeOrigin: true, ws: true },
    },
  },
  build: {
    target: 'es2022',
    // The real budget is the gzipped figure the build prints (~92 kB, of which React and Zod
    // are the bulk). This threshold is set just above the current uncompressed size so that a
    // meaningful regression trips it and routine builds stay quiet.
    chunkSizeWarningLimit: 320,
  },
});
