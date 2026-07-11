<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Code2, Copy } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { useToast } from "@/composables/useToast";
import { copyToClipboard } from "@/lib/common/clipboard";

const props = defineProps<{
  status: number;
  body: string;
}>();

const { t } = useI18n();
const { toast } = useToast();
const statusClass = computed(() => {
  if (props.status >= 500) return "border-destructive/40 bg-destructive/10 text-destructive";
  if (props.status >= 400) return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (props.status >= 300) return "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300";
  return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
});

async function copyResponse() {
  try {
    await copyToClipboard(props.body);
    toast(t("grid.copied"), 2000);
  } catch (error: any) {
    toast(t("grid.copyFailed", { message: error?.message || String(error) }), 5000);
  }
}
</script>

<template>
  <section data-elasticsearch-json-response-root class="flex h-full min-h-0 flex-col bg-background" :aria-label="t('grid.elasticsearchJsonResponse')">
    <header class="flex h-9 shrink-0 items-center gap-2 border-b bg-muted/20 px-3 text-xs">
      <Code2 class="h-3.5 w-3.5 text-muted-foreground" />
      <span class="min-w-0 flex-1 truncate font-medium">{{ t("grid.elasticsearchJsonResponse") }}</span>
      <span class="rounded-full border px-2 py-0.5 font-mono text-[11px] tabular-nums" :class="statusClass">HTTP {{ status }}</span>
      <Button variant="ghost" size="icon" class="h-6 w-6" :title="t('grid.copyJson')" :aria-label="t('grid.copyJson')" @click="copyResponse">
        <Copy class="h-3.5 w-3.5" />
      </Button>
    </header>
    <pre class="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs leading-5">{{ body }}</pre>
  </section>
</template>
