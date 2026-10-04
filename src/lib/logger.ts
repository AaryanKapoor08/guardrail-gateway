const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

// Only these fields ever reach the logs. Anything else (tokens, codes, SnapTrade bodies,
// account numbers) is dropped, so a careless call site cannot leak a secret.
const ALLOWED_FIELDS = new Set([
  'route',
  'method',
  'status',
  'durationMs',
  'userId',
  'intentId',
  'event',
  'snaptradeRequestId',
  'attempt',
  'count',
  'rule',
  'state',
  'reason',
  'clientHost',
  // An MCP client's public client_id URL (never a secret).
  'clientId',
  'errorName',
  'errorMessage',
]);

export type LogFields = Readonly<Record<string, unknown>>;

type LogMethod = (message: string, fields?: LogFields) => void;

export type Logger = {
  readonly debug: LogMethod;
  readonly info: LogMethod;
  readonly warn: LogMethod;
  readonly error: LogMethod;
  readonly logError: (message: string, error: unknown, fields?: LogFields) => void;
};

export type LogWriter = (line: string) => void;

function pickAllowedFields(fields: LogFields): Record<string, unknown> {
  const allowed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (ALLOWED_FIELDS.has(key)) {
      allowed[key] = value;
    }
  }
  return allowed;
}

// Walks the `cause` chain so "[Tokens] refresh failed <- TypeError" is visible. Only names and
// our own messages are kept; raw response bodies never end up in an Error message we create.
export function describeError(error: unknown): { errorName: string; errorMessage: string } {
  if (!(error instanceof Error)) {
    return { errorName: 'NonError', errorMessage: 'A non-Error value was thrown' };
  }
  const causeNames: string[] = [];
  let cause: unknown = error.cause;
  while (cause instanceof Error && causeNames.length < 5) {
    causeNames.push(cause.name);
    cause = cause.cause;
  }
  const causeSuffix = causeNames.length > 0 ? ` (caused by ${causeNames.join(' <- ')})` : '';
  return { errorName: error.name, errorMessage: `${error.message}${causeSuffix}` };
}

function writeToStdout(line: string): void {
  process.stdout.write(`${line}\n`);
}

export function createLogger(minimumLevel: LogLevel, write: LogWriter = writeToStdout): Logger {
  const minimumRank = LOG_LEVELS.indexOf(minimumLevel);

  function log(level: LogLevel, message: string, fields: LogFields = {}): void {
    if (LOG_LEVELS.indexOf(level) < minimumRank) {
      return;
    }
    const entry = {
      time: new Date().toISOString(),
      level,
      message,
      ...pickAllowedFields(fields),
    };
    write(JSON.stringify(entry));
  }

  return {
    debug: (message, fields) => log('debug', message, fields),
    info: (message, fields) => log('info', message, fields),
    warn: (message, fields) => log('warn', message, fields),
    error: (message, fields) => log('error', message, fields),
    logError: (message, error, fields = {}) =>
      log('error', message, { ...fields, ...describeError(error) }),
  };
}
