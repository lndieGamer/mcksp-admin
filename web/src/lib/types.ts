export type Side = "both" | "client" | "server";
export type ModStatus =
  | "current"
  | "update_safe"
  | "update_blocked"
  | "broken"
  | "frozen"
  | "unknown";
export type Role = "core" | "addon" | "library" | "standalone" | "mod";

export interface Mod {
  slug: string;
  name: string;
  filename: string;
  side: Side;
  source: "modrinth" | "curseforge" | "url";
  project_id: string | null;
  version: string | null;
  mod_ids: string[];
  size_bytes: number;
  flavors: string[];
  role: Role;
  cluster: string | null;
  embedded: boolean;
  owner: string | null;
  date_added: string | null;
  date_updated: string | null;
  parse_status: "ok" | "warning" | "failed";
  status: ModStatus;
}

export interface Edge {
  from: string;
  to: string | null;
  to_mod_id: string;
  type: "required" | "optional" | "discouraged" | string;
  version_range: string;
  satisfied: boolean;
}

export interface FlavorChoice {
  id: string;
  name: string;
  mod_count: number;
}

export interface FlavorGroup {
  id: string;
  name: string;
  description: string;
  side: string;
  choices: FlavorChoice[];
}

export interface PublicData {
  generated_at: string;
  notices?: string[];
  pack: { version: string; mc: string; loader: string; loader_version: string };
  mods: Mod[];
  edges: Edge[];
  flavor_groups: FlavorGroup[];
  build_sizes: { full: number; minimal: number; without: Record<string, number> };
}

export interface Blocker {
  slug: string;
  version_range: string;
}

export interface Update {
  slug: string;
  current_version: string | null;
  candidate_version: string | null;
  candidate_ref: Record<string, unknown>;
  published_at: string | null;
  status: "safe" | "blocked";
  blocked_by: Blocker[];
}

export interface UpdateSet {
  id: string;
  members: string[];
  status: "available" | "partially_available";
  missing: string[];
}

export interface LintFinding {
  level: "error" | "warning" | "info";
  code: string;
  slug: string;
  message: string;
}

export interface HistoryEntry {
  sha: string;
  op_id: string;
  op: string;
  title: string;
  date: string;
  reverted: boolean;
}

export interface PrivateData {
  generated_at: string;
  updates: Update[];
  update_sets: UpdateSet[];
  lint: LintFinding[];
  history: HistoryEntry[];
  unparsed: { slug: string; level: string; reason: string }[];
  platform: { slug: string; mod_id: string; version_range: string; satisfied: boolean }[];
}

export interface Session {
  login: string;
  iat: number;
  exp: number;
}

/** Every mutation the workflow accepts. Mirrors mutate/mutate.py's OPS table. */
export type Operation =
  | { op: "set-side"; targets: string[]; value: Side }
  | { op: "set-flavors"; targets: string[]; flavors: string[] }
  | { op: "add-modrinth"; version_id: string; slug?: string; side?: Side; flavors?: string[] }
  | { op: "add-curseforge"; project_id: number; file_id: number; side?: Side; flavors?: string[] }
  | { op: "add-url"; name: string; url: string; side?: Side; flavors?: string[] }
  | { op: "add-jar"; name: string; release_asset_url: string; side?: Side }
  | { op: "update-mod"; targets: string[]; version_id?: string }
  | { op: "update-set"; set_id: string }
  | { op: "remove-mod"; targets: string[]; reason?: string }
  | { op: "set-pack-version"; version: string }
  | { op: "revert"; sha: string };
