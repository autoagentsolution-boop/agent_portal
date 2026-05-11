import { useMemo, useState, type KeyboardEvent } from 'react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { cn } from '../../lib/utils';
import type { ConfigSchema, FieldSchema } from '../../lib/types';
import type { FieldError } from './wizard-validation';

interface DynamicConfigFormProps {
  schema: ConfigSchema;
  values: Record<string, unknown>;
  errors: FieldError[];
  onChange: (key: string, value: unknown) => void;
}

export function DynamicConfigForm({ schema, values, errors, onChange }: DynamicConfigFormProps) {
  const errorMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of errors) m[e.field] = e.message;
    return m;
  }, [errors]);

  const entries = Object.entries(schema);
  if (entries.length === 0) {
    return <p className="text-sm text-gray-500">This template has no configurable fields.</p>;
  }

  return (
    <div className="grid gap-4">
      {entries.map(([key, field]) => (
        <FieldRow
          key={key}
          fieldKey={key}
          field={field}
          value={values[key]}
          error={errorMap[key]}
          onChange={(v) => onChange(key, v)}
        />
      ))}
    </div>
  );
}

interface FieldRowProps {
  fieldKey: string;
  field: FieldSchema;
  value: unknown;
  error: string | undefined;
  onChange: (value: unknown) => void;
}

function FieldRow({ fieldKey, field, value, error, onChange }: FieldRowProps) {
  const id = `cfg-${fieldKey}`;
  const isSelect = field.type === 'select' || (field.enum && field.enum.length > 0);

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>
        {field.label}
        {field.required && <span className="ml-0.5 text-red-500">*</span>}
      </Label>

      {isSelect ? (
        <select
          id={id}
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            'h-9 w-full rounded-md border bg-white px-3 py-1 text-sm shadow-sm',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400',
            error ? 'border-red-400' : 'border-gray-300',
          )}
        >
          <option value="" disabled>
            Select…
          </option>
          {(field.enum ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : field.type === 'boolean' ? (
        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
          <input
            id={id}
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-400"
          />
          <span className="text-xs text-gray-500">Enabled</span>
        </label>
      ) : field.type === 'array' ? (
        <ArrayInput
          id={id}
          value={Array.isArray(value) ? (value as Array<string | number>) : []}
          itemType={field.itemType ?? 'string'}
          maxItems={field.maxItems}
          onChange={onChange}
          error={Boolean(error)}
        />
      ) : field.type === 'textarea' ? (
        <textarea
          id={id}
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          className={cn(
            'w-full rounded-md border bg-white px-3 py-2 text-sm shadow-sm',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400',
            error ? 'border-red-400' : 'border-gray-300',
          )}
        />
      ) : field.type === 'number' ? (
        <Input
          id={id}
          type="number"
          value={value === undefined || value === null ? '' : String(value)}
          min={field.min}
          max={field.max}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === '' ? '' : Number(v));
          }}
          className={cn(error && 'border-red-400')}
        />
      ) : (
        <Input
          id={id}
          type="text"
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value)}
          className={cn(error && 'border-red-400')}
        />
      )}

      {(field.min !== undefined || field.max !== undefined) && field.type === 'number' && (
        <span className="text-xs text-gray-400">
          Range: {field.min ?? '−∞'} — {field.max ?? '∞'}
        </span>
      )}
      {field.type === 'array' && (field.minItems !== undefined || field.maxItems !== undefined) && (
        <span className="text-xs text-gray-400">
          {field.minItems !== undefined && field.maxItems !== undefined
            ? `${field.minItems}–${field.maxItems} items`
            : field.minItems !== undefined
              ? `Min ${field.minItems} item${field.minItems === 1 ? '' : 's'}`
              : `Max ${field.maxItems} items`}
        </span>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

interface ArrayInputProps {
  id: string;
  value: Array<string | number>;
  itemType: 'string' | 'number';
  maxItems?: number;
  onChange: (next: Array<string | number>) => void;
  error: boolean;
}

function ArrayInput({ id, value, itemType, maxItems, onChange, error }: ArrayInputProps) {
  const [draft, setDraft] = useState('');
  const atCapacity = maxItems !== undefined && value.length >= maxItems;

  const add = () => {
    if (atCapacity) return;
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (itemType === 'number') {
      const num = Number(trimmed);
      if (Number.isNaN(num)) return;
      onChange([...value, num]);
    } else {
      if (value.includes(trimmed)) {
        setDraft('');
        return;
      }
      onChange([...value, trimmed]);
    }
    setDraft('');
  };

  const remove = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      e.preventDefault();
      remove(value.length - 1);
    }
  };

  return (
    <div
      className={cn(
        'rounded-md border bg-white px-2 py-1.5 shadow-sm',
        error ? 'border-red-400' : 'border-gray-300',
      )}
    >
      {value.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1.5">
          {value.map((v, i) => (
            <span
              key={`${i}-${String(v)}`}
              className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
            >
              {String(v)}
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`Remove ${String(v)}`}
                className="text-gray-400 hover:text-gray-900"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1">
        <input
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={add}
          placeholder={atCapacity ? 'Max items reached' : 'Type and press Enter…'}
          disabled={atCapacity}
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400 disabled:cursor-not-allowed"
          inputMode={itemType === 'number' ? 'decimal' : 'text'}
        />
        <button
          type="button"
          onClick={add}
          disabled={atCapacity || draft.trim() === ''}
          className="text-xs text-gray-500 hover:text-gray-900 disabled:cursor-not-allowed disabled:text-gray-300"
        >
          Add
        </button>
      </div>
    </div>
  );
}
