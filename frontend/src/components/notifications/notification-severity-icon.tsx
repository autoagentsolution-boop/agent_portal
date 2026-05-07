import { AlertTriangle, Info, CheckCircle2, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { NotificationSeverity } from '../../lib/types';

const STYLES: Record<NotificationSeverity, { icon: LucideIcon; className: string; label: string }> = {
  critical: { icon: AlertTriangle, className: 'text-red-600',    label: 'Critical' },
  warning:  { icon: AlertTriangle, className: 'text-amber-500',  label: 'Warning' },
  info:     { icon: Info,          className: 'text-sky-600',    label: 'Info' },
  success:  { icon: CheckCircle2,  className: 'text-emerald-600',label: 'Success' },
};

export function NotificationSeverityIcon({
  severity,
  className,
}: {
  severity: NotificationSeverity;
  className?: string;
}) {
  const style = STYLES[severity] ?? STYLES.info;
  const Icon = style.icon;
  return <Icon aria-label={style.label} className={cn('h-4 w-4', style.className, className)} />;
}

export function severityBadgeClass(severity: NotificationSeverity): string {
  switch (severity) {
    case 'critical': return 'bg-red-50 text-red-700 ring-red-200';
    case 'warning':  return 'bg-amber-50 text-amber-700 ring-amber-200';
    case 'success':  return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
    case 'info':
    default:         return 'bg-sky-50 text-sky-700 ring-sky-200';
  }
}
