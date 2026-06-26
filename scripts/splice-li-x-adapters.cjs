#!/usr/bin/env node
/**
 * Splice LinkedIn (personal feed, free) + X (code-only, no live test) adapters
 * into mkt-post-scheduler.json, mirroring the existing per-platform IF-gate pattern.
 *
 * Chain change:  Normalize IG result -> Aggregate results
 * becomes:       Normalize IG result -> [LinkedIn branch] -> [X branch] -> Aggregate results
 *
 * LinkedIn + X = BINARY upload (no public-URL ingestion like Threads/IG) -> each branch
 * downloads the Drive hero as binary (mirrors FB), then platform-specific upload+publish.
 */
const fs = require('fs');
const path = require('path');

const WF = path.join(__dirname, '..', 'n8n-workflows', 'mkt-post-scheduler.json');
const w = JSON.parse(fs.readFileSync(WF, 'utf8'));

const LI_VERSION = '202606'; // LinkedIn versioned REST (YYYYMM); default moniker li-lms-2026-06

// ---- helper: assert a node exists (fail loud if upstream renamed) ----
const have = (name) => {
  if (!w.nodes.find((n) => n.name === name)) throw new Error(`missing node: ${name}`);
};
['Normalize IG result', 'Aggregate results', 'Validate assets'].forEach(have);

// ---- guard: idempotent re-run ----
if (w.nodes.find((n) => n.name === 'Build LinkedIn request')) {
  console.error('LinkedIn branch already present — aborting (re-run not idempotent).');
  process.exit(1);
}

const Y = 640;
let x = 4510;
const at = () => { const p = [x, Y]; x += 220; return p; };

