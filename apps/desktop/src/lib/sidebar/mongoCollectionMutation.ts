import type { MongoCollectionKind, TreeNode } from "@/types/database";

export type MongoCreateIndexValidationError = "keys-required" | "keys-invalid-json" | "keys-not-object" | "keys-empty" | "options-invalid-json" | "options-not-object" | "options-name-invalid" | "options-contains-key";

export type MongoCreateIndexValidation =
  | {
      valid: true;
      keysJson: string;
      optionsJson?: string;
    }
  | {
      valid: false;
      error: MongoCreateIndexValidationError;
    };

/**
 * MongoDB only supports renameCollection for ordinary, non-system collections.
 * Views, time-series collections, and reserved system namespaces must not expose a rename action.
 * @see https://www.mongodb.com/docs/manual/reference/command/renameCollection/
 */
export function isRenamableMongoCollection(name: string, kind: MongoCollectionKind = "collection"): boolean {
  return kind === "collection" && !name.startsWith("system.");
}

export function mongoCollectionKindFromNode(node: Pick<TreeNode, "meta">): MongoCollectionKind {
  const meta = node.meta;
  if (meta && "collectionKind" in meta && meta.collectionKind) {
    return meta.collectionKind;
  }
  return "collection";
}

export function mongoCollectionTableTypeFromNode(node: Pick<TreeNode, "meta">): "TABLE" | "VIEW" | "TIMESERIES" {
  const kind = mongoCollectionKindFromNode(node);
  return kind === "view" ? "VIEW" : kind === "timeseries" ? "TIMESERIES" : "TABLE";
}

export function toMongoCollectionKind(kind?: string | null): MongoCollectionKind {
  const normalized = (kind || "collection").toLowerCase();
  if (normalized === "view") return "view";
  if (normalized === "timeseries") return "timeseries";
  return "collection";
}

export function mongoRenameCollectionPreview(database: string, oldName: string, newName: string): string {
  return `db.getSiblingDB(${JSON.stringify(database)}).getCollection(${JSON.stringify(oldName)}).renameCollection(${JSON.stringify(newName)})`;
}

export function mongoDropCollectionPreview(database: string, collection: string): string {
  return `db.getSiblingDB(${JSON.stringify(database)}).getCollection(${JSON.stringify(collection)}).drop()`;
}

export function mongoDropDatabasePreview(database: string): string {
  return `db.getSiblingDB(${JSON.stringify(database)}).dropDatabase()`;
}

export function mongoDropIndexPreview(database: string, collection: string, indexName: string): string {
  return `db.getSiblingDB(${JSON.stringify(database)}).getCollection(${JSON.stringify(collection)}).dropIndex(${JSON.stringify(indexName)})`;
}

export function mongoDropAllIndexesPreview(database: string, collection: string): string {
  return `db.getSiblingDB(${JSON.stringify(database)}).getCollection(${JSON.stringify(collection)}).dropIndexes()`;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate JSON before sending it to either MongoDB driver implementation. */
export function validateMongoCreateIndexInput(keysInput: string, optionsInput: string): MongoCreateIndexValidation {
  const keysJson = keysInput.trim();
  if (!keysJson) return { valid: false, error: "keys-required" };

  let keys: unknown;
  try {
    keys = JSON.parse(keysJson);
  } catch {
    return { valid: false, error: "keys-invalid-json" };
  }
  if (!isJsonObject(keys)) return { valid: false, error: "keys-not-object" };
  if (Object.keys(keys).length === 0) return { valid: false, error: "keys-empty" };

  const optionsJson = optionsInput.trim();
  if (!optionsJson) return { valid: true, keysJson };

  let options: unknown;
  try {
    options = JSON.parse(optionsJson);
  } catch {
    return { valid: false, error: "options-invalid-json" };
  }
  if (!isJsonObject(options)) return { valid: false, error: "options-not-object" };
  if (Object.prototype.hasOwnProperty.call(options, "name") && (typeof options.name !== "string" || !options.name.trim())) {
    return { valid: false, error: "options-name-invalid" };
  }
  if (Object.prototype.hasOwnProperty.call(options, "key")) return { valid: false, error: "options-contains-key" };
  return { valid: true, keysJson, optionsJson };
}

/**
 * Keep the preview and production confirmation byte-for-byte aligned with
 * the JSON passed to the backend. Re-serializing parsed JSON could reorder a
 * compound key or round a large numeric value before the user reviews it.
 */
export function mongoCreateIndexPreview(database: string, collection: string, keysJson: string, optionsJson?: string): string {
  const args = [keysJson, ...(optionsJson ? [optionsJson] : [])];
  return `db.getSiblingDB(${JSON.stringify(database)}).getCollection(${JSON.stringify(collection)}).createIndex(${args.join(", ")})`;
}
