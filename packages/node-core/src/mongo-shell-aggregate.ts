/**
 * Canonical MongoDB `db.collection.aggregate(pipeline[, options])` shell parse.
 *
 * Desktop, CLI, MCP, and node-core all import from here so options / diagnostics
 * cannot drift. Keep pure TypeScript (no Node native deps) so the desktop app can
 * import the source module directly.
 */

export interface MongoAggregateCommand {
  collection: string;
  pipeline: string;
  /** Optional second argument to `aggregate(pipeline, options)`, e.g. `{explain: true}`. */
  options?: string;
}

/** Shared unsupported-command hint (desktop / CLI / MCP / Rust fallback copy this wording). */
export const MONGO_SHELL_COMMAND_HINT =
  "Use MongoDB shell-style commands, for example: db.collection.find({}).limit(100), " +
  "db.collection.aggregate([]), db.collection.aggregate([], { explain: true }), " +
  'db.version(), db.collection.countDocuments({}), db.collection.distinct("field"), ' +
  "db.collection.getIndexes(), db.collection.createIndex({...}), or db.collection.insertOne({...}).";

const PIPELINE_MUST_BE_ARRAY =
  "MongoDB aggregate pipeline must be a JSON array (for example [{ $match: {} }]).";
const OPTIONS_MUST_BE_OBJECT =
  "MongoDB aggregate options must be a JSON object (for example { explain: true }).";
const UNCLOSED_DELIMITERS =
  "MongoDB command has unclosed parentheses, brackets, braces, or strings.";
const UNSUPPORTED_CHAINING =
  "Unsupported MongoDB aggregate form. Use db.collection.aggregate(pipeline) or " +
  "db.collection.aggregate(pipeline, options). Chaining (for example .limit()) is not supported.";
const EXPECTS_PIPELINE_OR_OPTIONS =
  "MongoDB aggregate expects aggregate(pipeline) or aggregate(pipeline, options).";

type AggregateParseResult =
  | { ok: true; command: MongoAggregateCommand }
  | { ok: false; reason: string };

export function parseMongoAggregateCommand(input: string): MongoAggregateCommand | null {
  const source = input.trim().replace(/;$/, "").trim();
  const parsed = tryParseMongoAggregateCommand(source);
  return parsed?.ok ? parsed.command : null;
}

/**
 * Client-side diagnosis when shell parsing fails, so callers do not fall through
 * to a generic SQL / unknown-command rejection that hides syntax details.
 */
export function describeMongoCommandParseFailure(input: string): string {
  const source = trimMongoOuterComments(input).trim().replace(/;$/, "").trim();
  if (!source) return "Empty MongoDB command.";
  if (hasUnclosedMongoDelimiters(source)) return UNCLOSED_DELIMITERS;
  const aggregate = tryParseMongoAggregateCommand(source);
  if (aggregate && !aggregate.ok) return aggregate.reason;
  return MONGO_SHELL_COMMAND_HINT;
}

function tryParseMongoAggregateCommand(source: string): AggregateParseResult | null {
  const target = parseCollectionMethodTarget(source, "aggregate");
  if (!target) return null;

  const openIndex = source.indexOf("(", target.methodCallIndex);
  const closeIndex = findMatchingParen(source, openIndex);
  if (closeIndex < 0) return { ok: false, reason: UNCLOSED_DELIMITERS };
  if (source.slice(closeIndex + 1).trim()) return { ok: false, reason: UNSUPPORTED_CHAINING };

  const args = splitTopLevel(source.slice(openIndex + 1, closeIndex));
  if (args.length < 1 || args.length > 2) return { ok: false, reason: EXPECTS_PIPELINE_OR_OPTIONS };
  if (args.length === 2 && !args[1]?.trim()) return { ok: false, reason: OPTIONS_MUST_BE_OBJECT };

  const pipeline = normalizeJsonArgument(args[0] ?? "");
  if (!pipeline) return { ok: false, reason: PIPELINE_MUST_BE_ARRAY };
  try {
    if (!Array.isArray(JSON.parse(pipeline))) return { ok: false, reason: PIPELINE_MUST_BE_ARRAY };
  } catch {
    return { ok: false, reason: PIPELINE_MUST_BE_ARRAY };
  }

  if (args.length === 2) {
    const options = parseMongoObjectArgument(args[1]);
    if (!options) return { ok: false, reason: OPTIONS_MUST_BE_OBJECT };
    return { ok: true, command: { collection: target.collection, pipeline, options } };
  }

  return { ok: true, command: { collection: target.collection, pipeline } };
}

function parseCollectionMethodTarget(source: string, method: string): { collection: string; methodCallIndex: number } | null {
  const escapedMethod = escapeRegExp(method);
  const direct = new RegExp(`^db\\s*\\.\\s*([A-Za-z_$][\\w$]*)\\s*\\.\\s*${escapedMethod}\\s*\\(`).exec(source);
  if (direct) {
    return { collection: direct[1]!, methodCallIndex: findChainedMethodCallIndex(source, method) };
  }
  const getCollection = new RegExp(
    `^db\\s*\\.\\s*getCollection\\s*\\(\\s*(["'])(.*?)\\1\\s*\\)\\s*\\.\\s*${escapedMethod}\\s*\\(`,
  ).exec(source);
  if (getCollection) {
    return { collection: getCollection[2]!, methodCallIndex: findChainedMethodCallIndex(source, method) };
  }
  return null;
}

