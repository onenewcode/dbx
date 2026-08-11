import assert from "node:assert/strict";
import { test } from "vitest";
import { REDIS_COMMAND_TABLE, isRedisMutatingCommand, resolveRedisCommandSpec } from "../../apps/desktop/src/lib/redis/redisCommandTable.ts";

test("write commands are flagged as mutating", () => {
  assert.equal(isRedisMutatingCommand("SET foo bar"), true);
  assert.equal(isRedisMutatingCommand("DEL foo"), true);
  assert.equal(isRedisMutatingCommand("HSET h k v"), true);
  assert.equal(isRedisMutatingCommand("LPUSH list a"), true);
  assert.equal(isRedisMutatingCommand("INCR counter"), true);
  assert.equal(isRedisMutatingCommand("EXPIRE foo 60"), true);
  assert.equal(isRedisMutatingCommand("RENAME a b"), true);
});

test("subcommand mutations are detected via MAIN SUB spec", () => {
  assert.equal(isRedisMutatingCommand("XGROUP CREATE s g 0"), true);
  assert.equal(isRedisMutatingCommand("XADD stream * field value"), true);
  assert.equal(isRedisMutatingCommand("CLUSTER RESET HARD"), true);
});

test("destructive/blocked commands are flagged as mutating", () => {
  assert.equal(isRedisMutatingCommand("FLUSHDB"), true);
  assert.equal(isRedisMutatingCommand("FLUSHALL"), true);
});

test("read-only commands are not mutating", () => {
  assert.equal(isRedisMutatingCommand("GET foo"), false);
  assert.equal(isRedisMutatingCommand("LRANGE list 0 -1"), false);
  assert.equal(isRedisMutatingCommand("HGETALL h"), false);
  assert.equal(isRedisMutatingCommand("KEYS *"), false);
  assert.equal(isRedisMutatingCommand("TYPE foo"), false);
  assert.equal(isRedisMutatingCommand("SCAN 0"), false);
  assert.equal(isRedisMutatingCommand("SELECT 1"), false);
  assert.equal(isRedisMutatingCommand("INFO"), false);
});

test("read-only subcommands are not mutating", () => {
  // XLEN is a read on a stream; XINFO ... is read
  assert.equal(isRedisMutatingCommand("XLEN stream"), false);
});

test("case-insensitive and quoted command tokens", () => {
  assert.equal(isRedisMutatingCommand("set foo bar"), true);
  assert.equal(isRedisMutatingCommand("del foo"), true);
  assert.equal(isRedisMutatingCommand('get "weird key"'), false);
});

test("unknown / empty commands are treated as non-mutating (no cache thrash)", () => {
  assert.equal(isRedisMutatingCommand(""), false);
  assert.equal(isRedisMutatingCommand("NOTACMD x y"), false);
});

test("resolveRedisCommandSpec resolves subcommand then main", () => {
  const sub = resolveRedisCommandSpec(["XGROUP", "CREATE"]);
  assert.ok(sub);
  assert.equal(sub?.safety, "write");
  const main = resolveRedisCommandSpec(["GET"]);
  assert.ok(main);
  assert.equal(main?.group, "string");
});

test("resolveRedisCommandSpec resolves every OBJECT subcommand with Redis arity", () => {
  const expectedArities = new Map([
    ["ENCODING", 3],
    ["FREQ", 3],
    ["IDLETIME", 3],
    ["REFCOUNT", 3],
    ["HELP", 2],
  ]);

  for (const [subcommand, arity] of expectedArities) {
    const spec = resolveRedisCommandSpec(["OBJECT", subcommand]);
    assert.ok(spec, `OBJECT ${subcommand} should resolve`);
    assert.equal(spec.arity, arity);
    assert.equal(spec.group, "generic");
  }

  assert.equal(resolveRedisCommandSpec(["OBJECT", "UNKNOWN"]), undefined);
});

test("normal writes do not require confirmation but destructive commands do", () => {
  assert.equal(resolveRedisCommandSpec(["SET"])?.safety, "write");
  assert.equal(resolveRedisCommandSpec(["HSET"])?.safety, "write");
  assert.equal(resolveRedisCommandSpec(["LPUSH"])?.safety, "write");
  assert.equal(resolveRedisCommandSpec(["DEL"])?.safety, "confirm");
  assert.equal(resolveRedisCommandSpec(["FLUSHDB"])?.safety, "confirm");
});

