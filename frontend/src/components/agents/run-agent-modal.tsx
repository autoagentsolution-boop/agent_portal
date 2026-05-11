import { useEffect, useMemo, useState } from 'react';
import { X, Play, RotateCcw } from 'lucide-react';
import { Button } from '../ui/button';
import { DynamicConfigForm } from '../wizard/dynamic-config-form';
import { extractErrorMessage } from '../../lib/api-client';
import { diffOverrides, formatValuePreview } from '../../lib/overrides-diff';
import type { ConfigSchema, FieldSchema } from '../../lib/types';
import type { FieldError } from '../wizard/wizard-validation';

interface RunAgentModalProps {
  open: boolean;
  agentName: string;
  agentConfig: Record<string, unknown>;
  templateSchema: ConfigSchema;
  overridableFields: string[];
  defaultOverrides?: Record<string, unknown> | null;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (overrides: Record<string, unknown>) => Promise<void>;
}

export function RunAgentModal(props: RunAgentModalProps) {
  const {
    open,
    agentName,
    agentConfig,
    templateSchema,
    overridableFields,
    defaultOverrides,
    isSubmitting,
    onClose,
    onSubmit,
  } = props;

  const overridableSchema = useMemo<ConfigSchema>(() => {
    const out: ConfigSchema = {};
    for (const k of overridableFields) {
      const field = templateSchema[k];
      if (field) out[k] = field;
    }
    return out;
  }, [templateSchema, overridableFields]);

  const initialValues = useMemo(() => {
    const base: Record<string, unknown> = {};
    for (const k of overridableFields) {
      base[k] = defaultOverrides && k in defaultOverrides ? defaultOverrides[k] : agentConfig[k];
    }
    return base;
  }, [overridableFields, agentConfig, defaultOverrides]);

  const [values, setValues] = useState<Record<string, unknown>>(initialValues);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValues(initialValues);
      setErrors([]);
      setSubmitError(null);
    }
  }, [open, initialValues]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, isSubmitting, onClose]);

  if (!open) return null;

  const overrideDiff = diffOverrides(agentConfig, values, overridableFields);
  const hasOverrides = Object.keys(overrideDiff).length > 0;

  function resetField(key: string) {
    setValues((v) => ({ ...v, [key]: agentConfig[key] }));
  }

  function resetAll() {
    setValues(initialValues);
  }

  async function handleSubmit() {
    setSubmitError(null);
    setErrors([]);
    try {
      await onSubmit(overrideDiff);
    } catch (err) {
      const data = (err as { response?: { data?: { details?: FieldError[]; message?: string } } })
        .response?.data;
      if (data?.details && Array.isArray(data.details)) {
        setErrors(data.details);
      }
      setSubmitError(extractErrorMessage(err, 'Run failed'));
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Run ${agentName}`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-lg bg-white shadow-xl flex flex-col">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Run {agentName}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Tweak overridable parameters for this run only — agent defaults stay untouched.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {Object.keys(overridableSchema).length === 0 ? (
            <p className="text-sm text-gray-500">
              This template exposes no overridable fields. The run will use the agent's saved defaults.
            </p>
          ) : (
            <>
              <DynamicConfigForm
                schema={overridableSchema}
                values={values}
                errors={errors}
                onChange={(k, v) => setValues((cur) => ({ ...cur, [k]: v }))}
              />
              <DefaultsHint
                schema={overridableSchema}
                agentConfig={agentConfig}
                values={values}
                onResetField={resetField}
              />
            </>
          )}
          {submitError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {submitError}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-5 py-3">
          <div className="text-xs text-gray-500">
            {hasOverrides ? (
              <span>
                <strong>{Object.keys(overrideDiff).length}</strong> override
                {Object.keys(overrideDiff).length === 1 ? '' : 's'} applied
              </span>
            ) : (
              <span>No overrides — running with defaults</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {hasOverrides && (
              <Button variant="ghost" size="sm" onClick={resetAll} disabled={isSubmitting}>
                <RotateCcw className="h-3.5 w-3.5" />
                Reset all
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSubmit} disabled={isSubmitting}>
              <Play className="h-3.5 w-3.5" />
              {isSubmitting ? 'Starting…' : 'Run Now'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface DefaultsHintProps {
  schema: ConfigSchema;
  agentConfig: Record<string, unknown>;
  values: Record<string, unknown>;
  onResetField: (key: string) => void;
}

function DefaultsHint({ schema, agentConfig, values, onResetField }: DefaultsHintProps) {
  const dirty = Object.keys(schema).filter(
    (k) => JSON.stringify(agentConfig[k]) !== JSON.stringify(values[k]),
  );
  if (dirty.length === 0) return null;
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 space-y-1.5">
      <div className="text-xs font-medium text-amber-900">Modified fields</div>
      {dirty.map((k) => (
        <div key={k} className="flex items-center justify-between text-xs text-amber-900">
          <span>
            <code className="font-mono">{k}</code>: default ={' '}
            <code className="font-mono">{formatValuePreview(agentConfig[k] ?? (schema[k] as FieldSchema).default)}</code>
          </span>
          <button
            type="button"
            onClick={() => onResetField(k)}
            className="text-xs text-amber-800 underline hover:text-amber-900"
          >
            Reset
          </button>
        </div>
      ))}
    </div>
  );
}
