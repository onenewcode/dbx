<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { emptyAnnotations } from "@/docs/annotationEdits";
import type { SchemaSnapshot, SnapshotWarning } from "@/docs/types";
import * as api from "@/lib/backend/api";
import { buildDataDictionary, dataDictionaryDefaultFileName, type DataDictionaryLabels } from "@/lib/docs/dataDictionary";
import { saveDataDictionaryFile } from "@/lib/docs/saveDataDictionaryFile";
import { buildXlsxWorkbookMulti } from "@/lib/export/xlsxExport";

const props = defineProps<{
  prefillConnectionId?: string;
  prefillDatabase?: string;
  prefillSchema?: string;
  prefillTableNames?: string[];
  /** Already merged snapshot from the documentation dialog. Skips collection. */
  snapshot?: SchemaSnapshot | null;
}>();

const open = defineModel<boolean>("open", { default: false });
const { t } = useI18n();

const collected = ref<SchemaSnapshot | null>(null);
const loading = ref(false);
const exporting = ref(false);
const loadError = ref<string | null>(null);
const exportError = ref<string | null>(null);
const format = ref<"xlsx" | "markdown">("xlsx");
const includeViews = ref(true);
const includeIndexes = ref(true);
let generation = 0;

const schema = computed(() => props.prefillSchema || undefined);
const tableNames = computed(() => (props.prefillTableNames ?? []).filter((name) => name !== ""));
const explicitObjects = computed(() => tableNames.value.length > 0);
const effectiveIncludeViews = computed(() => explicitObjects.value || includeViews.value);

const scopeLabel = computed(() => {
  const database = props.prefillDatabase || props.snapshot?.project.database || props.snapshot?.project.name || "";
  if (explicitObjects.value) return t("dataDictionary.scopeTables", { database, count: tableNames.value.length });
  if (schema.value) return t("dataDictionary.scopeSchema", { database, schema: schema.value });
  return t("dataDictionary.scopeDatabase", { database });
});

const exportableTables = computed(() => collected.value?.tables.filter((table) => effectiveIncludeViews.value || table.kind === "TABLE") ?? []);
const dictionaryWarnings = computed(() => (collected.value?.warnings ?? []).map(warningText).filter((text) => text !== ""));
const canExport = computed(() => !loading.value && !exporting.value && exportableTables.value.length > 0);

function warningText(warning: SnapshotWarning): string {
  switch (warning.kind) {
    case "tableSkipped":
      return t("dataDictionary.warningTableSkipped", { table: warning.table, reason: warning.reason });
    case "noForeignKeyMetadata":
      return t("dataDictionary.warningNoForeignKeys", { engine: warning.engine });
    case "commentsUnsupported":
      return t("dataDictionary.warningCommentsUnsupported", { engine: warning.engine });
    default:
      return "";
  }
}

function labels(): DataDictionaryLabels {
  return {
    sheetTables: t("dataDictionary.sheetTables"),
    sheetColumns: t("dataDictionary.sheetColumns"),
    sheetIndexes: t("dataDictionary.sheetIndexes"),
    sheetForeignKeys: t("dataDictionary.sheetForeignKeys"),
    schema: t("dataDictionary.schema"),
    table: t("dataDictionary.table"),
    kind: t("dataDictionary.kind"),
    tableComment: t("dataDictionary.tableComment"),
    estimatedRows: t("dataDictionary.estimatedRows"),
    columnCount: t("dataDictionary.columnCount"),
    ordinal: t("dataDictionary.ordinal"),
    column: t("dataDictionary.column"),
    type: t("dataDictionary.type"),
    length: t("dataDictionary.length"),
    precision: t("dataDictionary.precision"),
    scale: t("dataDictionary.scale"),
    primaryKey: t("dataDictionary.primaryKey"),
    nullable: t("dataDictionary.nullable"),
    unique: t("dataDictionary.unique"),
    defaultValue: t("dataDictionary.defaultValue"),
    extra: t("dataDictionary.extra"),
    comment: t("dataDictionary.comment"),
    indexName: t("dataDictionary.indexName"),
    indexColumns: t("dataDictionary.indexColumns"),
    indexType: t("dataDictionary.indexType"),
    constraintName: t("dataDictionary.constraintName"),
    refSchema: t("dataDictionary.refSchema"),
    refTable: t("dataDictionary.refTable"),
    refColumn: t("dataDictionary.refColumn"),
    onUpdate: t("dataDictionary.onUpdate"),
    onDelete: t("dataDictionary.onDelete"),
    yes: t("dataDictionary.yes"),
    no: t("dataDictionary.no"),
    kindTable: t("dataDictionary.kindTable"),
    kindView: t("dataDictionary.kindView"),
    kindMaterializedView: t("dataDictionary.kindMaterializedView"),
    indexesHeading: t("dataDictionary.indexesHeading"),
    foreignKeysHeading: t("dataDictionary.foreignKeysHeading"),
  };
}

