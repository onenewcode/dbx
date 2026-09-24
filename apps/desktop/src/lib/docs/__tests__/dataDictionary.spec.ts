import { describe, expect, it } from "vitest";
import type { ColumnInfo, DocTable, SchemaSnapshot } from "@/docs/types";
import { buildXlsxWorkbookMulti } from "@/lib/export/xlsxExport";
import { buildDataDictionary, dataDictionaryDefaultFileName, DATA_DICTIONARY_SHEET_NAME_LIMIT, type DataDictionaryLabels } from "@/lib/docs/dataDictionary";

const labels: DataDictionaryLabels = {
  sheetTables: "Tables",
  sheetColumns: "Columns",
  sheetIndexes: "Indexes",
  sheetForeignKeys: "Foreign Keys",
  schema: "Schema",
  table: "Table",
  kind: "Kind",
  tableComment: "Table comment",
  estimatedRows: "Estimated rows",
  columnCount: "Column count",
  ordinal: "#",
  column: "Column",
  type: "Type",
  length: "Length",
  precision: "Precision",
  scale: "Scale",
  primaryKey: "Primary key",
  nullable: "Nullable",
  unique: "Unique",
  defaultValue: "Default",
  extra: "Extra",
  comment: "Comment",
  indexName: "Index",
  indexColumns: "Index columns",
  indexType: "Index type",
  constraintName: "Constraint",
  refSchema: "Referenced schema",
  refTable: "Referenced table",
  refColumn: "Referenced column",
  onUpdate: "ON UPDATE",
  onDelete: "ON DELETE",
  yes: "Yes",
  no: "No",
  kindTable: "Table",
  kindView: "View",
  kindMaterializedView: "Materialized view",
  indexesHeading: "Indexes",
  foreignKeysHeading: "Foreign keys",
};

function column(partial: Partial<ColumnInfo> & Pick<ColumnInfo, "name" | "data_type">): ColumnInfo {
  return {
    is_nullable: true,
    column_default: null,
    is_primary_key: false,
    extra: null,
    comment: null,
    numeric_precision: null,
    numeric_scale: null,
    character_maximum_length: null,
    ...partial,
  };
}

function docTable(partial: Partial<DocTable> & Pick<DocTable, "name">): DocTable {
  return {
    schema: "public",
    kind: "TABLE",
    columns: [],
    indexes: [],
    foreignKeys: [],
    groupId: null,
    note: null,
    noteSource: "NONE",
    shadowedNote: null,
    columnNotes: {},
    estimatedRows: null,
    viewDefinition: null,
    ...partial,
  };
}

function snapshot(tables: DocTable[]): SchemaSnapshot {
  return {
    formatVersion: 1,
    project: { name: "shop", databaseType: "postgres", database: "shop", schemas: ["public"], generatedAt: "2026-09-24T00:00:00Z", note: null },
    tables,
    relationships: [],
    groups: [],
    enums: [],
    warnings: [],
  };
}

