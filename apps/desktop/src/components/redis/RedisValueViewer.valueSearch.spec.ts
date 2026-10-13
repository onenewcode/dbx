// @vitest-environment happy-dom

import { createApp, defineComponent, h, nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redisGetValue: vi.fn(),
  redisGetTtl: vi.fn(),
  redisSetTtl: vi.fn(),
  redisSetExpireAt: vi.fn(),
  redisLoadMore: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/lib/backend/api", () => ({
  redisGetValue: mocks.redisGetValue,
  redisGetTtl: mocks.redisGetTtl,
  redisSetTtl: mocks.redisSetTtl,
  redisSetExpireAt: mocks.redisSetExpireAt,
  redisLoadMore: mocks.redisLoadMore,
}));

vi.mock("@/composables/useEditorFontFamilyStyle", () => ({
  useEditorFontFamilyStyle: () => ({}),
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/lib/common/shikiJsonHighlighter", () => ({
  createShikiJsonHighlighter: vi.fn().mockResolvedValue(() => ""),
}));

import RedisValueViewer from "./RedisValueViewer.vue";

const mountedApps: Array<{ unmount: () => void; host: HTMLElement }> = [];

function createLocalStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
    getItem(key) {
      return entries.get(key) ?? null;
    },
    key(index) {
      return [...entries.keys()][index] ?? null;
    },
    removeItem(key) {
      entries.delete(key);
    },
    setItem(key, value) {
      entries.set(key, String(value));
    },
  };
}

async function settle() {
  for (let index = 0; index < 4; index += 1) {
    await nextTick();
    await Promise.resolve();
  }
}

function stringValue() {
  return {
    key_display: "user:info:admin",
    key_raw: "user:info:admin",
    ttl: -1,
    redis_type: "string",
    data: {
      kind: "string" as const,
      content: {
        raw_base64: btoa("alpha needle beta NEEDLE omega"),
        encoding: "utf8" as const,
      },
    },
  };
}

function mountViewer() {
  const host = document.createElement("div");
  document.body.append(host);
  const viewerRef = ref<{ focusSearch: () => boolean } | null>(null);
  const app = createApp(
    defineComponent({
      setup() {
        return () =>
          h(RedisValueViewer, {
            ref: viewerRef,
            connectionId: "connection",
            db: 0,
            keyDisplay: "user:info:admin",
            keyRaw: "user:info:admin",
          });
      },
    }),
  );
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: {} }, missingWarn: false, fallbackWarn: false }));
  app.mount(host);
  mountedApps.push({ unmount: () => app.unmount(), host });
  return viewerRef;
}

function searchInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>("input[data-text-content-search-input]");
  if (!input) throw new Error("Value search input not found");
  return input;
}

function valueTextarea(): HTMLTextAreaElement {
  const textarea = document.querySelector<HTMLTextAreaElement>("textarea[data-text-content-textarea-input]");
  if (!textarea) throw new Error("Value textarea not found");
  return textarea;
}

function activeMatchText(): string | undefined {
  return document.querySelector<HTMLElement>('[data-document-search-active="true"]')?.textContent ?? undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("localStorage", createLocalStorage());
  mocks.redisGetValue.mockResolvedValue(stringValue());
});

afterEach(() => {
  for (const { unmount, host } of mountedApps.splice(0)) {
    unmount();
    host.remove();
  }
  vi.unstubAllGlobals();
});

describe("RedisValueViewer value search", () => {
  it("highlights textarea matches and navigates without stealing focus", async () => {
    const viewerRef = mountViewer();
    await settle();

    document.querySelector<HTMLElement>("[data-redis-value-viewer]")?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(viewerRef.value?.focusSearch()).toBe(true);
    await settle();
    const input = searchInput();
    input.value = "needle";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();

    const highlight = document.querySelector("[data-text-content-textarea-highlight]");
    expect(highlight).not.toBeNull();
    expect(highlight?.querySelectorAll("mark")).toHaveLength(2);
    expect(activeMatchText()).toBe("needle");
    expect([valueTextarea().selectionStart, valueTextarea().selectionEnd]).toEqual([6, 12]);
    expect(document.activeElement).toBe(input);

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await settle();
    expect(activeMatchText()).toBe("needle");
    expect([valueTextarea().selectionStart, valueTextarea().selectionEnd]).toEqual([6, 12]);

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await settle();
    expect(activeMatchText()).toBe("NEEDLE");
    expect([valueTextarea().selectionStart, valueTextarea().selectionEnd]).toEqual([18, 24]);
    expect(document.activeElement).toBe(input);

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true }));
    await settle();
    expect(activeMatchText()).toBe("needle");
    expect([valueTextarea().selectionStart, valueTextarea().selectionEnd]).toEqual([6, 12]);

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await settle();
    expect(document.querySelector("[data-text-content-textarea-highlight]")).toBeNull();
  });
});