async function load(): Promise<void> {
  const mine = ++generation;
  loadError.value = null;
  exportError.value = null;
  if (props.snapshot) {
    collected.value = props.snapshot;
    loading.value = false;
    return;
  }
  const connectionId = props.prefillConnectionId;
  const database = props.prefillDatabase;
  if (!connectionId || !database) {
    loadError.value = t("dataDictionary.loadFailed", { error: t("dataDictionary.empty") });
    collected.value = null;
    return;
  }
  loading.value = true;
  collected.value = null;
  try {
    const raw = await api.collectDocsSnapshot(connectionId, database, schema.value ? [schema.value] : [], tableNames.value, database);
    if (mine !== generation) return;
    const file = (await api.loadDocsAnnotations(connectionId)) ?? emptyAnnotations();
    if (mine !== generation) return;
    collected.value = await api.applyDocsAnnotations(connectionId, raw, file);
  } catch (error) {
    if (mine === generation) {
      loadError.value = t("dataDictionary.loadFailed", { error: error instanceof Error ? error.message : String(error) });
      collected.value = null;
    }
  } finally {
    if (mine === generation) loading.value = false;
  }
}

async function exportDictionary(): Promise<void> {
  const current = collected.value;
  if (!current || exportableTables.value.length === 0) return;
  exporting.value = true;
  exportError.value = null;
  try {
    const document = buildDataDictionary(current, labels(), {
      includeViews: effectiveIncludeViews.value,
      includeIndexesAndForeignKeys: includeIndexes.value,
    });
    const fileName = dataDictionaryDefaultFileName(props.prefillDatabase || current.project.database || current.project.name, schema.value, format.value);
    const content = format.value === "xlsx" ? buildXlsxWorkbookMulti(document.sheets) : document.markdown;
    const saved = await saveDataDictionaryFile(fileName, format.value, content);
    if (saved) open.value = false;
  } catch (error) {
    exportError.value = t("dataDictionary.exportFailed", { error: error instanceof Error ? error.message : String(error) });
  } finally {
    exporting.value = false;
  }
}

watch(
  open,
  (isOpen) => {
    if (!isOpen) {
      generation += 1;
      return;
    }
    format.value = "xlsx";
    includeViews.value = true;
    includeIndexes.value = true;
    void load();
  },
  { immediate: true },
);

watch(
  () => props.snapshot,
  (value) => {
    if (open.value && value) collected.value = value;
  },
);

onBeforeUnmount(() => {
  generation += 1;
});
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{{ t("dataDictionary.title") }}</DialogTitle>
        <DialogDescription>{{ scopeLabel }}</DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-4">
        <p v-if="loading" class="text-sm text-muted-foreground">{{ t("dataDictionary.loading") }}</p>
        <p v-if="loadError" class="text-sm text-destructive">{{ loadError }}</p>
        <p v-else-if="!loading && exportableTables.length === 0" class="text-sm text-muted-foreground">{{ t("dataDictionary.empty") }}</p>

        <div v-if="dictionaryWarnings.length > 0" class="flex max-h-32 flex-col gap-1 overflow-auto rounded border border-border p-2">
          <p class="text-xs font-medium text-foreground">{{ t("dataDictionary.warningsTitle") }}</p>
          <p v-for="(warning, index) in dictionaryWarnings" :key="index" class="text-xs text-muted-foreground">{{ warning }}</p>
        </div>

        <div class="flex flex-col gap-2">
          <Label>{{ t("dataDictionary.format") }}</Label>
          <div class="flex gap-2">
            <Button type="button" size="sm" :variant="format === 'xlsx' ? 'default' : 'outline'" @click="format = 'xlsx'">{{ t("dataDictionary.formatXlsx") }}</Button>
            <Button type="button" size="sm" :variant="format === 'markdown' ? 'default' : 'outline'" @click="format = 'markdown'">{{ t("dataDictionary.formatMarkdown") }}</Button>
          </div>
        </div>

        <div v-if="!explicitObjects" class="flex items-center justify-between gap-3">
          <Label for="data-dictionary-views">{{ t("dataDictionary.includeViews") }}</Label>
          <Switch id="data-dictionary-views" size="sm" :model-value="includeViews" @update:model-value="includeViews = Boolean($event)" />
        </div>
        <div class="flex items-center justify-between gap-3">
          <Label for="data-dictionary-indexes">{{ t("dataDictionary.includeIndexes") }}</Label>
          <Switch id="data-dictionary-indexes" size="sm" :model-value="includeIndexes" @update:model-value="includeIndexes = Boolean($event)" />
        </div>

        <p v-if="exportError" class="text-sm text-destructive">{{ exportError }}</p>
      </div>

      <DialogFooter>
        <Button type="button" :disabled="!canExport" @click="exportDictionary()">
          {{ exporting ? t("dataDictionary.exporting") : t("dataDictionary.export") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
