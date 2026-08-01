// Characterization: the shared request<T,M> fetch-wrapper contract. This is the ONE piece of
// client.ts that must survive the Phase-2.2 DTO fold (types get regenerated; the runtime envelope
// unwrap must NOT change). request() is module-private, so we drive it through the exported `api`
// helpers that reach each branch, stubbing global fetch. Assertions are on RUNTIME behavior.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, UnauthorizedError } from './client.ts';

function mockFetch(impl: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn(async (url: unknown, init: unknown) =>
    impl(String(url), (init ?? {}) as RequestInit));
  vi.stubGlobal('fetch', spy as unknown as typeof fetch);
  return spy;
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('client request<T,M> wrapper contract', () => {
  beforeEach(() => vi.stubGlobal('location', { origin: 'http://localhost' } as Location));
  afterEach(() => vi.unstubAllGlobals());

  it('unwraps { data } on 200 (data is the payload, not the envelope)', async () => {
    mockFetch(() => json(200, { data: { credits: 42 } }));
    const r = await api.me();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual({ credits: 42 });
  });

  it('surfaces { data, meta } together on a keyset-paginated list (the meta generic)', async () => {
    mockFetch(() => json(200, { data: [{ id: 'p1' }], meta: { count: 1, nextCursor: 'abc' } }));
    const r = await api.listPosts();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toEqual([{ id: 'p1' }]);
      expect(r.meta).toEqual({ count: 1, nextCursor: 'abc' });
    }
  });

  it('throws UnauthorizedError on 401 (App bounces to login) — never returns a Result', async () => {
    mockFetch(() => json(401, { error: 'unauthorized' }));
    await expect(api.me()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('returns ok with undefined data on 204 (no body parsed)', async () => {
    mockFetch(() => new Response(null, { status: 204 }));
    const r = await api.logout();
    expect(r).toEqual({ ok: true, data: undefined });
  });

  it('maps a thrown fetch to { ok:false, error:network_error, status:0 } — no throw escapes', async () => {
    mockFetch(() => { throw new TypeError('Failed to fetch'); });
    const r = await api.me();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.status).toBe(0);
      expect(r.error.error).toBe('network_error');
    }
  });

  it('maps a non-2xx error body to { ok:false } preserving code + i18n params', async () => {
    mockFetch(() => json(402, { error: 'insufficient_credits', params: { need: 10 } }));
    const r = await api.me();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.status).toBe(402);
      expect(r.error.error).toBe('insufficient_credits');
      expect(r.error.params).toEqual({ need: 10 });
    }
  });

  it('falls back to error:"error" when the failure body has no code', async () => {
    mockFetch(() => json(500, {}));
    const r = await api.me();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.error).toBe('error');
  });

  it('sends credentials:include so the HttpOnly session cookie rides every call', async () => {
    const spy = mockFetch(() => json(200, { data: {} }));
    await api.me();
    expect(spy.mock.calls[0][1]).toMatchObject({ credentials: 'include' });
  });

  it('sets Content-Type only when there is a body (GET carries no content header)', async () => {
    const spy = mockFetch(() => json(200, { data: {} }));
    await api.me(); // GET
    expect((spy.mock.calls[0][1] as RequestInit).headers).not.toHaveProperty('Content-Type');
    spy.mockClear();
    await api.setUiLanguage('vi'); // PATCH with body
    expect((spy.mock.calls[0][1] as RequestInit).headers).toMatchObject({ 'Content-Type': 'application/json' });
  });
});