test("offline fallback covers every current Redis command omitted by the original table", () => {
  // Redis' official redis-doc commands.json is the source for this list. Keep
  // this explicit so a future table edit cannot silently lose fallback prompts.
  const expected: Array<[string, number, string]> = [
    ["ACL", -2, "server"],
    ["ACL CAT", -2, "server"],
    ["ACL DELUSER", -3, "server"],
    ["ACL DRYRUN", -4, "server"],
    ["ACL GENPASS", -2, "server"],
    ["ACL GETUSER", 3, "server"],
    ["ACL HELP", 2, "server"],
    ["ACL LIST", 2, "server"],
    ["ACL LOAD", 2, "server"],
    ["ACL LOG", -2, "server"],
    ["ACL SAVE", 2, "server"],
    ["ACL SETUSER", -3, "server"],
    ["ACL USERS", 2, "server"],
    ["ACL WHOAMI", 2, "server"],
    ["ASKING", 1, "cluster"],
    ["CLIENT", -2, "connection"],
    ["CLIENT HELP", 2, "connection"],
    ["CLIENT UNBLOCK", -3, "connection"],
    ["CLUSTER", -2, "cluster"],
    ["CLUSTER ADDSLOTSRANGE", -4, "cluster"],
    ["CLUSTER BUMPEPOCH", 2, "cluster"],
    ["CLUSTER DELSLOTSRANGE", -4, "cluster"],
    ["CLUSTER HELP", 2, "cluster"],
    ["CLUSTER MYSHARDID", 2, "cluster"],
    ["COMMAND", -1, "server"],
    ["COMMAND GETKEYSANDFLAGS", -3, "server"],
    ["COMMAND HELP", 2, "server"],
    ["CONFIG", -2, "server"],
    ["CONFIG HELP", 2, "server"],
    ["DEBUG", -2, "server"],
    ["EXPIRETIME", 2, "generic"],
    ["FUNCTION", -2, "scripting"],
    ["FUNCTION HELP", 2, "scripting"],
    ["FUNCTION KILL", 2, "scripting"],
    ["LATENCY", -2, "server"],
    ["LATENCY DOCTOR", 2, "server"],
    ["LATENCY GRAPH", 3, "server"],
    ["LATENCY HELP", 2, "server"],
    ["LATENCY HISTOGRAM", -2, "server"],
    ["LATENCY HISTORY", 3, "server"],
    ["LATENCY LATEST", 2, "server"],
    ["LATENCY RESET", -2, "server"],
    ["LOLWUT", -1, "server"],
    ["MEMORY", -2, "server"],
    ["MEMORY DOCTOR", 2, "server"],
    ["MEMORY HELP", 2, "server"],
    ["MEMORY MALLOC-STATS", 2, "server"],
    ["MODULE", -2, "server"],
    ["MODULE HELP", 2, "server"],
    ["OBJECT", -2, "generic"],
    ["PEXPIRETIME", 2, "generic"],
    ["PFDEBUG", 3, "hyperloglog"],
    ["PFSELFTEST", 1, "hyperloglog"],
    ["PSYNC", -3, "server"],
    ["PUBSUB", -2, "pubsub"],
    ["PUBSUB HELP", 2, "pubsub"],
    ["REPLCONF", -1, "server"],
    ["RESTORE-ASKING", -4, "server"],
    ["SCRIPT", -2, "scripting"],
    ["SCRIPT DEBUG", 3, "scripting"],
    ["SCRIPT HELP", 2, "scripting"],
    ["SLOWLOG", -2, "server"],
    ["SUBSTR", 4, "string"],
    ["XGROUP", -2, "stream"],
    ["XINFO", -2, "stream"],
  ];

  for (const [name, arity, group] of expected) {
    const spec = REDIS_COMMAND_TABLE[name];
    assert.ok(spec, `${name} should be available offline`);
    assert.equal(spec.arity, arity, `${name} arity`);
    assert.equal(spec.group, group, `${name} group`);
  }
});
