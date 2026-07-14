// Artifact → human-readable view model. Replaces the raw JSON.stringify dump with a
// clean per-type rendering (the feedback: don't show users JSON). Each artifact type
// maps to a title + a list of labeled text fields, plus an optional image URL for the
// infographic. Defensive: artifact.data is unknown (server-validated but typed loose
// at the API boundary), so every accessor is guarded.
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

// imageRef is an AssetStore ref: `local:<abspath>/<hash>.png`. The server serves the
// image dir at /media/images, so map to /media/images/<basename>. Non-local refs
// (future remote URLs) pass through. Returns null when there's no usable ref.
export const imageUrlFromRef = (ref: unknown): string | null => {
  if (typeof ref !== 'string' || !ref) return null;
  if (ref.startsWith('local:')) {
    const file = ref.slice('local:'.length).replace(/\\/g, '/').split('/').pop();
    return file ? `${API_BASE}/media/images/${file}` : null;
  }
  if (/^https?:\/\//.test(ref)) return ref;
  return null;
};

// videoRef `local:<abspath>/<hash>.mp4` → /media/videos/<basename> (served static).
export const videoUrlFromRef = (ref: unknown): string | null => {
  if (typeof ref !== 'string' || !ref) return null;
  if (ref.startsWith('local:')) {
    const file = ref.slice('local:'.length).replace(/\\/g, '/').split('/').pop();
    return file ? `${API_BASE}/media/videos/${file}` : null;
  }
  if (/^https?:\/\//.test(ref)) return ref;
  return null;
};

export interface ArtifactField { label: string; value: string }
export interface ArtifactView {
  title: string;
  fields: ArtifactField[];
  imageUrl?: string | null;
  imageUrls?: string[]; // storyboard gallery
  videoUrl?: string | null; // rendered video
}

const ARTIFACT_TITLES: Record<string, string> = {
  campaign_ideas: 'Campaign ideas',
  strategy_brief: 'Strategy brief',
  research_summary: 'Research summary',
  content_concept: 'Content & copy',
  infographic_brief: 'Infographic',
  storyboard: 'Storyboard',
  video_prompt: 'Video',
  publish_result: 'Publish result',
  content_calendar: 'Content calendar',
  summary: 'Summary',
  security_scan: 'Data protection scan',
};

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const list = (v: unknown): string => (Array.isArray(v) ? v.map(str).filter(Boolean).join('\n• ') : '');

export const formatArtifact = (type: string, data: unknown): ArtifactView => {
  const d = (data ?? {}) as Record<string, unknown>;
  const title = ARTIFACT_TITLES[type] ?? type.replace(/_/g, ' ');

  switch (type) {
    case 'campaign_ideas':
      return { title, fields: [
        { label: 'Chosen', value: str(d.chosen) },
        { label: 'Ideas', value: '• ' + list(d.ideas) },
      ].filter((f) => f.value.trim()) };
    case 'strategy_brief':
      return { title, fields: [
        { label: 'Positioning', value: str(d.positioning) },
        { label: 'Audience', value: str(d.audience) },
        { label: 'Funnel stage', value: str(d.funnelStage) },
        { label: 'Pillars', value: '• ' + list(d.pillars) },
      ].filter((f) => f.value.trim()) };
    case 'research_summary':
      return { title, fields: [
        { label: 'Summary', value: str(d.summary) },
        { label: 'Sources', value: '• ' + list(d.sourceNotes) },
      ].filter((f) => f.value.trim()) };
    case 'content_concept': {
      const copy = (d.copy ?? {}) as Record<string, unknown>;
      return { title, fields: [
        { label: 'Angle', value: str(d.mainAngle) },
        { label: 'Key message', value: str(d.keyMessage) },
        { label: 'Post body', value: str(copy.body) },
        { label: 'Threads', value: str(copy.threads) },
        { label: 'X', value: str(copy.x) },
      ].filter((f) => f.value.trim()) };
    }
    case 'infographic_brief':
      return {
        title,
        imageUrl: imageUrlFromRef(d.imageRef),
        fields: [
          { label: 'Visual brief', value: str(d.visualBrief) },
          { label: 'Image prompt', value: str(d.imagePrompt) },
        ].filter((f) => f.value.trim()),
      };
    case 'storyboard': {
      const frames = Array.isArray(d.frames) ? (d.frames as Array<Record<string, unknown>>) : [];
      const imageUrls = frames.map((f) => imageUrlFromRef(f.imageRef)).filter((u): u is string => Boolean(u));
      const captions = frames.map((f, i) => `${i + 1}. ${str(f.caption)}`).filter((c) => c.trim().length > 3);
      return {
        title,
        imageUrls,
        fields: captions.length ? [{ label: 'Frames', value: captions.join('\n') }] : [],
      };
    }
    case 'video_prompt':
      return {
        title,
        videoUrl: videoUrlFromRef(d.videoRef),
        fields: [
          { label: 'Duration', value: d.durationSec ? `${str(d.durationSec)}s` : '' },
          { label: 'Clips', value: d.clipCount ? `${str(d.clipCount)}` : '' },
        ].filter((f) => f.value.trim()),
      };
    case 'content_calendar': {
      const slots = Array.isArray(d.slots) ? (d.slots as Array<Record<string, unknown>>) : [];
      const lines = slots.map((s, i) => `${i + 1}. [${str(s.format)}] ${str(s.pillar)} — ${str(s.angle)} (${Array.isArray(s.platforms) ? (s.platforms as unknown[]).map(str).join(', ') : ''})`);
      return { title, fields: lines.length ? [{ label: `${slots.length} planned posts`, value: lines.join('\n') }] : [] };
    }
    case 'publish_result': {
      const urls = (d.postUrls ?? null) as Record<string, string> | null;
      const urlLines = urls ? Object.entries(urls).map(([p, u]) => `• ${p}: ${u}`).join('\n') : '';
      return { title, fields: [
        { label: 'Status', value: str(d.status) },
        { label: 'Posts', value: urlLines },
        { label: 'Error', value: str(d.error) },
      ].filter((f) => f.value.trim()) };
    }
    case 'summary':
      return { title, fields: [
        { label: 'Summary', value: str(d.summary) },
        { label: 'Key points', value: '• ' + list(d.bullets) },
      ].filter((f) => f.value.trim()) };
    case 'security_scan': {
      const findings = Array.isArray(d.findings) ? (d.findings as Array<Record<string, unknown>>) : [];
      const lines = findings.map((f) => `[${str(f.category).toUpperCase()}] ${str(f.count) || '1'}× — e.g. ${str(f.example)}`);
      return { title, fields: [
        { label: 'Sensitive data', value: d.hasSensitive ? 'Detected & masked' : 'None detected' },
        { label: 'Notice', value: str(d.notice) },
        { label: 'Findings', value: lines.length ? lines.join('\n• ').replace(/^/, '• ') : '' },
      ].filter((f) => f.value.trim()) };
    }
    default:
      return { title, fields: Object.entries(d).map(([k, v]) => ({ label: k, value: str(v) })).filter((f) => f.value.trim()) };
  }
};
