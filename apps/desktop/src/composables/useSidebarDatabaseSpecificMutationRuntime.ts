import { computed, watch, type ShallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "@/composables/useToast";
import { useConnectionStore } from "@/stores/connectionStore";
import type { TreeNode } from "@/types/database";
import * as api from "@/lib/backend/api";
import { translateBackendError } from "@/i18n/backend-errors";
import { notifyNacosNamespacesChanged } from "@/lib/nacos/nacosNamespaceCache";
import { findSidebarActionTarget } from "@/lib/sidebar/sidebarActionTarget";
import {
  MONGO_INDEX_KEY_TYPES,
  buildMongoCreateIndexRequest,
  isProtectedMongoIndex,
  isRenamableMongoCollection,
  mongoCollectionKindFromNode,
  mongoCreateIndexPreview,
  mongoDropCollectionPreview,
  mongoDropDatabasePreview,
  mongoDropIndexPreview,
  mongoRenameCollectionPreview,
} from "@/lib/sidebar/mongoCollectionMutation";
import { supportsMongoAllDriverMutations, supportsMongoIndexMutations, supportsNativeMongoDriverMutations } from "@/lib/mongo/mongoCapabilities";
import { runMongoSidebarMutation } from "@/lib/sidebar/runMongoSidebarMutation";
import {
  sidebarDangerTarget,
  sidebarFormTarget,
  showCreateNacosNamespaceDialog,
  createNacosNamespaceId,
  createNacosNamespaceName,
  createNacosNamespaceDesc,
  createNacosNamespaceLoading,
  showEditNacosNamespaceDialog,
  editNacosNamespaceName,
  editNacosNamespaceDesc,
  editNacosNamespaceLoading,
  showDropMongoCollectionConfirm,
  dropMongoCollectionLoading,
  showDropMongoIndexConfirm,
  dropMongoIndexLoading,
  showDropDatabaseConfirm,
  dropDatabaseLoading,
  showFlushRedisDbConfirm,
  showRedisDatabaseAliasDialog,
  redisDatabaseAliasInput,
  redisDatabaseAliasSaving,
  showRenameMongoCollectionDialog,
  renameMongoCollectionName,
  renameMongoCollectionError,
  renameMongoCollectionPreview,
  renameMongoCollectionLoading,
  showCreateMongoIndexDialog,
  mongoCreateIndexForm,
  mongoCreateIndexFieldOptions,
  mongoCreateIndexError,
  mongoCreateIndexLoading,
  resetMongoCreateIndexForm,
} from "@/components/sidebar/sidebarTreeDialogState";

interface SidebarDatabaseSpecificMutationRuntimeOptions {
  activeNode: ShallowRef<TreeNode>;
  connectionStore: ReturnType<typeof useConnectionStore>;
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message || error);
  }
  return String(error);
}

