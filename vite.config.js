import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base keeps asset URLs correct when the site is served from
  // https://<user>.github.io/<repo>/ rather than a domain root.
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
});
