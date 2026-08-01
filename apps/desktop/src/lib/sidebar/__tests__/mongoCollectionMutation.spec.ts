import { describe, expect, it } from "vitest";
import {
  isRenamableMongoCollection,
  mongoCollectionKindFromNode,
  mongoCollectionTableTypeFromNode,
  mongoCreateIndexPreview,
  mongoDropAllIndexesPreview,
  mongoDropCollectionPreview,
  mongoDropIndexPreview,
  mongoRenameCollectionPreview,
  toMongoCollectionKind,
  validateMongoCreateIndexInput,
} from "../mongoCollectionMutation";

describe("isRenamableMongoCollection", () => {
  it("allows ordinary collections and defaults", () => {
    expect(isRenamableMongoCollection("users")).toBe(true);
    expect(isRenamableMongoCollection("users", "collection")).toBe(true);
  });

  it("rejects views, time-series collections, and system namespaces", () => {
    expect(isRenamableMongoCollection("users_view", "view")).toBe(false);
    expect(isRenamableMongoCollection("metrics", "timeseries")).toBe(false);
    expect(isRenamableMongoCollection("system.views", "collection")).toBe(false);
  });
});

describe("mongoCollectionKindFromNode", () => {
  it("reads collectionKind from node meta without using SQL tableType", () => {
    expect(mongoCollectionKindFromNode({ meta: { collectionKind: "view" } })).toBe("view");
    expect(mongoCollectionKindFromNode({ meta: { collectionKind: "timeseries" } })).toBe("timeseries");
    expect(mongoCollectionKindFromNode({ meta: { collectionKind: "collection" } })).toBe("collection");
    expect(mongoCollectionKindFromNode({})).toBe("collection");
  });

  it("maps collection kinds to data-tab table types", () => {
    expect(mongoCollectionTableTypeFromNode({ meta: { collectionKind: "collection" } })).toBe("TABLE");
    expect(mongoCollectionTableTypeFromNode({ meta: { collectionKind: "view" } })).toBe("VIEW");
    expect(mongoCollectionTableTypeFromNode({ meta: { collectionKind: "timeseries" } })).toBe("TIMESERIES");
  });
});

describe("toMongoCollectionKind", () => {
  it("normalizes wire kinds", () => {
    expect(toMongoCollectionKind("view")).toBe("view");
    expect(toMongoCollectionKind("timeseries")).toBe("timeseries");
    expect(toMongoCollectionKind("bucket")).toBe("collection");
    expect(toMongoCollectionKind(undefined)).toBe("collection");
  });
});

describe("mongo shell previews", () => {
  it("preserves identifier whitespace in rename preview", () => {
    expect(mongoRenameCollectionPreview("app", " users ", " renamed ")).toBe('db.getSiblingDB("app").getCollection(" users ").renameCollection(" renamed ")');
  });

  it("builds drop previews with database scope", () => {
    expect(mongoDropCollectionPreview("app", "users")).toBe('db.getSiblingDB("app").getCollection("users").drop()');
    expect(mongoDropIndexPreview("app", "users", "idx_name")).toBe('db.getSiblingDB("app").getCollection("users").dropIndex("idx_name")');
    expect(mongoDropAllIndexesPreview("app", "users")).toBe('db.getSiblingDB("app").getCollection("users").dropIndexes()');
  });

  it("builds a create-index shell preview from validated JSON objects", () => {
    const validation = validateMongoCreateIndexInput('{"email":1,"createdAt":-1}', '{"name":"email_created_at","unique":true}');

    expect(validation).toMatchObject({
      valid: true,
      keysJson: '{"email":1,"createdAt":-1}',
      optionsJson: '{"name":"email_created_at","unique":true}',
    });
    if (!validation.valid) throw new Error("expected valid index JSON");
    expect(mongoCreateIndexPreview("app", "users", validation.keysJson, validation.optionsJson)).toBe('db.getSiblingDB("app").getCollection("users").createIndex({"email":1,"createdAt":-1}, {"name":"email_created_at","unique":true})');
  });

  it("keeps the entered compound-key order in the preview", () => {
    const validation = validateMongoCreateIndexInput('{"10":1,"2":-1}', "");

    if (!validation.valid) throw new Error("expected valid index JSON");
    expect(mongoCreateIndexPreview("app", "events", validation.keysJson, validation.optionsJson)).toBe('db.getSiblingDB("app").getCollection("events").createIndex({"10":1,"2":-1})');
  });

  it("requires non-empty keys and JSON objects for keys and options", () => {
    expect(validateMongoCreateIndexInput("", "")).toEqual({ valid: false, error: "keys-required" });
    expect(validateMongoCreateIndexInput("{", "")).toEqual({ valid: false, error: "keys-invalid-json" });
    expect(validateMongoCreateIndexInput("[]", "")).toEqual({ valid: false, error: "keys-not-object" });
    expect(validateMongoCreateIndexInput("{}", "")).toEqual({ valid: false, error: "keys-empty" });
    expect(validateMongoCreateIndexInput('{"email":1}', "[]")).toEqual({ valid: false, error: "options-not-object" });
    expect(validateMongoCreateIndexInput('{"email":1}', "{")).toEqual({ valid: false, error: "options-invalid-json" });
    expect(validateMongoCreateIndexInput('{"email":1}', '{"name":"   "}')).toEqual({ valid: false, error: "options-name-invalid" });
    expect(validateMongoCreateIndexInput('{"email":1}', '{"name":1}')).toEqual({ valid: false, error: "options-name-invalid" });
    expect(validateMongoCreateIndexInput('{"email":1}', '{"key":{"other":1}}')).toEqual({ valid: false, error: "options-contains-key" });
  });
});
