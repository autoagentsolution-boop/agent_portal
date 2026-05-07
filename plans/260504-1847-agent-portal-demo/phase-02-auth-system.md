# Phase 02: Auth System

**Day:** Day 3 (May 8, 2026)  
**Priority:** Critical  
**Status:** Complete

## Context Links
- Plan: `plans/260504-1847-agent-portal-demo/plan.md`
- Spec §6.2 Rule 2: Backend is control plane (owns auth)
- Prior handoff: `phase-01-database-schema-seed.md` → Handoff Notes

## Overview
Install and configure Better Auth on NestJS backend with Prisma adapter. Expose auth endpoints. Add JWT/session guard to protect all business API routes. This phase is backend-only — frontend auth UI is Phase 05.

## Prerequisites
- Phase 01 complete: Prisma schema migrated, PrismaService injectable
- Better Auth docs: https://www.better-auth.com/docs/installation

## Files to Create / Modify

```
backend/src/
├── auth/
│   ├── auth.module.ts          (create)
│   ├── auth.controller.ts      (create — mounts Better Auth handler)
│   ├── auth.service.ts         (create — Better Auth instance)
│   └── auth.guard.ts           (create — NestJS guard using Better Auth session)
├── app.module.ts               (modify — import AuthModule)
└── main.ts                     (modify — raw body for Better Auth)
```

## Implementation Steps

### 1. Install Better Auth
```bash
cd backend
npm install better-auth @better-auth/prisma-adapter
```

### 2. auth.service.ts — Better Auth instance
```typescript
import { betterAuth } from 'better-auth';
import { prismaAdapter } from '@better-auth/prisma-adapter';
import { PrismaService } from '../prisma/prisma.service';

// Create auth instance with:
// - database: prismaAdapter(prisma, { provider: 'postgresql' })
// - emailAndPassword: { enabled: true }
// - secret: process.env.BETTER_AUTH_SECRET
// - baseURL: process.env.BETTER_AUTH_URL
// Export createAuth() factory — NestJS injects PrismaService then builds auth instance
```

### 3. auth.controller.ts — Mount Better Auth handler
Better Auth uses a catch-all route to handle all `/api/auth/*` paths.
```typescript
@Controller('auth')
export class AuthController {
  // toWebRequest / toExpressHandler pattern from Better Auth docs
  // Mount at /api/auth/* — all methods (GET, POST)
  @All('*')
  async handler(@Req() req, @Res() res) {
    return this.authService.handler(req, res);
  }
}
```

### 4. auth.guard.ts — Session validation guard
```typescript
@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const session = await this.authService.getSession(req);
    if (!session?.user) throw new UnauthorizedException();
    req.user = session.user;
    req.session = session.session;
    return true;
  }
}
```

### 5. Apply guard globally with exception for public routes
Use `SetMetadata('public', true)` decorator + reflector to skip auth on:
- `GET /api/health`
- `POST /api/auth/*` (all Better Auth routes)
- `POST /api/n8n/callback` (protected by callback secret instead)

### 6. main.ts — raw body support
Better Auth requires raw body access for CSRF/cookie handling:
```typescript
app.use(express.json({ limit: '10mb' }));
// Keep raw body accessible
```
Also configure cookie parser: `npm install cookie-parser`

### 7. CORS config in main.ts
```typescript
app.enableCors({
  origin: process.env.FRONTEND_URL,
  credentials: true,  // required for session cookies
});
```

### 8. Auth endpoints exposed by Better Auth (no custom code needed)
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/auth/sign-up/email | Register |
| POST | /api/auth/sign-in/email | Login |
| POST | /api/auth/sign-out | Logout |
| GET  | /api/auth/get-session | Current session |

### 9. Add convenience endpoint (optional)
```
GET /api/auth/me — returns current user profile (calls getSession internally)
```

### 10. Test auth flow end-to-end
```bash
# Register
curl -X POST http://localhost:4000/api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"email":"test@demo.local","password":"demo1234","name":"Test User"}'

# Login
curl -X POST http://localhost:4000/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email":"test@demo.local","password":"demo1234"}'

# Hit protected route
curl http://localhost:4000/api/agent-templates \
  -H "Cookie: <session-cookie-from-login>"
```

## Done Criteria
- [ ] `POST /api/auth/sign-up/email` creates user in DB
- [ ] `POST /api/auth/sign-in/email` returns session cookie
- [ ] `GET /api/agent-templates` with valid session cookie → 200
- [ ] `GET /api/agent-templates` without cookie → 401
- [ ] `GET /api/health` without cookie → 200 (public route)
- [ ] Session stored in DB `Session` table

## Handoff Notes (for Phase 03)
- Auth guard is global — apply `@Public()` decorator to skip on public routes
- Session is cookie-based (Better Auth default) — frontend must send `credentials: 'include'` with fetch
- Current user available as `req.user` (type: Better Auth User) on any guarded route
- Auth endpoints at `/api/auth/*` — all handled by Better Auth internally
- `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` must be set in `.env`
- `FRONTEND_URL` must match exactly for CORS to pass credentials
