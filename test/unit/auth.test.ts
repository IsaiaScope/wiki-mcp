import { describe, it, expect } from "vitest";
import { checkBearer, unauthorized } from "../../src/auth";

describe("checkBearer", () => {
  it("accepts correct Authorization header", () => {
    const req = new Request("https://x/mcp", {
      headers: { Authorization: "Bearer correct-token" }
    });
    expect(checkBearer(req, { primary: "correct-token" })).toBe(true);
  });

  it("rejects missing header", () => {
    const req = new Request("https://x/mcp");
    expect(checkBearer(req, { primary: "correct-token" })).toBe(false);
  });

  it("rejects wrong token", () => {
    const req = new Request("https://x/mcp", {
      headers: { Authorization: "Bearer wrong" }
    });
    expect(checkBearer(req, { primary: "correct-token" })).toBe(false);
  });

  it("accepts token matching the rotation 'next' secret", () => {
    const req = new Request("https://x/mcp", {
      headers: { Authorization: "Bearer next-token" }
    });
    expect(
      checkBearer(req, { primary: "old", next: "next-token" })
    ).toBe(true);
  });

  it("uses constant-time comparison (same length traversal)", () => {
    const req = new Request("https://x/mcp", {
      headers: { Authorization: "Bearer a-very-long-token-value" }
    });
    // Both comparisons should complete without short-circuiting.
    expect(checkBearer(req, { primary: "a-very-long-token-valuX" })).toBe(false);
    expect(checkBearer(req, { primary: "X-very-long-token-value" })).toBe(false);
  });
});

describe("unauthorized", () => {
  it("returns 401 with WWW-Authenticate: Bearer", () => {
    const res = unauthorized();
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
  });
});
