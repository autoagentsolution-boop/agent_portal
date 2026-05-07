import { useState } from 'react';
import { Check, X, MailCheck, MailX, Clock } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Alert } from '../ui/alert';
import { useDraftApproval } from '../../hooks/use-approval';
import { extractErrorMessage } from '../../lib/api-client';

type ApprovalStatus = 'waiting_for_review' | 'approved' | 'rejected' | string;

interface Draft {
  from?: string | null;
  original_subject?: string | null;
  subject?: string;
  body?: string;
  approval_status?: ApprovalStatus;
}

interface EmailDraftPayload {
  drafts?: Draft[];
  summary?: string;
  items_processed?: number;
}

interface EmailDraftOutput extends EmailDraftPayload {
  data?: EmailDraftPayload;
}

export interface EmailDraftApprovalViewProps {
  executionId: string;
  output: unknown;
}

const STATUS_VARIANT: Record<string, 'success' | 'danger' | 'warning' | 'muted'> = {
  approved: 'success',
  rejected: 'danger',
  waiting_for_review: 'warning',
};

const STATUS_ICON = {
  approved: MailCheck,
  rejected: MailX,
  waiting_for_review: Clock,
} as const;

export function EmailDraftApprovalView({ executionId, output }: EmailDraftApprovalViewProps) {
  const root = (output ?? {}) as EmailDraftOutput;
  const data: EmailDraftPayload = root.data ?? root;
  const drafts = Array.isArray(data.drafts) ? data.drafts : [];

  if (drafts.length === 0) {
    return <p className="text-sm text-gray-500">No drafts in this execution.</p>;
  }

  const pendingCount = drafts.filter(
    (d) => (d.approval_status ?? 'waiting_for_review') === 'waiting_for_review',
  ).length;

  return (
    <div className="space-y-4">
      {data.summary && (
        <p className="rounded bg-gray-50 px-3 py-2 text-sm text-gray-700 ring-1 ring-gray-200">
          {data.summary}
          {pendingCount > 0 && (
            <span className="ml-2 text-xs text-gray-500">
              ({pendingCount} of {drafts.length} pending)
            </span>
          )}
        </p>
      )}
      <div className="space-y-3">
        {drafts.map((draft, idx) => (
          <DraftCard key={idx} executionId={executionId} draft={draft} index={idx} />
        ))}
      </div>
    </div>
  );
}

function DraftCard({
  executionId,
  draft,
  index,
}: {
  executionId: string;
  draft: Draft;
  index: number;
}) {
  const status: ApprovalStatus = draft.approval_status ?? 'waiting_for_review';
  const variant = STATUS_VARIANT[status] ?? 'muted';
  const Icon = STATUS_ICON[status as keyof typeof STATUS_ICON] ?? Clock;
  const pending = status === 'waiting_for_review';

  const approval = useDraftApproval();
  const [error, setError] = useState<string | null>(null);

  async function act(action: 'approve' | 'reject') {
    setError(null);
    try {
      await approval.mutateAsync({ executionId, action, draftIndex: index });
    } catch (e) {
      setError(extractErrorMessage(e, `${action} failed`));
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Badge variant={variant} className="gap-1">
              <Icon className="h-3 w-3" />
              {status.replace(/_/g, ' ')}
            </Badge>
            {draft.from && (
              <span className="text-xs text-gray-500 truncate">to: {draft.from}</span>
            )}
          </div>
          <div className="mt-1.5 truncate text-sm font-medium text-gray-900">
            {draft.subject || '(no subject)'}
          </div>
          {draft.original_subject && (
            <div className="text-xs text-gray-400">
              Re: {draft.original_subject}
            </div>
          )}
        </div>
        {pending && (
          <div className="flex shrink-0 gap-1.5">
            <Button
              size="sm"
              onClick={() => act('approve')}
              disabled={approval.isPending}
            >
              <Check className="h-3.5 w-3.5" />
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => act('reject')}
              disabled={approval.isPending}
            >
              <X className="h-3.5 w-3.5" />
              Reject
            </Button>
          </div>
        )}
      </div>
      <div className="px-4 py-3">
        <pre className="whitespace-pre-wrap font-sans text-sm leading-6 text-gray-700">
          {draft.body || '(empty body)'}
        </pre>
      </div>
      {error && (
        <div className="border-t border-gray-100 px-4 py-2">
          <Alert variant="destructive">{error}</Alert>
        </div>
      )}
    </div>
  );
}
