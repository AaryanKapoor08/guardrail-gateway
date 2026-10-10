import { CsrfField } from '../../auth/csrf.js';
import type { SignedIn } from '../../auth/sessions.js';
import { fmtToronto } from '../../lib/time.js';
import type { ConnectedApp } from '../../oauth-server/grants.js';
import { Layout } from '../layout.js';

// Connected AI apps (V§6.6): which apps can use your account, and a way to cut each one off.
export function AppsPage(props: { signedIn: SignedIn; apps: readonly ConnectedApp[] }) {
  const csrfToken = props.signedIn.session.csrfToken;
  return (
    <Layout title="Connected AI apps" signedIn={props.signedIn} activePage="apps">
      <div class="page-head">
        <p class="eyebrow">Settings</p>
        <h1>Connected AI apps</h1>
      </div>
      <p>
        These apps can read the accounts you allowed and propose orders. Every order still needs
        your approval. Disconnecting an app stops it immediately.
      </p>
      {props.apps.length === 0 ? (
        <p class="box">No AI apps are connected.</p>
      ) : (
        <section class="box">
          <table class="data-table">
            <thead>
              <tr>
                <th>App</th>
                <th>Connected</th>
                <th>Last used</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {props.apps.map((app) => (
                <tr>
                  <td>{app.clientHost}</td>
                  <td>{fmtToronto(app.createdAt)}</td>
                  <td>{fmtToronto(app.lastUsedAt)}</td>
                  <td>
                    <form method="post" action={`/apps/${app.id}/revoke`} class="inline">
                      <CsrfField token={csrfToken} />
                      <button type="submit" class="secondary small">
                        Disconnect
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <p>
        <a href="/dashboard">Back to the dashboard</a>
      </p>
    </Layout>
  );
}
