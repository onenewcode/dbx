/**
 * Redis command autocompletion shared by the query editor and terminal input.
 * It mirrors the shape of `elasticsearchCompletion.ts` so the editor's
 * completion pipeline can dispatch to it.
 *
 * The static `REDIS_COMMAND_TABLE` is the offline fallback. When available,
 * Redis command docs returned by the connected server through `COMMAND DOCS`
 * are authoritative for that server's core and module command set.
 */
import { REDIS_COMMAND_TABLE } from "@/lib/redis/redisCommandTable";
import type { RedisCommandSpec } from "@/lib/redis/redisCommandTable";
import type { RedisCommandDocumentation } from "@/lib/redis/redisCommandDocs";

export interface RedisCompletionItem {
  label: string;
  type: "keyword" | "text"; // command/subcommand=keyword, key name=text
  detail?: string; // single-line, e.g. "string · confirm"
  info?: string; // multi-line: Group / Arity / Safety
  summary?: string;
  since?: string;
  apply?: string;
  boost: number;
}

export interface RedisCompletionContext {
  mode: "command" | "subcommand" | "argument";
  prefix: string;
  /** Absolute document offset where the completion starts. */
  from: number;
  /** Upper-cased main command already typed, when known. */
  mainCommand?: string;
  /** Resolved command head, including a subcommand when applicable. */
  commandName?: string;
  /** In argument mode: 0-based index of the argument position (after the command head). */
  argumentIndex?: number;
}

export interface RedisCompletionInput {
  keys?: string[];
  /** Commands reported by the connected Redis server through `COMMAND DOCS`. */
  commands?: RedisCommandDocumentation[];
}

// ---- Static and server-reported command indexes ----

interface CompletionCommandEntry {
  name: string;
  spec: RedisCommandSpec;
  summary?: string;
  since?: string;
  firstArgumentIsKey: boolean;
}

interface CompletionIndex {
  commands: Map<string, CompletionCommandEntry>;
  mainCommands: CompletionCommandEntry[];
  subcommands: Map<string, CompletionCommandEntry[]>;
  subcommandMains: Set<string>;
}

// Groups whose first argument is a key name (enable key completion there).
const KEY_ARGUMENT_GROUPS = new Set(["string", "generic", "list", "hash", "set", "zset", "bitmap", "hyperloglog", "geo", "stream"]);

// Commands that accept a variadic list of keys (keep suggesting keys beyond the
// first argument slot). Most key commands take exactly one key; these keep going.
const MULTI_KEY_COMMANDS = new Set(["DEL", "UNLINK", "EXISTS", "TOUCH", "MGET"]);

// Boost tuning: common groups surface higher.
const GROUP_BOOST: Record<string, number> = {
  string: 110,
  generic: 108,
  connection: 100,
  server: 96,
};

function describeArity(arity: number): string {
  if (arity > 0) {
    const n = arity - 1;
    return `exactly ${n} argument${n === 1 ? "" : "s"}`;
  }
  if (arity < 0) {
    const n = -arity - 1;
    return `at least ${n} argument${n === 1 ? "" : "s"}`;
  }
  return "variable arguments";
}

function commandFirstArgumentIsKey(spec: RedisCommandSpec): boolean {
  if (KEY_ARGUMENT_GROUPS.has(spec.group)) return true;
  return false;
}

