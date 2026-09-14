import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/ct-proxy': {
        target: 'https://nl.church.tools',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/ct-proxy/, ''),
      },
    },
  },
});
