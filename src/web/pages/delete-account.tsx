import { CsrfField } from '../../auth/csrf.js';
import type { SignedIn } from '../../auth/sessions.js';
import { Layout } from '../layout.js';

export const DELETE_CONFIRMATION = 'DELETE';

export function DeleteAccountPage(props: { signedIn: SignedIn; problem?: string | undefined }) {
  return (
    <Layout title="Delete account" signedIn={props.signedIn}>
      <h1>Delete your account</h1>
      <p>This permanently deletes, on Guardrail Gateway:</p>
      <ul>
        <li>your SnapTrade sign-in (we also revoke it at SnapTrade),</li>
        <li>every connected AI app and its access,</li>
        <li>your accounts list, policy, orders, paper positions, and the audit log.</li>
      </ul>
      <p>
        It does not touch your brokerage or your SnapTrade account. You can sign in again later as a
        new user.
      </p>
      {props.problem === undefined ? null : <div class="banner danger">{props.problem}</div>}
      <form method="post" action="/account/delete" class="box">
        <CsrfField token={props.signedIn.session.csrfToken} />
        <label for="confirm">Type {DELETE_CONFIRMATION} to confirm</label>
        <input id="confirm" name="confirm" autocomplete="off" />{' '}
        <button type="submit" class="danger">
          Delete my account
        </button>
      </form>
    </Layout>
  );
}

export function GoodbyePage(props: { revokedAtSnapTrade: boolean }) {
  return (
    <Layout title="Account deleted">
      <h1>Your account is deleted</h1>
      <p>Everything we stored about you is gone, including the audit log.</p>
      {props.revokedAtSnapTrade ? null : (
        <div class="banner">
          We couldn't confirm that SnapTrade revoked our access. To be sure, also remove Guardrail
          Gateway from the connected apps in your SnapTrade dashboard.
        </div>
      )}
      <p>
        <a href="/">Back to the home page</a>
      </p>
    </Layout>
  );
}
