/**
 * Normalizes `COMMAND DOCS` maps emitted by the Rust bridge. RESP3 maps are
 * serialized as `{ key, value }` entries; RESP2 maps are alternating arrays.
 */
export interface RedisCommandDocumentation {
  name: string;
  summary?: string;
  since?: string;
  group?: string;
  arity?: number;
  firstArgumentIsKey?: boolean;
}

type RedisRecord = Record<string, unknown>;

function mapEntries(value: unknown): Array<[string, unknown]> {
  if (Array.isArray(value)) {
    // RESP2 represents a map as an alternating key/value array, while RESP3
    // reaches the bridge as `{ key, value }` entries.
    if (value.length > 0 && value.length % 2 === 0 && value.every((item, index) => index % 2 !== 0 || typeof item === "string")) {
      const entries: Array<[string, unknown]> = [];
      for (let index = 0; index < value.length; index += 2) {
        entries.push([value[index] as string, value[index + 1]]);
      }
      return entries;
    }
    const entries: Array<[string, unknown]> = [];
    for (const item of value) {
      if (Array.isArray(item) && item.length >= 2 && typeof item[0] === "string") {
        entries.push([item[0], item[1]]);
        continue;
      }
      if (item && typeof item === "object" && "key" in item && "value" in item && typeof item.key === "string") {
        entries.push([item.key, item.value]);
      }
    }
    return entries;
  }
  if (value && typeof value === "object") return Object.entries(value);
  return [];
}

function recordFromMap(value: unknown): RedisRecord {
  return Object.fromEntries(mapEntries(value));
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeCommandName(value: string): string {
  // Redis represents subcommands as `parent|child` in COMMAND metadata.
  return value.trim().replaceAll("|", " ").toUpperCase();
}

function firstArgumentIsKey(value: unknown): boolean | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const argument of value) {
    const record = recordFromMap(argument);
    const type = optionalString(record.type);
    if (!type) continue;
    return type === "key";
  }
  return undefined;
}

function isCommandInfo(value: unknown): value is unknown[] {
  return Array.isArray(value) && typeof value[0] === "string" && optionalNumber(value[1]) !== undefined && Array.isArray(value[2]) && optionalNumber(value[3]) !== undefined;
}

/** Extract the completion-relevant subset of Redis' official `COMMAND DOCS` reply. */
export function parseRedisCommandDocumentation(value: unknown): RedisCommandDocumentation[] {
  const docs = new Map<string, RedisCommandDocumentation>();
  const collect = (rawDocs: unknown) => {
    for (const [rawName, rawDoc] of mapEntries(rawDocs)) {
      const name = normalizeCommandName(rawName);
      if (!name) continue;
      const doc = recordFromMap(rawDoc);
      docs.set(name, {
        name,
        summary: optionalString(doc.summary),
        since: optionalString(doc.since),
        group: optionalString(doc.group),
        arity: optionalNumber(doc.arity),
        firstArgumentIsKey: firstArgumentIsKey(doc.arguments),
      });
      // COMMAND DOCS returns only command families at the top level; their
      // concrete subcommands are nested in a map keyed as `parent|child`.
      if (doc.subcommands) collect(doc.subcommands);
    }
  };
  collect(value);
  return [...docs.values()].sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Extract command names from the legacy `COMMAND` reply, used on Redis before
 * 7.0 where `COMMAND DOCS` is unavailable. Its name and key-position fields
 * are stable across Redis 2.8+, and modern replies also include subcommands.
 */
export function parseRedisCommandCatalog(value: unknown): RedisCommandDocumentation[] {
  const docs = new Map<string, RedisCommandDocumentation>();
  const collect = (rawValue: unknown) => {
    if (isCommandInfo(rawValue)) {
      const rawName = rawValue[0];
      if (typeof rawName !== "string") return;
      const name = normalizeCommandName(rawName);
      if (name) {
        const firstKeyPosition = optionalNumber(rawValue[3]);
        docs.set(name, {
          name,
          summary: undefined,
          since: undefined,
          group: undefined,
          arity: optionalNumber(rawValue[1]),
          firstArgumentIsKey: firstKeyPosition == null ? undefined : firstKeyPosition === 1,
        });
      }
      // Redis 7+ appends subcommand command-info replies in slot 10.
      collect(rawValue[9]);
      return;
    }
    if (Array.isArray(rawValue)) {
      for (const entry of rawValue) collect(entry);
      return;
    }
    if (rawValue && typeof rawValue === "object") {
      // A cluster client can return a node-to-reply map through the bridge.
      if ("value" in rawValue) {
        collect(rawValue.value);
      } else {
        for (const entry of Object.values(rawValue)) collect(entry);
      }
    }
  };
  collect(value);
  return [...docs.values()].sort((left, right) => left.name.localeCompare(right.name));
}
