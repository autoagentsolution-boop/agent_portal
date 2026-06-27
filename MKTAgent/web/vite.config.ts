import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Split-origin dev (UI :5173 → API :7100). The API base is read from VITE_API_BASE
// (see src/api/client.ts) so flipping to same-origin later = change one env var, no
// component edits. credentials:'include' on fetch carries the HttpOnly session cookie.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
