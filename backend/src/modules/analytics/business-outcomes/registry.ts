import * as gmailLead from './extractors/gmail-lead-classifier.js';
import * as emailDraft from './extractors/email-draft-responder.js';
import * as slackSummary from './extractors/slack-daily-summary.js';
import * as sheetChecker from './extractors/google-sheet-data-checker.js';
import * as ticketTriage from './extractors/ticket-triage-agent.js';
import type { Extractor, OutcomeFormatter } from './types.js';

export interface RegistryEntry {
  extract: Extractor;
  format: OutcomeFormatter;
  postAggregate: (metrics: Record<string, number>) => Record<string, number>;
}

export const REGISTRY: Record<string, RegistryEntry> = {
  'gmail-lead-classifier': {
    extract: gmailLead.extract,
    format: gmailLead.format,
    postAggregate: gmailLead.postAggregate,
  },
  'email-draft-responder': {
    extract: emailDraft.extract,
    format: emailDraft.format,
    postAggregate: emailDraft.postAggregate,
  },
  'slack-daily-summary': {
    extract: slackSummary.extract,
    format: slackSummary.format,
    postAggregate: slackSummary.postAggregate,
  },
  'slack-daily-summary-real': {
    extract: slackSummary.extract,
    format: slackSummary.format,
    postAggregate: slackSummary.postAggregate,
  },
  'google-sheet-data-checker': {
    extract: sheetChecker.extract,
    format: sheetChecker.format,
    postAggregate: sheetChecker.postAggregate,
  },
  'ticket-triage-agent': {
    extract: ticketTriage.extract,
    format: ticketTriage.format,
    postAggregate: ticketTriage.postAggregate,
  },
};

export function getRegistryEntry(templateId: string): RegistryEntry | undefined {
  return REGISTRY[templateId];
}
