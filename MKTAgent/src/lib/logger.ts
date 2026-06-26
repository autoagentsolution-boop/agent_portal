// Structured JSON logger (stdout/stderr). Mirrors render-service/src/logger.ts
// so log shipping/parsing stays uniform across the two services.

type LogLevel = 'info' | 'warn' | 'error';

type LogFields = Record<string, unknown>;

const emit = (level: LogLevel, message: string, fields: LogFields = {}): void => {
  const line = {
    ts: new Date().toISOString(),
    level,
    message,
    ...fields,
  };
  const stream = level === 'error' ? process.stderr : process.stdout;
  stream.write(JSON.stringify(line) + '\n');
};

export const logger = {
  info: (message: string, fields?: LogFields) => emit('info', message, fields),
  warn: (message: string, fields?: LogFields) => emit('warn', message, fields),
  error: (message: string, fields?: LogFields) => emit('error', message, fields),
};