function createCompletionIndex(commandDocs: RedisCommandDocumentation[] = [], includeStaticCommands = true): CompletionIndex {
  const commands = new Map<string, CompletionCommandEntry>();
  if (includeStaticCommands) {
    for (const [name, spec] of Object.entries(REDIS_COMMAND_TABLE)) {
      commands.set(name, {
        name,
        spec,
        firstArgumentIsKey: commandFirstArgumentIsKey(spec),
      });
    }
  }
  for (const doc of commandDocs) {
    const name = doc.name.trim().toUpperCase();
    if (!name) continue;
    const current = REDIS_COMMAND_TABLE[name];
    const spec: RedisCommandSpec = {
      arity: doc.arity ?? current?.arity ?? 0,
      group: doc.group ?? current?.group ?? "server",
      // Commands absent from DBX's execution safety table remain visibly blocked.
      safety: current?.safety ?? "blocked",
    };
    commands.set(name, {
      name,
      spec,
      summary: doc.summary,
      since: doc.since,
      firstArgumentIsKey: doc.firstArgumentIsKey ?? (current ? commandFirstArgumentIsKey(current) : false),
    });
  }

  const mainCommands = new Map<string, CompletionCommandEntry>();
  const subcommands = new Map<string, CompletionCommandEntry[]>();
  const subcommandMains = new Set<string>();
  for (const entry of commands.values()) {
    const space = entry.name.indexOf(" ");
    if (space < 0) {
      mainCommands.set(entry.name, entry);
      continue;
    }
    const main = entry.name.slice(0, space);
    subcommandMains.add(main);
    const entries = subcommands.get(main) ?? [];
    entries.push(entry);
    subcommands.set(main, entries);
    // A command family may not have a root entry (for example old metadata for XGROUP).
    if (!mainCommands.has(main) && !commands.has(main)) {
      mainCommands.set(main, { ...entry, name: main, summary: undefined, since: undefined });
    }
  }

  return {
    commands,
    mainCommands: [...mainCommands.values()],
    subcommands,
    subcommandMains,
  };
}

const STATIC_COMPLETION_INDEX = createCompletionIndex();

function completionIndex(input: Pick<RedisCompletionInput, "commands"> = {}): CompletionIndex {
  return input.commands?.length ? createCompletionIndex(input.commands, false) : STATIC_COMPLETION_INDEX;
}

function matchesPrefix(value: string, prefix: string): boolean {
  return value.toLowerCase().startsWith(prefix.toLowerCase());
}

function buildSpecDetail(spec: RedisCommandSpec): string {
  return spec.safety === "allowed" ? spec.group : `${spec.group} · ${spec.safety}`;
}

function buildSpecInfo(entry: CompletionCommandEntry, label: string): string {
  const info = [];
  if (entry.summary) info.push(entry.summary);
  info.push(`Command: ${label}`, `Group: ${entry.spec.group}`, `Arity: ${describeArity(entry.spec.arity)}`, `Safety: ${entry.spec.safety}`);
  if (entry.since) info.push(`Since: ${entry.since}`);
  return info.join("\n");
}

function boostFor(spec: RedisCommandSpec): number {
  return GROUP_BOOST[spec.group] ?? 90;
}

// ---- Context parsing ----

export function getRedisCompletionContext(text: string, cursor: number, input: Pick<RedisCompletionInput, "commands"> = {}): RedisCompletionContext {
  const index = completionIndex(input);
  const safeCursor = Math.max(0, Math.min(cursor, text.length));
  const lineStart = text.lastIndexOf("\n", safeCursor - 1) + 1;
  const beforeCursor = text.slice(lineStart, safeCursor);

  // Tokenize the part before the cursor by whitespace.
  const tokens = beforeCursor.trimStart().length === 0 ? [] : beforeCursor.trim().split(/\s+/);
  const endsWithSpace = beforeCursor.length > 0 && /\s$/.test(beforeCursor);

  // Current word being typed (no trailing space yet).
  const currentWord = endsWithSpace ? "" : (tokens[tokens.length - 1] ?? "");
  const wordStartFromEnd = currentWord.length;
  const from = safeCursor - wordStartFromEnd;

  const typedTokens = endsWithSpace ? tokens : tokens.slice(0, -1);

  // No command yet (or typing the very first token).
  if (typedTokens.length === 0) {
    return { mode: "command", prefix: currentWord, from };
  }

  const main = typedTokens[0]!.toUpperCase();

  // First token done + space → maybe a subcommand of a command that has them.
  if (typedTokens.length === 1 && index.subcommandMains.has(main)) {
    return { mode: "subcommand", prefix: currentWord, from, mainCommand: main };
  }

  // Past the command (and any subcommand slot) → an argument. Track which
  // argument position the cursor is at so we only suggest key names for the
  // first key argument (e.g. GET <key>, not after the key is filled in).
  const subcommandName = typedTokens.length >= 2 ? `${main} ${typedTokens[1]!.toUpperCase()}` : undefined;
  const commandName = subcommandName && index.commands.has(subcommandName) ? subcommandName : subcommandName && index.subcommandMains.has(main) ? undefined : main;
  const commandHeadTokens = commandName === subcommandName ? 2 : 1;
  const argumentIndex = Math.max(typedTokens.length - commandHeadTokens, 0);
  return { mode: "argument", prefix: currentWord, from, mainCommand: main, commandName, argumentIndex };
}

