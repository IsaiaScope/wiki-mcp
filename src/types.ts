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
  reason: string;
  body: string;
  links_expanded: string[];
};

export type Bundle = {
  schema: string;
  indexes: Record<string, string>;
  recent_log: string[];
  hits: Hit[];
  citation_instructions: string;
};

export type GithubTreeEntry = {
  path: string;
  mode: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
};

export type PrimeVocabMode = "structural" | "full" | "off";

export type ToolName = "wiki_context" | "wiki_search" | "wiki_fetch" | "wiki_list";

export type PrimeBundle = {
  instructions: string;
  toolDescriptions: Record<ToolName, string>;
  overviewIndex: string;
  overviewByDomain: Map<string, string>;
  vocabMode: PrimeVocabMode;
  sha: string;
};
