import assert from "node:assert/strict";
import { test } from "vitest";
import {
  documentStoreValueForGrid,
  parseDocumentStoreInputValue,
  parseDocumentStoreJsonDocument,
  documentStoreIdsEqual,
  prepareDocumentStoreWriteDocument,
  serializeDocumentStoreId,
  stringifyDocumentStoreValue,
} from "../../apps/desktop/src/lib/app/documentJsonValues.ts";

test("keeps Elasticsearch long values as native numeric JSON without rounding", () => {
  const value = parseDocumentStoreInputValue("2018551659033767937", "elasticsearch");

  assert.equal(documentStoreValueForGrid(value, "elasticsearch"), "2018551659033767937");
  assert.equal(stringifyDocumentStoreValue({ id: value }, "elasticsearch"), '{"id":2018551659033767937}');
});

test("keeps Elasticsearch string ids distinct from numeric long values", () => {
  const value = parseDocumentStoreInputValue('"2018551659033767937"', "elasticsearch");

  assert.equal(value, "2018551659033767937");
  assert.equal(serializeDocumentStoreId("orders/2018551659033767937", "elasticsearch"), "orders/2018551659033767937");
  assert.equal(stringifyDocumentStoreValue({ id: value }, "elasticsearch"), '{"id":"2018551659033767937"}');
});

test("retains MongoDB Extended JSON parsing for int64 fields", () => {
  const value = parseDocumentStoreInputValue("2018551659033767937", "mongodb");

  assert.deepEqual(value, { $numberLong: "2018551659033767937" });
  assert.equal(serializeDocumentStoreId("2018551659033767937", "mongodb"), '__dbx_mongo_string_id__"2018551659033767937"');
  assert.equal(stringifyDocumentStoreValue({ id: value }, "mongodb"), '{"id":{"$numberLong":"2018551659033767937"}}');
});

test("does not reinterpret Mongo-compatible objects stored in Elasticsearch", () => {
  const value = parseDocumentStoreInputValue('{"$numberLong":"2018551659033767937"}', "elasticsearch");

  assert.deepEqual(value, { $numberLong: "2018551659033767937" });
  assert.equal(stringifyDocumentStoreValue({ legacy: value }, "elasticsearch"), '{"legacy":{"$numberLong":"2018551659033767937"}}');
});

test("parses whole MongoDB document JSON with extended types and large ints", () => {
  const parsed = parseDocumentStoreJsonDocument(
    `{
      "_id": {"$oid": "6743e4bfa3f6f84bc3fff6c8"},
      "createdAt": {"$date": "2026-06-10T13:59:31.287Z"},
      "amount": 2018551659033767937,
      "nested": {"score": 42}
    }`,
    "mongodb",
  );

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.document, {
    _id: { $oid: "6743e4bfa3f6f84bc3fff6c8" },
    createdAt: { $date: "2026-06-10T13:59:31.287Z" },
    amount: { $numberLong: "2018551659033767937" },
    nested: { score: 42 },
  });
});

test("parses whole Elasticsearch document JSON while preserving large numbers", () => {
  const parsed = parseDocumentStoreJsonDocument('{"id":2018551659033767937,"name":"Ada"}', "elasticsearch");

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(documentStoreValueForGrid(parsed.document.id, "elasticsearch"), "2018551659033767937");
  assert.equal(stringifyDocumentStoreValue(parsed.document, "elasticsearch"), '{"id":2018551659033767937,"name":"Ada"}');
});

test("rejects invalid whole document JSON payloads", () => {
  assert.deepEqual(parseDocumentStoreJsonDocument("", "mongodb"), { ok: false, error: "empty" });
  assert.deepEqual(parseDocumentStoreJsonDocument("{", "mongodb"), { ok: false, error: "invalid" });
  assert.deepEqual(parseDocumentStoreJsonDocument("[1,2]", "elasticsearch"), { ok: false, error: "not-object" });
  assert.deepEqual(parseDocumentStoreJsonDocument("null", "mongodb"), { ok: false, error: "not-object" });
  assert.deepEqual(parseDocumentStoreJsonDocument('{"amount":9223372036854775808}', "mongodb"), { ok: false, error: "unsupported-number" });
  assert.deepEqual(
    parseDocumentStoreJsonDocument('{"name":"a","age":1,"name":"b"}', "mongodb"),
    { ok: false, error: "duplicate-key", field: "name" },
  );
});

test("prepareDocumentStoreWriteDocument strips immutable identity fields on update", () => {
  const mongo = prepareDocumentStoreWriteDocument(
    {
      _id: { $oid: "6743e4bfa3f6f84bc3fff6c8" },
      name: "Ada",
    },
    {
      kind: "mongodb",
      mode: "update",
      existingId: { $oid: "aaaaaaaaaaaaaaaaaaaaaaaa" },
    },
  );
  assert.equal(mongo.ignoredIdChange, true);
  assert.deepEqual(mongo.document, { name: "Ada" });

  const sameId = prepareDocumentStoreWriteDocument(
    {
      _id: { $oid: "6743e4bfa3f6f84bc3fff6c8" },
      name: "Ada",
    },
    {
      kind: "mongodb",
      mode: "update",
      existingId: { $oid: "6743e4bfa3f6f84bc3fff6c8" },
    },
  );
  assert.equal(sameId.ignoredIdChange, false);
  assert.deepEqual(sameId.document, { name: "Ada" });

  const es = prepareDocumentStoreWriteDocument(
    {
      _id: "doc-1",
      _routing: "shard-a",
      title: "hello",
    },
    {
      kind: "elasticsearch",
      mode: "update",
      existingId: "doc-1",
    },
  );
  assert.equal(es.ignoredIdChange, false);
  assert.deepEqual(es.document, { title: "hello" });

  const insertKeepsId = prepareDocumentStoreWriteDocument(
    {
      _id: { $oid: "6743e4bfa3f6f84bc3fff6c8" },
      name: "Ada",
    },
    {
      kind: "mongodb",
      mode: "insert",
    },
  );
  assert.equal(insertKeepsId.ignoredIdChange, false);
  assert.deepEqual(insertKeepsId.document, {
    _id: { $oid: "6743e4bfa3f6f84bc3fff6c8" },
    name: "Ada",
  });
});

test("documentStoreIdsEqual falls back safely for unstringifiable values", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  // Same reference remains equal without traversing the cycle.
  assert.equal(documentStoreIdsEqual(circular, circular, "mongodb"), true);
  // BigInt-bearing objects must not throw when comparing identifiers.
  assert.doesNotThrow(() => documentStoreIdsEqual({ value: 1n }, { value: 2n }, "mongodb"));
});
