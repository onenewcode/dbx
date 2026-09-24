import type { XlsxCellValue, XlsxWorksheetData } from "@/lib/export/xlsxExport";
import type { ColumnInfo, DocTable, SchemaSnapshot } from "@/docs/types";

export const DATA_DICTIONARY_SHEET_NAME_LIMIT = 31;

export interface DataDictionaryLabels {
  sheetTables: string;
  sheetColumns: string;
  sheetIndexes: string;
  sheetForeignKeys: string;
  schema: string;
  table: string;
  kind: string;
  tableComment: string;
  estimatedRows: string;
  columnCount: string;
  ordinal: string;
  column: string;
  type: string;
  length: string;
  precision: string;
  scale: string;
  primaryKey: string;
  nullable: string;
  unique: string;
  defaultValue: string;
  extra: string;
  comment: string;
  indexName: string;
  indexColumns: string;
  indexType: string;
  constraintName: string;
  refSchema: string;
  refTable: string;
  refColumn: string;
  onUpdate: string;
  onDelete: string;
  yes: string;
  no: string;
  kindTable: string;
  kindView: string;
  kindMaterializedView: string;
  indexesHeading: string;
  foreignKeysHeading: string;
}

export interface DataDictionaryOptions {
  includeViews: boolean;
  includeIndexesAndForeignKeys: boolean;
}

export interface DataDictionaryDocument {
  sheets: XlsxWorksheetData[];
  markdown: string;
}

