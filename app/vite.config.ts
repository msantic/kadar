import { defineConfig } from 'vite'

// Frontend for the Tauri app. Tauri opens the dev server on this fixed port.
export default defineConfig({
  root: __dirname,
  clearScreen: false,
  // 127.0.0.1, not localhost: Vite would listen on IPv6 only, and the window connects over IPv4.
  server: { host: '127.0.0.1', port: 1420, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, target: 'safari16' },
})
