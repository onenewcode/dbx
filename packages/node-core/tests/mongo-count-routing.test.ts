import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import type { ConnectionConfig } from "../src/connections.js";
import { executeQuery } from "../src/database.js";

const mongoConfig: ConnectionConfig = {
  id: "mongo-bridge",
  name: "mongo-bridge",
  db_type: "mongodb",
  host: "127.0.0.1",
  port: 27017,
  username: "",
  password: "",
  database: "app",
  ssh_enabled: false,
  ssl: false,
};

test("direct backend routes MongoDB count commands through the count bridge", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "dbx-node-core-count-"));
  const previousDataDir = process.env.DBX_DATA_DIR;
  let requestBody: unknown;
  const server = createServer((req, res) => {
    assert.equal(req.url, "/data/mongo/count-documents");
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requestBody = JSON.parse(body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end("42");
    });
  });

  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("expected TCP bridge address");

    process.env.DBX_DATA_DIR = tempDir;
    await writeFile(join(tempDir, "mcp-bridge-port"), String(address.port));

    const result = await executeQuery(mongoConfig, "db.projects.count({ active: true })");

    assert.deepEqual(requestBody, {
      connection_id: "mongo-bridge",
      connection_name: "mongo-bridge",
      database: "app",
      collection: "projects",
      filter: '{ "active": true }',
      mode: "legacy",
    });
    assert.deepEqual(result, {
      columns: ["count"],
      rows: [{ count: 42 }],
      row_count: 1,
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previousDataDir === undefined) delete process.env.DBX_DATA_DIR;
    else process.env.DBX_DATA_DIR = previousDataDir;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("direct backend forwards legacy MongoDB insert options through the bridge", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "dbx-node-core-insert-"));
  const previousDataDir = process.env.DBX_DATA_DIR;
  const previousAllowWrites = process.env.DBX_MCP_ALLOW_WRITES;
  let requestBody: unknown;
  const server = createServer((req, res) => {
    assert.equal(req.url, "/data/mongo/insert-documents");
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requestBody = JSON.parse(body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"affected_rows":2}');
    });
  });

  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("expected TCP bridge address");

    process.env.DBX_DATA_DIR = tempDir;
    process.env.DBX_MCP_ALLOW_WRITES = "1";
    await writeFile(join(tempDir, "mcp-bridge-port"), String(address.port));

    const result = await executeQuery(mongoConfig, 'db.getCollection("accounting_reconciliations").insert([{ accountId: 999 }, { accountId: 1000 }], { ordered: false })');

    assert.deepEqual(requestBody, {
      connection_id: "mongo-bridge",
      connection_name: "mongo-bridge",
      database: "app",
      collection: "accounting_reconciliations",
      docs_json: '[{ "accountId": 999 }, { "accountId": 1000 }]',
      options_json: '{ "ordered": false }',
    });
    assert.deepEqual(result, { columns: [], rows: [], row_count: 2 });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previousDataDir === undefined) delete process.env.DBX_DATA_DIR;
    else process.env.DBX_DATA_DIR = previousDataDir;
    if (previousAllowWrites === undefined) delete process.env.DBX_MCP_ALLOW_WRITES;
    else process.env.DBX_MCP_ALLOW_WRITES = previousAllowWrites;
    await rm(tempDir, { recursive: true, force: true });
  }
});
