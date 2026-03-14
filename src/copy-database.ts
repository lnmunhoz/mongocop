import { MongoClient } from "mongodb";
import { SYSTEM_DBS, stripIndexMeta } from "./utils.js";

const BATCH_SIZE = 1000;

export interface DatabaseInfo {
  name: string;
  sizeOnDisk: number;
}

export interface CopyProgress {
  collection: string;
  index: number;
  total: number;
  docCount: number;
}

export interface CopySummary {
  collections: number;
  documents: number;
}

export async function listUserDatabases(
  client: MongoClient
): Promise<DatabaseInfo[]> {
  const result = await client.db().admin().listDatabases();
  return result.databases
    .filter((db) => !SYSTEM_DBS.has(db.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((db) => ({ name: db.name, sizeOnDisk: db.sizeOnDisk ?? 0 }));
}

export async function copyCollection(
  sourceClient: MongoClient,
  targetClient: MongoClient,
  sourceDbName: string,
  targetDbName: string,
  collectionName: string,
  onProgress?: (progress: CopyProgress) => void
): Promise<CopySummary> {
  const sourceColl = sourceClient.db(sourceDbName).collection(collectionName);
  const targetColl = targetClient.db(targetDbName).collection(collectionName);

  // Copy indexes (skip default _id_)
  const indexes = await sourceColl.indexes();
  const customIndexes = indexes
    .filter((idx) => idx.name !== "_id_")
    .map((idx) => {
      const { key, ...rest } = stripIndexMeta(idx) as {
        key: Record<string, unknown>;
        [k: string]: unknown;
      };
      return { key, ...rest };
    });

  if (customIndexes.length > 0) {
    await targetColl.createIndexes(
      customIndexes as Parameters<typeof targetColl.createIndexes>[0]
    );
  }

  // Batch copy documents
  let docCount = 0;
  const cursor = sourceColl.find();
  let batch: Record<string, unknown>[] = [];

  for await (const doc of cursor) {
    batch.push(doc as Record<string, unknown>);
    if (batch.length >= BATCH_SIZE) {
      await targetColl.insertMany(batch, { ordered: false });
      docCount += batch.length;
      batch = [];
    }
  }

  if (batch.length > 0) {
    await targetColl.insertMany(batch, { ordered: false });
    docCount += batch.length;
  }

  onProgress?.({
    collection: collectionName,
    index: 1,
    total: 1,
    docCount,
  });

  return { collections: 1, documents: docCount };
}

export async function copyDatabase(
  sourceClient: MongoClient,
  targetClient: MongoClient,
  sourceDbName: string,
  targetDbName: string,
  onProgress?: (progress: CopyProgress) => void
): Promise<CopySummary> {
  const sourceDb = sourceClient.db(sourceDbName);

  const collections = (await sourceDb.listCollections().toArray()).filter(
    (col) => col.type !== "view"
  );

  let totalDocuments = 0;

  for (let i = 0; i < collections.length; i++) {
    const col = collections[i];

    const result = await copyCollection(
      sourceClient,
      targetClient,
      sourceDbName,
      targetDbName,
      col.name
    );

    totalDocuments += result.documents;

    onProgress?.({
      collection: col.name,
      index: i + 1,
      total: collections.length,
      docCount: result.documents,
    });
  }

  return { collections: collections.length, documents: totalDocuments };
}
