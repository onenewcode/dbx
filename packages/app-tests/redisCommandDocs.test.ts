import assert from "node:assert/strict";
import { test } from "vitest";
import { parseRedisCommandCatalog, parseRedisCommandDocumentation } from "../../apps/desktop/src/lib/redis/redisCommandDocs.ts";

test("parses COMMAND DOCS maps emitted by the Redis bridge", () => {
  const docs = parseRedisCommandDocumentation([
    {
      key: "get",
      value: [
        { key: "summary", value: "Returns the string value of a key." },
        { key: "since", value: "1.0.0" },
        { key: "group", value: "string" },
        { key: "arity", value: 2 },
        {
          key: "arguments",
          value: [[{ key: "name", value: "key" }, { key: "type", value: "key" }]],
        },
      ],
    },
    {
      key: "acl cat",
      value: [
        { key: "summary", value: "Lists ACL categories." },
        { key: "group", value: "server" },
        { key: "arity", value: -2 },
      ],
    },
  ]);

  assert.deepEqual(docs, [
    { name: "ACL CAT", summary: "Lists ACL categories.", since: undefined, group: "server", arity: -2, firstArgumentIsKey: undefined },
    { name: "GET", summary: "Returns the string value of a key.", since: "1.0.0", group: "string", arity: 2, firstArgumentIsKey: true },
  ]);
});

test("parses nested subcommands from a COMMAND DOCS response", () => {
  const docs = parseRedisCommandDocumentation([
    {
      key: "acl",
      value: [
        { key: "summary", value: "A container for Access List Control commands." },
        { key: "group", value: "server" },
        { key: "arity", value: -2 },
        {
          key: "subcommands",
          value: [
            {
              key: "acl|cat",
              value: [
                { key: "summary", value: "Lists ACL categories." },
                { key: "group", value: "server" },
                { key: "arity", value: -2 },
              ],
            },
          ],
        },
      ],
    },
  ]);

  assert.deepEqual(docs, [
    { name: "ACL", summary: "A container for Access List Control commands.", since: undefined, group: "server", arity: -2, firstArgumentIsKey: undefined },
    { name: "ACL CAT", summary: "Lists ACL categories.", since: undefined, group: "server", arity: -2, firstArgumentIsKey: undefined },
  ]);
});

test("parses COMMAND DOCS maps returned through RESP2", () => {
  const docs = parseRedisCommandDocumentation([
    "get",
    [
      "summary",
      "Returns the string value of a key.",
      "since",
      "1.0.0",
      "group",
      "string",
      "arity",
      2,
      "arguments",
      [["name", "key", "type", "key"]],
    ],
  ]);

  assert.deepEqual(docs, [
    { name: "GET", summary: "Returns the string value of a key.", since: "1.0.0", group: "string", arity: 2, firstArgumentIsKey: true },
  ]);
});

test("parses the legacy COMMAND catalog including nested subcommands", () => {
  const docs = parseRedisCommandCatalog([
    ["get", 2, ["readonly", "fast"], 1, 1, 1, ["@read"], [], [], []],
    [
      "acl",
      -2,
      ["admin"],
      0,
      0,
      0,
      ["@admin"],
      [],
      [],
      [["acl|cat", -2, ["readonly"], 0, 0, 0, ["@read"], [], [], []]],
    ],
  ]);

  assert.deepEqual(docs, [
    { name: "ACL", summary: undefined, since: undefined, group: undefined, arity: -2, firstArgumentIsKey: false },
    { name: "ACL CAT", summary: undefined, since: undefined, group: undefined, arity: -2, firstArgumentIsKey: false },
    { name: "GET", summary: undefined, since: undefined, group: undefined, arity: 2, firstArgumentIsKey: true },
  ]);
});
