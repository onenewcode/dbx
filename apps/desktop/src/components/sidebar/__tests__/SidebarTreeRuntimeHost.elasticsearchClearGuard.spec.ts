import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const runtimeHostSource = readFileSync(new URL("../SidebarTreeRuntimeHost.vue", import.meta.url), "utf8");
const connectionTreeSource = readFileSync(new URL("../ConnectionTree.vue", import.meta.url), "utf8");
const dangerDialogSource = readFileSync(new URL("../../editor/DangerConfirmDialog.vue", import.meta.url), "utf8");

/**
 * `isElasticsearchClearConfirmed` is unit-tested on its own, but a correct pure
 * function is worthless if the dialog never consults it. These assertions pin
 * the wiring that connects the two, end to end through the shared dialog.
 */
describe("Elasticsearch clear-index wildcard guard wiring", () => {
  it("gates the confirm button on the typed pattern for wildcard nodes only", () => {
    const clearRoute = runtimeHostSource.slice(runtimeHostSource.indexOf("routeDangerDialog(showClearElasticsearchIndexConfirm"));
    expect(clearRoute).toContain("const isPattern = isElasticsearchIndexPattern(index)");
    expect(clearRoute).toMatch(/\.\.\.\(isPattern\s*\?\s*\{/);
    expect(clearRoute).toMatch(/get confirmDisabled\(\) \{\s*return !isElasticsearchClearConfirmed\(index, clearElasticsearchIndexTypedName\.value\);/);
  });

  it("pins the index label for the life of the dialog instead of following the tree selection", () => {
    const clearRoute = runtimeHostSource.slice(runtimeHostSource.indexOf("routeDangerDialog(showClearElasticsearchIndexConfirm"), runtimeHostSource.indexOf("routeDangerDialog(showFlushRedisDbConfirm"));
    expect(clearRoute).toContain("const index = activeNode.value.label;");
    // Reading activeNode again inside the request would reintroduce the drift.
    expect(clearRoute.match(/activeNode\.value/g)).toHaveLength(1);
  });

  it("clears any previously typed name when the dialog is opened again", () => {
    const clearRoute = runtimeHostSource.slice(runtimeHostSource.indexOf("routeDangerDialog(showClearElasticsearchIndexConfirm"), runtimeHostSource.indexOf("routeDangerDialog(showFlushRedisDbConfirm"));
    expect(clearRoute).toContain('clearElasticsearchIndexTypedName.value = "";');
  });

  it("forwards confirmDisabled from the sidebar request to the shared danger dialog", () => {
    expect(connectionTreeSource).toContain(':confirm-disabled="sidebarDangerDialogRequest.confirmDisabled"');
  });

  it("honours confirmDisabled on both the button and the confirm handler", () => {
    expect(dangerDialogSource).toContain(':disabled="loading || confirmDisabled"');
    expect(dangerDialogSource).toMatch(/function onConfirm\(\) \{[\s\S]*?if \(props\.loading \|\| props\.confirmDisabled\) return;/);
  });

  it("leaves confirmDisabled off by default so existing danger dialogs are unaffected", () => {
    expect(dangerDialogSource).toContain("confirmDisabled: false,");
  });
});
