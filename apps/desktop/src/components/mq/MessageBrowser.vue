<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { MqSystemKind, PeekedMessage, PeekMessagesOptions, TopicRef } from "@/types/mq";
import { mqPeekMessages } from "@/lib/backend/api";
import { formatError } from "@/lib/backend/errorUtils";
import { parseNonNegativeSafeInteger } from "@/lib/mq/mqPeekFilters";

type MessageBrowserAppearance = "form" | "monitoring";

interface Props {
  connectionId: string;
  topic?: TopicRef | null;
  mqSystemKind?: MqSystemKind;
  appearance?: MessageBrowserAppearance;
}

const props = defineProps<Props>();
const { t } = useI18n();

const loading = ref(false);
const error = ref<string>();
const messages = ref<PeekedMessage[]>([]);
const partition = ref<string | number>("");
const offset = ref<string | number>("");
const count = ref(20);
const advancedExpanded = ref(false);
type KafkaPeekStartPosition = NonNullable<PeekMessagesOptions["startPosition"]>;
const kafkaStartPosition = ref<KafkaPeekStartPosition>("latest");

const isKafka = computed(() => props.mqSystemKind === "kafka");
const isKafkaOffsetMode = computed(() => kafkaStartPosition.value === "offset");
const isMonitoring = computed(() => props.appearance === "monitoring");

function peekGroupName(): string {
  if (props.mqSystemKind === "rocketmq") return "__dbx_rocketmq_viewer__";
  return "__dbx_kafka_viewer__";
}

async function loadMessages() {
  if (!props.topic || loading.value) return;
  loading.value = true;
  error.value = undefined;
  try {
    const resultLimit = Math.max(1, Math.min(100, Number(count.value) || 20));
    count.value = resultLimit;
    const options: PeekMessagesOptions = {};
    const partitionText = String(partition.value).trim();
    const offsetText = String(offset.value).trim();

    if (isKafka.value) {
      options.startPosition = kafkaStartPosition.value;
      if (partitionText !== "") {
        const parsedPartition = parseNonNegativeSafeInteger(partitionText);
        if (parsedPartition == null) throw new Error(t("mqMessages.partitionMustBeNonNegativeInt"));
        options.partition = parsedPartition;
        partition.value = String(parsedPartition);
      }
      if (isKafkaOffsetMode.value) {
        if (partitionText === "") throw new Error(t("mqMessages.partitionRequiredForOffset"));
        if (offsetText === "") throw new Error(t("mqMessages.offsetRequiredForOffset"));
        const parsedOffset = parseNonNegativeSafeInteger(offsetText);
        if (parsedOffset == null) throw new Error(t("mqMessages.offsetMustBeNonNegativeIntRequired"));
        options.offset = parsedOffset;
        offset.value = String(parsedOffset);
      }
    } else {
      if (partitionText !== "") {
        const parsedPartition = parseNonNegativeSafeInteger(partitionText);
        if (parsedPartition == null) throw new Error(t("mqMessages.partitionMustBeNonNegativeInt"));
        options.partition = parsedPartition;
        partition.value = String(parsedPartition);
      }
      if (offsetText !== "") {
        const parsedOffset = parseNonNegativeSafeInteger(offsetText);
        if (parsedOffset == null) throw new Error(t("mqMessages.offsetMustBeNonNegativeInt"));
        options.offset = parsedOffset;
        offset.value = String(parsedOffset);
      }
    }
    messages.value = await mqPeekMessages(props.connectionId, props.topic, peekGroupName(), resultLimit, options);
  } catch (cause: unknown) {
    error.value = formatError(cause);
  } finally {
    loading.value = false;
  }
}

function messagePayload(message: PeekedMessage): string {
  return message.payloadText ?? message.payloadBase64;
}

function formatMessageTimestamp(value?: string): string {
  if (!value) return "-";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  return new Date(numeric).toLocaleString();
}

watch([() => props.topic?.tenant, () => props.topic?.namespace, () => props.topic?.topic], () => {
  error.value = undefined;
  messages.value = [];
});

watch(kafkaStartPosition, () => {
  // Keep offset values for switching back, but never retain results from another start mode.
  error.value = undefined;
  messages.value = [];
});
</script>

