export type BearerSecrets = { primary: string; next?: string };

export function checkBearer(req: Request, secrets: BearerSecrets): boolean {
  const header = req.headers.get("Authorization") ?? "";
  const m = header.match(/^Bearer\s+(.+)$/);
  if (!m) return false;
  const token = m[1];
  const okPrimary = constantTimeEqual(token, secrets.primary);
  const okNext = secrets.next ? constantTimeEqual(token, secrets.next) : false;
  return okPrimary || okNext;
}

function constantTimeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}

export function unauthorized(): Response {
  return new Response("Unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": "Bearer" }
  });
}
