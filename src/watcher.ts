import fs from "node:fs";
import { isPatchedContent, patchCliJs } from "./patcher.js";

export interface WatchHandle {
  close: () => void;
}

export function watchCliJsForUpdates(
  cliPath: string,
  onRepatch?: (result: ReturnType<typeof patchCliJs>) => void,
  onError?: (error: unknown) => void,
): WatchHandle {
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const checkAndPatch = () => {
    try {
      if (!fs.existsSync(cliPath)) return;
      const content = fs.readFileSync(cliPath, "utf8");
      if (!isPatchedContent(content)) {
        const res = patchCliJs(cliPath);
        onRepatch?.(res);
      }
    } catch (err) {
      onError?.(err);
    }
  };

  const watcher = fs.watch(cliPath, () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(checkAndPatch, 350);
  });

  return {
    close: () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      watcher.close();
    },
  };
}
