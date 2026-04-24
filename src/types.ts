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
