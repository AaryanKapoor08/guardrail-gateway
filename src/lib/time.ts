export const TORONTO = 'America/Toronto';

// For display only, e.g. "Oct 3, 2026, 2:32 PM ET". Business-time comparisons never go through
// strings; they compare Date values from the injected clock.
export function fmtToronto(date: Date): string {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: TORONTO,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
  // Newer ICU data puts a narrow no-break space before AM/PM; use a plain space so the text is
  // the same everywhere (tests, emails, pages).
  return `${formatted.replace(/ /g, ' ')} ET`;
}
