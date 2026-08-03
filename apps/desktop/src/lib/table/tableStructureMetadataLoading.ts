import type { TableInfoTab } from "@/types/database";

export type TableStructureMetadataFacet = "columns" | "indexes" | "foreign-keys" | "triggers" | "comment";

export interface TableStructureRefreshScope {
  columns: boolean;
  indexes: boolean;
  foreignKeys: boolean;
  triggers: boolean;
  tableComment: boolean;
}

export function visibleTableStructureRefreshScope(activeTab: TableInfoTab): TableStructureRefreshScope {
  switch (activeTab) {
    case "columns":
      return { columns: true, indexes: false, foreignKeys: false, triggers: false, tableComment: true };
    case "indexes":
      return { columns: true, indexes: true, foreignKeys: false, triggers: false, tableComment: true };
    case "foreignKeys":
      return { columns: true, indexes: false, foreignKeys: true, triggers: false, tableComment: true };
    case "triggers":
      return { columns: false, indexes: false, foreignKeys: false, triggers: true, tableComment: true };
    case "ddl":
      return { columns: false, indexes: false, foreignKeys: false, triggers: false, tableComment: false };
  }
}

export const TRIGGERS_ONLY_REFRESH_SCOPE: TableStructureRefreshScope = {
  columns: false,
  indexes: false,
  foreignKeys: false,
  triggers: true,
  tableComment: false,
};

export function missingTableStructureRefreshScope(scope: TableStructureRefreshScope, loadedFacets: ReadonlySet<TableStructureMetadataFacet>): TableStructureRefreshScope {
  return {
    columns: scope.columns && !loadedFacets.has("columns"),
    indexes: scope.indexes && !loadedFacets.has("indexes"),
    foreignKeys: scope.foreignKeys && !loadedFacets.has("foreign-keys"),
    triggers: scope.triggers && !loadedFacets.has("triggers"),
    tableComment: scope.tableComment && !loadedFacets.has("comment"),
  };
}

export function hasTableStructureRefreshScope(scope: TableStructureRefreshScope): boolean {
  return scope.columns || scope.indexes || scope.foreignKeys || scope.triggers || scope.tableComment;
}

export function shouldLoadTableStructureTriggers(options: { activeTab: TableInfoTab; isCreateMode: boolean; supported: boolean; loaded: boolean; loading: boolean; structureLoading: boolean }): boolean {
  return options.activeTab === "triggers" && !options.isCreateMode && options.supported && !options.loaded && !options.loading && !options.structureLoading;
}
