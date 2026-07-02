// Orchestration mappers — DB row → DTO + clarification answer merge. Kept separate
// from the router (decoupling boundary, like api/mappers.ts) and the GoalSpec
// internal schema.
import type { RunWithNodes } from '../db/repos/workflow-run-repo.ts';
import { goalSpec, type GoalSpec } from '../orchestration/schemas/goal-spec.ts';
import type { ClarificationQuestion } from '../orchestration/master/clarification-engine.ts';
import { parseAccountType } from '../orchestration/master/deterministic-analyzer.ts';
import type { WorkflowRunDto, RequiredActionDto } from './schemas.ts';

export type ClarifyQuestions = ClarificationQuestion[];

export interface RunDtoExtras {
  questions?: ClarifyQuestions;
  assistantMessage?: string;
  // Connection Resolver output — present when the run is gated as needs_connection.
  requiredActions?: RequiredActionDto[];
  // True when a saved-flow chat message created a campaign under the flow (item 2).
  campaignIntent?: boolean;
  createdCampaignId?: string;
  createdPostId?: string;
}

export const toRunDto = (run: RunWithNodes, extras: RunDtoExtras = {}): WorkflowRunDto => ({
  id: run.id,
  status: run.status,
  kind: run.kind === 'template' ? 'template' : 'instance',
  locked: run.locked,
  name: run.name ?? null,
  goal: run.goal,
  plan: run.plan ?? null,
  chatSessionId: run.chatSessionId ?? null,
  ...(extras.questions ? { questions: extras.questions } : {}),
  ...(extras.assistantMessage ? { assistantMessage: extras.assistantMessage } : {}),
  ...(extras.requiredActions ? { requiredActions: extras.requiredActions } : {}),
  ...(extras.campaignIntent ? { campaignIntent: extras.campaignIntent } : {}),
  ...(extras.createdCampaignId ? { createdCampaignId: extras.createdCampaignId } : {}),
  ...(extras.createdPostId ? { createdPostId: extras.createdPostId } : {}),
  nodes: run.nodes.map((n) => ({
    nodeId: n.nodeId,
    agentId: n.agentId,
    status: n.status,
    dependsOn: n.dependsOn,
    error: n.error,
  })),
  artifacts: run.artifacts.map((a) => ({
    id: a.id,
    nodeId: a.nodeId,
    type: a.type,
    data: a.data,
    createdAt: a.createdAt.toISOString(),
  })),
  createdAt: run.createdAt.toISOString(),
  updatedAt: run.updatedAt.toISOString(),
});

// Merge clarification answers (slot → value) into a prior GoalSpec. The slot keys
// match clarification-engine's question slots (product, output_format, platforms,
// targetAudience, angle). output_format maps the multiple-choice label → flags.
const first = (v: string | string[]): string => (Array.isArray(v) ? (v[0] ?? '') : v);

const applyOutputFormat = (goal: GoalSpec, label: string): void => {
  const l = label.toLowerCase();
  const fullCampaign = /campaign/.test(l);
  goal.outputs.needsTextPost = true;
  // A full multi-platform campaign runs the whole branding flow: ideate → strategy
  // → copy → image. The narrower formats only enable the media they name.
  goal.outputs.needsIdeation = fullCampaign;
  goal.outputs.needsStrategy = fullCampaign;
  goal.outputs.needsInfographic = /infographic/.test(l) || fullCampaign;
  goal.outputs.needsVideo = /video/.test(l);
  // Storyboard is independent + implied by video. Enable it for an explicit storyboard
  // choice or any video (the planner also enforces video ⇒ storyboard as a backstop).
  goal.outputs.needsStoryboard = /storyboard/.test(l) || goal.outputs.needsVideo;
  goal.outputs.needsPublishing = true;
};

export const mergeAnswers = (
  prior: GoalSpec,
  answers: Record<string, string | string[]>,
): GoalSpec => {
  // Clone via the schema so we never mutate the stored object reference.
  const goal = goalSpec.parse(prior);
  for (const [slot, value] of Object.entries(answers)) {
    switch (slot) {
      case 'product':
        goal.slots.product = first(value);
        break;
      case 'productDetails':
        goal.slots.productDetails = first(value);
        break;
      case 'accountType': {
        // Answer is a localized choice label (cá nhân/thương hiệu/công ty) or free
        // text — map through the same parser the analyzer uses so the enum is consistent.
        const mapped = parseAccountType(first(value));
        if (mapped) goal.slots.accountType = mapped;
        break;
      }
      case 'targetAudience':
        goal.slots.targetAudience = first(value);
        break;
      case 'angle':
        goal.slots.angle = first(value);
        break;
      case 'platforms': {
        const arr = (Array.isArray(value) ? value : [value]).filter(Boolean);
        const valid = arr.filter((p) => ['facebook', 'instagram', 'threads', 'linkedin', 'x'].includes(p)) as GoalSpec['platforms'];
        if (valid.length) goal.platforms = valid;
        break;
      }
      case 'output_format':
        applyOutputFormat(goal, first(value));
        break;
      default:
        break; // unknown slot → ignore (forward-compatible)
    }
  }
  return goal;
};
