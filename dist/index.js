#!/usr/bin/env node
import * as p from "@clack/prompts";
import { MongoClient } from "mongodb";
import { copyCollection, copyDatabase, listUserDatabases, } from "./copy-database.js";
import { addHost, loadConfig, maskConnectionString, removeHost, renameHost, } from "./config.js";
import { formatBytes, isValidDbName } from "./utils.js";
function exit(code) {
    process.exit(code);
}
async function manageConnections(hosts) {
    // Pick which connection to manage
    const host = await p.select({
        message: "Which connection?",
        options: hosts.map((h) => ({
            value: h,
            label: h.name,
            hint: maskConnectionString(h.connectionString),
        })),
    });
    if (p.isCancel(host))
        return;
    const action = await p.select({
        message: `"${host.name}"`,
        options: [
            { value: "rename", label: "Rename" },
            { value: "delete", label: "Delete" },
            { value: "back", label: "Back" },
        ],
    });
    if (p.isCancel(action) || action === "back")
        return;
    if (action === "rename") {
        const newName = await p.text({
            message: "New name",
            initialValue: host.name,
            validate: (v) => (!v ? "Name is required" : undefined),
        });
        if (p.isCancel(newName))
            return;
        await renameHost(host.name, newName);
        p.log.success(`Renamed "${host.name}" → "${newName}"`);
    }
    if (action === "delete") {
        const confirm = await p.confirm({
            message: `Delete "${host.name}"?`,
            initialValue: false,
        });
        if (p.isCancel(confirm) || !confirm)
            return;
        await removeHost(host.name);
        p.log.success(`Deleted "${host.name}"`);
    }
}
async function pickConnectionString(message = "Select a host") {
    // Env var takes priority — skip host selection entirely
    if (process.env.MONGODB_URL) {
        p.log.info(`Using MONGODB_URL from environment.`);
        return process.env.MONGODB_URL;
    }
    // Loop so user can manage connections and come back to selection
    while (true) {
        const config = await loadConfig();
        if (config.hosts.length > 0) {
            const options = config.hosts.map((host) => ({
                value: host.connectionString,
                label: host.name,
                hint: maskConnectionString(host.connectionString),
            }));
            options.push({ value: "__new__", label: "Add new connection" }, { value: "__manage__", label: "Manage connections" });
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
                return choice;
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
            await addHost({ name: name, connectionString: connectionString });
            p.log.success(`Saved as "${name}" in ~/.mongocop/config.json`);
        }
        return connectionString;
    }
}
async function main() {
    p.intro("mongocop");
    // --- Source host ---
    const sourceConnectionString = await pickConnectionString("Source host");
    const sourceSpinner = p.spinner();
    sourceSpinner.start("Connecting to source...");
    let sourceClient;
    try {
        sourceClient = await MongoClient.connect(sourceConnectionString);
        sourceSpinner.stop("Connected to source.");
    }
    catch (err) {
        sourceSpinner.stop("Connection failed.");
        p.log.error(`Could not connect: ${err instanceof Error ? err.message : err}`);
        exit(1);
    }
    let targetClient = sourceClient;
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
        const sourceDbName = sourceDb;
        // --- Entire database or selected collections? ---
        const copyMode = await p.select({
            message: "What do you want to copy?",
            options: [
                { value: "database", label: "Entire database" },
                { value: "collections", label: "Selected collections" },
            ],
        });
        if (p.isCancel(copyMode)) {
            p.cancel("Cancelled.");
            exit(0);
        }
        let selectedCollections = [];
        if (copyMode === "collections") {
            const collections = (await sourceClient.db(sourceDbName).listCollections().toArray()).filter((c) => c.type !== "view");
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
            selectedCollections = collChoices;
        }
        // --- Same or different host? ---
        const copyTarget = await p.select({
            message: "Copy to same host or different host?",
            options: [
                { value: "same", label: "Same host" },
                { value: "different", label: "Different host" },
            ],
        });
        if (p.isCancel(copyTarget)) {
            p.cancel("Cancelled.");
            exit(0);
        }
        if (copyTarget === "different") {
            const targetConnectionString = await pickConnectionString("Target host");
            const targetSpinner = p.spinner();
            targetSpinner.start("Connecting to target...");
            try {
                targetClient = await MongoClient.connect(targetConnectionString);
                targetSpinner.stop("Connected to target.");
            }
            catch (err) {
                targetSpinner.stop("Connection failed.");
                p.log.error(`Could not connect: ${err instanceof Error ? err.message : err}`);
                exit(1);
            }
        }
        // --- Pick or create target database ---
        const targetDatabases = await listUserDatabases(targetClient);
        let targetDbName;
        if (targetDatabases.length > 0) {
            const targetDbOptions = targetDatabases.map((db) => ({
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
            if (targetDbChoice === "__new__") {
                const newDbName = await p.text({
                    message: "New database name",
                    placeholder: `${sourceDbName}-copy`,
                    validate: isValidDbName,
                });
                if (p.isCancel(newDbName)) {
                    p.cancel("Cancelled.");
                    exit(0);
                }
                targetDbName = newDbName;
            }
            else {
                targetDbName = targetDbChoice;
            }
        }
        else {
            const newDbName = await p.text({
                message: "Target database name",
                placeholder: `${sourceDbName}-copy`,
                validate: isValidDbName,
            });
            if (p.isCancel(newDbName)) {
                p.cancel("Cancelled.");
                exit(0);
            }
            targetDbName = newDbName;
        }
        if (selectedCollections.length > 0) {
            // --- Selected collections: check for existing ones in target ---
            const existingTargetColls = (await targetClient.db(targetDbName).listCollections().toArray()).map((c) => c.name);
            const conflicting = selectedCollections.filter((name) => existingTargetColls.includes(name));
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
                const result = await copyCollection(sourceClient, targetClient, sourceDbName, targetDbName, collName, ({ docCount }) => {
                    copySpinner.message(`Copied ${collName} (${docCount} docs) [${i + 1}/${selectedCollections.length}]`);
                });
                totalDocuments += result.documents;
            }
            copySpinner.stop("Copy complete.");
            p.log.success(`Copied ${selectedCollections.length} collection(s), ${totalDocuments.toLocaleString()} documents.`);
        }
        else {
            // --- Entire database: check if target DB exists ---
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
            const sourceCollections = (await sourceClient.db(sourceDbName).listCollections().toArray()).filter((c) => c.type !== "view");
            const proceed = await p.confirm({
                message: `Copy ${sourceCollections.length} collections from "${sourceDbName}" to "${targetDbName}"?`,
            });
            if (p.isCancel(proceed) || !proceed) {
                p.cancel("Cancelled.");
                exit(0);
            }
            const copySpinner = p.spinner();
            copySpinner.start("Starting copy...");
            const summary = await copyDatabase(sourceClient, targetClient, sourceDbName, targetDbName, ({ collection, index, total, docCount }) => {
                copySpinner.message(`Copied ${collection} (${docCount} docs) [${index}/${total}]`);
            });
            copySpinner.stop("Copy complete.");
            p.log.success(`Copied ${summary.collections} collections, ${summary.documents.toLocaleString()} documents.`);
        }
    }
    finally {
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
