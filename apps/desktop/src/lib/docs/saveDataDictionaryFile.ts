import { isTauriRuntime } from "@/lib/backend/tauriRuntime";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function saveDataDictionaryFile(fileName: string, format: "xlsx" | "markdown", content: Uint8Array | string): Promise<boolean> {
  if (isTauriRuntime()) {
    const [{ save }, fs] = await Promise.all([import("@tauri-apps/plugin-dialog"), import("@tauri-apps/plugin-fs")]);
    const path = await save({
      defaultPath: fileName,
      filters: format === "xlsx" ? [{ name: "Excel", extensions: ["xlsx"] }] : [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!path) return false;
    if (typeof content === "string") {
      await fs.writeTextFile(path, content);
    } else {
      await fs.writeFile(path, content);
    }
    return true;
  }

  const blob = typeof content === "string" ? new Blob([content], { type: "text/markdown" }) : new Blob([content.slice().buffer], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
  return true;
}
