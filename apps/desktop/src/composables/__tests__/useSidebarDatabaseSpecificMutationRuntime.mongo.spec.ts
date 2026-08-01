import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick, shallowRef } from "vue";
import type { TreeNode } from "@/types/database";
import { createMongoIndexError, createMongoIndexKeysJson, createMongoIndexLoading, createMongoIndexOptionsJson, createMongoIndexPreview, createMongoIndexValidationError, showCreateMongoIndexDialog, sidebarDangerTarget, sidebarFormTarget } from "@/components/sidebar/sidebarTreeDialogState";

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  ensureConnected: vi.fn().mockResolvedValue(undefined),
  loadIndexes: vi.fn().mockResolvedValue(undefined),
  loadMongoCollections: vi.fn().mockResolvedValue(undefined),
  loadMongoDatabases: vi.fn().mockResolvedValue(undefined),
  mongoCreateIndex: vi.fn().mockResolvedValue({ name: "email_1" }),
  mongoDropCollection: vi.fn().mockResolvedValue(undefined),
  mongoDropDatabase: vi.fn().mockResolvedValue(undefined),
  mongoDropIndexes: vi.fn().mockResolvedValue({ dropped_names: ["email_1"], affected_rows: 1 }),
  getConfig: vi.fn(),
}));

vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
  }),
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: () => ({}),
}));

vi.mock("@/lib/backend/api", () => ({
  mongoCreateIndex: (...args: unknown[]) => mocks.mongoCreateIndex(...args),
  mongoDropCollection: (...args: unknown[]) => mocks.mongoDropCollection(...args),
  mongoDropDatabase: (...args: unknown[]) => mocks.mongoDropDatabase(...args),
  mongoDropIndexes: (...args: unknown[]) => mocks.mongoDropIndexes(...args),
  mongoRenameCollection: vi.fn(),
  nacosCreateNamespace: vi.fn(),
  nacosUpdateNamespace: vi.fn(),
  redisFlushDb: vi.fn(),
}));

vi.mock("@/lib/sidebar/sidebarActionTarget", () => ({
  findSidebarActionTarget: () => null,
}));

import { useSidebarDatabaseSpecificMutationRuntime } from "@/composables/useSidebarDatabaseSpecificMutationRuntime";

function mongoConfig(driverProfile?: string, production = false) {
  return {
    id: "conn-1",
    name: "Mongo",
    db_type: "mongodb" as const,
    driver_profile: driverProfile,
    host: "localhost",
    port: 27017,
    username: "op",
    password: "",
    is_production: production,
  };
}

function mongoDatabaseNode(): TreeNode {
  return {
    id: "conn-1:app",
    label: "app",
    type: "mongo-db",
    connectionId: "conn-1",
    database: "app",
    isExpanded: false,
  };
}

function mongoCollectionNode(kind: "collection" | "view" | "timeseries" = "collection"): TreeNode {
  return {
    id: "conn-1:app:users",
    label: "users",
    type: "mongo-collection",
    connectionId: "conn-1",
    database: "app",
    meta: { collectionKind: kind },
    isExpanded: false,
  };
}

function mongoIndexesGroupNode(kind: "collection" | "view" | "timeseries" = "collection"): TreeNode {
  return {
    id: "conn-1:app:users:__indexes",
    label: "tree.indexes",
    type: "group-indexes",
    connectionId: "conn-1",
    database: "app",
    tableName: "users",
    meta: { collectionKind: kind },
    isExpanded: false,
    children: [],
  };
}

function mongoIndexNode(name: string, kind: "collection" | "view" | "timeseries" = "collection", isPrimary = name === "_id_"): TreeNode {
  return {
    id: `conn-1:app:users:__indexes:${name}`,
    label: `${name} (email)`,
    type: "index",
    connectionId: "conn-1",
    database: "app",
    tableName: "users",
    meta: { name, columns: ["email"], is_primary: isPrimary, is_unique: false, collectionKind: kind },
    isExpanded: false,
  };
}

function runtime(activeNode: TreeNode) {
  return useSidebarDatabaseSpecificMutationRuntime({
    activeNode: shallowRef(activeNode),
    connectionStore: {
      getConfig: mocks.getConfig,
      ensureConnected: mocks.ensureConnected,
      loadIndexes: mocks.loadIndexes,
      loadMongoCollections: mocks.loadMongoCollections,
      loadMongoDatabases: mocks.loadMongoDatabases,
      treeNodes: [],
    } as any,
  });
}

