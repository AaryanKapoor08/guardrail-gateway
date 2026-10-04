import type { SignedIn } from '../../auth/sessions.js';
import { Layout } from '../layout.js';

export function DashboardPage(props: { signedIn: SignedIn }) {
  const email = props.signedIn.user.email;
  return (
    <Layout title="Dashboard" signedIn={props.signedIn}>
      <h1>Dashboard</h1>
      <p>Signed in{email === null ? '' : ` as ${email}`}.</p>
      <p>Your accounts will appear here.</p>
      <p class="notice">Not financial advice. Guardrail Gateway never recommends trades.</p>
    </Layout>
  );
}
