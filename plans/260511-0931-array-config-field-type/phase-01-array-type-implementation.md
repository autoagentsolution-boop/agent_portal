# Phase 01 — Array Type End-to-End

**Status:** pending | **Effort:** 2-3h | **Owner:** Mixed BE+FE

## Context Links

- Parent plan: `plans/260511-0931-array-config-field-type/plan.md`
- Override pipeline (Phase 01-03 prior): `plans/260511-0825-runtime-parameter-override/`
- Validator: `backend/src/utils/config-schema-validator.ts`
- Override validator: `backend/src/utils/overrides-validator.ts` (no change needed — chains to validateConfig)
- Form: `frontend/src/components/wizard/dynamic-config-form.tsx`
- Seed: `backend/prisma/seed.ts`
- n8n workflow: `n8n-workflows/gmail-lead-classifier.json` (verify exact path during impl)

## Implementation order (CRITICAL — follow exactly)

```
1. BE validator + types          ← deploy first (backward compat: array type added but unused)
2. FE types + form renderer       ← deploy second (UI ready before data)
3. Data migration script (one-shot) ← run once on running DB
4. Seed update (gmail_labels)     ← re-seed
5. n8n workflow JSON              ← re-import
6. Smoke verify
```

## Step-by-step

### 1. Backend validator

`backend/src/utils/config-schema-validator.ts`:

```ts
export interface FieldSchema {
  type: 'string' | 'number' | 'boolean' | 'select' | 'textarea' | 'array';
  label: string;
  required?: boolean;
  default?: unknown;
  min?: number;
  max?: number;
  enum?: string[];
  // Array-specific
  itemType?: 'string' | 'number';
  minItems?: number;
  maxItems?: number;
}
```

Add to `validateConfig`:

```ts
if (fieldSchema.type === 'array') {
  if (!Array.isArray(effectiveValue)) {
    errors.push({ field: key, message: `${fieldSchema.label} must be an array` });
    continue;
  }
  const itemType = fieldSchema.itemType ?? 'string';
  for (let i = 0; i < effectiveValue.length; i++) {
    const item = effectiveValue[i];
    if (itemType === 'string' && typeof item !== 'string') {
      errors.push({ field: key, message: `${fieldSchema.label}[${i}] must be a string` });
    }
    if (itemType === 'number' && typeof item !== 'number') {
      errors.push({ field: key, message: `${fieldSchema.label}[${i}] must be a number` });
    }
  }
  if (fieldSchema.minItems !== undefined && effectiveValue.length < fieldSchema.minItems) {
    errors.push({ field: key, message: `${fieldSchema.label} requires at least ${fieldSchema.minItems} items` });
  }
  if (fieldSchema.maxItems !== undefined && effectiveValue.length > fieldSchema.maxItems) {
    errors.push({ field: key, message: `${fieldSchema.label} accepts at most ${fieldSchema.maxItems} items` });
  }
}
```

Also: required + array → reject empty `[]` (treat empty as "no value"). Already handled by existing `hasValue` logic if `effectiveValue.length === 0`. Verify and adjust:

```ts
const hasValue = value !== undefined && value !== null && value !== '' &&
                 !(Array.isArray(value) && value.length === 0);
```

### 2. Backend tests

`backend/src/utils/config-schema-validator.spec.ts` (new file or extend existing):

```ts
describe('validateConfig — array type', () => {
  const schema: ConfigSchema = {
    labels: { type: 'array', itemType: 'string', label: 'Labels', required: true, minItems: 1 },
  };
  it('accepts valid string array', () => expect(validateConfig({ labels: ['a','b'] }, schema)).toEqual([]));
  it('rejects empty when required', () => expect(validateConfig({ labels: [] }, schema)).toHaveLength(1));
  it('rejects non-string items', () => expect(validateConfig({ labels: [1,2] }, schema)).toHaveLength(2));
  it('rejects non-array', () => expect(validateConfig({ labels: 'x' }, schema)).toHaveLength(1));
  // Add maxItems test
});
```

### 3. Frontend types

`frontend/src/lib/types.ts`:

```ts
export interface FieldSchema {
  type: 'string' | 'number' | 'boolean' | 'select' | 'textarea' | 'array';
  label: string;
  required?: boolean;
  default?: unknown;
  min?: number;
  max?: number;
  enum?: string[];
  itemType?: 'string' | 'number';
  minItems?: number;
  maxItems?: number;
}
```

### 4. Frontend tag input renderer

`frontend/src/components/wizard/dynamic-config-form.tsx` — add branch trong `FieldRow`:

```tsx
} : field.type === 'array' ? (
  <ArrayInput
    id={id}
    value={Array.isArray(value) ? (value as Array<string|number>) : []}
    itemType={field.itemType ?? 'string'}
    onChange={onChange}
    error={Boolean(error)}
  />
) : ...
```

New component (same file or extract `array-input.tsx`):

