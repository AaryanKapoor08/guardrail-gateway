import type { DatabaseExecutor } from '../db/client.js';
import { type ACTORS, auditEvents } from '../db/schema.js';

export type Actor = (typeof ACTORS)[number];

export type AuditEvent = {
  readonly userId: string;
  readonly intentId?: string;
  readonly actor: Actor;
  // Who exactly, e.g. 'claude.ai' for an AI client.
  readonly actorDetail?: string;
  readonly eventType: string;
  readonly details: Readonly<Record<string, unknown>>;
  // From the injected clock (`deps.now()`), so tests control audit times.
  readonly createdAt: Date;
};

// Audit rows can never be edited or deleted (a database trigger enforces it), so a secret
// written here would be stuck forever. Any key that looks like it holds one is refused.
const SECRET_LOOKING_KEY = /token|secret|code|password|authorization/i;

function findSecretLookingKey(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findSecretLookingKey(item);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
  if (value === null || typeof value !== 'object') {
    return undefined;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_LOOKING_KEY.test(key)) {
      return key;
    }
    const found = findSecretLookingKey(nested);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

export function assertNoSecrets(details: Readonly<Record<string, unknown>>): void {
  const key = findSecretLookingKey(details);
  if (key !== undefined) {
    throw new Error(`[Audit] details key "${key}" looks like it holds a secret`);
  }
}

// Call inside the same transaction as the state change it records, so both happen or neither.
export async function writeAudit(tx: DatabaseExecutor, event: AuditEvent): Promise<void> {
  assertNoSecrets(event.details);
  await tx.insert(auditEvents).values({
    userId: event.userId,
    intentId: event.intentId ?? null,
    actor: event.actor,
    actorDetail: event.actorDetail ?? null,
    eventType: event.eventType,
    details: event.details,
    createdAt: event.createdAt,
  });
}
