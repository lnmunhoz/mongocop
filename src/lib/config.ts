import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { isCredentialRef, type CredentialRef } from "./credentials/index.js";

const CONFIG_DIR = join(homedir(), ".mongocop");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export interface SavedHost {
  name: string;
  kind?: "inline" | "credential";
  connectionString?: string;
  credential?: CredentialRef;
}

export interface SavedCopyTemplate {
  name: string;
  sourceHost: string;
  targetHost: string;
  sourceDatabase: string;
  targetDatabase: string;
  collections?: string[];
}

interface Config {
  hosts: SavedHost[];
  templates: SavedCopyTemplate[];
}

async function ensureConfigDir(): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
}

const DEFAULT_HOSTS: SavedHost[] = [
  {
    name: "localhost",
    kind: "inline",
    connectionString: "mongodb://localhost:27017",
  },
];

function getDefaultHosts(): SavedHost[] {
  return DEFAULT_HOSTS.map((host) => ({ ...host }));
}

function normalizeHost(value: unknown): SavedHost | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Partial<SavedHost>;
  if (typeof candidate.name !== "string" || candidate.name.trim() === "") {
    return null;
  }

  if (isCredentialRef(candidate.credential)) {
    return {
      name: candidate.name,
      kind: "credential",
      credential: candidate.credential,
    };
  }

  if (
    candidate.kind === "inline" &&
    typeof candidate.connectionString === "string"
  ) {
    return {
      name: candidate.name,
      kind: "inline",
      connectionString: candidate.connectionString,
    };
  }

  // Legacy entries with plaintext connection strings are still loaded so
  // they can be migrated to keychain.
  if (typeof candidate.connectionString === "string") {
    return {
      name: candidate.name,
      connectionString: candidate.connectionString,
    };
  }

  return null;
}

function normalizeTemplate(value: unknown): SavedCopyTemplate | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Partial<SavedCopyTemplate>;
  if (
    typeof candidate.name !== "string" ||
    candidate.name.trim() === "" ||
    typeof candidate.sourceHost !== "string" ||
    candidate.sourceHost.trim() === "" ||
    typeof candidate.targetHost !== "string" ||
    candidate.targetHost.trim() === "" ||
    typeof candidate.sourceDatabase !== "string" ||
    candidate.sourceDatabase.trim() === "" ||
    typeof candidate.targetDatabase !== "string" ||
    candidate.targetDatabase.trim() === ""
  ) {
    return null;
  }

  const collections = Array.isArray(candidate.collections)
    ? candidate.collections.filter(
        (collection): collection is string =>
          typeof collection === "string" && collection.trim() !== ""
      )
    : [];

  return {
    name: candidate.name,
    sourceHost: candidate.sourceHost,
    targetHost: candidate.targetHost,
    sourceDatabase: candidate.sourceDatabase,
    targetDatabase: candidate.targetDatabase,
    ...(collections.length > 0 ? { collections } : {}),
  };
}

function serializeHost(host: SavedHost): SavedHost | null {
  if (isCredentialHost(host)) {
    return {
      name: host.name,
      kind: "credential",
      credential: host.credential,
    };
  }

  if (isInlineHost(host)) {
    return {
      name: host.name,
      kind: "inline",
      connectionString: host.connectionString,
    };
  }

  if (isLegacyHost(host)) {
    return {
      name: host.name,
      connectionString: host.connectionString,
    };
  }

  return null;
}

function serializeTemplate(
  template: SavedCopyTemplate
): SavedCopyTemplate | null {
  return normalizeTemplate(template);
}

export function isCredentialHost(
  host: SavedHost
): host is SavedHost & { kind: "credential"; credential: CredentialRef } {
  return host.kind === "credential" && isCredentialRef(host.credential);
}

export function isInlineHost(
  host: SavedHost
): host is SavedHost & { kind: "inline"; connectionString: string } {
  return host.kind === "inline" && typeof host.connectionString === "string";
}

export function isLegacyHost(
  host: SavedHost
): host is SavedHost & { connectionString: string } {
  return !host.kind && typeof host.connectionString === "string";
}

export async function loadConfig(): Promise<Config> {
  try {
    const raw = await readFile(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<Config>;
    return {
      hosts: Array.isArray(parsed.hosts)
        ? parsed.hosts
            .map((host) => normalizeHost(host))
            .filter((host): host is SavedHost => Boolean(host))
        : getDefaultHosts(),
      templates: Array.isArray(parsed.templates)
        ? parsed.templates
            .map((template) => normalizeTemplate(template))
            .filter(
              (template): template is SavedCopyTemplate => Boolean(template)
            )
        : [],
    };
  } catch {
    return { hosts: getDefaultHosts(), templates: [] };
  }
}

async function saveConfig(config: Config): Promise<void> {
  await ensureConfigDir();
  await writeFile(
    CONFIG_FILE,
    JSON.stringify(
      {
        hosts: config.hosts
          .map((host) => serializeHost(host))
          .filter((host): host is SavedHost => Boolean(host)),
        templates: config.templates
          .map((template) => serializeTemplate(template))
          .filter(
            (template): template is SavedCopyTemplate => Boolean(template)
          ),
      },
      null,
      2
    ) + "\n",
    "utf-8"
  );
}

export async function addHost(host: SavedHost): Promise<void> {
  const config = await loadConfig();
  const existing = config.hosts.findIndex((h) => h.name === host.name);
  if (existing !== -1) {
    config.hosts[existing] = host;
  } else {
    config.hosts.push(host);
  }
  await saveConfig(config);
}

export async function addTemplate(
  template: SavedCopyTemplate
): Promise<void> {
  const config = await loadConfig();
  const existing = config.templates.findIndex((t) => t.name === template.name);
  if (existing !== -1) {
    config.templates[existing] = template;
  } else {
    config.templates.push(template);
  }
  await saveConfig(config);
}

export async function removeTemplate(name: string): Promise<void> {
  const config = await loadConfig();
  config.templates = config.templates.filter((t) => t.name !== name);
  await saveConfig(config);
}

export async function renameTemplate(
  oldName: string,
  newName: string
): Promise<void> {
  const config = await loadConfig();
  const template = config.templates.find((t) => t.name === oldName);
  if (template) {
    template.name = newName;
    await saveConfig(config);
  }
}

export async function removeHost(name: string): Promise<void> {
  const config = await loadConfig();
  config.hosts = config.hosts.filter((h) => h.name !== name);
  await saveConfig(config);
}

export async function renameHost(
  oldName: string,
  newName: string
): Promise<void> {
  const config = await loadConfig();
  const host = config.hosts.find((h) => h.name === oldName);
  if (host) {
    host.name = newName;
    await saveConfig(config);
  }
}

export function maskConnectionString(cs: string): string {
  try {
    const url = new URL(cs);
    if (url.password) {
      url.password = "***";
    }
    return url.toString();
  } catch {
    return cs.replace(/:([^@/]+)@/, ":***@");
  }
}
