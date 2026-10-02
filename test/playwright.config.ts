import playwright from '../package/node_modules/@playwright/test/index.js'
import { fileURLToPath } from 'node:url'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { defineConfig } = playwright
const data = mkdtempSync(join(tmpdir(), 'devops-e2e-'))
export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  workers: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:18081',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'node dist/server.js',
        cwd: fileURLToPath(new URL('../package/', import.meta.url)),
        url: 'http://127.0.0.1:18081/api/health',
        reuseExistingServer: false,
        timeout: 30000,
        env: {
          NODE_ENV: 'test',
          START_SERVER: 'true',
          PORT: '18081',
          HOST: '127.0.0.1',
          PUBLIC_ORIGIN: 'http://127.0.0.1:18081',
          DATABASE_URL: '',
          STATE_FILE: join(data, 'state.json'),
          DEMO_SEED: 'true',
          DEMO_PASSWORD: 'test-password-12345',
          FILE_ROOT: join(data, 'files'),
          AUDIT_ROOT: join(data, 'audit')
        }
      }
})
