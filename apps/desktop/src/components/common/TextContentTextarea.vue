<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type CSSProperties } from "vue";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    highlightedHtml?: string;
    highlight?: boolean;
    readonly?: boolean;
    wordWrap?: boolean;
    contentClass?: string;
    textareaClass?: string;
    inputAttrs?: Record<string, string>;
    ariaLabel?: string;
  }>(),
  {
    highlightedHtml: "",
    highlight: false,
    readonly: false,
    wordWrap: true,
    contentClass: "",
    textareaClass: "",
    inputAttrs: () => ({}),
    ariaLabel: undefined,
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const textareaRef = ref<HTMLTextAreaElement | null>(null);
const highlightWidth = ref(0);
const highlightMinHeight = ref(0);
const highlightScrollLeft = ref(0);
const highlightScrollTop = ref(0);
let resizeObserver: ResizeObserver | undefined;

const highlightStyle = computed<CSSProperties>(() => ({
  width: `${highlightWidth.value}px`,
  minWidth: `${highlightWidth.value}px`,
  minHeight: `${highlightMinHeight.value}px`,
  transform: `translate(${-highlightScrollLeft.value}px, ${-highlightScrollTop.value}px)`,
}));

function syncHighlightLayout() {
  const textarea = textareaRef.value;
  if (!textarea) return;
  highlightWidth.value = textarea.clientWidth;
  highlightMinHeight.value = textarea.clientHeight;
  highlightScrollLeft.value = textarea.scrollLeft;
  highlightScrollTop.value = textarea.scrollTop;
}

function onTextareaScroll() {
  syncHighlightLayout();
}

function focus() {
  textareaRef.value?.focus({ preventScroll: true });
}

function scrollRangeIntoView(start: number, end: number) {
  const textarea = textareaRef.value;
  if (!textarea) return;

  textarea.setSelectionRange(start, end, "forward");
  syncHighlightLayout();

  const style = getComputedStyle(textarea);
  const probe = document.createElement("div");
  const marker = document.createElement("span");
  probe.textContent = textarea.value.slice(0, start) || " ";
  marker.textContent = "\u200b";
  probe.appendChild(marker);
  probe.style.cssText = [
    "position:fixed",
    "left:-9999px",
    "top:-9999px",
    "visibility:hidden",
    "box-sizing:border-box",
    `width:${textarea.clientWidth}px`,
    `white-space:${style.whiteSpace}`,
    `overflow-wrap:${style.overflowWrap}`,
    `word-break:${style.wordBreak}`,
    `padding:${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`,
    `font:${style.font}`,
    `font-size:${style.fontSize}`,
    `font-family:${style.fontFamily}`,
    `font-weight:${style.fontWeight}`,
    `line-height:${style.lineHeight}`,
    `letter-spacing:${style.letterSpacing}`,
    `text-indent:${style.textIndent}`,
    `tab-size:${style.tabSize}`,
  ].join(";");
  document.body.appendChild(probe);

  const markerTop = marker.offsetTop;
  const markerLeft = marker.offsetLeft;
  const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.5 || 20;
  probe.remove();

  const maxTop = Math.max(0, textarea.scrollHeight - textarea.clientHeight);
  const maxLeft = Math.max(0, textarea.scrollWidth - textarea.clientWidth);
  textarea.scrollTop = Math.min(maxTop, Math.max(0, markerTop - (textarea.clientHeight - lineHeight) / 2));
  textarea.scrollLeft = Math.min(maxLeft, Math.max(0, markerLeft - textarea.clientWidth / 2));
  syncHighlightLayout();
}

function selectRange(from: number, to: number, options?: { focus?: boolean }): boolean {
  const textarea = textareaRef.value;
  if (!textarea) return false;
  const max = textarea.value.length;
  const start = Math.max(0, Math.min(from, max));
  const end = Math.max(start, Math.min(to, max));
  scrollRangeIntoView(start, end);
  if (options?.focus !== false) textarea.focus({ preventScroll: true });
  return true;
}

function onInput(event: Event) {
  emit("update:modelValue", (event.currentTarget as HTMLTextAreaElement).value);
}

watch(
  () => [props.modelValue, props.highlight, props.highlightedHtml, props.contentClass, props.textareaClass, props.wordWrap] as const,
  () => {
    void nextTick(syncHighlightLayout);
  },
);

onMounted(() => {
  syncHighlightLayout();
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(syncHighlightLayout);
    if (textareaRef.value) resizeObserver.observe(textareaRef.value);
  }
  window.addEventListener("resize", syncHighlightLayout);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  window.removeEventListener("resize", syncHighlightLayout);
});

defineExpose({ focus, selectRange });
</script>

<template>
  <div data-text-content-textarea class="relative min-h-0 flex-1 overflow-hidden bg-background">
    <div v-if="highlight" data-text-content-textarea-highlight aria-hidden="true" class="pointer-events-none absolute left-0 top-0 m-0" :class="[contentClass, textareaClass]" :style="highlightStyle" v-html="highlightedHtml" />
    <textarea
      ref="textareaRef"
      data-text-content-textarea-input
      v-bind="inputAttrs"
      :value="modelValue"
      :readonly="readonly"
      :aria-label="ariaLabel"
      :wrap="wordWrap ? 'soft' : 'off'"
      class="absolute inset-0 h-full w-full resize-none bg-transparent outline-none"
      :class="[contentClass, textareaClass, { 'text-transparent caret-foreground': highlight }]"
      spellcheck="false"
      @input="onInput"
      @scroll="onTextareaScroll"
    />
  </div>
</template>

<style scoped>
textarea.text-transparent::selection {
  color: transparent;
  background: rgb(59 130 246 / 35%);
}
</style>
