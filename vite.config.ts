import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  esbuild: { jsx: 'automatic' },
  build: {
    outDir: 'public/lesson-ui',
    emptyOutDir: true,
    lib: { entry: 'lesson-ui/index.tsx', formats: ['es'], fileName: () => 'lesson.js', cssFileName: 'lesson' },
    rollupOptions: { external: id => id.startsWith('/shared/') },
    minify: true
  }
});
