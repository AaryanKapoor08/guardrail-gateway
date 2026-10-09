import type { AuditEntry } from '../../audit/read.js';
import type { SignedIn } from '../../auth/sessions.js';
import { fmtToronto } from '../../lib/time.js';
import { Layout } from '../layout.js';

// Details are shown as escaped "key: value" lines (Hono JSX escapes every value), never as HTML.
function detailLines(details: unknown): string[] {
  if (details === null || typeof details !== 'object') {
    return [];
  }
  return Object.entries(details).map(
    ([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`,
  );
}

function AuditRow(props: { entry: AuditEntry }) {
  const { entry } = props;
  return (
    <tr>
      <td>{fmtToronto(entry.createdAt)}</td>
      <td>
        {entry.actor}
        {entry.actorDetail === null ? '' : ` (${entry.actorDetail})`}
      </td>
      <td>
        <code>{entry.eventType}</code>
        {entry.intentId === null ? null : (
          <>
            {' '}
            <a href={`/approvals/${entry.intentId}`}>order</a>
          </>
        )}
      </td>
      <td>
        {detailLines(entry.details).map((line) => (
          <div>{line}</div>
        ))}
      </td>
    </tr>
  );
}

export function AuditPage(props: { signedIn: SignedIn; entries: readonly AuditEntry[] }) {
  return (
    <Layout title="Audit log" signedIn={props.signedIn}>
      <div class="page-head">
        <p class="eyebrow">History</p>
        <h1>Audit log</h1>
      </div>
      <p>
        The last {props.entries.length} events, newest first. The log can't be edited or deleted,
        except by deleting your whole account.
      </p>
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Who</th>
            <th>What</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {props.entries.map((entry) => (
            <AuditRow entry={entry} />
          ))}
        </tbody>
      </table>
    </Layout>
  );
}
