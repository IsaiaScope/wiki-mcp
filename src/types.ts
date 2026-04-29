export type Domain = {
  name: string;
  indexPath: string;
  logPath: string;
  claudeMdPath?: string;
  wikiTypes: Map<string, string[]>;
  rawPaths: string[];
};

export type Snapshot = {
  sha: string;
  fetchedAt: number;
  domains: Map<string, Domain>;
  allPaths: string[];
  schemaPaths: string[];
};

export type PageMeta = {
  path: string;
  title: string;
  aliases: string[];
  tags: string[];
  entities: string[];
  concepts: string[];
  headings: string[];
};

export type Hit = {
  path: string;
  score: number;
  body: string;
  truncated: boolean;
  viaParent?: string; // present only on expansion hits when expand_links is true
};

export type Bundle = {
  hits: Hit[];
  citation_instructions: string;
};

export type SearchRow = { p: string; t: string; sn?: string; s: number };

export type ListRow = { p: string; t: string };
export type ListGrouped = {
  g: Record<string, Record<string, ListRow[]>>;
  tot: number;
  off: number;
  lim: number;
  tr: boolean;
};

export type FetchRow =
  | { p: string; c: string; fm: Record<string, unknown> }
  | { p: string; err: string };

export type WikiListItem = {
  path: string;
  title: string;
  type: string;
  domain: string;
};

export type WikiListResult = {
  items: WikiListItem[];
  total: number;
  offset: number;
  limit: number;
  truncated: boolean;
};

export type GithubTreeEntry = {
  path: string;
  mode: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
};

export type PrimeVocabMode = "structural" | "full" | "off";

export type ToolName =
  | "wiki_context"
  | "wiki_search"
  | "wiki_fetch"
  | "wiki_list"
  | "wiki_upload"
  | "wiki_read_raw";

export type PrimeBundle = {
  instructions: string;
  toolDescriptions: Record<ToolName, string>;
  overviewIndex: string;
  overviewByDomain: Map<string, string>;
  vocabMode: PrimeVocabMode;
  sha: string;
};
