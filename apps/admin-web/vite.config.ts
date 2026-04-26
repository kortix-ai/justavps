import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/admin-ui/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 4300,
    strictPort: true,
    proxy: {
      '^/(health|regions|images|machines|admin)(/.*)?$': {
        target: 'http://localhost:4200',
        changeOrigin: true,
      },
    },
  },
});
