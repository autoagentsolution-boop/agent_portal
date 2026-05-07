import { useEffect, useRef, useState } from 'react';
import { Loader2, CheckCircle2, AlertTriangle, SkipForward } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { useCreateAgent, useRunAgent } from '../../hooks/use-agents';
import { useExecution } from '../../hooks/use-execution';
import {
  friendlyRuntimeError,
  friendlyTriggerError,
  type FriendlyTestError,
} from './friendly-test-error';
import type { WizardAction, WizardState } from './wizard-types';

interface StepProps {
  state: WizardState;
  dispatch: (a: WizardAction) => void;
}

const TIMEOUT_MS = 30_000;

export function StepTestRun({ state, dispatch }: StepProps) {
  const createAgent = useCreateAgent();
  const runAgent = useRunAgent();
  const timerRef = useRef<number | null>(null);
  const [friendlyError, setFriendlyError] = useState<FriendlyTestError | null>(null);
  const [showRawError, setShowRawError] = useState(false);

  const isPolling = state.testStatus === 'running';
  const execution = useExecution(state.testExecutionId, { poll: isPolling });

  useEffect(() => {
    const status = execution.data?.status;
    if (!isPolling || !status) return;
    if (status === 'success') {
      setFriendlyError(null);
      dispatch({ type: 'setTestStatus', status: 'success', error: null });
    } else if (status === 'failed' || status === 'warning') {
      setFriendlyError(friendlyRuntimeError(execution.data?.errorMessage));
      dispatch({ type: 'setTestStatus', status: 'failed', error: execution.data?.errorMessage ?? null });
    }
  }, [execution.data?.status, execution.data?.errorMessage, isPolling, dispatch]);

  useEffect(() => {
    if (!isPolling) {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    timerRef.current = window.setTimeout(() => {
      setFriendlyError(friendlyRuntimeError('timed out'));
      dispatch({ type: 'setTestStatus', status: 'failed', error: 'Test run timed out' });
    }, TIMEOUT_MS);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [isPolling, dispatch, state.testExecutionId]);

  async function ensureAgent(): Promise<string | null> {
    if (state.agentId) return state.agentId;
    if (!state.template || !state.triggerMode) return null;
    const agent = await createAgent.mutateAsync({
      template_id: state.template.id,
      name: state.agentName.trim(),
      selected_integrations: state.selectedIntegrations,
      trigger_mode: state.triggerMode,
      config: state.config,
    });
    dispatch({ type: 'setAgentId', agentId: agent.id });
    return agent.id;
  }

  async function onRunTest() {
    setFriendlyError(null);
    setShowRawError(false);
    dispatch({ type: 'setTestStatus', status: 'running', error: null, executionId: null });
    try {
      const agentId = await ensureAgent();
      if (!agentId) throw new Error('Cannot create agent');
      const res = await runAgent.mutateAsync(agentId);
      dispatch({ type: 'setTestStatus', status: 'running', executionId: res.execution_id });
    } catch (err) {
      setFriendlyError(friendlyTriggerError(err));
      dispatch({ type: 'setTestStatus', status: 'failed', error: null });
    }
  }

  async function onSkipTest() {
    setFriendlyError(null);
    setShowRawError(false);
    try {
      await ensureAgent();
      dispatch({ type: 'setTestStatus', status: 'skipped', error: null, executionId: null });
    } catch (err) {
      setFriendlyError(friendlyTriggerError(err));
      dispatch({ type: 'setTestStatus', status: 'failed', error: null });
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Test run</h2>
        <p className="text-sm text-gray-500">
          Creates the agent as draft and fires one execution. You can skip and activate later.
        </p>
      </div>

      <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
        <TestStatusView
          state={state}
          friendlyError={friendlyError}
          showRawError={showRawError}
          onToggleRaw={() => setShowRawError((v) => !v)}
          executionStatus={execution.data?.status}
          resultSummary={execution.data?.resultSummary ?? null}
          durationMs={execution.data?.durationMs ?? null}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={onRunTest} disabled={isPolling || createAgent.isPending} type="button">
          {isPolling
            ? 'Running…'
            : state.testStatus === 'idle'
              ? 'Run Test'
              : 'Run Test Again'}
        </Button>
        <Button
          variant="outline"
          onClick={onSkipTest}
          disabled={isPolling || createAgent.isPending}
          type="button"
        >
          <SkipForward className="h-3.5 w-3.5" />
          Skip test
        </Button>
      </div>
    </div>
  );
}

interface StatusViewProps {
  state: WizardState;
  friendlyError: FriendlyTestError | null;
  showRawError: boolean;
  onToggleRaw: () => void;
  executionStatus: string | undefined;
  resultSummary: string | null;
  durationMs: number | null;
}

function TestStatusView({
  state,
  friendlyError,
  showRawError,
  onToggleRaw,
  executionStatus,
  resultSummary,
  durationMs,
}: StatusViewProps) {
  if (state.testStatus === 'idle') {
    return <p className="text-sm text-gray-600">Click "Run Test" to fire a one-off execution.</p>;
  }
  if (state.testStatus === 'running') {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-700">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{executionStatus ? `Status: ${executionStatus}…` : 'Starting…'}</span>
        {state.testExecutionId && (
          <Badge variant="muted">execution: {state.testExecutionId.slice(0, 8)}…</Badge>
        )}
      </div>
    );
  }
  if (state.testStatus === 'skipped') {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-700">
        <SkipForward className="h-4 w-4 text-gray-500" />
        <span>Test skipped — agent saved as draft. You can run it after activating.</span>
      </div>
    );
  }
  if (state.testStatus === 'success') {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-green-700">
          <CheckCircle2 className="h-4 w-4" />
          <span>Test run succeeded.</span>
          {durationMs !== null && (
            <Badge variant="muted">{(durationMs / 1000).toFixed(1)}s</Badge>
          )}
        </div>
        {resultSummary && (
          <p className="rounded bg-white px-3 py-2 text-sm text-gray-700 ring-1 ring-gray-200">
            {resultSummary}
          </p>
        )}
      </div>
    );
  }
  // failed
  const fe = friendlyError ?? {
    title: 'The test could not finish this time',
    hint: 'You can retry, or skip and activate later.',
    detail: state.testError,
  };
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2 text-sm text-yellow-800">
        <AlertTriangle className="mt-0.5 h-4 w-4" />
        <div>
          <div className="font-medium">{fe.title}</div>
          <div className="text-xs text-yellow-700">{fe.hint}</div>
        </div>
      </div>
      {fe.detail && (
        <button
          type="button"
          onClick={onToggleRaw}
          className="text-xs text-gray-500 underline-offset-2 hover:underline"
        >
          {showRawError ? 'Hide details' : 'Show details'}
        </button>
      )}
      {showRawError && fe.detail && (
        <pre className="overflow-x-auto rounded bg-white p-2 text-xs text-gray-600 ring-1 ring-gray-200">
          {fe.detail}
        </pre>
      )}
    </div>
  );
}
