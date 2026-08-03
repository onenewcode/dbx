// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";

const backend = vi.hoisted(() => ({
  mqPeekMessages: vi.fn(),
}));

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/backend/api", () => ({
  mqPeekMessages: backend.mqPeekMessages,
}));

import MessageBrowser from "@/components/mq/MessageBrowser.vue";

const TOPIC = {
  tenant: "_kafka",
  namespace: "default",
  topic: "events",
  persistent: true,
  partitioned: false,
};

let app: App<Element> | null = null;
let root: HTMLDivElement | null = null;

async function flushUi() {
  await Promise.resolve();
  await Promise.resolve();
  await nextTick();
}

function buttonByText(container: ParentNode, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes(text));
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
}

async function setInputValue(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await nextTick();
}

async function setSelectValue(select: HTMLSelectElement, value: string) {
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await nextTick();
}

async function mountBrowser(mqSystemKind: "kafka" | "rabbitmq" = "kafka") {
  root = document.createElement("div");
  document.body.appendChild(root);
  app = createApp(MessageBrowser, {
    connectionId: "mq-1",
    topic: { ...TOPIC, tenant: mqSystemKind === "rabbitmq" ? "_rabbitmq" : "_kafka" },
    mqSystemKind,
  });
  app.mount(root);
  await flushUi();
  return root;
}

async function loadMessages(container: ParentNode) {
  buttonByText(container, "mqMessages.loadMessages").click();
  await flushUi();
}

beforeEach(() => {
  backend.mqPeekMessages.mockReset();
  backend.mqPeekMessages.mockResolvedValue([
    {
      position: 1,
      messageId: "17",
      payloadBase64: "",
      payloadText: "existing message",
      properties: { partition: "0" },
      headers: {},
    },
  ]);
});

afterEach(() => {
  app?.unmount();
  app = null;
  root?.remove();
  root = null;
});

describe("MessageBrowser", () => {
  it("loads Kafka's latest messages by default", async () => {
    const browser = await mountBrowser();

    await loadMessages(browser);

    expect(backend.mqPeekMessages).toHaveBeenCalledWith("mq-1", expect.objectContaining({ topic: "events" }), "__dbx_kafka_viewer__", 20, { startPosition: "latest" });
  });

  it("sends explicit earliest and offset read positions", async () => {
    const browser = await mountBrowser();
    const startPosition = browser.querySelector<HTMLSelectElement>('[data-testid="kafka-peek-start-position"]');
    if (!startPosition) throw new Error("Kafka start position select not found");

    await setSelectValue(startPosition, "earliest");
    await loadMessages(browser);
    expect(backend.mqPeekMessages).toHaveBeenLastCalledWith("mq-1", expect.objectContaining({ topic: "events" }), "__dbx_kafka_viewer__", 20, { startPosition: "earliest" });

    await setSelectValue(startPosition, "offset");
    const partition = browser.querySelector<HTMLInputElement>('[data-testid="kafka-peek-partition"]');
    const offset = browser.querySelector<HTMLInputElement>('[data-testid="kafka-peek-offset"]');
    if (!partition || !offset) throw new Error("Kafka offset inputs not found");
    await setInputValue(partition, "2");
    await setInputValue(offset, "17");
    await loadMessages(browser);

    expect(backend.mqPeekMessages).toHaveBeenLastCalledWith("mq-1", expect.objectContaining({ topic: "events" }), "__dbx_kafka_viewer__", 20, { startPosition: "offset", partition: 2, offset: 17 });
  });

  it("allows an all-partition offset read but requires an offset", async () => {
    const browser = await mountBrowser();
    const startPosition = browser.querySelector<HTMLSelectElement>('[data-testid="kafka-peek-start-position"]');
    if (!startPosition) throw new Error("Kafka start position control not found");

    await setSelectValue(startPosition, "offset");
    await loadMessages(browser);
    expect(backend.mqPeekMessages).not.toHaveBeenCalled();
    expect(browser.textContent).toContain("mqMessages.offsetRequiredForOffset");

    const offset = browser.querySelector<HTMLInputElement>('[data-testid="kafka-peek-offset"]');
    if (!offset) throw new Error("Kafka offset input not found");
    await setInputValue(offset, "-1");
    await loadMessages(browser);
    expect(backend.mqPeekMessages).not.toHaveBeenCalled();
    expect(browser.textContent).toContain("mqMessages.offsetMustBeNonNegativeIntRequired");

    await setInputValue(offset, "17");
    await loadMessages(browser);
    expect(backend.mqPeekMessages).toHaveBeenLastCalledWith("mq-1", expect.objectContaining({ topic: "events" }), "__dbx_kafka_viewer__", 20, { startPosition: "offset", offset: 17 });
  });

  it("clears results and does not leak an offset into a different read mode", async () => {
    const browser = await mountBrowser();
    const startPosition = browser.querySelector<HTMLSelectElement>('[data-testid="kafka-peek-start-position"]');
    const partition = browser.querySelector<HTMLInputElement>('[data-testid="kafka-peek-partition"]');
    if (!startPosition || !partition) throw new Error("Kafka start position controls not found");

    await loadMessages(browser);
    expect(browser.textContent).toContain("existing message");

    await setSelectValue(startPosition, "offset");
    expect(browser.textContent).not.toContain("existing message");
    await setInputValue(partition, "2");
    const offset = browser.querySelector<HTMLInputElement>('[data-testid="kafka-peek-offset"]');
    if (!offset) throw new Error("Kafka offset input not found");
    await setInputValue(offset, "17");

    await setSelectValue(startPosition, "latest");
    await loadMessages(browser);
    expect(backend.mqPeekMessages).toHaveBeenLastCalledWith("mq-1", expect.objectContaining({ topic: "events" }), "__dbx_kafka_viewer__", 20, { startPosition: "latest", partition: 2 });
  });

  it("keeps RabbitMQ's advanced filters collapsed and sends its existing request shape", async () => {
    const browser = await mountBrowser("rabbitmq");

    expect(browser.querySelector('input[placeholder="mqMessages.partitionPlaceholderAll"]')).toBeNull();
    buttonByText(browser, "mqMessages.advancedFilter").click();
    await nextTick();
    const partition = browser.querySelector<HTMLInputElement>('input[placeholder="mqMessages.partitionPlaceholderAll"]');
    const offset = browser.querySelector<HTMLInputElement>('input[placeholder="mqMessages.offsetPlaceholderEarliest"]');
    if (!partition || !offset) throw new Error("RabbitMQ advanced filter inputs not found");
    await setInputValue(partition, "2");
    await setInputValue(offset, "17");
    await loadMessages(browser);

    expect(backend.mqPeekMessages).toHaveBeenCalledWith("mq-1", expect.objectContaining({ tenant: "_rabbitmq", topic: "events" }), "__dbx_kafka_viewer__", 20, { partition: 2, offset: 17 });
  });
});
