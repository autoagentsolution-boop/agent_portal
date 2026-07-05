// Product-knowledge router: the user uploads documents/images about their product and Gemini
// reads them into a rich, factual profile that grounds every downstream copy + image + video
// prompt. Documents arrive as base64 in JSON (no multipart dep); this route is mounted with a
// larger body limit than the global 1mb (see server.ts). Tenant-scoped via requireAuth.
import { Router } from 'express';
import { z } from 'zod';
import { ok, fail, parseOr422, asyncHandler } from './http.ts';
import { analyzeDocuments, SUPPORTED_MIME, type UploadedDoc } from '../product-knowledge/analyze-documents.ts';
import { getCampaign, updateCampaign } from '../db/repos/campaign-repo.ts';
import { logger } from '../lib/logger.ts';

export const productKnowledgeRouter: Router = Router();

// Per-file ~8MB base64 cap and ≤6 files keep the request within the route's body limit and the
// model's context. dataB64 is the raw base64 (no data: URI prefix — the client strips it).
const MAX_B64_LEN = 8 * 1024 * 1024;
const analyzeBody = z.object({
  files: z.array(z.object({
    name: z.string().max(300),
    mimeType: z.string().max(120),
    dataB64: z.string().min(1).max(MAX_B64_LEN),
  })).min(1).max(6),
  product: z.string().max(200).optional(),
  // When set, persist the extracted knowledge onto the campaign (brandContext + optional voice).
  campaignId: z.string().uuid().optional(),
});

productKnowledgeRouter.post(
  '/analyze',
  asyncHandler(async (req, res) => {
    const body = parseOr422(res, analyzeBody, req.body ?? {});
    if (!body) return;

    const unsupported = body.files.find((f) => !SUPPORTED_MIME.has(f.mimeType));
    if (unsupported) {
      return fail(res, 415, 'unsupported_file_type',
        `"${unsupported.name}" (${unsupported.mimeType}) is not supported. Use PDF, PNG/JPG/WebP, or TXT/Markdown.`);
    }

    // Persisting to a campaign requires it to exist + belong to the caller (404 otherwise).
    if (body.campaignId && !(await getCampaign(body.campaignId, req.userId!))) {
      return fail(res, 404, 'campaign_not_found');
    }

    let result;
    try {
      result = await analyzeDocuments(body.files as UploadedDoc[], body.product);
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      logger.warn('product_knowledge_analyze_failed', { error: msg.slice(0, 200) });
      // A model/parse failure is a 502 (upstream), a truly-empty extraction a 422.
      const status = /no product knowledge|unreadable/.test(msg) ? 422 : 502;
      return fail(res, status, 'analysis_failed', msg.slice(0, 200));
    }

    if (body.campaignId) {
      await updateCampaign(body.campaignId, req.userId!, {
        brandContext: result.productDetails,
        ...(result.brandVoice ? { brandVoice: result.brandVoice } : {}),
      });
    }

    ok(res, {
      productDetails: result.productDetails,
      profile: result.profile,
      brandVoice: result.brandVoice,
      language: result.language,
      cost: result.cost,
      persistedToCampaign: Boolean(body.campaignId),
    });
  }),
);