<template>
  <section v-if="topic" class="message-browser" :class="{ 'is-monitoring': isMonitoring }" data-testid="message-browser">
    <div class="message-browser-header">
      <h4>{{ t("mqMessages.messageList") }}</h4>
      <button type="button" class="btn-sm" :disabled="loading" @click="loadMessages">
        {{ loading ? t("mqMessages.loading") : t("mqMessages.loadMessages") }}
      </button>
    </div>

    <p v-if="isKafka" class="peek-default-hint">
      <template v-if="kafkaStartPosition === 'latest'">
        {{ t("mqMessages.kafkaLatestHint", { count }) }}
      </template>
      <template v-else-if="kafkaStartPosition === 'earliest'">
        {{ t("mqMessages.kafkaEarliestHint", { count }) }}
      </template>
      <template v-else>
        {{ t("mqMessages.kafkaOffsetHint", { count }) }}
      </template>
    </p>
    <p v-else class="peek-default-hint">{{ t("mqMessages.peekDefaultHint", { count }) }}</p>

    <div class="peek-controls">
      <label>
        <span>{{ t("mqMessages.count") }}</span>
        <input v-model.number="count" data-testid="peek-count" type="number" min="1" max="100" :disabled="loading" />
      </label>
      <label v-if="isKafka">
        <span>{{ t("mqMessages.startPosition") }}</span>
        <select v-model="kafkaStartPosition" data-testid="kafka-peek-start-position" :disabled="loading">
          <option value="latest">{{ t("mqMessages.kafkaLatest") }}</option>
          <option value="earliest">{{ t("mqMessages.kafkaEarliest") }}</option>
          <option value="offset">{{ t("mqMessages.kafkaOffset") }}</option>
        </select>
      </label>
      <label v-if="isKafka">
        <span>{{ t("mqMessages.partition") }}</span>
        <input v-model="partition" data-testid="kafka-peek-partition" type="number" min="0" :placeholder="t('mqMessages.partitionPlaceholderAll')" :disabled="loading" />
      </label>
      <label v-if="isKafkaOffsetMode">
        <span>{{ t("mqMessages.offset") }}</span>
        <input v-model="offset" data-testid="kafka-peek-offset" type="number" min="0" :placeholder="t('mqMessages.offsetPlaceholderRequired')" :disabled="loading" />
      </label>
    </div>

    <template v-if="!isKafka">
      <button type="button" class="collapse-toggle peek-advanced-toggle" @click="advancedExpanded = !advancedExpanded">
        <span class="collapse-arrow" :class="{ expanded: advancedExpanded }">&#9654;</span>
        <span>{{ t("mqMessages.advancedFilter") }}</span>
        <span v-if="(partition || offset) && !advancedExpanded" class="collapse-badge">&middot;</span>
      </button>
      <div v-if="advancedExpanded" class="peek-controls non-kafka-controls">
        <label>
          <span>{{ t("mqMessages.partition") }}</span>
          <input v-model="partition" type="number" min="0" :placeholder="t('mqMessages.partitionPlaceholderAll')" :disabled="loading" />
        </label>
        <label>
          <span>{{ t("mqMessages.offset") }}</span>
          <input v-model="offset" type="number" min="0" :placeholder="t('mqMessages.offsetPlaceholderEarliest')" :disabled="loading" />
        </label>
      </div>
    </template>

    <div v-if="error" class="panel-error">{{ error }}</div>
    <div v-else-if="loading" class="message-empty">{{ t("mqMessages.messagesLoading") }}</div>
    <div v-else-if="!messages.length" class="message-empty">{{ t("mqMessages.noMessages") }}</div>
    <div v-else class="message-list">
      <article v-for="message in messages" :key="`${message.properties?.partition ?? 'p'}-${message.messageId || message.position}`" class="message-row">
        <div class="message-meta">
          <span>#{{ message.position }}</span>
          <span v-if="message.properties?.partition != null">{{ t("mqMessages.metaPartition", { partition: message.properties.partition }) }}</span>
          <span>{{ t("mqMessages.metaOffset", { offset: message.messageId || "-" }) }}</span>
          <span v-if="message.key">{{ t("mqMessages.metaKey", { key: message.key }) }}</span>
          <span>{{ formatMessageTimestamp(message.publishTime) }}</span>
        </div>
        <pre class="message-payload">{{ messagePayload(message) }}</pre>
        <div v-if="Object.keys(message.headers || {}).length" class="message-headers">
          <span v-for="(value, key) in message.headers" :key="key">{{ key }}: {{ value }}</span>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.message-browser {
  --browser-border: var(--color-border);
  --browser-surface: var(--color-background-secondary);
  --browser-raised-surface: var(--color-background);
  --browser-code-surface: var(--color-background-tertiary, var(--color-background-secondary));
  --browser-text: var(--color-text);
  --browser-muted: var(--color-text-secondary);
  --browser-faint: var(--color-text-tertiary);
  --browser-accent: var(--color-primary);
  --browser-accent-soft: var(--color-primary-alpha);
  --browser-error: var(--color-error);
  --browser-error-surface: var(--color-error-bg);
  /* The send form uses a flex gap; retain the former final visual offset here. */
  margin: 4px 0 0;
  padding: 14px;
  border: 1px solid var(--browser-border);
  border-radius: var(--dbx-radius-fixed-6);
  background: var(--browser-surface);
}

