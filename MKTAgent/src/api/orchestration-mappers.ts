// Orchestration mappers — DB row → DTO + clarification answer merge. Kept separate
// from the router (decoupling boundary, like api/mappers.ts) and the GoalSpec
// internal schema.
import type { RunWithNodes } from '../db/repos/workflow-run-repo.ts';
import { goalSpec, type GoalSpec } from '../orchestration/schemas/goal-spec.ts';
import type { ClarificationQuestion } from '../orchestration/master/clarification-engine.ts';
import { parseAccountType } from '../orchestration/master/deterministic-analyzer.ts';
import type { WorkflowRunDto, RequiredActionDto, CostSummaryDto } from './schemas.ts';
import { withCredits } from '../cost/credits.ts';

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
  // Flow-template spend rolled up across its instance runs (Phase 6 dashboard).
  flowCost?: CostSummaryDto;
}

// Sum a run's node token/cost into its own total (Phase 6) + friendly credits (Phase 03).
const runCost = (run: RunWithNodes): CostSummaryDto =>
  withCredits(
    run.nodes.reduce(
      (acc, n) => ({
        promptTokens: acc.promptTokens + (n.promptTokens ?? 0),
        outputTokens: acc.outputTokens + (n.outputTokens ?? 0),
        totalTokens: acc.totalTokens + (n.totalTokens ?? 0),
        costUsd: acc.costUsd + (n.costUsd ?? 0),
      }),
      { promptTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 },
    ),
  );

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
  approvalMode: run.approvalMode === 'atria' ? 'atria' : 'human',
  nodes: run.nodes.map((n) => ({
    nodeId: n.nodeId,
    agentId: n.agentId,
    status: n.status,
    dependsOn: n.dependsOn,
    error: n.error,
    promptTokens: n.promptTokens ?? 0,
    outputTokens: n.outputTokens ?? 0,
    totalTokens: n.totalTokens ?? 0,
    costUsd: n.costUsd ?? 0,
    startedAt: n.startedAt ? n.startedAt.toISOString() : null,
    finishedAt: n.finishedAt ? n.finishedAt.toISOString() : null,
  })),
  artifacts: run.artifacts.map((a) => ({
    id: a.id,
    nodeId: a.nodeId,
    type: a.type,
    data: a.data,
    createdAt: a.createdAt.toISOString(),
  })),
  cost: runCost(run),
  ...(extras.flowCost ? { flowCost: extras.flowCost } : {}),
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
  // A carousel is a multi-image swipe deck → the storyboard produces its slides. It is NOT a
  // single infographic image and NOT a video, so it maps to storyboard-only (assetTypeFromOutputs
  // then resolves it to 'carousel').
  const carousel = /carousel/.test(l);
  goal.outputs.needsTextPost = true;
  // A full multi-platform campaign runs the whole branding flow: ideate → strategy
  // → copy → image. The narrower formats only enable the media they name.
  goal.outputs.needsIdeation = fullCampaign;
  goal.outputs.needsStrategy = fullCampaign;
  goal.outputs.needsInfographic = (/infographic/.test(l) || fullCampaign) && !carousel;
  goal.outputs.needsVideo = /video/.test(l);
  // Storyboard is independent + implied by video AND by a carousel choice. Enable it for an
  // explicit storyboard/carousel choice or any video (planner enforces video ⇒ storyboard too).
  goal.outputs.needsStoryboard = /storyboard/.test(l) || carousel || goal.outputs.needsVideo;
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