const nodes = [
  // ===================== LINKEDIN BRANCH =====================
  {
    id: 'build-li-request',
    name: 'Build LinkedIn request',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: at(),
    parameters: {
      jsCode: [
        "// LinkedIn adapter step 1: gate + carry prior results forward.",
        "// 'Normalize IG result' ALWAYS runs (both IG IF branches converge) -> {id,rowNumber,results}.",
        "const prev = $('Normalize IG result').first().json;",
        "const spec = $('Validate assets').first().json;",
        "const results = [...(prev.results || [])];",
        "const carry = { id: prev.id, rowNumber: prev.rowNumber, priorResults: results, heroFileId: spec.heroFileId };",
        "const platforms = spec.platforms || [];",
        "if (!platforms.includes('linkedin')) { return [{ json: { ...carry, skipLi: true } }]; }",
        "// LinkedIn commentary limit 3000 chars (generous); long-form like FB -> copyVi.",
        "let commentary = String(spec.copyVi || spec.copyEn || '');",
        "if (commentary.length > 3000) { commentary = commentary.slice(0, 2997); commentary = commentary.slice(0, commentary.lastIndexOf(' ')) + '…'; }",
        "const owner = 'urn:li:person:' + String($env.MKT_LINKEDIN_PERSON_ID || '');",
        "return [{ json: { ...carry, skipLi: false, commentary, owner } }];",
      ].join('\n'),
    },
  },
  {
    id: 'if-linkedin-targeted',
    name: 'IF linkedin targeted',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.3,
    position: at(),
    parameters: {
      conditions: {
        options: { caseSensitive: true, version: 2, typeValidation: 'strict', leftValue: '' },
        combinator: 'and',
        conditions: [{
          leftValue: '={{ $json.skipLi }}',
          rightValue: false,
          operator: { type: 'boolean', operation: 'false', singleValue: true },
        }],
      },
    },
  },
  {
    id: 'li-init-upload',
    name: 'LI init upload',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: at(),
    onError: 'continueErrorOutput',
    parameters: {
      method: 'POST',
      url: 'https://api.linkedin.com/rest/images?action=initializeUpload',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'Authorization', value: '=Bearer {{$env.MKT_LINKEDIN_ACCESS_TOKEN}}' },
          { name: 'LinkedIn-Version', value: LI_VERSION },
          { name: 'X-Restli-Protocol-Version', value: '2.0.0' },
        ],
      },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ initializeUploadRequest: { owner: $json.owner } }) }}',
      options: { timeout: 30000 },
    },
  },
  {
    id: 'li-download-hero',
    name: 'Download hero (LinkedIn)',
    type: 'n8n-nodes-base.googleDrive',
    typeVersion: 3,
    position: at(),
    parameters: {
      operation: 'download',
      fileId: { __rl: true, mode: 'id', value: "={{ $('Build LinkedIn request').item.json.heroFileId }}" },
      options: { binaryPropertyName: 'data' },
    },
  },
  {
    id: 'li-upload-binary',
    name: 'LI upload binary',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: at(),
    onError: 'continueErrorOutput',
    parameters: {
      method: 'PUT',
      // uploadUrl pulled from init response; binary travels on the current item (from Drive download).
      url: "={{ $('LI init upload').item.json.value.uploadUrl }}",
      sendHeaders: true,
      headerParameters: {
        parameters: [{ name: 'Authorization', value: '=Bearer {{$env.MKT_LINKEDIN_ACCESS_TOKEN}}' }],
      },
      sendBody: true,
      contentType: 'binaryData',
      inputDataFieldName: 'data',
      options: { timeout: 60000 },
    },
  },
  {
    id: 'li-create-post',
    name: 'LI create post',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: at(),
    onError: 'continueErrorOutput',
    parameters: {
      method: 'POST',
      url: 'https://api.linkedin.com/rest/posts',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'Authorization', value: '=Bearer {{$env.MKT_LINKEDIN_ACCESS_TOKEN}}' },
          { name: 'LinkedIn-Version', value: LI_VERSION },
          { name: 'X-Restli-Protocol-Version', value: '2.0.0' },
        ],
      },
      sendBody: true,
      specifyBody: 'json',
      // post id is returned in the x-restli-id RESPONSE HEADER -> need fullResponse.
      jsonBody: '={{ JSON.stringify({ author: $(\'Build LinkedIn request\').item.json.owner, commentary: $(\'Build LinkedIn request\').item.json.commentary, visibility: "PUBLIC", distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] }, content: { media: { altText: $(\'Build LinkedIn request\').item.json.product || "image", id: $(\'LI init upload\').item.json.value.image } }, lifecycleState: "PUBLISHED", isReshareDisabledByAuthor: false }) }}',
      options: { timeout: 60000, response: { response: { fullResponse: true } } },
    },
  },
  {
    id: 'normalize-li-result',
    name: 'Normalize LinkedIn result',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: at(),
    parameters: {
      jsCode: [
        "// LinkedIn final: read post URN from x-restli-id header, append to priorResults.",
        "const carry = $('Build LinkedIn request').first().json;",
        "const results = [...(carry.priorResults || [])];",
        "if (!carry.skipLi) {",
        "  const item = $('LI create post').first();",
        "  const resp = (item && item.json) || {};",
        "  const headers = resp.headers || {};",
        "  const code = resp.statusCode || resp.status;",
        "  const urn = headers['x-restli-id'] || headers['X-RestLi-Id'];",
        "  const body = resp.body || resp;",
        "  if (urn && (!code || code === 201 || code === 200)) {",
        "    results.push({ platform: 'linkedin', ok: true, url: 'https://www.linkedin.com/feed/update/' + urn, error: null });",
        "  } else {",
        "    let msg = 'LinkedIn publish failed';",
        "    if (body && body.message) msg = body.message;",
        "    else if (body && body.error) msg = typeof body.error === 'string' ? body.error : JSON.stringify(body.error);",
        "    results.push({ platform: 'linkedin', ok: false, url: null, error: ('LinkedIn: ' + msg).slice(0, 300) });",
        "  }",
        "}",
        "return [{ json: { id: carry.id, rowNumber: carry.rowNumber, results } }];",
      ].join('\n'),
    },
  },
  // ===================== X (TWITTER) BRANCH — code only, NOT live-tested =====================
  {
    id: 'build-x-request',
    name: 'Build X request',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: at(),
    parameters: {
      jsCode: [
        "// X adapter step 1: gate + carry forward. NOTE: not live-tested (no API credit).",
        "const prev = $('Normalize LinkedIn result').first().json;",
        "const spec = $('Validate assets').first().json;",
        "const results = [...(prev.results || [])];",
        "const carry = { id: prev.id, rowNumber: prev.rowNumber, priorResults: results, heroFileId: spec.heroFileId };",
        "const platforms = spec.platforms || [];",
        "if (!platforms.includes('x') && !platforms.includes('twitter')) { return [{ json: { ...carry, skipX: true } }]; }",
        "// X hard limit 280 chars -> prefer short variant (copyThreads), else truncate copyVi.",
        "let text = String(spec.copyThreads || '').trim();",
        "if (!text) { text = String(spec.copyVi || ''); }",
        "if (text.length > 280) { text = text.slice(0, 277); text = text.slice(0, text.lastIndexOf(' ')) + '…'; }",
        "return [{ json: { ...carry, skipX: false, text } }];",
      ].join('\n'),
    },
  },
  {
    id: 'if-x-targeted',
    name: 'IF x targeted',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.3,
    position: at(),
    parameters: {
      conditions: {
        options: { caseSensitive: true, version: 2, typeValidation: 'strict', leftValue: '' },
        combinator: 'and',
        conditions: [{
          leftValue: '={{ $json.skipX }}',
          rightValue: false,
          operator: { type: 'boolean', operation: 'false', singleValue: true },
        }],
      },
    },
  },
  {
    id: 'x-download-hero',
    name: 'Download hero (X)',
    type: 'n8n-nodes-base.googleDrive',
    typeVersion: 3,
    position: at(),
    parameters: {
      operation: 'download',
      fileId: { __rl: true, mode: 'id', value: "={{ $('Build X request').item.json.heroFileId }}" },
      options: { binaryPropertyName: 'data' },
    },
  },
  {
    id: 'x-upload-media',
    name: 'X upload media',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: at(),
    onError: 'continueErrorOutput',
    parameters: {
      method: 'POST',
      url: 'https://api.twitter.com/2/media/upload',
      sendHeaders: true,
      headerParameters: {
        parameters: [{ name: 'Authorization', value: '=Bearer {{$env.MKT_X_ACCESS_TOKEN}}' }],
      },
      sendBody: true,
      contentType: 'multipart-form-data',
      bodyParameters: {
        parameters: [
          { parameterType: 'formData', name: 'media_category', value: 'tweet_image' },
          { parameterType: 'formBinaryData', name: 'media', inputDataFieldName: 'data' },
        ],
      },
      options: { timeout: 60000 },
    },
  },
  {
    id: 'x-create-tweet',
    name: 'X create tweet',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: at(),
    onError: 'continueErrorOutput',
    parameters: {
      method: 'POST',
      url: 'https://api.twitter.com/2/tweets',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'Authorization', value: '=Bearer {{$env.MKT_X_ACCESS_TOKEN}}' },
          { name: 'Content-Type', value: 'application/json' },
        ],
      },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ text: $(\'Build X request\').item.json.text, media: { media_ids: [ String(($(\'X upload media\').item.json.media_id_string) || ($(\'X upload media\').item.json.data && $(\'X upload media\').item.json.data.id) || ($(\'X upload media\').item.json.media_id) || "") ] } }) }}',
      options: { timeout: 60000 },
    },
  },
  {
    id: 'normalize-x-result',
    name: 'Normalize X result',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: at(),
    parameters: {
      jsCode: [
        "// X final: append result. Not live-tested; tolerant parsing of v2 response shapes.",
        "const carry = $('Build X request').first().json;",
        "const results = [...(carry.priorResults || [])];",
        "if (!carry.skipX) {",
        "  const item = $('X create tweet').first();",
        "  const resp = (item && item.json) || {};",
        "  const data = resp.data || {};",
        "  const tid = data.id;",
        "  const err = resp.errors || resp.error || resp.title;",
        "  if (tid && !err) {",
        "    results.push({ platform: 'x', ok: true, url: 'https://twitter.com/i/web/status/' + tid, error: null });",
        "  } else {",
        "    let msg = 'X publish failed';",
        "    if (err) msg = typeof err === 'string' ? err : JSON.stringify(err);",
        "    results.push({ platform: 'x', ok: false, url: null, error: ('X: ' + msg).slice(0, 300) });",
        "  }",
        "}",
        "return [{ json: { id: carry.id, rowNumber: carry.rowNumber, results } }];",
      ].join('\n'),
    },
  },
];

