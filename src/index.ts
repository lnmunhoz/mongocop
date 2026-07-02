#!/usr/bin/env tsx
import * as p from "@clack/prompts";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import {
  copyCollection,
  copyDatabase,
  listUserDatabases,
} from "./copy-database.js";
import {
  addHost,
  addTemplate,
  isCredentialHost,
  isLegacyHost,
  loadConfig,
  maskConnectionString,
  removeHost,
  removeTemplate,
  renameHost,
  renameTemplate,
  type SavedCopyTemplate,
  type SavedHost,
} from "./lib/config.js";
import {
  CredentialStoreError,
  createCredentialRef,
  getCredentialStore,
  getDefaultCredentialStore,
  type CredentialStoreName,
} from "./lib/credentials/index.js";
import { formatBytes, isValidDbName } from "./utils.js";

function exit(code: number): never {
  process.exit(code);
}

function readPackageVersion(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const packageJsonPath = resolve(currentDir, "../package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
    version?: string;
  };

  return packageJson.version ?? "unknown";
}

function printVersionIfRequested(args = process.argv.slice(2)): void {
  if (args.includes("--version") || args.includes("-v")) {
    console.log(`mongocop ${readPackageVersion()}`);
    exit(0);
  }
}

interface PickedConnection {
  connectionString: string;
  hostName?: string;
}

interface CopyRun {
  sourceClient: MongoClient;
  targetClient: MongoClient;
  sourceDbName: string;
  targetDbName: string;
  selectedCollections: string[];
}

interface SaveableCopy {
  sourceHostName?: string;
  targetHostName?: string;
  sourceDbName: string;
  targetDbName: string;
  selectedCollections: string[];
}

function describeStore(store: CredentialStoreName): string {
  if (store === "keychain") {
    return "macOS Keychain";
  }
  return store;
}

function hostHint(host: SavedHost): string | undefined {
  if (isCredentialHost(host)) {
    return `Stored in ${describeStore(host.credential.store)}`;
  }
  if (typeof host.connectionString === "string") {
    return maskConnectionString(host.connectionString);
  }
  return undefined;
}

function toErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof CredentialStoreError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

async function resolveHostConnectionString(host: SavedHost): Promise<string> {
  if (isCredentialHost(host)) {
    const store = getCredentialStore(host.credential.store);
    const value = await store.get(host.credential);
    if (!value) {
      throw new CredentialStoreError(
        "backend_error",
        `Saved credential not found in ${describeStore(host.credential.store)}.`
      );
    }
    return value;
  }

  if (typeof host.connectionString === "string") {
    return host.connectionString;
  }

  throw new CredentialStoreError(
    "backend_error",
    `Connection "${host.name}" has no stored credential.`
  );
}

async function migrateLegacyHosts(hosts: SavedHost[]): Promise<void> {
  const legacyHosts = hosts.filter(isLegacyHost);
  if (legacyHosts.length === 0) return;

  p.log.warn(
    `Found ${legacyHosts.length} legacy connection(s) stored in plaintext config.`
  );

  const shouldMigrate = await p.confirm({
    message: "Migrate legacy connections to macOS Keychain now?",
    initialValue: true,
  });

  if (p.isCancel(shouldMigrate)) {
    p.cancel("Cancelled.");
    exit(0);
  }

  if (!shouldMigrate) {
    p.log.warn("Legacy plaintext connections were kept for now.");
    return;
  }

  let migratedCount = 0;
  for (const host of legacyHosts) {
    const ref = createCredentialRef();
    const store = getCredentialStore(ref.store);

    try {
      await store.set(ref, host.connectionString);
      try {
        await addHost({
          name: host.name,
          kind: "credential",
          credential: ref,
        });
      } catch (cause) {
        await store.delete(ref).catch(() => undefined);
        throw cause;
      }
      migratedCount += 1;
    } catch (err) {
      p.log.error(
        `Could not migrate "${host.name}": ${toErrorMessage(
          err,
          "Unknown keychain error."
        )}`
      );
    }
  }

  if (migratedCount > 0) {
    p.log.success(
      `Migrated ${migratedCount}/${legacyHosts.length} connection(s) to macOS Keychain.`
    );
  }

  if (migratedCount < legacyHosts.length) {
    p.log.warn(
      `${legacyHosts.length - migratedCount} connection(s) remain in legacy plaintext format.`
    );
  }
}

