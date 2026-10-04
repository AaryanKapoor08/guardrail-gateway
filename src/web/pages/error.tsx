import type { SignedIn } from '../../auth/sessions.js';
import { Layout } from '../layout.js';

type MessagePageProps = {
  readonly title: string;
  readonly message: string;
  readonly signedIn?: SignedIn | undefined;
  readonly linkHref?: string;
  readonly linkText?: string;
};

// A plain page for errors and short outcomes: what happened and what to do next.
export function ErrorPage(props: MessagePageProps) {
  return (
    <Layout title={props.title} signedIn={props.signedIn}>
      <h1>{props.title}</h1>
      <p>{props.message}</p>
      <p>
        <a href={props.linkHref ?? '/'}>{props.linkText ?? 'Back to the home page'}</a>
      </p>
    </Layout>
  );
}
