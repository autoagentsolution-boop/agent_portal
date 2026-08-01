import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Deterministic FE characterization tier (Phase-0 safety net). jsdom + RTL, no live stack.
// Pins the referential-stability / merge-not-replace / StrictMode-guard / ref-count invariants
// the Phase-3 App.tsx + client.ts decomposition must preserve. Run: `npm run test`.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
