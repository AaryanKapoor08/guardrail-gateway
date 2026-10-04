// Typed errors for failures the app knows how to present. Each `message` is safe to show to a
// user or the AI: plain English, no tokens, SQL, or SnapTrade response bodies. Put internal
// detail in `cause`, which is logged by name only.

export class NeedsReauthError extends Error {
  override readonly name = 'NeedsReauthError';

  constructor(
    message = 'Your SnapTrade connection needs to be renewed. Sign in again to continue.',
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export class NotFoundError extends Error {
  override readonly name = 'NotFoundError';

  constructor(message = "We couldn't find that.", options?: ErrorOptions) {
    super(message, options);
  }
}

export class ConflictError extends Error {
  override readonly name = 'ConflictError';

  constructor(
    message = 'That changed while you were working on it. Refresh the page and try again.',
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export class ValidationError extends Error {
  override readonly name = 'ValidationError';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}
