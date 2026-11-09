import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' keeps asset paths relative so the static build works when
// served from any path (e.g. GitHub Pages project site).
export default defineConfig({
  plugins: [react()],
  base: './',
});
