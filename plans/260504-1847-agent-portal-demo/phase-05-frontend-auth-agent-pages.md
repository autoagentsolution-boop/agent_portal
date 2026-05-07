# Phase 05: Frontend Auth + Agent Pages

**Day:** Day 6 (May 13, 2026)  
**Priority:** High  
**Status:** Pending

## Context Links
- Plan: `plans/260504-1847-agent-portal-demo/plan.md`
- Spec §13.2: Agents page requirements
- Prior handoff: `phase-04-n8n-integration-core-loop.md` → Handoff Notes

## Overview
Build the React frontend foundation: API client, auth context, login/register pages, protected route wrapper, and the main agents page (Templates tab + My Agents tab). All data from backend — no hardcoding.

## Prerequisites
- Phase 04 complete: all backend APIs live, auth working, E2E loop functional
- Frontend at `frontend/src/` with Vite + React + TypeScript + Tailwind + shadcn/ui

## Install Dependencies
```bash
cd frontend
npm install @tanstack/react-query axios react-router-dom
npx shadcn@latest init  # if not already done
npx shadcn@latest add button card badge tabs input label
```

## Files to Create

```
frontend/src/
├── lib/
│   ├── api-client.ts           (axios instance, interceptors)
│   └── query-client.ts         (React Query client)
├── contexts/
│   └── auth-context.tsx        (session state, login/logout helpers)
├── hooks/
│   ├── use-auth.ts
│   ├── use-templates.ts
│   └── use-agents.ts
├── components/
│   ├── layout/
│   │   ├── app-layout.tsx      (sidebar + main content)
│   │   └── sidebar.tsx
│   └── ui/                     (shadcn components — auto-generated)
├── pages/
│   ├── auth/
│   │   ├── login-page.tsx
│   │   └── register-page.tsx
│   ├── agents/
│   │   ├── agents-page.tsx     (tab container)
│   │   ├── templates-tab.tsx
│   │   ├── my-agents-tab.tsx
│   │   └── agent-card.tsx
│   └── dashboard/
│       └── dashboard-page.tsx  (placeholder — wired in Phase 11)
├── router.tsx                  (React Router config)
└── main.tsx                    (QueryClientProvider + RouterProvider)
```

## Implementation Steps

### 1. API client — lib/api-client.ts
```typescript
const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api',
  withCredentials: true,  // required for Better Auth session cookies
});

// Response interceptor: unwrap { data: ... } envelope
apiClient.interceptors.response.use(
  (res) => res.data.data ?? res.data,
  (err) => {
    if (err.response?.status === 401) {
      // Redirect to /login
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);
```

### 2. Auth context — contexts/auth-context.tsx
```typescript
// Calls GET /api/auth/get-session on mount
// Provides: user, isLoading, login(), logout(), register()
// login() → POST /api/auth/sign-in/email → reload session
// logout() → POST /api/auth/sign-out → clear user
```

### 3. Protected route wrapper
```typescript
// If !user && !isLoading → redirect to /login
// Show loading spinner while isLoading
```

### 4. Login page — pages/auth/login-page.tsx
- Email + password form with shadcn Input/Button
- Validation: both fields required, email format
- On submit: call auth context login() → redirect to /agents on success
- Link to /register
- Error display under form

### 5. Register page — pages/auth/register-page.tsx
- Name + email + password form
- On success → auto-login → redirect to /agents

### 6. Router config — router.tsx
```typescript
// Public: /login, /register
// Protected (wrap in <ProtectedRoute>):
//   / → redirect to /agents
//   /agents → AgentsPage
//   /agents/:id → AgentDetailPage (placeholder)
//   /executions/:id → ExecutionDetailPage (placeholder)
//   /integrations → IntegrationsPage (placeholder)
//   /notifications → NotificationsPage (placeholder)
//   /analytics → AnalyticsPage (placeholder)
```

### 7. App layout — components/layout/app-layout.tsx
Sidebar with nav links:
- Dashboard (/)
- Agents (/agents)
- Integrations (/integrations)
- Notifications (/notifications)
- Analytics (/analytics)
User info at bottom with logout button.

### 8. Agents page — agents-page.tsx
Two tabs using shadcn Tabs:
- **Templates** tab → `TemplatesTab`
- **My Agents** tab → `MyAgentsTab`

### 9. Templates tab — templates-tab.tsx
```typescript
// useQuery: GET /api/agent-templates
// Render AgentTemplate cards with:
//   - name, category, description
//   - required_integrations (badges)
//   - optional_integrations (badges, muted)
//   - cost_level badge
//   - "Create Agent" button → navigate to /agents/new?template=:id
// Loading: skeleton cards
// Empty: "No templates available"
// Error: error message with retry
```

### 10. My Agents tab — my-agents-tab.tsx
```typescript
// useQuery: GET /api/agent-instances
// Render agent cards with:
//   - name, template name, status badge (color-coded)
//   - trigger mode, integrations used
//   - Actions: Run Now, Pause/Resume, View Details, Archive
// Run Now → POST /api/agent-instances/:id/run → navigate to /executions/:execution_id
// Status badge colors: running=green, paused=yellow, error=red, draft=gray, archived=muted
```

### 11. Environment variables
```env
# frontend/.env.local
VITE_API_URL=http://localhost:4000/api
```

### 12. Add loading/empty/error states to all data fetches
- Loading: shadcn Skeleton components
- Empty: centered text + icon
- Error: Alert component with error message + retry button

## Done Criteria
- [ ] `/login` renders form, submitting with `admin@demo.local` / `demo1234` → redirects to `/agents`
- [ ] Visiting `/agents` without session → redirects to `/login`
- [ ] Templates tab shows 5 templates (names match DB, not hardcoded)
- [ ] My Agents tab shows empty state initially, then agent cards after creating one via API
- [ ] "Run Now" on an agent → POSTs to backend, navigates to execution page (placeholder OK)
- [ ] Logout clears session and redirects to `/login`
- [ ] Network tab shows API calls going to `localhost:4000`, not to n8n directly

## Handoff Notes (for Phase 06)
- Router has `/agents/new` route (placeholder) — Phase 06 replaces with wizard
- `useTemplates()` hook returns `AgentTemplate[]` from React Query cache
- `useAgents()` hook returns `AgentInstance[]` from React Query cache
- Auth state via `useAuth()` hook from `contexts/auth-context.tsx`
- API client at `lib/api-client.ts` — always use this, never raw fetch
- All API responses unwrapped from `{ data: ... }` envelope by interceptor
- shadcn components available in `src/components/ui/`
- `withCredentials: true` is set on axios — do not remove or session breaks