describe("buildDataDictionary", () => {
  it("writes an empty dictionary with headers and no data rows", () => {
    const document = buildDataDictionary(snapshot([]), labels, { includeViews: true, includeIndexesAndForeignKeys: true });

    expect(document.sheets).toHaveLength(4);
    expect(document.sheets.every((sheet) => sheet.rows.length === 0)).toBe(true);
    expect(document.sheets.every((sheet) => sheet.autoFilter)).toBe(true);
    expect(document.markdown).toBe("# shop\n");
  });

  it("fills table and column rows, and spells out length and precision", () => {
    const document = buildDataDictionary(
      snapshot([
        docTable({
          name: "orders",
          note: "Customer orders",
          estimatedRows: 12,
          columns: [
            column({ name: "id", data_type: "integer", is_nullable: false, is_primary_key: true }),
            column({ name: "code", data_type: "varchar", character_maximum_length: 32 }),
            column({ name: "amount", data_type: "numeric", numeric_precision: 10, numeric_scale: 2 }),
            column({ name: "kind", data_type: "varchar(8)", character_maximum_length: 8 }),
          ],
        }),
      ]),
      labels,
      { includeViews: true, includeIndexesAndForeignKeys: true },
    );

    expect(document.sheets[0]?.rows[0]).toEqual(["public", "orders", "Table", "Customer orders", 12, 4]);
    expect(document.sheets[1]?.rows[1]).toEqual(["public", "orders", 2, "code", "varchar(32)", 32, null, null, "No", "Yes", "No", "", "", ""]);
    expect(document.sheets[1]?.rows[2]?.[4]).toBe("numeric(10,2)");
    expect(document.sheets[1]?.rows[3]?.[4]).toBe("varchar(8)");
  });

  it("prefers a local column note over the database comment", () => {
    const document = buildDataDictionary(
      snapshot([
        docTable({
          name: "orders",
          columns: [column({ name: "status", data_type: "text", comment: "from database" })],
          columnNotes: { status: { note: "local note", source: "LOCAL", shadowed: "from database" } },
        }),
      ]),
      labels,
      { includeViews: true, includeIndexesAndForeignKeys: false },
    );

    expect(document.sheets[1]?.rows[0]?.[13]).toBe("local note");
    expect(document.markdown).toContain("local note");
    expect(document.markdown).not.toContain("from database");
  });

  it("drops views and the indexes and foreign keys that belong only to them", () => {
    const document = buildDataDictionary(
      snapshot([
        docTable({ name: "orders", indexes: [{ name: "orders_pkey", columns: ["id"], is_unique: true, is_primary: true, filter: null, index_type: "btree", included_columns: null, comment: null }] }),
        docTable({
          name: "active_orders",
          kind: "VIEW",
          indexes: [{ name: "view_idx", columns: ["id"], is_unique: false, is_primary: false, filter: null, index_type: null, included_columns: null, comment: null }],
          foreignKeys: [{ name: "view_fk", column: "id", ref_table: "orders", ref_column: "id" }],
        }),
      ]),
      labels,
      { includeViews: false, includeIndexesAndForeignKeys: true },
    );

    expect(document.sheets[0]?.rows.map((row) => row[1])).toEqual(["orders"]);
    expect(document.sheets[2]?.rows.map((row) => row[2])).toEqual(["orders_pkey"]);
    expect(document.sheets[3]?.rows).toEqual([]);
  });

  it("omits index and foreign-key sheets when that section is off", () => {
    const document = buildDataDictionary(snapshot([docTable({ name: "orders", indexes: [{ name: "orders_pkey", columns: ["id"], is_unique: true, is_primary: true, filter: null, index_type: null, included_columns: null, comment: null }] })]), labels, {
      includeViews: true,
      includeIndexesAndForeignKeys: false,
    });

    expect(document.sheets.map((sheet) => sheet.sheetName)).toEqual(["Tables", "Columns"]);
    expect(document.markdown).not.toContain("### Indexes");
  });

  it("escapes markdown table cells and keeps sheet names within the Excel limit", () => {
    const longLabels = { ...labels, sheetTables: "Tables / with: illegal * characters and a very long trailing name" };
    const document = buildDataDictionary(
      snapshot([
        docTable({
          name: "odd|name",
          note: "line1\nline2",
          columns: [column({ name: "a|b", data_type: "text", comment: "x|y" })],
        }),
      ]),
      longLabels,
      { includeViews: true, includeIndexesAndForeignKeys: true },
    );

    expect(document.sheets[0]?.sheetName.length).toBeLessThanOrEqual(DATA_DICTIONARY_SHEET_NAME_LIMIT);
    expect(document.sheets[0]?.sheetName).not.toMatch(/[\\/?*[\]:]/);
    expect(document.markdown).toContain("a\\|b");
    expect(document.markdown).toContain("line1<br>line2");
    expect(document.markdown).toContain("## public.odd\\|name");
  });

  it("builds a workbook whose bytes are an xlsx zip", () => {
    const document = buildDataDictionary(snapshot([docTable({ name: "orders", columns: [column({ name: "id", data_type: "integer" })] })]), labels, { includeViews: true, includeIndexesAndForeignKeys: true });
    const bytes = buildXlsxWorkbookMulti(document.sheets);

    expect(String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0)).toBe("PK");
  });
});

describe("dataDictionaryDefaultFileName", () => {
  it("uses the database, and the schema when one is selected", () => {
    expect(dataDictionaryDefaultFileName("shop", undefined, "xlsx")).toBe("shop-data-dictionary.xlsx");
    expect(dataDictionaryDefaultFileName("shop", "public", "markdown")).toBe("shop-public-data-dictionary.md");
    expect(dataDictionaryDefaultFileName("a/b", undefined, "xlsx")).toBe("a_b-data-dictionary.xlsx");
  });
});
