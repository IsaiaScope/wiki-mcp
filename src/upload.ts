const MAX_SEGMENTS = 8;
const MAX_SEGMENT_LEN = 255;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export function sanitizeSubpath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("subpath is empty");
  if (trimmed.includes("\0")) throw new Error("invalid subpath — null byte");
  if (trimmed.includes("\\")) throw new Error("invalid subpath — traversal not allowed");
  if (trimmed.startsWith("/")) throw new Error("invalid subpath — traversal not allowed");

  const collapsed = trimmed.replace(/\/+/g, "/");
  const segments = collapsed.split("/");
  if (segments.some((s) => s === "..")) {
    throw new Error("invalid subpath — traversal not allowed");
  }
  if (segments.length > MAX_SEGMENTS) {
    throw new Error(`invalid subpath — too many segments (max ${MAX_SEGMENTS})`);
  }
  if (segments.some((s) => s.length === 0 || s.length > MAX_SEGMENT_LEN)) {
    throw new Error(`invalid subpath — segment empty or exceeds ${MAX_SEGMENT_LEN} chars`);
  }
  return segments.join("/");
}

export function checkSize(contentBase64: string, maxRawBytes: number): void {
  if (!contentBase64) throw new Error("content_base64 is empty");
  if (!BASE64_RE.test(contentBase64)) {
    throw new Error("content_base64 is not valid base64");
  }
  const maxEncodedLen = Math.ceil(maxRawBytes / 3) * 4;
  if (contentBase64.length > maxEncodedLen) {
    throw new Error(`file too large: encoded ${contentBase64.length} > cap ${maxEncodedLen} chars`);
  }
  const padding = contentBase64.endsWith("==") ? 2 : contentBase64.endsWith("=") ? 1 : 0;
  const rawBytes = Math.floor((contentBase64.length * 3) / 4) - padding;
  if (rawBytes > maxRawBytes) {
    throw new Error(`file too large: ${rawBytes} bytes > cap ${maxRawBytes} bytes`);
  }
}
