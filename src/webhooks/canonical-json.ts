// The exact text SnapTrade signs (V§12.4): the payload re-serialised the way Python's
// `json.dumps(payload, sort_keys=True, separators=(',', ':'))` does it, with the default
// `ensure_ascii=True`. Two details matter for a byte-identical result:
//   - keys sorted at every level (Python compares code points; JS compares UTF-16 code units,
//     which agree for every key that isn't an emoji-like astral character),
//   - every character outside printable ASCII escaped as \uXXXX (lowercase hex, UTF-16 code
//     units, so an emoji becomes a surrogate pair), with Python's short forms for the usual ones.
// Numbers use JSON.stringify. Python prints floats like 1.0 as "1.0" where JS prints "1";
// SnapTrade's payloads contain only strings, integers, booleans, and null, so this never applies.

const SHORT_ESCAPES: Readonly<Record<string, string>> = {
  '"': '\\"',
  '\\': '\\\\',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\b': '\\b',
  '\f': '\\f',
};

const FIRST_PRINTABLE = 0x20;
const LAST_PRINTABLE = 0x7e;

function escapeCodeUnit(character: string): string {
  const shortForm = SHORT_ESCAPES[character];
  if (shortForm !== undefined) {
    return shortForm;
  }
  const code = character.charCodeAt(0);
  if (code >= FIRST_PRINTABLE && code <= LAST_PRINTABLE) {
    return character;
  }
  return `\\u${code.toString(16).padStart(4, '0')}`;
}

function quoteString(text: string): string {
  let quoted = '"';
  // Indexing (not for...of) walks UTF-16 code units, so surrogate pairs are escaped separately.
  for (let index = 0; index < text.length; index += 1) {
    quoted += escapeCodeUnit(text.charAt(index));
  }
  return `${quoted}"`;
}

function serializeObject(value: object): string {
  const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const members = entries.map(([key, member]) => `${quoteString(key)}:${canonicalJson(member)}`);
  return `{${members.join(',')}}`;
}

export function canonicalJson(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('[Webhooks] payload contains a number JSON cannot represent');
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    return quoteString(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value === 'object') {
    return serializeObject(value);
  }
  throw new Error('[Webhooks] payload contains a value that is not JSON');
}