function findChainedMethodCallIndex(source: string, method: string): number {
  return new RegExp(`\\.\\s*${escapeRegExp(method)}\\s*\\(`, "g").exec(source)?.index ?? -1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseMongoObjectArgument(arg: string | undefined): string | null {
  if (!arg?.trim()) return null;
  const normalized = normalizeJsonArgument(arg);
  if (!normalized) return null;
  try {
    const value = JSON.parse(normalized) as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value) ? normalized : null;
  } catch {
    return null;
  }
}

function normalizeJsonArgument(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "{}";
  const withExtendedJson = replaceMongoShellConstructors(trimmed);
  const preprocessed = quoteUnquotedObjectKeys(convertSingleQuotedStrings(withExtendedJson));
  try {
    JSON.parse(preprocessed);
    return preprocessed;
  } catch {
    return null;
  }
}

function replaceMongoShellConstructors(source: string): string {
  const constructor =
    /^(ObjectId|NumberLong|ISODate)\s*\(\s*["']([^"']+)["']\s*\)|^(ObjectId|NumberLong)\s*\(\s*(-?\d+)\s*\)|^(?:new\s+Date)\s*\(\s*["']([^"']+)["']\s*\)/;
  let result = "";
  let index = 0;
  while (index < source.length) {
    const quote = source[index];
    if (quote === '"' || quote === "'") {
      const start = index++;
      while (index < source.length) {
        if (source[index] === "\\") index += 2;
        else if (source[index] === quote) {
          index++;
          break;
        } else index++;
      }
      result += source.slice(start, index);
      continue;
    }
    const match = source.slice(index).match(constructor);
    if (!match) {
      result += source[index++]!;
      continue;
    }
    if (match[1]) {
      result +=
        match[1] === "ObjectId"
          ? `{"$oid":"${match[2]}"}`
          : match[1] === "NumberLong"
            ? `{"$numberLong":"${match[2]}"}`
            : `{"$date":"${match[2]}"}`;
    } else if (match[3]) {
      result += match[3] === "NumberLong" ? `{"$numberLong":"${match[4]}"}` : `{"$oid":"${match[4]}"}`;
    } else {
      result += `{"$date":"${match[5]}"}`;
    }
    index += match[0].length;
  }
  return result;
}

function convertSingleQuotedStrings(source: string): string {
  let result = "";
  let copiedUntil = 0;
  let quote: string | null = null;
  let start = 0;
  let value = "";
  let escaped = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i] ?? "";
    if (!quote) {
      if (char === '"' || char === "'") {
        quote = char;
        start = i;
        value = "";
        escaped = false;
      }
      continue;
    }
    if (escaped) {
      value += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      value += char;
      escaped = true;
      continue;
    }
    if (char === quote) {
      if (quote === "'") {
        result += source.slice(copiedUntil, start);
        result += JSON.stringify(value);
        copiedUntil = i + 1;
      }
      quote = null;
      continue;
    }
    value += char;
  }

  return copiedUntil === 0 ? source : result + source.slice(copiedUntil);
}

function quoteUnquotedObjectKeys(source: string): string {
  let result = "";
  let quote: string | null = null;
  let escaped = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i] ?? "";
    if (quote) {
      result += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      result += char;
      continue;
    }
    if (/[A-Za-z_$]/.test(char) && shouldQuoteObjectKey(source, i)) {
      let end = i + 1;
      while (/[\w$]/.test(source[end] || "")) end += 1;
      result += `"${source.slice(i, end)}"`;
      i = end - 1;
      continue;
    }
    result += char;
  }
  return result;
}

function shouldQuoteObjectKey(source: string, index: number): boolean {
  let before = index - 1;
  while (/\s/.test(source[before] || "")) before -= 1;
  if (source[before] !== "{" && source[before] !== ",") return false;
  let after = index + 1;
  while (/[\w$]/.test(source[after] || "")) after += 1;
  while (/\s/.test(source[after] || "")) after += 1;
  return source[after] === ":";
}

function splitTopLevel(source: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let quote: string | null = null;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\" && i + 1 < source.length) i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "{" || ch === "[" || ch === "(") depth += 1;
    else if (ch === "}" || ch === "]" || ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) {
      parts.push(source.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(source.slice(start));
  return parts;
}

function findMatchingParen(source: string, openIndex: number): number {
  if (openIndex < 0 || source[openIndex] !== "(") return -1;
  let depth = 0;
  let quote: string | null = null;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\" && i + 1 < source.length) i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function hasUnclosedMongoDelimiters(source: string): boolean {
  const stack: string[] = [];
  let quote: string | null = null;
  let escaped = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i] ?? "";
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") {
      stack.push(char);
      continue;
    }
    if (char === ")" || char === "]" || char === "}") {
      const expected = char === ")" ? "(" : char === "]" ? "[" : "{";
      if (stack.pop() !== expected) return true;
    }
  }
  return quote !== null || stack.length > 0;
}

function trimMongoOuterComments(source: string): string {
  let text = source;
  // Strip leading // and /* */ and -- comments repeatedly.
  for (;;) {
    const trimmed = text.trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("--")) {
      const nl = trimmed.indexOf("\n");
      text = nl < 0 ? "" : trimmed.slice(nl + 1);
      continue;
    }
    if (trimmed.startsWith("/*")) {
      const end = trimmed.indexOf("*/");
      if (end < 0) return trimmed;
      text = trimmed.slice(end + 2);
      continue;
    }
    return trimmed.trimEnd();
  }
}
