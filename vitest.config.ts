import { defineConfig } from 'vitest/config'

// Checks for the window code. jsdom gives the code a browser-like page (storage, DOM).
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
})
