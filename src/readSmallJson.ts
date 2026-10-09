/** Read a bounded UTF-8 JSON body without buffering an arbitrary upload. */
export async function readSmallJson(request: Request, limit: number): Promise<{ ok: true; value: unknown } | { ok: false; status: number }> {
  if (Number(request.headers.get('content-length')) > limit) return { ok: false, status: 413 };
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, status: 400 };
  const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); return { ok: false, status: 413 }; }
      parts.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    return { ok: true, value: JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)) };
  } catch { return { ok: false, status: 400 }; }
}
