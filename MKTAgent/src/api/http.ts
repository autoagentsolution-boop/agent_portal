// HTTP envelope + helpers shared by all routers. Every response is exactly one
// of { data, meta? } or { error, details? } so the UI has a single shape to parse.
import type { Response, NextFunction } from 'express';
import type { z, ZodTypeAny } from 'zod';

export const ok = (res: Response, data: unknown, meta?: unknown): void => {
  res.json(meta === undefined ? { data } : { data, meta });
};

// `error` stays a bare, stable CODE (never a sentence) — the client turns it into words via the i18n
// catalog (web/src/i18n/t-error.ts). `params` (i18n phase 02) carries the structured values the catalog
// sentence interpolates (e.g. { platform: 'Gmail' }); optional + additive so un-migrated clients that
// read only `error` keep working. `details` is unchanged (field errors, diagnostics). params is the 5th
// arg to preserve every existing `fail(res, status, code, details)` call site.
export const fail = (
  res: Response,
  status: number,
  error: string,
  details?: unknown,
  params?: Record<string, string | number>,
): void => {
  res.status(status).json({
    error,
    ...(params === undefined ? {} : { params }),
    ...(details === undefined ? {} : { details }),
  });
};

// Parse + validate a request part; on failure respond 422 and return null so the
// handler can early-return. Field errors are surfaced for form binding in the UI.
export function parseOr422<S extends ZodTypeAny>(
  res: Response,
  schema: S,
  input: unknown,
): z.infer<S> | null {
  const r = schema.safeParse(input);
  if (!r.success) {
    fail(res, 422, 'validation_failed', r.error.flatten().fieldErrors);
    return null;
  }
  return r.data;
}

// Wrap async handlers so thrown errors hit the global error handler (Express 5
// forwards rejected promises, but this keeps the intent explicit + stack clean).
export const asyncHandler =
  (fn: (...args: any[]) => Promise<unknown>) =>
  (req: any, res: any, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
