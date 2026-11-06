import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { rollupOptions: { input: { index: 'index.html', catBurglar: 'games/cat-burglar/index.html' } } },
});