.message-browser.is-monitoring {
  --browser-border: var(--monitor-border, var(--color-border));
  --browser-surface: var(--monitor-surface, var(--color-background-secondary));
  --browser-raised-surface: var(--monitor-surface-raised, var(--color-background));
  --browser-code-surface: var(--monitor-surface, var(--color-background-secondary));
  --browser-text: var(--monitor-text, var(--color-text));
  --browser-muted: var(--monitor-muted, var(--color-text-secondary));
  --browser-faint: var(--monitor-faint, var(--color-text-tertiary));
  --browser-accent: var(--monitor-accent, var(--color-primary));
  --browser-accent-soft: var(--monitor-accent-soft, var(--color-primary-alpha));
  --browser-error: var(--monitor-danger, var(--color-error));
  --browser-error-surface: var(--monitor-danger-soft, var(--color-error-bg));
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.message-browser-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 32px;
  margin-bottom: 12px;
}

.message-browser-header h4 {
  margin: 0;
  color: var(--browser-text);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.35;
}

.message-browser.is-monitoring .message-browser-header {
  min-height: 34px;
  margin-bottom: 14px;
}

.message-browser.is-monitoring .message-browser-header h4 {
  display: flex;
  align-items: center;
  gap: 9px;
  font-weight: 680;
}

.message-browser.is-monitoring .message-browser-header h4::before {
  content: "";
  width: 4px;
  height: 16px;
  border-radius: 2px;
  background: var(--browser-accent);
  box-shadow: 0 0 0 4px var(--browser-accent-soft);
}

.btn-sm {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  padding: 4px 10px;
  border: 1px solid var(--browser-border);
  border-radius: var(--dbx-radius-fixed-6);
  background: var(--browser-raised-surface);
  color: var(--browser-text);
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
}

.message-browser.is-monitoring .btn-sm {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: 7px 12px;
  border-radius: var(--dbx-radius-fixed-4);
  font-size: 13px;
  font-weight: 560;
  line-height: 1;
  box-shadow: 0 1px 0 rgb(255 255 255 / 0.55) inset;
}

.peek-default-hint {
  margin: 0 0 12px;
  padding: 8px 10px;
  border-radius: var(--dbx-radius-fixed-6);
  background: color-mix(in srgb, var(--browser-accent) 8%, transparent);
  color: var(--browser-muted);
  font-size: 12px;
  line-height: 1.5;
}

.peek-controls {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}

.peek-controls label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: var(--browser-muted);
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
}

.peek-controls input,
.peek-controls select {
  height: 32px;
  width: 100%;
  padding: 7px 10px;
  box-sizing: border-box;
  border: 1px solid var(--browser-border);
  border-radius: var(--dbx-radius-fixed-6);
  background: var(--browser-raised-surface);
  color: var(--browser-text);
  font-size: 13px;
  line-height: 18px;
}

.peek-controls input:focus,
.peek-controls select:focus {
  outline: none;
  border-color: var(--browser-accent);
  box-shadow: 0 0 0 2px var(--browser-accent-soft);
}

.message-browser.is-monitoring .peek-controls {
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}

.message-browser.is-monitoring .peek-controls input,
.message-browser.is-monitoring .peek-controls select {
  height: 34px;
  min-height: 34px;
  border-radius: var(--dbx-radius-fixed-4);
}

.non-kafka-controls {
  margin-top: 6px;
}

.collapse-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: none;
  background: none;
  color: var(--browser-muted);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  user-select: none;
}

.peek-advanced-toggle {
  margin-bottom: 10px;
}

.collapse-arrow {
  display: inline-block;
  font-size: 10px;
  transition: transform 0.15s;
}

.collapse-arrow.expanded {
  transform: rotate(90deg);
}

.collapse-badge {
  color: var(--browser-accent);
  font-weight: 700;
}

.panel-error {
  padding: 10px 14px;
  border-radius: var(--dbx-radius-fixed-6);
  background: var(--browser-error-surface);
  color: var(--browser-error);
  font-size: 13px;
}

.message-empty {
  padding: 18px;
  border: 1px dashed var(--browser-border);
  border-radius: var(--dbx-radius-fixed-6);
  color: var(--browser-faint);
  text-align: center;
  font-size: 13px;
}

.message-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 360px;
  overflow: auto;
}

.message-row {
  padding: 10px 12px;
  border: 1px solid var(--browser-border);
  border-radius: var(--dbx-radius-fixed-6);
  background: var(--browser-raised-surface);
}

.message-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 8px;
  color: var(--browser-faint);
  font-size: 12px;
}

.message-meta span:first-child {
  color: var(--browser-accent);
  font-weight: 700;
}

.message-payload {
  max-height: 160px;
  margin: 8px 0 0;
  overflow: auto;
  padding: 10px;
  border-radius: var(--dbx-radius-fixed-6);
  background: var(--browser-code-surface);
  color: var(--browser-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.message-headers {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
  color: var(--browser-muted);
  font-size: 11px;
}

.message-headers span {
  padding: 2px 6px;
  border: 1px solid var(--browser-border);
  border-radius: var(--dbx-radius-fixed-4);
  background: var(--browser-surface);
}

@media (max-width: 720px) {
  .peek-controls {
    grid-template-columns: 1fr;
  }
}
</style>
