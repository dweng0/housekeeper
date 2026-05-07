import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'

const env = loadEnv('test', process.cwd(), '')

export default defineConfig({
  test: {
    exclude: ['client/**', 'node_modules/**', '.devenv/**'],
    env,
  },
})
