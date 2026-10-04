import { desc, eq } from 'drizzle-orm';
import type { DatabaseExecutor } from '../db/client.js';
import { auditEvents } from '../db/schema.js';

export type AuditEntry = {
  readonly id: number;
  readonly createdAt: Date;
  readonly actor: string;
  readonly actorDetail: string | null;
  readonly eventType: string;
  readonly intentId: string | null;
  readonly details: unknown;
};

// The user's most recent audit events, newest first (the id grows with every insert).
export function listAuditEvents(
  db: DatabaseExecutor,
  userId: string,
  limit: number,
): Promise<AuditEntry[]> {
  return db
    .select({
      id: auditEvents.id,
      createdAt: auditEvents.createdAt,
      actor: auditEvents.actor,
      actorDetail: auditEvents.actorDetail,
      eventType: auditEvents.eventType,
      intentId: auditEvents.intentId,
      details: auditEvents.details,
    })
    .from(auditEvents)
    .where(eq(auditEvents.userId, userId))
    .orderBy(desc(auditEvents.id))
    .limit(limit);
}
