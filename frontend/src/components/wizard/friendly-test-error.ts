import axios from 'axios';

export interface FriendlyTestError {
  title: string;
  hint: string;
  detail: string | null;
}

const TIMEOUT_TITLE = 'The test took longer than expected';
const NETWORK_TITLE = 'We could not reach the automation engine';
const TRIGGER_TITLE = 'The agent could not start this run';
const RUNTIME_TITLE = 'The test finished, but the agent reported a problem';
const GENERIC_TITLE = 'The test could not finish this time';

export function friendlyTriggerError(err: unknown): FriendlyTestError {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const data = err.response?.data as { message?: string; details?: unknown } | undefined;
    if (!status || status === 0) {
      return { title: NETWORK_TITLE, hint: 'Check that the backend is running.', detail: null };
    }
    if (status >= 400 && status < 500) {
      return {
        title: TRIGGER_TITLE,
        hint: 'Adjust the configuration or integrations and try again.',
        detail: typeof data?.message === 'string' ? data.message : null,
      };
    }
    return { title: TRIGGER_TITLE, hint: 'You can retry, or skip and activate later.', detail: null };
  }
  if (err instanceof Error && /timed out/i.test(err.message)) {
    return { title: TIMEOUT_TITLE, hint: 'n8n may still be warming up.', detail: null };
  }
  return { title: GENERIC_TITLE, hint: 'You can retry, or skip and activate later.', detail: null };
}

export function friendlyRuntimeError(rawMessage: string | null | undefined): FriendlyTestError {
  if (!rawMessage) {
    return { title: RUNTIME_TITLE, hint: 'You can retry, or skip and activate later.', detail: null };
  }
  if (/timed out/i.test(rawMessage)) {
    return { title: TIMEOUT_TITLE, hint: 'n8n may still be warming up.', detail: null };
  }
  if (/n8n trigger failed/i.test(rawMessage)) {
    return {
      title: NETWORK_TITLE,
      hint: 'Make sure the n8n container is up.',
      detail: null,
    };
  }
  return {
    title: RUNTIME_TITLE,
    hint: 'You can retry, or skip and activate later.',
    detail: rawMessage.length > 240 ? `${rawMessage.slice(0, 240)}…` : rawMessage,
  };
}
