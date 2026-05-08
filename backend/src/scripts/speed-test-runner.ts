import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

interface CliArgs {
  template: string;
  count: number;
  agentId?: string;
  baseUrl: string;
  email: string;
  password: string;
  pollIntervalMs: number;
  pollTimeoutMs: number;
  outDir: string;
}

interface ExecutionResult {
  index: number;
  execution_id?: string;
  status: string;
  duration_ms: number;
  backend_response_ms: number;
  error?: string;
}

const TERMINAL = new Set(['success', 'failed', 'warning', 'cancelled']);

export function parseArgs(argv: string[]): CliArgs {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('--')) continue;
    const key = tok.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags.set(key, next);
      i++;
    } else {
      flags.set(key, 'true');
    }
  }

  const template = flags.get('template');
  if (!template) throw new Error('Missing --template');
  const count = Number(flags.get('count') ?? '10');
  if (!Number.isFinite(count) || count <= 0) throw new Error('--count must be a positive number');

  return {
    template,
    count,
    agentId: flags.get('agent-id'),
    baseUrl: flags.get('base-url') ?? process.env.SPEED_TEST_BASE_URL ?? 'http://localhost:4000',
    email: flags.get('email') ?? process.env.SPEED_TEST_EMAIL ?? 'admin@demo.local',
    password: flags.get('password') ?? process.env.SPEED_TEST_PASSWORD ?? 'demo1234',
    pollIntervalMs: Number(flags.get('poll-interval-ms') ?? '500'),
    pollTimeoutMs: Number(flags.get('poll-timeout-ms') ?? '30000'),
    outDir: flags.get('out-dir') ?? resolve(process.cwd(), 'speed-test-results'),
  };
}

interface ApiClient {
  get: <T>(path: string) => Promise<T>;
  post: <T>(path: string, body?: unknown) => Promise<T>;
}

function createApiClient(baseUrl: string): ApiClient {
  let cookieJar = '';

  const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Origin: baseUrl,
    };
    if (cookieJar) headers.Cookie = cookieJar;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookieHeader = res.headers.get('set-cookie');
    if (setCookieHeader) {
      const pairs = setCookieHeader
        .split(/,(?=[^;]+=)/g)
        .map((c) => c.split(';')[0].trim())
        .filter(Boolean);
      cookieJar = pairs.join('; ');
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : (undefined as T);
  };

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
  };
}

async function login(client: ApiClient, email: string, password: string): Promise<void> {
  await client.post('/api/auth/sign-in/email', { email, password });
}

interface AgentInstance {
  id: string;
  templateId: string;
  status: string;
  name: string;
}

async function resolveAgent(client: ApiClient, args: CliArgs): Promise<AgentInstance> {
  if (args.agentId) {
    const res = await client.get<{ data: AgentInstance }>(`/api/agent-instances/${args.agentId}`);
    return res.data;
  }
  const res = await client.get<{ data: AgentInstance[] }>(
    `/api/agent-instances?template_id=${encodeURIComponent(args.template)}`,
  );
  const candidate = res.data.find((a) => a.status === 'running' || a.status === 'draft' || a.status === 'paused');
  if (!candidate) {
    throw new Error(
      `No runnable agent found for template "${args.template}". ` +
        'Create one via the Create Agent wizard or pass --agent-id.',
    );
  }
  return candidate;
}

interface ExecutionDetail {
  id: string;
  status: string;
  durationMs: number | null;
  finishedAt: string | null;
}

async function pollUntilTerminal(
  client: ApiClient,
  executionId: string,
  pollIntervalMs: number,
  pollTimeoutMs: number,
): Promise<ExecutionDetail> {
  const deadline = Date.now() + pollTimeoutMs;
  while (Date.now() < deadline) {
    const res = await client.get<{ data: ExecutionDetail }>(`/api/executions/${executionId}`);
    if (TERMINAL.has(res.data.status)) return res.data;
    await sleep(pollIntervalMs);
  }
  throw new Error(`Execution ${executionId} timed out after ${pollTimeoutMs}ms`);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(Math.floor((p / 100) * sorted.length), sorted.length - 1);
  return sorted[idx];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

export async function runSpeedTest(args: CliArgs): Promise<void> {
  const client = createApiClient(args.baseUrl);

  process.stdout.write(`Logging in as ${args.email}…\n`);
  await login(client, args.email, args.password);

  process.stdout.write(`Resolving agent for template "${args.template}"…\n`);
  const agent = await resolveAgent(client, args);
  process.stdout.write(`Using agent: ${agent.name} (${agent.id})\n`);

  const results: ExecutionResult[] = [];
  const totalStart = Date.now();

  for (let i = 0; i < args.count; i++) {
    const start = Date.now();
    try {
      const runRes = await client.post<{ data: { execution_id: string; status: string } }>(
        `/api/agent-instances/${agent.id}/run`,
      );
      const executionId = runRes.data.execution_id;
      const detail = await pollUntilTerminal(client, executionId, args.pollIntervalMs, args.pollTimeoutMs);
      results.push({
        index: i + 1,
        execution_id: executionId,
        status: detail.status,
        duration_ms: detail.durationMs ?? Date.now() - start,
        backend_response_ms: Date.now() - start,
      });
    } catch (err) {
      results.push({
        index: i + 1,
        status: 'error',
        duration_ms: Date.now() - start,
        backend_response_ms: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    process.stdout.write(`\r[${i + 1}/${args.count}] last=${results[i].status}     `);
  }

  const totalMs = Date.now() - totalStart;
  const successes = results.filter((r) => r.status === 'success');
  const failures = results.filter((r) => r.status !== 'success');
  const durations = successes.map((r) => r.duration_ms).sort((a, b) => a - b);

  const summary = {
    test_name: `${args.count} execution local test`,
    template_id: args.template,
    agent_id: agent.id,
    agent_name: agent.name,
    total_executions: args.count,
    success_count: successes.length,
    failed_count: failures.length,
    avg_duration_ms: mean(durations),
    p50_duration_ms: percentile(durations, 50),
    p95_duration_ms: percentile(durations, 95),
    total_elapsed_ms: totalMs,
    throughput_per_min: totalMs > 0 ? Math.round((args.count / totalMs) * 60000) : 0,
    callback_missing_count: results.filter((r) => r.status === 'error').length,
    notes:
      failures.length > 0
        ? `${failures.length} non-success outcomes — see results array`
        : 'All executions completed successfully',
    results,
  };

  process.stdout.write('\n\n--- Speed Test Results ---\n');
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  ensureDir(args.outDir);
  const filename = `speed-test-${args.template}-${args.count}-${Date.now()}.json`;
  const filepath = resolve(args.outDir, filename);
  writeFileSync(filepath, JSON.stringify(summary, null, 2));
  process.stdout.write(`\nResults saved to ${filepath}\n`);
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}
