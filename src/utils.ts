export const SYSTEM_DBS = new Set(["admin", "local", "config"]);

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function isValidDbName(name: string): string | undefined {
  if (!name) return "Database name cannot be empty";
  if (name.length > 64) return "Database name must be 64 characters or fewer";
  if (/[\/\\. "$*<>:|?]/.test(name))
    return 'Database name cannot contain / \\ . " $ * < > : | ?';
  if (SYSTEM_DBS.has(name))
    return `Cannot use system database name "${name}"`;
  return undefined;
}

const INDEX_META_FIELDS = new Set(["v", "ns", "background", "name"]);

export function stripIndexMeta(
  indexInfo: Record<string, unknown>
): Record<string, unknown> {
  const stripped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(indexInfo)) {
    if (!INDEX_META_FIELDS.has(key)) {
      stripped[key] = value;
    }
  }
  return stripped;
}