```tsx
interface ArrayInputProps {
  id: string;
  value: Array<string | number>;
  itemType: 'string' | 'number';
  onChange: (next: Array<string | number>) => void;
  error: boolean;
}

function ArrayInput({ id, value, itemType, onChange, error }: ArrayInputProps) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    const item = itemType === 'number' ? Number(trimmed) : trimmed;
    if (itemType === 'number' && isNaN(item as number)) return;
    onChange([...value, item]);
    setDraft('');
  };
  const remove = (idx: number) => onChange(value.filter((_, i) => i !== idx));
  return (
    <div className={cn('rounded-md border bg-white px-2 py-1.5', error ? 'border-red-400' : 'border-gray-300')}>
      <div className="flex flex-wrap gap-1.5 mb-1">
        {value.map((v, i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-xs">
            {String(v)}
            <button type="button" onClick={() => remove(i)} aria-label={`Remove ${v}`}>×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-1">
        <input
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }}
          placeholder="Type and press Enter…"
          className="flex-1 text-sm outline-none"
        />
        <button type="button" onClick={add} className="text-xs text-gray-600 hover:text-gray-900">Add</button>
      </div>
    </div>
  );
}
```

### 5. Data migration script

New file `backend/prisma/migrate-gmail-labels.ts`:

```ts
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '..', '..', '.env') });

import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const agents = await prisma.agentInstance.findMany({
    where: { templateId: 'gmail-lead-classifier' },
  });
  let migrated = 0;
  for (const a of agents) {
    const cfg = (a.configJson ?? {}) as Record<string, unknown>;
    if (typeof cfg.gmail_label === 'string' && !cfg.gmail_labels) {
      const next = { ...cfg, gmail_labels: [cfg.gmail_label] };
      delete (next as Record<string, unknown>).gmail_label;
      await prisma.agentInstance.update({
        where: { id: a.id },
        data: { configJson: next as object },
      });
      migrated++;
    }
  }
  console.log(`Migrated ${migrated}/${agents.length} agent instances`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
```

Add npm script: `"migrate:gmail-labels": "tsx prisma/migrate-gmail-labels.ts"`.

Run AFTER step 1+2+3 deployed (so old single-label still validates during transition window).

### 6. Seed update

`backend/prisma/seed.ts` — gmail-lead-classifier:

```ts
configSchemaJson: {
  gmail_labels: {
    type: 'array',
    itemType: 'string',
    label: 'Gmail Labels',
    required: true,
    default: ['Leads'],
    minItems: 1,
    maxItems: 10,
  },
  lead_score_threshold: { type: 'number', label: 'Lead Score Threshold', required: true, default: 70, min: 0, max: 100 },
  notify_slack: { type: 'boolean', label: 'Notify Slack', required: false, default: false },
},
overridableFieldsJson: ['gmail_labels', 'lead_score_threshold', 'notify_slack'],
```

Re-run `npm run prisma:seed`.

### 7. n8n workflow update

`n8n-workflows/gmail-lead-classifier.json` (verify path; may need export from running n8n):

Current workflow likely reads `{{ $json.config.gmail_label }}` somewhere — replace với array consumption.

Pattern A (Set node + IF over each label):
- Add Code node: `return $json.config.gmail_labels.map(l => ({ json: { label: l, ...$json } }))`
- Branches process each label

Pattern B (Single query with OR):
- Gmail node label filter accept multiple labels: `{{ $json.config.gmail_labels.join(' OR label:') }}` (build query string)

Choose Pattern A for clarity (per-label processing). Test trong n8n UI trước khi commit JSON.

Re-import: `docker compose exec n8n n8n import:workflow --separate --input=/tmp/workflows`.

### 8. Demo script update

`DEMO_SCRIPT.md` Act 4b:

Replace step 2:
```
2. Bump threshold 70 → 85, add label "VIP" via tag input. Click Run.
```

Add talking point:
> "Notice the override snapshot stores both: threshold change AND the expanded label set. Audit shows exactly what filter ran."

## Todo

- [ ] BE validator support array
- [ ] BE unit tests (4 array-specific cases)
- [ ] FE types extend FieldSchema
- [ ] FE ArrayInput component
- [ ] Migration script `migrate-gmail-labels.ts`
- [ ] npm script registered
- [ ] Run BE+FE build clean
- [ ] Run validator unit tests pass
- [ ] Apply migration on running DB (verify no data loss)
- [ ] Update seed
- [ ] Re-seed
- [ ] n8n workflow JSON updated + re-imported
- [ ] Smoke: create new gmail-lead-classifier agent với 2 labels, run, verify
- [ ] Smoke: existing agent (post-migration) still runs
- [ ] Override modal renders tag input cho gmail_labels
- [ ] Override snapshot panel shows array correctly
- [ ] Demo script section 4b updated

## Success criteria

(Mirror plan.md §Success criteria — verify each)

## Risks (operational)

| Risk | Mitigation |
|---|---|
| Migration drops data nếu cfg.gmail_label undefined | Script idempotent: check `typeof === 'string'` before |
| n8n workflow re-import overwrites recent UI tweaks | Export current state first; commit JSON before re-import |
| Tag input UX confusing (no Add button hint) | Placeholder text + tooltip; Enter and comma both add |
| Wizard create flow fails for new agent vì schema thay đổi | Verify Step 4 renders correctly after seed update |

## Out of scope (recorded)

- Apply array pattern to other templates (slack-daily-summary.channels would benefit; defer)
- Drag-reorder tag items
- Bulk paste comma-separated → multi-add
- Per-item validation rules (regex, length)

## Pending unresolved questions

- Exact n8n workflow file path and current node structure — verify khi bắt đầu phase
- Có agent instance nào đang dùng `gmail_label` không (`SELECT count FROM "AgentInstance" WHERE "templateId"='gmail-lead-classifier'`) — nếu 0, skip migration script
