import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/ui', use: { baseURL: 'http://127.0.0.1:5173', channel: process.env.PLAYWRIGHT_CHANNEL || undefined, viewport: { width: 1440, height: 1000 } }, webServer: { command: 'npm run dev:web', url: 'http://127.0.0.1:5173', reuseExistingServer: true }, reporter: 'list' });