async function manageConnections(hosts: SavedHost[]): Promise<void> {
  // Pick which connection to manage
  const host = await p.select({
    message: "Which connection?",
    options: hosts.map((h) => ({
      value: h.name,
      label: h.name,
      hint: hostHint(h),
    })),
  });

  if (p.isCancel(host)) return;
  const selectedHost = hosts.find((h) => h.name === host);
  if (!selectedHost) return;

  const action = await p.select({
    message: `"${selectedHost.name}"`,
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
      initialValue: selectedHost.name,
      validate: (v) => (!v ? "Name is required" : undefined),
    });

    if (p.isCancel(newName)) return;

    await renameHost(selectedHost.name, newName as string);
    p.log.success(`Renamed "${selectedHost.name}" → "${newName as string}"`);
  }

  if (action === "delete") {
    const confirm = await p.confirm({
      message: `Delete "${selectedHost.name}"?`,
      initialValue: false,
    });

    if (p.isCancel(confirm) || !confirm) return;

    if (isCredentialHost(selectedHost)) {
      const store = getCredentialStore(selectedHost.credential.store);
      try {
        await store.delete(selectedHost.credential);
      } catch (err) {
        p.log.warn(
          `Removed config entry but could not delete keychain item: ${toErrorMessage(
            err,
            "Unknown keychain error."
          )}`
        );
      }
    }

    await removeHost(selectedHost.name);
    p.log.success(`Deleted "${selectedHost.name}"`);
  }
}

