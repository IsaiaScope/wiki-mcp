export function isAllDomain(d: string | undefined): boolean {
  return !d || d.toLowerCase() === "all";
}

export function eqIgnoreCase(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function arrayIncludesIgnoreCase(arr: string[], needle: string): boolean {
  const n = needle.toLowerCase();
  for (const v of arr) if (v.toLowerCase() === n) return true;
  return false;
}

export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

export function pathToText(path: string): string {
  return path.replace(/\.md$/, "").replace(/[/_-]/g, " ");
}

export function basename(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.md$/, "");
}
