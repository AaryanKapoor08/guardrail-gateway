import type { Context } from 'hono';
import type { HtmlEscapedString } from 'hono/utils/html';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

// What a JSX expression like `<HomePage />` evaluates to.
export type Page = HtmlEscapedString | Promise<HtmlEscapedString>;

// JSX can't express the doctype, and without it browsers render in "quirks mode". The doctype is
// a fixed string; every piece of data in the page is escaped by Hono JSX.
export async function renderPage(
  c: Context,
  page: Page,
  status: ContentfulStatusCode = 200,
): Promise<Response> {
  return c.html(`<!doctype html>${await page}`, status);
}
