#!/usr/bin/env node
/**
 * Switch the X adapter from $env Bearer token to n8n's predefined Twitter OAuth2
 * credential (auto-refresh via vault). X access tokens live ~2h, so $env re-mint
 * is impractical — the credential handles refresh transparently.
 *
 * Both X HTTP nodes (upload media + create tweet) now authenticate via
 * predefinedCredentialType: twitterOAuth2Api instead of a manual Authorization header.
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

const CRED = { twitterOAuth2Api: { id: '', name: 'DAIS X OAuth2' } }; // id bound on instance after user creates it

for (const id of ['x-upload-media', 'x-create-tweet']) {
  const n = byId(id);
  // route auth through the n8n credential instead of a hand-built Bearer header
  n.parameters.authentication = 'predefinedCredentialType';
  n.parameters.nodeCredentialType = 'twitterOAuth2Api';
  // strip the manual Authorization header; keep Content-Type on create-tweet
  if (n.parameters.headerParameters && n.parameters.headerParameters.parameters) {
    n.parameters.headerParameters.parameters = n.parameters.headerParameters.parameters.filter(
      (p) => String(p.name).toLowerCase() !== 'authorization'
    );
    if (n.parameters.headerParameters.parameters.length === 0) {
      delete n.parameters.headerParameters;
      n.parameters.sendHeaders = false;
    }
  }
  n.credentials = CRED;
}

fs.writeFileSync(WF, JSON.stringify(w, null, 2) + '\n');
console.log('OK: X adapter now uses predefinedCredentialType twitterOAuth2Api (auto-refresh vault).');
console.log('Bind the real credential id on the instance after the user creates "DAIS X OAuth2".');
