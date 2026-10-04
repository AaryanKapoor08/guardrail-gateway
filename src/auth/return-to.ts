export const DEFAULT_RETURN_TO = '/dashboard';

// Only a path on our own site is accepted. `//evil.com` and `/\evil.com` are read by browsers
// as links to another site, so they are refused too (open-redirect protection, V§13).
const SAME_SITE_PATH = /^\/(?![/\\])/;
// Control characters (including tabs and newlines, which browsers strip from URLs) are refused.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

export function safeReturnTo(input: string | null | undefined): string {
  if (input === null || input === undefined) {
    return DEFAULT_RETURN_TO;
  }
  if (!SAME_SITE_PATH.test(input) || CONTROL_CHARACTER.test(input)) {
    return DEFAULT_RETURN_TO;
  }
  return input;
}
