import { Injectable, Logger } from '@nestjs/common';
import type { N8nTriggerPayload } from './dto/callback.dto.js';

@Injectable()
export class N8nService {
  private readonly logger = new Logger(N8nService.name);
  private readonly baseUrl = process.env.N8N_BASE_URL ?? 'http://n8n:5678';
  private readonly callbackSecret: string;
  private readonly triggerTimeoutMs = 5000;

  constructor() {
    const secret = process.env.N8N_CALLBACK_SECRET;
    if (!secret) {
      throw new Error('N8N_CALLBACK_SECRET env var must be set — required for n8n callback authentication');
    }
    this.callbackSecret = secret;
  }

  // Resolves on 2xx, rejects on network/timeout/non-2xx. Caller decides await vs background-catch.
  async triggerWorkflow(webhookPath: string, payload: N8nTriggerPayload): Promise<void> {
    const url = `${this.baseUrl}${webhookPath}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.triggerTimeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        throw new Error(`n8n responded ${res.status} ${res.statusText}`);
      }
      this.logger.log(`n8n trigger ok path=${webhookPath} executionId=${payload.execution_id}`);
    } finally {
      clearTimeout(timer);
    }
  }

  validateCallbackSecret(provided: string | undefined): boolean {
    if (!provided || provided.length !== this.callbackSecret.length) return false;
    let diff = 0;
    for (let i = 0; i < this.callbackSecret.length; i++) {
      diff |= provided.charCodeAt(i) ^ this.callbackSecret.charCodeAt(i);
    }
    return diff === 0;
  }
}
