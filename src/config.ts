import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type SubagentPatchMode = "free" | "enum";

export interface SubagentModelEntry {
  id: string;
  Hint?: string;
  ownedBy?: string;
}

export interface SubagentModelsConfig {
  mode: SubagentPatchMode;
  models: Array<string | SubagentModelEntry>;
  customPrompt?: string;
  gatewayUrl?: string;
  updatedAt?: string;
}

export const DEFAULT_CONFIG: SubagentModelsConfig = {
  mode: "free",
  models: [],
  customPrompt: "",
};

export function getConfigPath(customPath?: string): string {
  return (
    customPath ||
    process.env.CC_SUBAGENT_CONFIG ||
    path.join(os.homedir(), ".claude", "subagent-models.json")
  );
}

export function normalizeModelEntry(entry: string | SubagentModelEntry): SubagentModelEntry {
  if (typeof entry === "string") {
    return { id: entry.trim() };
  }
  const rawAny = entry as unknown as Record<string, unknown>;
  const hint =
    typeof entry.Hint === "string"
      ? entry.Hint
      : typeof rawAny.hint === "string"
        ? rawAny.hint
        : undefined;
  return {
    id: String(entry.id || "").trim(),
    ...(hint ? { Hint: hint } : {}),
    ...(typeof entry.ownedBy === "string" ? { ownedBy: entry.ownedBy } : {}),
  };
}

export function readConfig(customPath?: string): SubagentModelsConfig {
  const cfgPath = getConfigPath(customPath);
  let cfg: SubagentModelsConfig = { ...DEFAULT_CONFIG, models: [] };
  if (fs.existsSync(cfgPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      cfg = {
        ...cfg,
        ...parsed,
        mode: parsed.mode === "enum" ? "enum" : "free",
        models: Array.isArray(parsed.models) ? parsed.models : [],
      };
    } catch {
      // Keep default if corrupt
    }
  }
  if (process.env.CC_SUBAGENT_MODELS) {
    cfg.models = process.env.CC_SUBAGENT_MODELS.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((id) => ({ id }));
  }
  return cfg;
}

export function writeConfig(cfg: SubagentModelsConfig, customPath?: string): string {
  const cfgPath = getConfigPath(customPath);
  const dir = path.dirname(cfgPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const normalized: SubagentModelsConfig = {
    mode: cfg.mode === "enum" ? "enum" : "free",
    models: (cfg.models || [])
      .map(normalizeModelEntry)
      .filter((m) => m.id.length > 0),
    ...(cfg.customPrompt ? { customPrompt: cfg.customPrompt } : { customPrompt: "" }),
    ...(cfg.gatewayUrl ? { gatewayUrl: cfg.gatewayUrl } : {}),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(cfgPath, JSON.stringify(normalized, null, 2) + "\n", "utf8");
  return cfgPath;
}

export function addModelToConfig(
  id: string,
  hint?: string,
  customPath?: string,
): SubagentModelsConfig {
  const trimmed = id.trim();
  if (!trimmed) {
    throw new Error("Model ID cannot be empty");
  }
  const cfg = readConfig(customPath);
  const entries = cfg.models.map(normalizeModelEntry);
  const idx = entries.findIndex((m) => m.id === trimmed);
  const nextEntry: SubagentModelEntry = {
    id: trimmed,
    ...(hint ? { Hint: hint } : idx >= 0 && entries[idx].Hint ? { Hint: entries[idx].Hint } : {}),
  };
  if (idx >= 0) {
    entries[idx] = nextEntry;
  } else {
    entries.push(nextEntry);
  }
  cfg.models = entries;
  writeConfig(cfg, customPath);
  return cfg;
}

export function removeModelFromConfig(id: string, customPath?: string): {
  config: SubagentModelsConfig;
  removed: boolean;
} {
  const trimmed = id.trim();
  const cfg = readConfig(customPath);
  const entries = cfg.models.map(normalizeModelEntry);
  const filtered = entries.filter((m) => m.id !== trimmed);
  const removed = filtered.length !== entries.length;
  cfg.models = filtered;
  writeConfig(cfg, customPath);
  return { config: cfg, removed };
}
