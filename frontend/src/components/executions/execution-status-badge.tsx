import { Loader2 } from 'lucide-react';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils';
import type { ExecutionStatus } from '../../lib/types';

const TERMINAL: ReadonlySet<ExecutionStatus> = new Set([
  'success',
  'failed',
  'warning',
  'cancelled',
]);

const VARIANT: Record<ExecutionStatus, 'success' | 'warning' | 'danger' | 'info' | 'muted'> = {
  queued: 'muted',
  running: 'info',
  success: 'success',
  warning: 'warning',
  failed: 'danger',
  cancelled: 'muted',
};

export function isTerminal(status: ExecutionStatus | undefined | null): boolean {
  return !!status && TERMINAL.has(status);
}

export interface ExecutionStatusBadgeProps {
  status: ExecutionStatus;
  className?: string;
  withLabel?: boolean;
}

export function ExecutionStatusBadge({
  status,
  className,
  withLabel = true,
}: ExecutionStatusBadgeProps) {
  const animated = status === 'running' || status === 'queued';
  return (
    <Badge variant={VARIANT[status] ?? 'muted'} className={cn('gap-1', className)}>
      {animated && <Loader2 className="h-3 w-3 animate-spin" />}
      {withLabel && status}
    </Badge>
  );
}
