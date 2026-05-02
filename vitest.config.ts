import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['client/**', 'node_modules/**'],
  },
})