// ---- Item builders ----

function commandItems(index: CompletionIndex, prefix: string): RedisCompletionItem[] {
  const items = index.mainCommands
    .filter((entry) => matchesPrefix(entry.name, prefix))
    .map((entry) => ({
      label: entry.name,
      type: "keyword" as const,
      detail: buildSpecDetail(entry.spec),
      info: buildSpecInfo(entry, entry.name),
      summary: entry.summary,
      since: entry.since,
      boost: boostFor(entry.spec),
    }));
  return items.sort((a, b) => b.boost - a.boost);
}

function subcommandItems(index: CompletionIndex, main: string, prefix: string): RedisCompletionItem[] {
  const items = (index.subcommands.get(main) ?? [])
    .filter((entry) => matchesPrefix(entry.name.slice(main.length + 1), prefix))
    .map((entry) => ({
      label: entry.name.slice(main.length + 1),
      type: "keyword" as const,
      detail: buildSpecDetail(entry.spec),
      info: buildSpecInfo(entry, entry.name),
      summary: entry.summary,
      since: entry.since,
      boost: boostFor(entry.spec),
    }));
  return items.sort((a, b) => b.boost - a.boost);
}

function keyItems(prefix: string, keys: string[]): RedisCompletionItem[] {
  if (!prefix) {
    // No partial key typed yet: offer a bounded sample (sorted) so the menu isn't empty.
    return keys.slice(0, 100).map((key) => ({
      label: key,
      type: "text" as const,
      detail: "key",
      boost: 60,
    }));
  }
  return keys
    .filter((key) => key.toLowerCase().includes(prefix.toLowerCase()))
    .slice(0, 100)
    .map((key) => ({
      label: key,
      type: "text" as const,
      detail: "key",
      boost: key.toLowerCase().startsWith(prefix.toLowerCase()) ? 70 : 55,
    }));
}

export function buildRedisCompletionItemsFromContext(context: RedisCompletionContext, input: RedisCompletionInput = {}): RedisCompletionItem[] {
  const index = completionIndex(input);
  if (context.mode === "command") return commandItems(index, context.prefix);
  if (context.mode === "subcommand" && context.mainCommand) {
    return subcommandItems(index, context.mainCommand, context.prefix);
  }
  // argument mode: offer key names at the key-argument slot only. Most key
  // commands take a single key (first slot); variadic key-list commands
  // (DEL/UNLINK/EXISTS/...) keep suggesting at every slot.
  const commandName = context.commandName ?? context.mainCommand;
  if (context.mode === "argument" && takesKeyArgument(commandName, input) && shouldSuggestKeyAt(context.mainCommand, context.argumentIndex)) {
    return keyItems(context.prefix, input.keys ?? []);
  }
  return [];
}

function shouldSuggestKeyAt(mainCommand: string | undefined, argumentIndex: number | undefined): boolean {
  if (argumentIndex == null) return false;
  if (mainCommand && MULTI_KEY_COMMANDS.has(mainCommand)) return true;
  return argumentIndex === 0;
}

export function buildRedisCompletionItems(text: string, cursor: number, input: RedisCompletionInput = {}): RedisCompletionItem[] {
  return buildRedisCompletionItemsFromContext(getRedisCompletionContext(text, cursor, input), input);
}

/** True when the active command metadata marks its first argument as a key. */
export function takesKeyArgument(commandName?: string, input: Pick<RedisCompletionInput, "commands"> = {}): boolean {
  if (!commandName) return false;
  return completionIndex(input).commands.get(commandName.toUpperCase())?.firstArgumentIsKey ?? false;
}

export function shouldAutoOpenRedisCompletion(text: string, cursor: number): boolean {
  const previousChar = text[cursor - 1];
  if (!previousChar) return false;
  if (/[\n\r]/.test(previousChar)) return false;
  // Open while typing command names or key names (letters/digits/_/:/./-).
  if (/[\w:*.-]/.test(previousChar)) return true;
  // Just typed a space after a command → open to suggest subcommands / keys.
  if (/\s/.test(previousChar)) return true;
  return false;
}

export function getRedisCompletionResultValidFor(): RegExp {
  return /[\w:*.-]*$/;
}
