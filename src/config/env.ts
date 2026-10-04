import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const ENCRYPTION_KEY_BYTES = 32;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

const encryptionKeySchema = z
  .string()
  .refine((value) => BASE64_PATTERN.test(value), 'must be base64')
  .transform((value) => Buffer.from(value, 'base64'))
  .refine(
    (key) => key.length === ENCRYPTION_KEY_BYTES,
    `must decode to exactly ${ENCRYPTION_KEY_BYTES} bytes`,
  );

const allowedClientHostsSchema = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter((host) => host.length > 0),
  )
  .pipe(z.array(z.string()).min(1, 'must list at least one host'));

const postgresUrlSchema = z.url({ protocol: /^postgres(ql)?$/ });

const envObjectSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_BASE_URL: z.url({ protocol: /^https?$/ }),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  SNAPTRADE_OAUTH_CLIENT_ID: z.string().min(1),
  SNAPTRADE_OAUTH_CLIENT_SECRET: z.string().min(1),
  SNAPTRADE_REDIRECT_URI: z.url({ protocol: /^https?$/ }),
  SNAPTRADE_ISSUER: z.url({ protocol: /^https$/ }).default('https://api.snaptrade.com'),
  SNAPTRADE_API_BASE_URL: z.url({ protocol: /^https$/ }).default('https://api.snaptrade.com'),
  SNAPTRADE_REQUEST_TRADE_SCOPE: z.stringbool().default(false),
  SNAPTRADE_CONSUMER_KEY: z.string().min(1),

  DATABASE_URL: postgresUrlSchema,
  TEST_DATABASE_URL: postgresUrlSchema.optional(),
  TOKEN_ENCRYPTION_KEY: encryptionKeySchema,

  MCP_ALLOWED_CLIENT_HOSTS: allowedClientHostsSchema,

  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.email().optional(),

  LIVE_TRADING_ENABLED: z.stringbool().default(false),
  LIVE_TRADING_PAPER_ACCOUNTS_ONLY: z.stringbool().default(true),
});

type EnvShape = z.infer<typeof envObjectSchema>;

// Cross-field rules. The redirect URI must share the app's origin, otherwise the login cookie
// set on `localhost` is not sent back to `127.0.0.1` (V§0 G15) and every sign-in fails.
function checkUrlConsistency(env: EnvShape, context: z.RefinementCtx<EnvShape>): void {
  const appBaseUrl = new URL(env.APP_BASE_URL);
  if (appBaseUrl.pathname !== '/' || env.APP_BASE_URL.endsWith('/')) {
    context.addIssue({
      code: 'custom',
      path: ['APP_BASE_URL'],
      message: 'must have no path and no trailing slash',
    });
  }
  if (appBaseUrl.search !== '' || appBaseUrl.hash !== '') {
    context.addIssue({
      code: 'custom',
      path: ['APP_BASE_URL'],
      message: 'must have no query string or fragment',
    });
  }
  if (env.NODE_ENV === 'production' && appBaseUrl.protocol !== 'https:') {
    context.addIssue({
      code: 'custom',
      path: ['APP_BASE_URL'],
      message: 'must use https in production',
    });
  }
  if (new URL(env.SNAPTRADE_REDIRECT_URI).origin !== appBaseUrl.origin) {
    context.addIssue({
      code: 'custom',
      path: ['SNAPTRADE_REDIRECT_URI'],
      message: 'must have the same origin (scheme, host, port) as APP_BASE_URL',
    });
  }
}

const envSchema = envObjectSchema.superRefine(checkUrlConsistency);

export type Env = z.infer<typeof envSchema>;

type EnvSource = Readonly<Record<string, string | undefined>>;

// `KEY=` in a .env file means "not set", so optional values can be left blank.
function dropEmptyValues(source: EnvSource): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value.trim() !== '') {
      result[key] = value;
    }
  }
  return result;
}

// Messages name the variable and the problem, never the value, because values are secrets.
function describeIssue(issue: z.core.$ZodIssue): string {
  const key = issue.path.join('.') || '(root)';
  if (issue.code === 'invalid_type' && issue.message.endsWith('received undefined')) {
    return `  - ${key}: is missing`;
  }
  return `  - ${key}: ${issue.message}`;
}

export function loadEnv(source: EnvSource = process.env): Env {
  const result = envSchema.safeParse(dropEmptyValues(source));
  if (result.success) {
    return result.data;
  }
  const lines = result.error.issues.map(describeIssue);
  throw new Error(`[Config] Invalid environment variables:\n${lines.join('\n')}`);
}

// Local development reads `.env` from the repo root. In production (Render) there is no file
// and the variables come from the host, so a missing file is expected, not an error.
export function loadDotEnvFileIfPresent(): void {
  const envFilePath = path.resolve(process.cwd(), '.env');
  if (existsSync(envFilePath)) {
    process.loadEnvFile(envFilePath);
  }
}