describe("MongoDB sidebar mutation runtime", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mocks.getConfig.mockReturnValue(mongoConfig());
    mocks.ensureConnected.mockResolvedValue(undefined);
    mocks.loadIndexes.mockResolvedValue(undefined);
    mocks.mongoCreateIndex.mockResolvedValue({ name: "email_1" });
    mocks.mongoDropCollection.mockResolvedValue(undefined);
    mocks.mongoDropDatabase.mockResolvedValue(undefined);
    mocks.mongoDropIndexes.mockResolvedValue({ dropped_names: ["email_1"], affected_rows: 1 });
    sidebarDangerTarget.value = null;
    sidebarFormTarget.value = null;
    showCreateMongoIndexDialog.value = false;
    createMongoIndexKeysJson.value = "";
    createMongoIndexOptionsJson.value = "";
    createMongoIndexValidationError.value = "";
    createMongoIndexError.value = "";
    createMongoIndexPreview.value = "";
    createMongoIndexLoading.value = false;
  });

  it("allows Legacy connections to create and delete MongoDB tree objects while keeping rename native-only", () => {
    mocks.getConfig.mockReturnValue(mongoConfig("mongodb-legacy"));
    const activeNode = shallowRef(mongoDatabaseNode());
    const feature = useSidebarDatabaseSpecificMutationRuntime({
      activeNode,
      connectionStore: {
        getConfig: mocks.getConfig,
        ensureConnected: mocks.ensureConnected,
        loadIndexes: mocks.loadIndexes,
        loadMongoCollections: mocks.loadMongoCollections,
        loadMongoDatabases: mocks.loadMongoDatabases,
        treeNodes: [],
      } as any,
    });

    expect(feature.canDropMongoDatabase.value).toBe(true);
    activeNode.value = mongoCollectionNode();
    expect(feature.canDropMongoCollection.value).toBe(true);
    expect(feature.canRenameMongoCollection.value).toBe(false);
    activeNode.value = mongoIndexesGroupNode();
    expect(feature.canCreateMongoIndex.value).toBe(true);
    activeNode.value = mongoIndexNode("email_1");
    expect(feature.canDropMongoIndex.value).toBe(true);
    activeNode.value = mongoIndexNode("_id_");
    expect(feature.canDropMongoIndex.value).toBe(false);
  });

  it("keeps collection deletion available for views without exposing unsupported index actions", () => {
    const activeNode = shallowRef(mongoCollectionNode("view"));
    const feature = useSidebarDatabaseSpecificMutationRuntime({
      activeNode,
      connectionStore: {
        getConfig: mocks.getConfig,
        ensureConnected: mocks.ensureConnected,
        loadIndexes: mocks.loadIndexes,
        loadMongoCollections: mocks.loadMongoCollections,
        loadMongoDatabases: mocks.loadMongoDatabases,
        treeNodes: [],
      } as any,
    });

    expect(feature.canDropMongoCollection.value).toBe(true);
    expect(feature.canDropAllMongoIndexes.value).toBe(false);
    activeNode.value = mongoIndexesGroupNode("view");
    expect(feature.canCreateMongoIndex.value).toBe(false);
    activeNode.value = mongoIndexNode("email_1", "view");
    expect(feature.canDropMongoIndex.value).toBe(false);
  });

  it("validates index JSON, previews the shell command, creates the index, and refreshes its group", async () => {
    mocks.getConfig.mockReturnValue(mongoConfig("mongodb-legacy"));
    const node = mongoIndexesGroupNode();
    const feature = runtime(node);

    feature.prepareCreateMongoIndexDialog();
    createMongoIndexKeysJson.value = '{"email":1,"createdAt":-1}';
    createMongoIndexOptionsJson.value = '{"name":"email_created_at","unique":true}';
    await nextTick();

    expect(feature.canSubmitCreateMongoIndex.value).toBe(true);
    expect(createMongoIndexValidationError.value).toBe("");
    expect(createMongoIndexPreview.value).toBe('db.getSiblingDB("app").getCollection("users").createIndex({"email":1,"createdAt":-1}, {"name":"email_created_at","unique":true})');

    await feature.confirmCreateMongoIndex();

    expect(mocks.ensureConnected).toHaveBeenCalledWith("conn-1");
    expect(mocks.mongoCreateIndex).toHaveBeenCalledWith("conn-1", "app", "users", '{"email":1,"createdAt":-1}', '{"name":"email_created_at","unique":true}');
    expect(mocks.loadIndexes).toHaveBeenCalledWith("conn-1", "app", "users", undefined, "conn-1:app:users:__indexes");
    expect(mocks.toast).toHaveBeenCalledWith('contextMenu.createMongoIndexSuccess:{"name":"email_1","collection":"users"}', 3000);
    expect(showCreateMongoIndexDialog.value).toBe(false);
  });

  it("keeps the collection target captured when the create-index dialog opened", async () => {
    const originalTarget = mongoIndexesGroupNode();
    const activeNode = shallowRef(originalTarget);
    const feature = useSidebarDatabaseSpecificMutationRuntime({
      activeNode,
      connectionStore: {
        getConfig: mocks.getConfig,
        ensureConnected: mocks.ensureConnected,
        loadIndexes: mocks.loadIndexes,
        loadMongoCollections: mocks.loadMongoCollections,
        loadMongoDatabases: mocks.loadMongoDatabases,
        treeNodes: [],
      } as any,
    });

    sidebarFormTarget.value = originalTarget;
    feature.prepareCreateMongoIndexDialog();
    createMongoIndexKeysJson.value = '{"email":1}';
    activeNode.value = {
      ...mongoIndexesGroupNode(),
      id: "conn-1:app:orders:__indexes",
      tableName: "orders",
    };
    await nextTick();

    expect(createMongoIndexPreview.value).toContain('getCollection("users")');
    await feature.confirmCreateMongoIndex();

    expect(mocks.mongoCreateIndex).toHaveBeenCalledWith("conn-1", "app", "users", '{"email":1}', undefined);
    expect(mocks.loadIndexes).toHaveBeenCalledWith("conn-1", "app", "users", undefined, "conn-1:app:users:__indexes");
  });

  it("executes Legacy delete operations and refreshes their MongoDB metadata", async () => {
    mocks.getConfig.mockReturnValue(mongoConfig("mongodb-legacy"));

    const databaseNode = mongoDatabaseNode();
    const databaseFeature = runtime(databaseNode);
    sidebarDangerTarget.value = databaseNode;
    await databaseFeature.confirmDropMongoDatabase();

    expect(mocks.mongoDropDatabase).toHaveBeenCalledWith("conn-1", "app");
    expect(mocks.loadMongoDatabases).toHaveBeenCalledWith("conn-1");

    const collectionNode = mongoCollectionNode();
    const collectionFeature = runtime(collectionNode);
    sidebarDangerTarget.value = collectionNode;
    await collectionFeature.confirmDropMongoCollection();
    await collectionFeature.confirmDropAllMongoIndexes();

    expect(mocks.mongoDropCollection).toHaveBeenCalledWith("conn-1", "app", "users");
    expect(mocks.loadMongoCollections).toHaveBeenCalledWith("conn-1", "app");
    expect(mocks.mongoDropIndexes).toHaveBeenCalledWith("conn-1", "app", "users", undefined, false);
    expect(mocks.loadIndexes).toHaveBeenCalledWith("conn-1", "app", "users", undefined, "conn-1:app:users:__indexes");

    const indexNode = mongoIndexNode("email_1");
    const indexFeature = runtime(indexNode);
    sidebarDangerTarget.value = indexNode;
    await indexFeature.confirmDropMongoIndex();

    expect(mocks.mongoDropIndexes).toHaveBeenCalledWith("conn-1", "app", "users", '"email_1"', true);
  });

  it("does not send a default _id_ index deletion request", async () => {
    const node = mongoIndexNode("_id_");
    const feature = runtime(node);
    sidebarDangerTarget.value = node;

    await feature.confirmDropMongoIndex();

    expect(mocks.mongoDropIndexes).not.toHaveBeenCalled();
  });

  it("also hides indexes marked primary when metadata has an unexpected name", () => {
    const feature = runtime(mongoIndexNode("unexpected_primary_name", "collection", true));

    expect(feature.canDropMongoIndex.value).toBe(false);
  });

  it("reports an index-list refresh problem without misreporting a completed create as failed", async () => {
    const node = mongoIndexesGroupNode();
    const feature = runtime(node);
    mocks.loadIndexes.mockRejectedValue(new Error("metadata unavailable"));

    feature.prepareCreateMongoIndexDialog();
    createMongoIndexKeysJson.value = '{"email":1}';
    await nextTick();
    await feature.confirmCreateMongoIndex();

    expect(mocks.mongoCreateIndex).toHaveBeenCalledOnce();
    expect(createMongoIndexError.value).toBe("");
    expect(showCreateMongoIndexDialog.value).toBe(false);
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining("contextMenu.mongoIndexRefreshFailed"), 5000);
  });

  it("does not issue a create request when production confirmation is cancelled", async () => {
    mocks.getConfig.mockReturnValue(mongoConfig(undefined, true));
    const node = mongoIndexesGroupNode();
    const feature = runtime(node);
    feature.prepareCreateMongoIndexDialog();
    createMongoIndexKeysJson.value = '{"email":1}';
    await nextTick();

    const pending = feature.confirmCreateMongoIndex();
    await Promise.resolve();

    const { useProductionSafetyStore } = await import("@/stores/productionSafetyStore");
    useProductionSafetyStore().cancel();
    await pending;

    expect(mocks.ensureConnected).not.toHaveBeenCalled();
    expect(mocks.mongoCreateIndex).not.toHaveBeenCalled();
    expect(showCreateMongoIndexDialog.value).toBe(true);
  });
});
