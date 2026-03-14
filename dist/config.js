import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
const CONFIG_DIR = join(homedir(), ".mongocop");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
async function ensureConfigDir() {
    await mkdir(CONFIG_DIR, { recursive: true });
}
const DEFAULT_HOSTS = [
    { name: "localhost", connectionString: "mongodb://localhost:27017" },
];
export async function loadConfig() {
    try {
        const raw = await readFile(CONFIG_FILE, "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return { hosts: DEFAULT_HOSTS };
    }
}
async function saveConfig(config) {
    await ensureConfigDir();
    await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf-8");
}
export async function addHost(host) {
    const config = await loadConfig();
    const existing = config.hosts.findIndex((h) => h.name === host.name);
    if (existing !== -1) {
        config.hosts[existing] = host;
    }
    else {
        config.hosts.push(host);
    }
    await saveConfig(config);
}
export async function removeHost(name) {
    const config = await loadConfig();
    config.hosts = config.hosts.filter((h) => h.name !== name);
    await saveConfig(config);
}
export async function renameHost(oldName, newName) {
    const config = await loadConfig();
    const host = config.hosts.find((h) => h.name === oldName);
    if (host) {
        host.name = newName;
        await saveConfig(config);
    }
}
export function maskConnectionString(cs) {
    try {
        const url = new URL(cs);
        if (url.password) {
            url.password = "***";
        }
        return url.toString();
    }
    catch {
        return cs.replace(/:([^@/]+)@/, ":***@");
    }
}
