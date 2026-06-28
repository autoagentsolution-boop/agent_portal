// Master Agent intake router. Draft-only: it parses natural-language intent into
// campaign/post fields and returns missing-field gates. It never publishes or writes.
import { Router } from 'express';
import { ok, parseOr422, asyncHandler } from './http.ts';
import { agentIntakeBody } from './schemas.ts';
import { GeminiAgentIntakeProvider } from '../agent/gemini-intake-provider.ts';

export const agentRouter: Router = Router();
const agentIntakeProvider = new GeminiAgentIntakeProvider();

agentRouter.post(
  '/intake',
  asyncHandler(async (req, res) => {
    const body = parseOr422(res, agentIntakeBody, req.body ?? {});
    if (!body) return;
    const draft = await agentIntakeProvider.parse(body);
    ok(res, draft);
  }),
);
