#!/usr/bin/env tsx
import * as p from "@clack/prompts";
import { MongoClient } from "mongodb";
import { copyDatabase, listUserDatabases } from "./copy-database.js";
import {
  addHost,
  loadConfig,
  maskConnectionString,
  removeHost,
  renameHost,
  type SavedHost,
} from "./config.js";
import { formatBytes, isValidDbName } from "./utils.js";

function exit(code: number): never {
  process.exit(code);
}

async function manageConnections(hosts: SavedHost[]): Promise<void> {
  // Pick which connection to manage
  const host = await p.select({
    message: "Which connection?",
    options: hosts.map((h) => ({
      value: h,
      label: h.name,
      hint: maskConnectionString(h.connectionString),
    })),
  });

  if (p.isCancel(host)) return;

  const action = await p.select({
    message: `"${host.name}"`,
    options: [
      { value: "rename" as const, label: "Rename" },
      { value: "delete" as const, label: "Delete" },
      { value: "back" as const, label: "Back" },
    ],
  });

  if (p.isCancel(action) || action === "back") return;

  if (action === "rename") {
    const newName = await p.text({
      message: "New name",
      initialValue: host.name,
      validate: (v) => (!v ? "Name is required" : undefined),
    });

    if (p.isCancel(newName)) return;

    await renameHost(host.name, newName as string);
    p.log.success(`Renamed "${host.name}" → "${newName as string}"`);
  }

  if (action === "delete") {
    const confirm = await p.confirm({
      message: `Delete "${host.name}"?`,
      initialValue: false,
    });

    if (p.isCancel(confirm) || !confirm) return;

    await removeHost(host.name);
    p.log.success(`Deleted "${host.name}"`);
  }
}

async function pickConnectionString(
  message = "Select a host"
): Promise<string> {
  // Env var takes priority — skip host selection entirely
  if (process.env.MONGODB_URL) {
    p.log.info(`Using MONGODB_URL from environment.`);
    return process.env.MONGODB_URL;
  }

  // Loop so user can manage connections and come back to selection
  while (true) {
    const config = await loadConfig();

    if (config.hosts.length > 0) {
      const options: { value: string; label: string; hint?: string }[] =
        config.hosts.map((host) => ({
          value: host.connectionString,
          label: host.name,
          hint: maskConnectionString(host.connectionString),
        }));

      options.push(
        { value: "__new__", label: "Add new connection" },
        { value: "__manage__", label: "Manage connections" }
      );

      const choice = await p.select({
        message,
        options,
      });

      if (p.isCancel(choice)) {
        p.cancel("Cancelled.");
        exit(0);
      }

      if (choice === "__manage__") {
        await manageConnections(config.hosts);
        continue;
      }

      if (choice !== "__new__") {
        return choice as string;
      }
    }

    // Prompt for a new connection string
    const connectionString = await p.text({
      message: "MongoDB connection string",
      placeholder: "mongodb+srv://user:pass@host",
      validate: (v) => (!v ? "Connection string is required" : undefined),
    });

    if (p.isCancel(connectionString)) {
      p.cancel("Cancelled.");
      exit(0);
    }

    // Offer to save it
    const shouldSave = await p.confirm({
      message: "Save this connection for next time?",
    });

    if (p.isCancel(shouldSave)) {
      p.cancel("Cancelled.");
      exit(0);
    }

    if (shouldSave) {
      const name = await p.text({
        message: "Name for this connection",
        placeholder: "production",
        validate: (v) => (!v ? "Name is required" : undefined),
      });

      if (p.isCancel(name)) {
        p.cancel("Cancelled.");
        exit(0);
      }

      await addHost({ name: name as string, connectionString: connectionString as string });
      p.log.success(`Saved as "${name as string}" in ~/.mongocop/config.json`);
    }

    return connectionString as string;
  }
}