async function pickConnectionString(
  message = "Select a host",
  excludeConnectionString?: string
): Promise<PickedConnection> {
  // Env var takes priority — skip host selection entirely
  if (process.env.MONGODB_URL) {
    p.log.info(`Using MONGODB_URL from environment.`);
    return { connectionString: process.env.MONGODB_URL };
  }

  // Loop so user can manage connections and come back to selection
  let hasCheckedLegacyMigration = false;
  while (true) {
    const config = await loadConfig();
    if (!hasCheckedLegacyMigration) {
      await migrateLegacyHosts(config.hosts);
      hasCheckedLegacyMigration = true;
    }
    const refreshedConfig = await loadConfig();
    const selectableHosts = refreshedConfig.hosts;

    if (selectableHosts.length > 0) {
      const options: { value: string; label: string; hint?: string }[] =
        selectableHosts.map((host) => ({
          value: host.name,
          label: host.name,
          hint: hostHint(host),
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
        await manageConnections(selectableHosts);
        continue;
      }

      if (choice !== "__new__") {
        const selectedHost = selectableHosts.find((host) => host.name === choice);
        if (!selectedHost) continue;

        try {
          const resolved = await resolveHostConnectionString(selectedHost);
          if (excludeConnectionString && resolved === excludeConnectionString) {
            p.log.warn("Please choose a different host than the source.");
            continue;
          }
          return { connectionString: resolved, hostName: selectedHost.name };
        } catch (err) {
          p.log.error(
            `Could not load "${selectedHost.name}": ${toErrorMessage(
              err,
              "Unknown credential-store error."
            )}`
          );
          continue;
        }
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

      const credentialRef = createCredentialRef();
      const defaultStore = getDefaultCredentialStore();
      try {
        await defaultStore.set(credentialRef, connectionString as string);
        try {
          await addHost({
            name: name as string,
            kind: "credential",
            credential: credentialRef,
          });
        } catch (cause) {
          await defaultStore.delete(credentialRef).catch(() => undefined);
          throw cause;
        }
        p.log.success(
          `Saved as "${name as string}" in ${describeStore(defaultStore.name)}.`
        );
        if (
          !excludeConnectionString ||
          connectionString !== excludeConnectionString
        ) {
          return {
            connectionString: connectionString as string,
            hostName: name as string,
          };
        }
      } catch (err) {
        p.log.error(
          `Could not save "${name as string}": ${toErrorMessage(
            err,
            "Unknown credential-store error."
          )}`
        );
      }
    }

    if (
      excludeConnectionString &&
      connectionString === excludeConnectionString
    ) {
      p.log.warn("Please enter a different host than the source.");
      continue;
    }

    return { connectionString: connectionString as string };
  }
}

function templateHint(template: SavedCopyTemplate): string {
  const scope =
    template.collections && template.collections.length > 0
      ? `${template.collections.length} collection(s)`
      : "Entire database";
  return `${template.sourceHost}/${template.sourceDatabase} to ${template.targetHost}/${template.targetDatabase} (${scope})`;
}

async function manageTemplates(
  templates: SavedCopyTemplate[]
): Promise<void> {
  const choice = await p.select({
    message: "Which template?",
    options: templates.map((template, index) => ({
      value: String(index),
      label: template.name,
      hint: templateHint(template),
    })),
  });

  if (p.isCancel(choice)) return;

  const selectedTemplate = templates[Number(choice)];
  if (!selectedTemplate) return;

  const action = await p.select({
    message: `"${selectedTemplate.name}"`,
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
      initialValue: selectedTemplate.name,
      validate: (v) => (!v ? "Name is required" : undefined),
    });

    if (p.isCancel(newName)) return;

    await renameTemplate(selectedTemplate.name, newName as string);
    p.log.success(`Renamed "${selectedTemplate.name}" → "${newName as string}"`);
  }

  if (action === "delete") {
    const confirm = await p.confirm({
      message: `Delete "${selectedTemplate.name}"?`,
      initialValue: false,
    });

    if (p.isCancel(confirm) || !confirm) return;

    await removeTemplate(selectedTemplate.name);
    p.log.success(`Deleted "${selectedTemplate.name}"`);
  }
}

async function pickStartAction(): Promise<
  { type: "new" } | { type: "template"; template: SavedCopyTemplate }
> {
  while (true) {
    const config = await loadConfig();
    if (config.templates.length === 0) {
      return { type: "new" };
    }

    const choice = await p.select({
      message: "What do you want to copy?",
      options: [
        ...config.templates.map((template, index) => ({
          value: `template:${index}`,
          label: template.name,
          hint: templateHint(template),
        })),
        { value: "__new__", label: "New copy" },
        { value: "__manage__", label: "Manage templates" },
      ],
    });

    if (p.isCancel(choice)) {
      p.cancel("Cancelled.");
      exit(0);
    }

    if (choice === "__new__") {
      return { type: "new" };
    }

    if (choice === "__manage__") {
      await manageTemplates(config.templates);
      continue;
    }

    const index = Number(String(choice).replace("template:", ""));
    const template = config.templates[index];
    if (template) {
      return { type: "template", template };
    }

    p.log.warn("Template not found.");
  }
}

async function connectClient(
  connectionString: string,
  label: "source" | "target"
): Promise<MongoClient> {
  const spinner = p.spinner();
  spinner.start(`Connecting to ${label}...`);

  try {
    const client = await MongoClient.connect(connectionString);
    spinner.stop(`Connected to ${label}.`);
    return client;
  } catch (err) {
    spinner.stop("Connection failed.");
    p.log.error(
      `Could not connect: ${err instanceof Error ? err.message : err}`
    );
    exit(1);
  }
}

async function pickTargetDatabase(
  targetClient: MongoClient,
  sourceDbName: string,
  copyTarget: "same" | "different"
): Promise<string> {
  const targetDatabases = await listUserDatabases(targetClient);

  if (targetDatabases.length > 0) {
    const selectableTargetDatabases =
      copyTarget === "same"
        ? targetDatabases.filter((db) => db.name !== sourceDbName)
        : targetDatabases;

    const targetDbOptions: { value: string; label: string; hint?: string }[] =
      selectableTargetDatabases.map((db) => ({
        value: db.name,
        label: db.name,
        hint: formatBytes(db.sizeOnDisk),
      }));

    targetDbOptions.push({
      value: "__new__",
      label: "Create new database",
    });

    const targetDbChoice = await p.select({
      message: "Target database",
      options: targetDbOptions,
    });

    if (p.isCancel(targetDbChoice)) {
      p.cancel("Cancelled.");
      exit(0);
    }

    if (targetDbChoice !== "__new__") {
      return targetDbChoice as string;
    }
  }

  const newDbName = await p.text({
    message:
      targetDatabases.length > 0 ? "New database name" : "Target database name",
    placeholder: `${sourceDbName}-copy`,
    validate: (name) =>
      copyTarget === "same" && name === sourceDbName
        ? "Target database must be different from source database"
        : isValidDbName(name),
  });

  if (p.isCancel(newDbName)) {
    p.cancel("Cancelled.");
    exit(0);
  }

  return newDbName as string;
}

async function runCopy({
  sourceClient,
  targetClient,
  sourceDbName,
  targetDbName,
  selectedCollections,
}: CopyRun): Promise<void> {
  if (selectedCollections.length > 0) {
    const existingTargetColls = (
      await targetClient.db(targetDbName).listCollections().toArray()
    ).map((c) => c.name);

    const conflicting = selectedCollections.filter((name) =>
      existingTargetColls.includes(name)
    );

    if (conflicting.length > 0) {
      const overwrite = await p.confirm({
        message: `${conflicting.length} collection(s) already exist in "${targetDbName}" (${conflicting.join(", ")}). Drop and overwrite?`,
        initialValue: false,
      });

      if (p.isCancel(overwrite) || !overwrite) {
        p.cancel("Cancelled.");
        exit(0);
      }

      const dropSpinner = p.spinner();
      dropSpinner.start("Dropping existing collections...");
      for (const name of conflicting) {
        await targetClient.db(targetDbName).collection(name).drop();
      }
      dropSpinner.stop(`Dropped ${conflicting.length} collection(s).`);
    }

    const proceed = await p.confirm({
      message: `Copy ${selectedCollections.length} collection(s) from "${sourceDbName}" to "${targetDbName}"?`,
    });

    if (p.isCancel(proceed) || !proceed) {
      p.cancel("Cancelled.");
      exit(0);
    }

    const copySpinner = p.spinner();
    copySpinner.start("Starting copy...");

    let totalDocuments = 0;

    for (let i = 0; i < selectedCollections.length; i++) {
      const collName = selectedCollections[i];
      const result = await copyCollection(
        sourceClient,
        targetClient,
        sourceDbName,
        targetDbName,
        collName,
        ({ docCount }) => {
          copySpinner.message(
            `Copied ${collName} (${docCount} docs) [${i + 1}/${selectedCollections.length}]`
          );
        }
      );
      totalDocuments += result.documents;
    }

    copySpinner.stop("Copy complete.");

    p.log.success(
      `Copied ${selectedCollections.length} collection(s), ${totalDocuments.toLocaleString()} documents.`
    );
    return;
  }

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
}

async function maybeSaveTemplate(copy: SaveableCopy): Promise<void> {
  if (!copy.sourceHostName || !copy.targetHostName) {
    return;
  }

  const shouldSave = await p.confirm({
    message: "Save this copy as a template?",
    initialValue: false,
  });

  if (p.isCancel(shouldSave) || !shouldSave) return;

  const name = await p.text({
    message: "Template name",
    placeholder: `${copy.sourceDbName} to ${copy.targetDbName}`,
    validate: (v) => (!v ? "Name is required" : undefined),
  });

  if (p.isCancel(name)) return;

  await addTemplate({
    name: name as string,
    sourceHost: copy.sourceHostName,
    targetHost: copy.targetHostName,
    sourceDatabase: copy.sourceDbName,
    targetDatabase: copy.targetDbName,
    ...(copy.selectedCollections.length > 0
      ? { collections: copy.selectedCollections }
      : {}),
  });
  p.log.success(`Saved template "${name as string}".`);
}

async function runInteractiveCopy(): Promise<void> {
  const source = await pickConnectionString("Source host");
  const sourceClient = await connectClient(source.connectionString, "source");
  let targetClient: MongoClient = sourceClient;
  let targetHostName = source.hostName;

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

    const copyMode = await p.select({
      message: "What do you want to copy?",
      options: [
        { value: "database" as const, label: "Entire database" },
        { value: "collections" as const, label: "Selected collections" },
      ],
    });

    if (p.isCancel(copyMode)) {
      p.cancel("Cancelled.");
      exit(0);
    }

    let selectedCollections: string[] = [];

    if (copyMode === "collections") {
      const collections = (
        await sourceClient.db(sourceDbName).listCollections().toArray()
      ).filter((c) => c.type !== "view");

      if (collections.length === 0) {
        p.log.warn("No collections found.");
        exit(0);
      }

      const collChoices = await p.multiselect({
        message: "Select collections",
        options: collections.map((c) => ({
          value: c.name,
          label: c.name,
        })),
        required: true,
      });

      if (p.isCancel(collChoices)) {
        p.cancel("Cancelled.");
        exit(0);
      }

      selectedCollections = collChoices as string[];
    }

    const copyTarget = await p.select({
      message: "Copy to same host or different host?",
      options: [
        { value: "different" as const, label: "Different host" },
        { value: "same" as const, label: "Same host" },
      ],
    });

    if (p.isCancel(copyTarget)) {
      p.cancel("Cancelled.");
      exit(0);
    }

    if (copyTarget === "different") {
      const target = await pickConnectionString(
        "Target host",
        source.connectionString
      );
      targetHostName = target.hostName;
      targetClient = await connectClient(target.connectionString, "target");
    }

    const targetDbName = await pickTargetDatabase(
      targetClient,
      sourceDbName,
      copyTarget
    );

    await runCopy({
      sourceClient,
      targetClient,
      sourceDbName,
      targetDbName,
      selectedCollections,
    });

    await maybeSaveTemplate({
      sourceHostName: source.hostName,
      targetHostName,
      sourceDbName,
      targetDbName,
      selectedCollections,
    });
  } finally {
    await sourceClient.close();
    if (targetClient !== sourceClient) {
      await targetClient.close();
    }
  }
}

async function runTemplateCopy(
  template: SavedCopyTemplate
): Promise<boolean> {
  const config = await loadConfig();
  const sourceHost = config.hosts.find(
    (host) => host.name === template.sourceHost
  );
  const targetHost = config.hosts.find(
    (host) => host.name === template.targetHost
  );

  if (!sourceHost) {
    p.log.error(`Template source host "${template.sourceHost}" was not found.`);
    return false;
  }

  if (!targetHost) {
    p.log.error(`Template target host "${template.targetHost}" was not found.`);
    return false;
  }

  let sourceConnectionString: string;
  let targetConnectionString: string;
  try {
    sourceConnectionString = await resolveHostConnectionString(sourceHost);
    targetConnectionString = await resolveHostConnectionString(targetHost);
  } catch (err) {
    p.log.error(
      `Could not load template hosts: ${toErrorMessage(
        err,
        "Unknown credential-store error."
      )}`
    );
    return false;
  }

  if (
    sourceConnectionString === targetConnectionString &&
    template.sourceDatabase === template.targetDatabase
  ) {
    p.log.error("Template source and target are the same database.");
    return false;
  }

  const sourceClient = await connectClient(sourceConnectionString, "source");
  let targetClient: MongoClient = sourceClient;

  try {
    const databases = await listUserDatabases(sourceClient);
    if (!databases.some((db) => db.name === template.sourceDatabase)) {
      p.log.error(
        `Template source database "${template.sourceDatabase}" was not found.`
      );
      return false;
    }

    const selectedCollections = template.collections ?? [];
    if (selectedCollections.length > 0) {
      const sourceCollections = (
        await sourceClient
          .db(template.sourceDatabase)
          .listCollections()
          .toArray()
      )
        .filter((collection) => collection.type !== "view")
        .map((collection) => collection.name);
      const missingCollections = selectedCollections.filter(
        (collection) => !sourceCollections.includes(collection)
      );

      if (missingCollections.length > 0) {
        p.log.error(
          `Template collection(s) not found: ${missingCollections.join(", ")}`
        );
        return false;
      }
    }

    if (targetConnectionString !== sourceConnectionString) {
      targetClient = await connectClient(targetConnectionString, "target");
    }

    await runCopy({
      sourceClient,
      targetClient,
      sourceDbName: template.sourceDatabase,
      targetDbName: template.targetDatabase,
      selectedCollections,
    });
    return true;
  } finally {
    await sourceClient.close();
    if (targetClient !== sourceClient) {
      await targetClient.close();
    }
  }
}

async function main() {
  p.intro("mongocop");

  while (true) {
    const action = await pickStartAction();
    if (action.type === "new") {
      await runInteractiveCopy();
      break;
    }

    const completed = await runTemplateCopy(action.template);
    if (completed) {
      break;
    }
  }

  p.outro("Done!");
}

printVersionIfRequested();

main().catch((err) => {
  console.error(err);
  exit(1);
});
