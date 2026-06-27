// Deterministic system/DAIS owner id — seeded by the T1 tenancy migration and
// referenced wherever pre-multi-tenant code must attribute rows to a tenant
// (CLI smoke tests, env-seeded DAIS tokens). Real users get their own ids via
// Google login; this is the single-tenant fallback until T2 threads ownerId.
export const SYSTEM_OWNER_ID = '00000000-0000-0000-0000-000000000001';
