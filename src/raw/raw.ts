import { type Env, rawFolder } from "../env";
import type { GithubClient } from "../github";
import type { Snapshot } from "../types";

export type ReadRawArgs = { path: string };
export type ReadRawResult = {
  ok: true;
  path: string;
  content_base64: string;
  bytes: number;
};

export async function readRawFile(
  args: ReadRawArgs,
  snapshot: Snapshot,
  github: GithubClient,
  env: Env,
): Promise<ReadRawResult> {
  const target = args.path.trim();
  if (!target) throw new Error("path is empty");
  if (!snapshot.allPaths.includes(target)) {
    throw new Error(`path not in snapshot: ${target}`);
  }

  const segments = target.split("/");
  if (segments.length < 3) {
    throw new Error("path must be under {domain}/{rawFolder}/...");
  }
  const [domain, folder] = segments;
  if (!snapshot.domains.has(domain)) {
    const valid = [...snapshot.domains.keys()].join(", ");
    throw new Error(`unknown domain '${domain}'. Valid: [${valid}]`);
  }
  if (folder !== rawFolder(env)) {
    throw new Error(`path must live under ${domain}/${rawFolder(env)}/`);
  }

  const b64 = await github.fetchBytesBase64(snapshot.sha, target);
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  const bytes = Math.floor((b64.length * 3) / 4) - padding;
  return { ok: true, path: target, content_base64: b64, bytes };
}