w.nodes.push(...nodes);

// ---- rewire connections ----
const c = w.connections;
const main1 = (toNode) => ({ main: [[{ node: toNode, type: 'main', index: 0 }]] });

// detach Normalize IG result -> Aggregate results, splice the two branches in
c['Normalize IG result'] = main1('Build LinkedIn request');

c['Build LinkedIn request'] = main1('IF linkedin targeted');
c['IF linkedin targeted'] = {
  main: [
    [{ node: 'LI init upload', type: 'main', index: 0 }],          // true -> publish path
    [{ node: 'Normalize LinkedIn result', type: 'main', index: 0 }], // false -> skip
  ],
};
c['LI init upload'] = {
  main: [
    [{ node: 'Download hero (LinkedIn)', type: 'main', index: 0 }],
    [{ node: 'Normalize LinkedIn result', type: 'main', index: 0 }], // error out -> normalize records failure
  ],
};
c['Download hero (LinkedIn)'] = main1('LI upload binary');
c['LI upload binary'] = {
  main: [
    [{ node: 'LI create post', type: 'main', index: 0 }],
    [{ node: 'Normalize LinkedIn result', type: 'main', index: 0 }],
  ],
};
c['LI create post'] = {
  main: [
    [{ node: 'Normalize LinkedIn result', type: 'main', index: 0 }],
    [{ node: 'Normalize LinkedIn result', type: 'main', index: 0 }],
  ],
};
c['Normalize LinkedIn result'] = main1('Build X request');

c['Build X request'] = main1('IF x targeted');
c['IF x targeted'] = {
  main: [
    [{ node: 'Download hero (X)', type: 'main', index: 0 }],
    [{ node: 'Normalize X result', type: 'main', index: 0 }],
  ],
};
c['Download hero (X)'] = main1('X upload media');
c['X upload media'] = {
  main: [
    [{ node: 'X create tweet', type: 'main', index: 0 }],
    [{ node: 'Normalize X result', type: 'main', index: 0 }],
  ],
};
c['X create tweet'] = {
  main: [
    [{ node: 'Normalize X result', type: 'main', index: 0 }],
    [{ node: 'Normalize X result', type: 'main', index: 0 }],
  ],
};
c['Normalize X result'] = main1('Aggregate results');

fs.writeFileSync(WF, JSON.stringify(w, null, 2) + '\n');
console.log('OK: spliced LinkedIn + X. node count =', w.nodes.length);