export function dataDictionaryDefaultFileName(database: string, schema: string | undefined, format: "xlsx" | "markdown"): string {
  const safe = (value: string) => value.replace(/[\\/:*?"<>|]/g, "_").trim() || "database";
  const base = schema ? `${safe(database)}-${safe(schema)}` : safe(database);
  return `${base}-data-dictionary.${format === "xlsx" ? "xlsx" : "md"}`;
}

export function sheetNameForDictionary(value: string): string {
  const cleaned = [...value]
    .map((char) => ("[]:*?/\\".includes(char) ? " " : char))
    .join("")
    .trim();
  const name = cleaned || "Sheet";
  return [...name].slice(0, DATA_DICTIONARY_SHEET_NAME_LIMIT).join("");
}

export function buildDataDictionary(snapshot: SchemaSnapshot, labels: DataDictionaryLabels, options: DataDictionaryOptions): DataDictionaryDocument {
  const tables = snapshot.tables.filter((table) => options.includeViews || table.kind === "TABLE");
  const sheets: XlsxWorksheetData[] = [tablesSheet(tables, labels), columnsSheet(tables, labels)];
  if (options.includeIndexesAndForeignKeys) {
    sheets.push(indexesSheet(tables, labels), foreignKeysSheet(tables, labels));
  }
  return { sheets, markdown: markdownDocument(snapshot.project.name, tables, labels, options.includeIndexesAndForeignKeys) };
}

function tablesSheet(tables: DocTable[], labels: DataDictionaryLabels): XlsxWorksheetData {
  return {
    sheetName: sheetNameForDictionary(labels.sheetTables),
    autoFilter: true,
    columns: [labels.schema, labels.table, labels.kind, labels.tableComment, labels.estimatedRows, labels.columnCount],
    rows: tables.map((table) => [table.schema ?? "", table.name, kindLabel(table, labels), table.note ?? "", table.estimatedRows, table.columns.length]),
  };
}

function columnsSheet(tables: DocTable[], labels: DataDictionaryLabels): XlsxWorksheetData {
  const rows: XlsxCellValue[][] = [];
  for (const table of tables) {
    table.columns.forEach((column, index) => {
      rows.push([
        table.schema ?? "",
        table.name,
        index + 1,
        column.name,
        typeLabel(column),
        column.character_maximum_length,
        column.numeric_precision,
        column.numeric_scale,
        yesNo(column.is_primary_key, labels),
        yesNo(column.is_nullable, labels),
        yesNo(columnIsUnique(column), labels),
        column.column_default ?? "",
        column.extra ?? "",
        columnComment(table, column),
      ]);
    });
  }
  return {
    sheetName: sheetNameForDictionary(labels.sheetColumns),
    autoFilter: true,
    columns: [labels.schema, labels.table, labels.ordinal, labels.column, labels.type, labels.length, labels.precision, labels.scale, labels.primaryKey, labels.nullable, labels.unique, labels.defaultValue, labels.extra, labels.comment],
    rows,
  };
}

function indexesSheet(tables: DocTable[], labels: DataDictionaryLabels): XlsxWorksheetData {
  const rows: XlsxCellValue[][] = [];
  for (const table of tables) {
    for (const index of table.indexes) {
      rows.push([table.schema ?? "", table.name, index.name, index.columns.join(", "), yesNo(index.is_unique, labels), yesNo(index.is_primary, labels), index.index_type ?? "", index.comment ?? ""]);
    }
  }
  return {
    sheetName: sheetNameForDictionary(labels.sheetIndexes),
    autoFilter: true,
    columns: [labels.schema, labels.table, labels.indexName, labels.indexColumns, labels.unique, labels.primaryKey, labels.indexType, labels.comment],
    rows,
  };
}

function foreignKeysSheet(tables: DocTable[], labels: DataDictionaryLabels): XlsxWorksheetData {
  const rows: XlsxCellValue[][] = [];
  for (const table of tables) {
    for (const key of table.foreignKeys) {
      rows.push([table.schema ?? "", table.name, key.name, key.column, key.ref_schema ?? "", key.ref_table, key.ref_column, key.on_update ?? "", key.on_delete ?? ""]);
    }
  }
  return {
    sheetName: sheetNameForDictionary(labels.sheetForeignKeys),
    autoFilter: true,
    columns: [labels.schema, labels.table, labels.constraintName, labels.column, labels.refSchema, labels.refTable, labels.refColumn, labels.onUpdate, labels.onDelete],
    rows,
  };
}

function markdownDocument(projectName: string, tables: DocTable[], labels: DataDictionaryLabels, includeIndexesAndForeignKeys: boolean): string {
  const parts = [`# ${markdownCell(projectName) || "data-dictionary"}`];
  for (const table of tables) {
    const lines = [`## ${markdownCell(qualifiedName(table))}`];
    if (table.note) lines.push("", markdownCell(table.note));
    lines.push(
      "",
      markdownTable(
        [labels.column, labels.type, labels.length, labels.precision, labels.scale, labels.primaryKey, labels.nullable, labels.unique, labels.defaultValue, labels.extra, labels.comment],
        table.columns.map((column) => [
          column.name,
          typeLabel(column),
          column.character_maximum_length,
          column.numeric_precision,
          column.numeric_scale,
          yesNo(column.is_primary_key, labels),
          yesNo(column.is_nullable, labels),
          yesNo(columnIsUnique(column), labels),
          column.column_default ?? "",
          column.extra ?? "",
          columnComment(table, column),
        ]),
      ),
    );
    if (includeIndexesAndForeignKeys && table.indexes.length > 0) {
      lines.push(
        "",
        `### ${labels.indexesHeading}`,
        "",
        markdownTable(
          [labels.indexName, labels.indexColumns, labels.unique, labels.primaryKey, labels.indexType, labels.comment],
          table.indexes.map((index) => [index.name, index.columns.join(", "), yesNo(index.is_unique, labels), yesNo(index.is_primary, labels), index.index_type ?? "", index.comment ?? ""]),
        ),
      );
    }
    if (includeIndexesAndForeignKeys && table.foreignKeys.length > 0) {
      lines.push(
        "",
        `### ${labels.foreignKeysHeading}`,
        "",
        markdownTable(
          [labels.constraintName, labels.column, labels.refSchema, labels.refTable, labels.refColumn, labels.onUpdate, labels.onDelete],
          table.foreignKeys.map((key) => [key.name, key.column, key.ref_schema ?? "", key.ref_table, key.ref_column, key.on_update ?? "", key.on_delete ?? ""]),
        ),
      );
    }
    parts.push(lines.join("\n"));
  }
  return `${parts.join("\n\n")}\n`;
}

function markdownTable(headers: string[], rows: unknown[][]): string {
  const head = `| ${headers.map(markdownCell).join(" | ")} |`;
  const rule = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map(markdownCell).join(" | ")} |`);
  return [head, rule, ...body].join("\n");
}

function markdownCell(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>").trim();
}

function qualifiedName(table: DocTable): string {
  return table.schema ? `${table.schema}.${table.name}` : table.name;
}

function kindLabel(table: DocTable, labels: DataDictionaryLabels): string {
  if (table.kind === "VIEW") return labels.kindView;
  if (table.kind === "MATERIALIZED_VIEW") return labels.kindMaterializedView;
  return labels.kindTable;
}

function yesNo(value: boolean, labels: DataDictionaryLabels): string {
  return value ? labels.yes : labels.no;
}

function columnIsUnique(column: ColumnInfo): boolean {
  return (column as ColumnInfo & { is_unique?: boolean }).is_unique === true;
}

function columnComment(table: DocTable, column: ColumnInfo): string {
  const note = table.columnNotes[column.name]?.note;
  if (note && note.trim() !== "") return note;
  return column.comment ?? "";
}

/** Match the documentation viewer: keep a spelled-out type, otherwise attach length or precision. */
function typeLabel(column: ColumnInfo): string {
  const base = column.data_type.trim();
  if (base.includes("(")) return base;
  if (column.character_maximum_length !== null) return `${base}(${column.character_maximum_length})`;
  if (column.numeric_precision !== null) {
    const scale = column.numeric_scale === null ? "" : `,${column.numeric_scale}`;
    return `${base}(${column.numeric_precision}${scale})`;
  }
  return base;
}
