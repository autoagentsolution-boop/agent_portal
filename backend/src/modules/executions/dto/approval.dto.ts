import { z } from 'zod';

export const ApprovalSchema = z.object({
  action: z.enum(['approve', 'reject']),
  draftIndex: z.number().int().nonnegative().optional(),
  note: z.string().max(500).optional(),
});

export type ApprovalDto = z.infer<typeof ApprovalSchema>;

export const EMAIL_DRAFT_TEMPLATE_ID = 'email-draft-responder';
export const APPROVAL_PENDING = 'waiting_for_review';
export const APPROVAL_APPROVED = 'approved';
export const APPROVAL_REJECTED = 'rejected';
