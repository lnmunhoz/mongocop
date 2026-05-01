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

interface Config {
  hosts: SavedHost[];
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
    if (!Array.isArray(parsed.hosts)) {
      return { hosts: getDefaultHosts() };
    }
    return {
      hosts: parsed.hosts
        .map((host) => normalizeHost(host))
        .filter((host): host is SavedHost => Boolean(host)),
    };
  } catch {
    return { hosts: getDefaultHosts() };
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
