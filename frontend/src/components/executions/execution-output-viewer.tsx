import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import { EmailDraftApprovalView } from './email-draft-approval';

export interface ExecutionOutputViewerProps {
  templateId?: string | null;
  executionId?: string;
  output: unknown;
}

export function ExecutionOutputViewer({
  templateId,
  executionId,
  output,
}: ExecutionOutputViewerProps) {
  if (output == null) {
    return <p className="text-sm text-gray-500">No output recorded.</p>;
  }
  if (templateId === 'email-draft-responder' && executionId) {
    return <EmailDraftApprovalView executionId={executionId} output={output} />;
  }
  return <JsonTree value={output} initialDepth={2} />;
}

interface JsonTreeProps {
  value: unknown;
  name?: string;
  depth?: number;
  initialDepth?: number;
}

function JsonTree({ value, name, depth = 0, initialDepth = 1 }: JsonTreeProps) {
  if (value === null) return <Leaf name={name} text="null" tone="muted" />;
  if (value === undefined) return <Leaf name={name} text="undefined" tone="muted" />;
  if (typeof value === 'string') return <Leaf name={name} text={`"${value}"`} tone="string" />;
  if (typeof value === 'number') return <Leaf name={name} text={String(value)} tone="number" />;
  if (typeof value === 'boolean') return <Leaf name={name} text={String(value)} tone="boolean" />;

  if (Array.isArray(value)) {
    return (
      <Collapsible
        name={name}
        summary={`Array(${value.length})`}
        defaultOpen={depth < initialDepth}
      >
        {value.map((item, i) => (
          <JsonTree
            key={i}
            name={String(i)}
            value={item}
            depth={depth + 1}
            initialDepth={initialDepth}
          />
        ))}
      </Collapsible>
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return (
      <Collapsible
        name={name}
        summary={`Object(${entries.length})`}
        defaultOpen={depth < initialDepth}
      >
        {entries.map(([k, v]) => (
          <JsonTree
            key={k}
            name={k}
            value={v}
            depth={depth + 1}
            initialDepth={initialDepth}
          />
        ))}
      </Collapsible>
    );
  }

  return <Leaf name={name} text={String(value)} />;
}

function Leaf({
  name,
  text,
  tone = 'default',
}: {
  name?: string;
  text: string;
  tone?: 'default' | 'string' | 'number' | 'boolean' | 'muted';
}) {
  const toneClass =
    tone === 'string'
      ? 'text-emerald-700'
      : tone === 'number'
        ? 'text-indigo-700'
        : tone === 'boolean'
          ? 'text-amber-700'
          : tone === 'muted'
            ? 'text-gray-400'
            : 'text-gray-700';
  return (
    <div className="font-mono text-xs leading-5 pl-4">
      {name !== undefined && <span className="text-gray-500">{name}: </span>}
      <span className={toneClass}>{text}</span>
    </div>
  );
}

function Collapsible({
  name,
  summary,
  defaultOpen,
  children,
}: {
  name?: string;
  summary: string;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="font-mono text-xs leading-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-left text-gray-700 hover:text-gray-900"
      >
        <ChevronRight
          className={cn('h-3 w-3 transition-transform', open && 'rotate-90')}
        />
        {name !== undefined && <span className="text-gray-500">{name}: </span>}
        <span className="text-gray-500">{summary}</span>
      </button>
      {open && <div className="border-l border-gray-200 ml-1.5 pl-2">{children}</div>}
    </div>
  );
}
