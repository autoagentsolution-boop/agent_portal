#!/usr/bin/env node
/**
 * Re-point the LinkedIn adapter from the versioned /rest/* gateway (Community
 * Management API — gated to legal entities) to the free consumer "Share on
 * LinkedIn" path (/v2/assets registerUpload + /v2/ugcPosts) which needs only
 * the w_member_social scope. Personal-feed posting, no company verification.
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

// uploadMechanism key carries a dotted type name -> bracket access in expression.
const UPLOAD_URL_EXPR =
  "={{ $('LI init upload').item.json.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl }}";

// 1) register upload (v2 assets)
const init = byId('li-init-upload');
init.parameters.url = 'https://api.linkedin.com/v2/assets?action=registerUpload';
init.parameters.headerParameters.parameters = [
  { name: 'Authorization', value: '=Bearer {{$env.MKT_LINKEDIN_ACCESS_TOKEN}}' },
  { name: 'X-Restli-Protocol-Version', value: '2.0.0' },
];
init.parameters.jsonBody =
  "={{ JSON.stringify({ registerUploadRequest: { recipes: ['urn:li:digitalmediaRecipe:feedshare-image'], owner: $json.owner, serviceRelationships: [{ relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' }] } }) }}";

// 2) binary upload -> uploadMechanism.uploadUrl
const up = byId('li-upload-binary');
up.parameters.url = UPLOAD_URL_EXPR;

// 3) create post (v2 ugcPosts)
const post = byId('li-create-post');
post.parameters.url = 'https://api.linkedin.com/v2/ugcPosts';
post.parameters.headerParameters.parameters = [
  { name: 'Authorization', value: '=Bearer {{$env.MKT_LINKEDIN_ACCESS_TOKEN}}' },
  { name: 'X-Restli-Protocol-Version', value: '2.0.0' },
];
post.parameters.jsonBody =
  "={{ JSON.stringify({ author: $('Build LinkedIn request').item.json.owner, lifecycleState: 'PUBLISHED', specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text: $('Build LinkedIn request').item.json.commentary }, shareMediaCategory: 'IMAGE', media: [ { status: 'READY', media: $('LI init upload').item.json.value.asset, title: { text: ($('Build LinkedIn request').item.json.product || 'image') } } ] } }, visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' } }) }}";

// Normalize already reads X-RestLi-Id header (same for v2) + URN -> feed URL. No change.

fs.writeFileSync(WF, JSON.stringify(w, null, 2) + '\n');
console.log('OK: LinkedIn adapter re-pointed to /v2 ugcPosts (free personal-feed path).');
