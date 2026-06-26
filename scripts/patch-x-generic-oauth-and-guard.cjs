#!/usr/bin/env node
/**
 * Two fixes for the X branch after the first live fire:
 *  (1) media.write scope — n8n's predefined twitterOAuth2Api only grants
 *      tweet.read/tweet.write/users.read/offline.access, so /2/media/upload 403s.
 *      Switch both X HTTP nodes to GENERIC oAuth2Api credential (scope set on the
 *      credential incl. media.write).
 *  (2) Normalize X result crashed ("Node 'X create tweet' hasn't been executed")
 *      when upload failed and create-tweet got skipped. Guard every upstream
 *      node access in try/catch and surface the real upstream error.
 */
const fs = require('fs');
const path = require('path');
const WF = path.join(__dirname, '..', 'n8n-workflows', 'mkt-post-scheduler.json');
const w = JSON.parse(fs.readFileSync(WF, 'utf8'));

const byId = (id) => {
  const n = w.nodes.find((x) => x.id === id);
  if (!n) throw new Error('missing node id: ' + id);
  return n;
};

// --- (1) generic OAuth2 credential on both X HTTP nodes ---
// id bound on instance after user creates the generic "X DAIS media" credential.
const GENERIC_CRED = { oAuth2Api: { id: '', name: 'X DAIS media' } };
for (const id of ['x-upload-media', 'x-create-tweet']) {
  const n = byId(id);
  n.parameters.authentication = 'genericCredentialType';
  n.parameters.genericAuthType = 'oAuth2Api';
  delete n.parameters.nodeCredentialType;
  n.credentials = GENERIC_CRED;
}

// --- (2) crash-proof Normalize X result ---
const norm = byId('normalize-x-result');
norm.parameters.jsCode = [
  "// X final: append result. Guard upstream nodes that may be skipped on upload/publish failure.",
  "const carry = $('Build X request').first().json;",
  "const results = [...(carry.priorResults || [])];",
  "if (!carry.skipX) {",
  "  // upload error surfaces on the X upload media node (continueErrorOutput)",
  "  let uploadErr = null;",
  "  try { const u = $('X upload media').first(); uploadErr = (u && u.json && u.json.error) || null; } catch (e) {}",
  "  let tid = null, pubErr = null;",
  "  try {",
  "    const item = $('X create tweet').first();",
  "    const resp = (item && item.json) || {};",
  "    tid = (resp.data && resp.data.id) || null;",
  "    pubErr = resp.errors || resp.error || resp.title || null;",
  "  } catch (e) { /* create tweet skipped because upload failed */ }",
  "  if (tid && !pubErr) {",
  "    results.push({ platform: 'x', ok: true, url: 'https://twitter.com/i/web/status/' + tid, error: null });",
  "  } else {",
  "    let msg = 'X publish failed';",
  "    const e = pubErr || uploadErr;",
  "    if (e) msg = typeof e === 'string' ? e : (e.message || JSON.stringify(e));",
  "    else if (!tid) msg = 'X media upload failed (no media id)';",
  "    results.push({ platform: 'x', ok: false, url: null, error: ('X: ' + msg).slice(0, 300) });",
  "  }",
  "}",
  "return [{ json: { id: carry.id, rowNumber: carry.rowNumber, results } }];",
].join('\n');

fs.writeFileSync(WF, JSON.stringify(w, null, 2) + '\n');
console.log('OK: X nodes use generic oAuth2Api + Normalize X result is crash-proof.');
console.log('Bind the generic credential id after the user creates "X DAIS media" with media.write scope.');
