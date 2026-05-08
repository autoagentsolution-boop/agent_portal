import { AlertTriangle, RefreshCw } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './button';
import { extractErrorMessage } from '../../lib/api-client';

export interface ErrorStateProps {
  title?: string;
  error?: unknown;
  onRetry?: () => void;
  isRetrying?: boolean;
  className?: string;
  variant?: 'panel' | 'inline';
}

export function ErrorState({
  title = 'Something went wrong',
  error,
  onRetry,
  isRetrying,
  className,
  variant = 'panel',
}: ErrorStateProps) {
  const message = error ? extractErrorMessage(error, title) : undefined;

  if (variant === 'inline') {
    return (
      <div
        role="alert"
        className={cn(
          'flex items-start gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800',
          className,
        )}
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
        <div className="flex-1">
          <div className="font-medium">{title}</div>
          {message && <div className="mt-0.5 text-xs text-red-700">{message}</div>}
        </div>
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry} disabled={isRetrying}>
            <RefreshCw className={cn('h-3.5 w-3.5', isRetrying && 'animate-spin')} />
            Retry
          </Button>
        )}
      </div>
    );
  }

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-red-200 bg-red-50 px-6 py-10 text-center',
        className,
      )}
    >
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white text-red-600 ring-1 ring-red-200">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <p className="text-sm font-medium text-red-900">{title}</p>
      {message && <p className="mt-1 max-w-md text-xs text-red-700">{message}</p>}
      {onRetry && (
        <Button size="sm" variant="outline" className="mt-4" onClick={onRetry} disabled={isRetrying}>
          <RefreshCw className={cn('h-3.5 w-3.5', isRetrying && 'animate-spin')} />
          {isRetrying ? 'Retrying…' : 'Retry'}
        </Button>
      )}
    </div>
  );
}
