import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/auth': {
        target: 'http://127.0.0.1:8788',
      },
      '/ct-proxy': {
        target: 'http://127.0.0.1:8788',
      },
    },
  },
});
