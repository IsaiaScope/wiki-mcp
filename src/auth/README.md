<h3 align="center">auth 🔐</h3>

<br />

<p align="center">
  <img src="https://img.shields.io/badge/check-constant_time-2D3748" alt="constant-time" />
  <img src="https://img.shields.io/badge/scheme-Bearer-4F46E5" alt="bearer" />
  <img src="https://img.shields.io/badge/rotation-overlap_token-10B981" alt="rotation" />
</p>

---

## 🔥 About

Bearer-token guard for the `/mcp` endpoint. The worker rejects every request that doesn't carry an `Authorization: Bearer <token>` header matching `MCP_BEARER` (or, optionally, `MCP_BEARER_NEXT` for zero-downtime rotation).

The comparison is **constant-time** — the loop XORs every byte of both candidates regardless of mismatch position, so a network attacker can't infer secret bytes from response timing.

## 🗂️ Files

| | File | Responsibility |
|-|------|----------------|
| 🛡️ | `bearer.ts` | `checkBearer(req, env)` + `unauthorized()` 401 helper |
| 📦 | `index.ts` | barrel export |

## 🔁 Rotation flow

`MCP_BEARER_NEXT` is the safety net during a token rotation:

```
T0  set MCP_BEARER_NEXT = newToken         (clients still use old)
T1  swap clients to newToken               (both tokens now valid)
T2  set MCP_BEARER = newToken              (still both valid)
T3  unset MCP_BEARER_NEXT                  (only new token works)
```

At any single instant, requests with **either** token return 200; requests with neither return 401 with `WWW-Authenticate: Bearer realm="wiki-mcp", resource_metadata="<origin>/.well-known/oauth-protected-resource"`.

## 🔗 OAuth discovery handshake

`unauthorized(resourceMetadataUrl)` appends `resource_metadata="…"` to the challenge per **RFC 9728** so MCP clients can locate the protected-resource metadata document without an out-of-band config step. The metadata route lives in `src/index.ts` and advertises bearer-via-header with no authorization servers — wiki-mcp does not run an OAuth AS.

The `resourceMetadataUrl` arg is optional; the worker entry always passes it. Callers outside the `/mcp` request path may omit it to fall back to the bare `Bearer realm="wiki-mcp"` challenge.

## 🧪 Testing

`test/unit/auth.test.ts` covers:

- accepts current token
- accepts overlap token while both set
- rejects missing / malformed / wrong-scheme headers
- rejects mismatched token (constant-time path)
- handles whitespace + casing in the header
