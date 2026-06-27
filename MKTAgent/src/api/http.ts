// HTTP envelope + helpers shared by all routers. Every response is exactly one
// of { data, meta? } or { error, details? } so the UI has a single shape to parse.
import type { Response, NextFunction } from 'express';
import type { z, ZodTypeAny } from 'zod';

export const ok = (res: Response, data: unknown, meta?: unknown): void => {
  res.json(meta === undefined ? { data } : { data, meta });
};

export const fail = (res: Response, status: number, error: string, details?: unknown): void => {
  res.status(status).json(details === undefined ? { error } : { error, details });
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
