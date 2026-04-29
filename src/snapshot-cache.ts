import type { RankDoc } from "./search/rank";
import type { Snapshot } from "./types";

export type SnapshotCache = {
  metaDocs?: Map<string, RankDoc[]>;
  knownPaths?: Set<string>;
};

const snapshotCaches = new WeakMap<Snapshot, SnapshotCache>();

export function snapCache(snap: Snapshot): SnapshotCache {
  let c = snapshotCaches.get(snap);
  if (!c) {
    c = {};
    snapshotCaches.set(snap, c);
  }
  return c;
}

export function knownPathsOf(snap: Snapshot): Set<string> {
  const cache = snapCache(snap);
  if (!cache.knownPaths) cache.knownPaths = new Set(snap.allPaths);
  return cache.knownPaths;
}