export function useSidebarDatabaseSpecificMutationRuntime(options: SidebarDatabaseSpecificMutationRuntimeOptions) {
  const { t } = useI18n();
  const { toast } = useToast();
  const { activeNode, connectionStore } = options;

  function usesAnyMongoDriver(node: Pick<TreeNode, "connectionId">): boolean {
    return !!node.connectionId && supportsMongoAllDriverMutations(connectionStore.getConfig(node.connectionId));
  }

  function usesNativeMongoDriver(node: Pick<TreeNode, "connectionId">): boolean {
    return !!node.connectionId && supportsNativeMongoDriverMutations(connectionStore.getConfig(node.connectionId));
  }

  function canMutateMongoIndexes(node: TreeNode): boolean {
    return !!node.connectionId && supportsMongoIndexMutations(connectionStore.getConfig(node.connectionId), mongoCollectionKindFromNode(node));
  }

  const canDropMongoDatabase = computed(() => activeNode.value.type === "mongo-db" && !!activeNode.value.database && usesAnyMongoDriver(activeNode.value));

  function canMutateMongoCollectionNode(node: TreeNode): boolean {
    if (node.type !== "mongo-collection" || !node.connectionId || !node.database) return false;
    return usesAnyMongoDriver(node);
  }

  function canRenameMongoCollectionNode(node: TreeNode): boolean {
    return canMutateMongoCollectionNode(node) && usesNativeMongoDriver(node) && isRenamableMongoCollection(node.label, mongoCollectionKindFromNode(node));
  }

  const canDropMongoCollection = computed(() => canMutateMongoCollectionNode(activeNode.value));
  const canRenameMongoCollection = computed(() => canRenameMongoCollectionNode(activeNode.value));

  function toastMutationError(error: unknown) {
    toast(t("contextMenu.tableOperationFailed", { message: errorMessage(error) }), 5000);
  }

  function prepareRenameMongoCollectionDialog() {
    renameMongoCollectionName.value = activeNode.value.label;
    renameMongoCollectionError.value = "";
    renameMongoCollectionPreview.value = "";
    renameMongoCollectionLoading.value = false;
    showRenameMongoCollectionDialog.value = true;
  }

  function refreshRenameMongoCollectionPreview() {
    const node = sidebarFormTarget.value ?? activeNode.value;
    // Preserve identifier whitespace exactly as entered; only reject empty names.
    const newName = renameMongoCollectionName.value;
    if (!showRenameMongoCollectionDialog.value || !canRenameMongoCollectionNode(node) || !node.database || !newName || newName === node.label) {
      renameMongoCollectionPreview.value = "";
      return;
    }
    renameMongoCollectionPreview.value = mongoRenameCollectionPreview(node.database, node.label, newName);
  }

  watch([showRenameMongoCollectionDialog, renameMongoCollectionName, () => activeNode.value.label, () => activeNode.value.database], () => {
    refreshRenameMongoCollectionPreview();
  });

  async function confirmRenameMongoCollection() {
    const node = sidebarFormTarget.value ?? activeNode.value;
    const connectionId = node.connectionId;
    const database = node.database;
    const newName = renameMongoCollectionName.value;
    if (!canRenameMongoCollectionNode(node) || !connectionId || !database || !newName || newName === node.label) {
      return;
    }
    const oldName = node.label;
    renameMongoCollectionError.value = "";
    await runMongoSidebarMutation({
      connection: connectionStore.getConfig(connectionId),
      database,
      reviewText: mongoRenameCollectionPreview(database, oldName, newName),
      source: t("production.sourceSidebar"),
      loading: renameMongoCollectionLoading,
      beforeExecute: () => connectionStore.ensureConnected(connectionId),
      execute: async () => {
        await api.mongoRenameCollection(connectionId, database, oldName, newName);
        await connectionStore.loadMongoCollections(connectionId, database);
      },
      onSuccess: () => {
        toast(t("contextMenu.renameObjectSuccess", { oldName, newName }), 3000);
        showRenameMongoCollectionDialog.value = false;
      },
      onError: (error) => {
        renameMongoCollectionError.value = translateBackendError(t, errorMessage(error));
      },
    });
  }

  function mongoIndexNameForNode(node: TreeNode): string {
    if (node.type !== "index") return "";
    return node.meta && "name" in node.meta ? node.meta.name : node.label.replace(/\s+\(.+\)$/, "");
  }

  function canDropMongoIndexNode(node: TreeNode): boolean {
    if (node.type !== "index" || !node.connectionId || !node.database || !node.tableName) return false;
    const isPrimary = !!(node.meta && "is_primary" in node.meta && node.meta.is_primary);
    return canMutateMongoIndexes(node) && !isProtectedMongoIndex({ name: mongoIndexNameForNode(node), is_primary: isPrimary });
  }

  const canDropMongoIndex = computed(() => canDropMongoIndexNode(activeNode.value));

  function mongoIndexDropPreview(node: Pick<TreeNode, "database" | "tableName">, indexName: string): string {
    return mongoDropIndexPreview(node.database || "", node.tableName || "", indexName);
  }

  function canCreateMongoIndexNode(node: TreeNode): boolean {
    const collectionName = mongoIndexCollectionName(node);
    return !!collectionName && !!node.database && canMutateMongoIndexes(node);
  }

  const canCreateMongoIndex = computed(() => canCreateMongoIndexNode(activeNode.value));
  const mongoCreateIndexCanSubmit = computed(() => mongoCreateIndexForm.value.fields.length > 0 && mongoCreateIndexForm.value.fields.every((field) => !!field.path.trim()));
  const mongoCreateIndexCanAddField = computed(() => mongoCreateIndexForm.value.fields.every((field) => !!field.path.trim()));

  watch(
    mongoCreateIndexForm,
    () => {
      mongoCreateIndexError.value = "";
    },
    { deep: true },
  );

  function mongoIndexCollectionName(node: TreeNode): string {
    if (node.type === "mongo-collection") return node.label;
    return node.type === "group-indexes" ? node.tableName || "" : "";
  }

  function prepareCreateMongoIndexDialog() {
    const node = activeNode.value;
    if (!canCreateMongoIndexNode(node) || !node.connectionId || !node.database) return;
    resetMongoCreateIndexForm();
    showCreateMongoIndexDialog.value = true;
    void connectionStore
      .listMongoCompletionFields(node.connectionId, node.database, mongoIndexCollectionName(node))
      .then((fields) => {
        const target = sidebarFormTarget.value ?? activeNode.value;
        if (showCreateMongoIndexDialog.value && target.id === node.id) mongoCreateIndexFieldOptions.value = fields.map((field) => field.name);
      })
      .catch(() => {
        // MongoDB is schemaless; users can still enter a field that was not sampled.
      });
  }

  function addMongoCreateIndexField() {
    if (!mongoCreateIndexCanAddField.value) return;
    const nextId = Math.max(0, ...mongoCreateIndexForm.value.fields.map((field) => field.id)) + 1;
    mongoCreateIndexForm.value.fields.push({ id: nextId, path: "", type: "1" });
  }

  function removeMongoCreateIndexField(id: number) {
    if (mongoCreateIndexForm.value.fields.length === 1) return;
    mongoCreateIndexForm.value.fields = mongoCreateIndexForm.value.fields.filter((field) => field.id !== id);
  }

  async function confirmCreateMongoIndex() {
    const node = sidebarFormTarget.value ?? activeNode.value;
    const connectionId = node.connectionId;
    const database = node.database;
    const collectionName = mongoIndexCollectionName(node);
    if (!canCreateMongoIndexNode(node) || !connectionId || !database || !collectionName) return;

    const request = buildMongoCreateIndexRequest(mongoCreateIndexForm.value);
    if (!request.valid) {
      mongoCreateIndexError.value = request.error === "field-duplicate" ? t("mongo.duplicateField", { field: request.field }) : t("contextMenu.createMongoIndexFieldRequired");
      return;
    }

    mongoCreateIndexError.value = "";
    await runMongoSidebarMutation({
      connection: connectionStore.getConfig(connectionId),
      database,
      reviewText: mongoCreateIndexPreview(database, collectionName, request.keysJson, request.optionsJson),
      source: t("production.sourceSidebar"),
      loading: mongoCreateIndexLoading,
      beforeExecute: () => connectionStore.ensureConnected(connectionId),
      execute: () => api.mongoCreateIndex(connectionId, database, collectionName, request.keysJson, request.optionsJson),
      onSuccess: async (created) => {
        showCreateMongoIndexDialog.value = false;
        toast(t("contextMenu.createMongoIndexSuccess", { name: created.name, collection: collectionName }), 3000);
        await refreshMongoIndexTreeAfterMutation({ ...node, tableName: collectionName });
      },
      onError: (error) => {
        mongoCreateIndexError.value = translateBackendError(t, errorMessage(error));
      },
    });
  }

  function openCreateNacosNamespaceDialog() {
    createNacosNamespaceId.value = "";
    createNacosNamespaceName.value = "";
    createNacosNamespaceDesc.value = "";
    showCreateNacosNamespaceDialog.value = true;
  }

  async function confirmCreateNacosNamespace() {
    const node = sidebarFormTarget.value ?? activeNode.value;
    const namespaceName = createNacosNamespaceName.value.trim();
    if (!node.connectionId || !namespaceName || createNacosNamespaceLoading.value) return;
    createNacosNamespaceLoading.value = true;
    try {
      await api.nacosCreateNamespace(node.connectionId, {
        namespaceId: createNacosNamespaceId.value.trim() || undefined,
        namespaceName,
        namespaceDesc: createNacosNamespaceDesc.value.trim() || namespaceName,
      });
      notifyNacosNamespacesChanged(node.connectionId);
      showCreateNacosNamespaceDialog.value = false;
      await connectionStore.loadNacosNamespaces(node.connectionId, { force: true });
      const liveNode = findSidebarActionTarget(connectionStore.treeNodes, node);
      if (liveNode) liveNode.isExpanded = true;
      toast(t("nacos.namespaceCreated", { name: namespaceName }), 3000);
    } catch (error: any) {
      toast(t("contextMenu.tableOperationFailed", { message: translateBackendError(t, error?.message || String(error)) }), 5000);
    } finally {
      createNacosNamespaceLoading.value = false;
    }
  }

  function openEditNacosNamespaceDialog() {
    editNacosNamespaceName.value = activeNode.value.nacosNamespaceName || activeNode.value.label;
    editNacosNamespaceDesc.value = activeNode.value.comment || "";
    showEditNacosNamespaceDialog.value = true;
  }

  async function confirmEditNacosNamespace() {
    const node = sidebarFormTarget.value ?? activeNode.value;
    const namespaceId = node.nacosNamespace?.trim() || "";
    const namespaceName = editNacosNamespaceName.value.trim();
    if (!node.connectionId || !namespaceId || !namespaceName || editNacosNamespaceLoading.value) return;
    editNacosNamespaceLoading.value = true;
    try {
      await api.nacosUpdateNamespace(node.connectionId, {
        namespaceId,
        namespaceName,
        namespaceDesc: editNacosNamespaceDesc.value.trim() || namespaceName,
      });
      showEditNacosNamespaceDialog.value = false;
      await connectionStore.loadNacosNamespaces(node.connectionId, { force: true });
      toast(t("nacos.namespaceUpdated", { name: namespaceName }), 3000);
    } catch (error: any) {
      toast(t("contextMenu.tableOperationFailed", { message: translateBackendError(t, error?.message || String(error)) }), 5000);
    } finally {
      editNacosNamespaceLoading.value = false;
    }
  }

  function dropMongoCollection() {
    dropMongoCollectionLoading.value = false;
    showDropMongoCollectionConfirm.value = true;
  }

  function dropMongoIndex() {
    dropMongoIndexLoading.value = false;
    showDropMongoIndexConfirm.value = true;
  }

  function flushRedisDb() {
    showFlushRedisDbConfirm.value = true;
  }

  function prepareRedisDatabaseAliasDialog() {
    const node = activeNode.value;
    redisDatabaseAliasInput.value = node.connectionId && node.database != null ? connectionStore.getRedisDatabaseAlias(node.connectionId, node.database) || "" : "";
    redisDatabaseAliasSaving.value = false;
    showRedisDatabaseAliasDialog.value = true;
  }

  async function saveRedisDatabaseAlias(alias?: string) {
    const node = sidebarFormTarget.value ?? activeNode.value;
    if (node.type !== "redis-db" || !node.connectionId || node.database == null || redisDatabaseAliasSaving.value) return;
    redisDatabaseAliasSaving.value = true;
    try {
      await connectionStore.setRedisDatabaseAlias(node.connectionId, node.database, alias);
      showRedisDatabaseAliasDialog.value = false;
      const normalizedAlias = alias?.trim();
      toast(normalizedAlias ? t("redis.databaseAliasSaved", { db: node.database, alias: normalizedAlias }) : t("redis.databaseAliasCleared", { db: node.database }), 3000);
    } catch (error: any) {
      toast(t("connection.saveFailed", { message: error?.message || String(error) }), 5000);
    } finally {
      redisDatabaseAliasSaving.value = false;
    }
  }

  async function confirmRedisDatabaseAlias() {
    await saveRedisDatabaseAlias(redisDatabaseAliasInput.value);
  }

  async function clearRedisDatabaseAlias() {
    redisDatabaseAliasInput.value = "";
    await saveRedisDatabaseAlias();
  }

  async function confirmFlushRedisDb() {
    const node = sidebarDangerTarget.value ?? activeNode.value;
    if (node.type !== "redis-db" || !node.connectionId || !node.database) return;
    try {
      await connectionStore.ensureConnected(node.connectionId);
      await api.redisFlushDb(node.connectionId, Number(node.database));
      connectionStore.updateRedisDbKeyStats(node.connectionId, Number(node.database), { loaded: 0, total: 0 });
      window.dispatchEvent(
        new CustomEvent("dbx-redis-db-flushed", {
          detail: { connectionId: node.connectionId, db: Number(node.database) },
        }),
      );
      toast(t("redis.flushDbSuccess", { db: node.database }), 3000);
    } catch (error: any) {
      toast(t("contextMenu.tableOperationFailed", { message: error?.message || String(error) }), 5000);
    }
  }

  async function confirmDropMongoDatabase() {
    const node = sidebarDangerTarget.value ?? activeNode.value;
    const connectionId = node.connectionId;
    const database = node.database;
    if (node.type !== "mongo-db" || !connectionId || !database || !usesAnyMongoDriver(node)) return;
    await runMongoSidebarMutation({
      connection: connectionStore.getConfig(connectionId),
      database,
      reviewText: mongoDropDatabasePreview(database),
      source: t("production.sourceSidebar"),
      loading: dropDatabaseLoading,
      beforeExecute: () => connectionStore.ensureConnected(connectionId),
      execute: () => api.mongoDropDatabase(connectionId, database),
      onSuccess: async () => {
        toast(t("contextMenu.dropDatabaseSuccess", { name: node.label }), 3000);
        showDropDatabaseConfirm.value = false;
        await refreshMongoTreeAfterDrop(node, () => connectionStore.loadMongoDatabases(connectionId));
      },
      onError: toastMutationError,
    });
  }

  async function confirmDropMongoCollection() {
    const node = sidebarDangerTarget.value ?? activeNode.value;
    const connectionId = node.connectionId;
    const database = node.database;
    if (!canMutateMongoCollectionNode(node) || !connectionId || !database) return;
    const collectionName = node.label;
    await runMongoSidebarMutation({
      connection: connectionStore.getConfig(connectionId),
      database,
      reviewText: mongoDropCollectionPreview(database, collectionName),
      source: t("production.sourceSidebar"),
      loading: dropMongoCollectionLoading,
      beforeExecute: () => connectionStore.ensureConnected(connectionId),
      execute: () => api.mongoDropCollection(connectionId, database, collectionName),
      onSuccess: async () => {
        toast(t("contextMenu.dropCollectionSuccess", { name: collectionName }), 3000);
        showDropMongoCollectionConfirm.value = false;
        await refreshMongoTreeAfterDrop(node, async () => {
          // The final collection can remove its database; if the database
          // remains, refresh its preserved expanded children as well.
          await connectionStore.loadMongoDatabases(connectionId);
          await connectionStore.loadMongoCollections(connectionId, database);
        });
      },
      onError: toastMutationError,
    });
  }

  async function refreshMongoTreeAfterDrop(node: TreeNode, refresh: () => Promise<void>) {
    try {
      await refresh();
    } catch (error) {
      connectionStore.removeTreeNode(node.id);
      toast(t("contextMenu.objectDropRefreshFailed", { message: translateBackendError(t, errorMessage(error)) }), 5000);
    }
  }

  function mongoIndexesGroupNodeId(node: Pick<TreeNode, "connectionId" | "database" | "schema" | "tableName" | "label">): string | null {
    if (!node.connectionId || !node.database) return null;
    const tableName = node.tableName || node.label;
    return node.schema ? `${node.connectionId}:${node.database}:${node.schema}:${tableName}:__indexes` : `${node.connectionId}:${node.database}:${tableName}:__indexes`;
  }

  async function refreshMongoIndexTree(node: Pick<TreeNode, "connectionId" | "database" | "schema" | "tableName" | "label">) {
    const nodeId = mongoIndexesGroupNodeId(node);
    if (!node.connectionId || !node.database || !nodeId) return;
    await connectionStore.loadIndexes(node.connectionId, node.database, node.tableName || node.label, node.schema, nodeId);
  }

  async function refreshMongoIndexTreeAfterMutation(node: Pick<TreeNode, "connectionId" | "database" | "schema" | "tableName" | "label">) {
    try {
      await refreshMongoIndexTree(node);
    } catch (error) {
      toast(t("contextMenu.mongoIndexRefreshFailed", { message: translateBackendError(t, errorMessage(error)) }), 5000);
    }
  }

  async function confirmDropMongoIndex() {
    const node = sidebarDangerTarget.value ?? activeNode.value;
    const connectionId = node.connectionId;
    const database = node.database;
    const tableName = node.tableName;
    if (!canDropMongoIndexNode(node) || !connectionId || !database || !tableName) return;
    const indexName = mongoIndexNameForNode(node);
    await runMongoSidebarMutation({
      connection: connectionStore.getConfig(connectionId),
      database,
      reviewText: mongoDropIndexPreview(database, tableName, indexName),
      source: t("production.sourceSidebar"),
      loading: dropMongoIndexLoading,
      beforeExecute: () => connectionStore.ensureConnected(connectionId),
      execute: () => api.mongoDropIndexes(connectionId, database, tableName, JSON.stringify(indexName), true),
      onSuccess: async () => {
        toast(t("contextMenu.dropTableChildObjectSuccess", { name: indexName }), 3000);
        showDropMongoIndexConfirm.value = false;
        await refreshMongoIndexTreeAfterMutation(node);
      },
      onError: toastMutationError,
    });
  }

  return {
    canDropMongoDatabase,
    canDropMongoCollection,
    canRenameMongoCollection,
    prepareRenameMongoCollectionDialog,
    confirmRenameMongoCollection,
    showRenameMongoCollectionDialog,
    renameMongoCollectionName,
    renameMongoCollectionError,
    renameMongoCollectionPreview,
    renameMongoCollectionLoading,
    mongoIndexNameForNode,
    canDropMongoIndexNode,
    canDropMongoIndex,
    mongoIndexDropPreview,
    canCreateMongoIndex,
    mongoIndexKeyTypes: MONGO_INDEX_KEY_TYPES,
    mongoCreateIndexCanSubmit,
    mongoCreateIndexCanAddField,
    prepareCreateMongoIndexDialog,
    addMongoCreateIndexField,
    removeMongoCreateIndexField,
    confirmCreateMongoIndex,
    openCreateNacosNamespaceDialog,
    confirmCreateNacosNamespace,
    openEditNacosNamespaceDialog,
    confirmEditNacosNamespace,
    dropMongoCollection,
    dropMongoIndex,
    flushRedisDb,
    prepareRedisDatabaseAliasDialog,
    confirmRedisDatabaseAlias,
    clearRedisDatabaseAlias,
    showRedisDatabaseAliasDialog,
    redisDatabaseAliasInput,
    redisDatabaseAliasSaving,
    confirmFlushRedisDb,
    confirmDropMongoDatabase,
    confirmDropMongoCollection,
    confirmDropMongoIndex,
  };
}