async function main() {
  p.intro("mongocop");

  // --- Source host ---
  const sourceConnectionString = await pickConnectionString("Source host");

  const sourceSpinner = p.spinner();
  sourceSpinner.start("Connecting to source...");

  let sourceClient!: MongoClient;
  try {
    sourceClient = await MongoClient.connect(sourceConnectionString);
    sourceSpinner.stop("Connected to source.");
  } catch (err) {
    sourceSpinner.stop("Connection failed.");
    p.log.error(
      `Could not connect: ${err instanceof Error ? err.message : err}`
    );
    exit(1);
  }

  let targetClient: MongoClient = sourceClient;

  try {
    const databases = await listUserDatabases(sourceClient);

    if (databases.length === 0) {
      p.log.warn("No user databases found.");
      exit(0);
    }

    const sourceDb = await p.select({
      message: "Source database",
      options: databases.map((db) => ({
        value: db.name,
        label: db.name,
        hint: formatBytes(db.sizeOnDisk),
      })),
    });

    if (p.isCancel(sourceDb)) {
      p.cancel("Cancelled.");
      exit(0);
    }

    const sourceDbName = sourceDb as string;

    // --- Same or different host? ---
    const copyTarget = await p.select({
      message: "Copy to same host or different host?",
      options: [
        { value: "same" as const, label: "Same host" },
        { value: "different" as const, label: "Different host" },
      ],
    });

    if (p.isCancel(copyTarget)) {
      p.cancel("Cancelled.");
      exit(0);
    }

    if (copyTarget === "different") {
      const targetConnectionString =
        await pickConnectionString("Target host");

      const targetSpinner = p.spinner();
      targetSpinner.start("Connecting to target...");

      try {
        targetClient = await MongoClient.connect(targetConnectionString);
        targetSpinner.stop("Connected to target.");
      } catch (err) {
        targetSpinner.stop("Connection failed.");
        p.log.error(
          `Could not connect: ${err instanceof Error ? err.message : err}`
        );
        exit(1);
      }
    }

    const targetDb = await p.text({
      message: "Target database name",
      placeholder: `${sourceDbName}-copy`,
      validate: isValidDbName,
    });

    if (p.isCancel(targetDb)) {
      p.cancel("Cancelled.");
      exit(0);
    }

    const targetDbName = targetDb as string;

    // Check if target exists
    const targetDatabases = await listUserDatabases(targetClient);
    const existingDbs = targetDatabases.map((db) => db.name);
    if (existingDbs.includes(targetDbName)) {
      const overwrite = await p.confirm({
        message: `Database "${targetDbName}" already exists on target. Drop it and overwrite?`,
        initialValue: false,
      });

      if (p.isCancel(overwrite) || !overwrite) {
        p.cancel("Cancelled.");
        exit(0);
      }

      const dropSpinner = p.spinner();
      dropSpinner.start(`Dropping "${targetDbName}"...`);
      await targetClient.db(targetDbName).dropDatabase();
      dropSpinner.stop(`Dropped "${targetDbName}".`);
    }

    // Get collection count for confirmation
    const sourceCollections = (
      await sourceClient.db(sourceDbName).listCollections().toArray()
    ).filter((c) => c.type !== "view");

    const proceed = await p.confirm({
      message: `Copy ${sourceCollections.length} collections from "${sourceDbName}" to "${targetDbName}"?`,
    });

    if (p.isCancel(proceed) || !proceed) {
      p.cancel("Cancelled.");
      exit(0);
    }

    const copySpinner = p.spinner();
    copySpinner.start("Starting copy...");

    const summary = await copyDatabase(
      sourceClient,
      targetClient,
      sourceDbName,
      targetDbName,
      ({ collection, index, total, docCount }) => {
        copySpinner.message(
          `Copied ${collection} (${docCount} docs) [${index}/${total}]`
        );
      }
    );

    copySpinner.stop("Copy complete.");

    p.log.success(
      `Copied ${summary.collections} collections, ${summary.documents.toLocaleString()} documents.`
    );
  } finally {
    await sourceClient.close();
    if (targetClient !== sourceClient) {
      await targetClient.close();
    }
  }

  p.outro("Done!");
}

main().catch((err) => {
  console.error(err);
  exit(1);
});
