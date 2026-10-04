// Reads a request or response body as text, counting bytes as they arrive, so a huge body can't
// exhaust memory. Returns null as soon as the body is larger than `maxBytes`.
export async function readLimitedText(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<string | null> {
  if (body === null) {
    return '';
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  for (let part = await reader.read(); !part.done; part = await reader.read()) {
    totalBytes += part.value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(part.value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
