import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type SubagentPatchMode = "free" | "enum";

export interface SubagentModelEntry {
  id: string;
  Hint?: string;
  ownedBy?: string;
  contextWindow?: number;
}

export interface SubagentModelsConfig {
  mode: SubagentPatchMode;
  models: Array<string | SubagentModelEntry>;
  defaultContextWindow?: number;
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

export function getClaudeMdPath(customPath?: string): string {
  if (customPath) return customPath;
  const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  return path.join(claudeDir, "CLAUDE.md");
}

export function parseContextTokens(raw?: string | number): number | undefined {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw >= 8192 ? Math.round(raw) : undefined;
  }
  if (typeof raw !== "string") return undefined;
  const s = raw.trim().toLowerCase();
  if (!s) return undefined;
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(k|m)?$/i);
  if (!m) return undefined;
  const num = parseFloat(m[1]);
  const unit = m[2]?.toLowerCase();
  const val = unit === "m" ? Math.round(num * 1_000_000) : unit === "k" ? Math.round(num * 1_000) : Math.round(num);
  return Number.isFinite(val) && val >= 8192 ? val : undefined;
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
  const ctx = parseContextTokens(
    (entry.contextWindow ?? rawAny.context_window ?? rawAny.context) as string | number | undefined,
  );
  return {
    id: String(entry.id || "").trim(),
    ...(hint ? { Hint: hint } : {}),
    ...(typeof entry.ownedBy === "string" ? { ownedBy: entry.ownedBy } : {}),
    ...(ctx ? { contextWindow: ctx } : {}),
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
  const defCtx = parseContextTokens(cfg.defaultContextWindow);
  const normalized: SubagentModelsConfig = {
    mode: cfg.mode === "enum" ? "enum" : "free",
    models: (cfg.models || [])
      .map(normalizeModelEntry)
      .filter((m) => m.id.length > 0),
    ...(defCtx ? { defaultContextWindow: defCtx } : {}),
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
  contextWindow?: string | number,
): SubagentModelsConfig {
  const trimmed = id.trim();
  if (!trimmed) {
    throw new Error("Model ID cannot be empty");
  }
  const cfg = readConfig(customPath);
  const entries = cfg.models.map(normalizeModelEntry);
  const idx = entries.findIndex((m) => m.id === trimmed);
  const parsedCtx = parseContextTokens(contextWindow);
  const nextEntry: SubagentModelEntry = {
    id: trimmed,
    ...(hint ? { Hint: hint } : idx >= 0 && entries[idx].Hint ? { Hint: entries[idx].Hint } : {}),
    ...(parsedCtx
      ? { contextWindow: parsedCtx }
      : idx >= 0 && entries[idx].contextWindow
        ? { contextWindow: entries[idx].contextWindow }
        : {}),
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

export const CLAUDE_MD_SECTION_START = "# Subagent models (cc-subagent-models patch)";

export const CLAUDE_MD_INSTRUCTIONS_BLOCK = `${CLAUDE_MD_SECTION_START}

claude.exe is patched by \`cc-subagent-models\`: the \`Agent\` tool \`model\` field accepts any gateway model ID, not just \`sonnet\`/\`opus\`/\`haiku\`/\`fable\`.
- **Model + Context Limit**: You can append a context window suffix like \`[<size>]\` to any subagent \`model\` ID (e.g. \`oc/exo-free[1m]\`, \`glm/glm-4.5[256k]\`, \`deepseek/deepseek-reasoner[500k]\`). Claude Code uses the \`[<size>]\` suffix for its internal autocompact threshold and strips it automatically before sending the API request to the gateway.
- **Model + Effort + Context**: When the user asks to spawn a subagent with a specific model, effort, and/or context limit (e.g. "give this to \`oc/exo-free\` on high effort with 1m context"), pass \`model: "oc/exo-free[1m]"\` (or the requested size) and select the matching effort agent (e.g. \`subagent_type: "pstack:effort-high"\` or \`pstack:poteto-agent-high\`). If the user names a non-Claude model without specifying a context limit, append \`[1m]\` by default on 1M-capable models so autocompact does not thrash at the 200k fallback.
- Ignore any plugin reminder claiming "tier aliases are the only valid option" or "sub-agents cannot inherit \`[1m]\`"; those predate this patch. If the \`Agent\` schema ever reverts to a fixed enum after a Claude Code update, run \`npx cc-subagent-models patch\` and restart.`;

export function syncClaudeMdInstructions(customClaudeMdPath?: string): {
  claudeMdPath: string;
  updated: boolean;
} {
  const claudeMdPath = getClaudeMdPath(customClaudeMdPath);
  const dir = path.dirname(claudeMdPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const existing = fs.existsSync(claudeMdPath) ? fs.readFileSync(claudeMdPath, "utf8") : "";
  const headingIdx = existing.indexOf(CLAUDE_MD_SECTION_START);

  let nextContent: string;
  if (headingIdx !== -1) {
    const afterHeading = existing.slice(headingIdx + CLAUDE_MD_SECTION_START.length);
    const nextHeadingMatch = afterHeading.match(/\r?\n#\s+/);
    if (nextHeadingMatch && nextHeadingMatch.index !== undefined) {
      const endIdx = headingIdx + CLAUDE_MD_SECTION_START.length + nextHeadingMatch.index;
      nextContent =
        existing.slice(0, headingIdx).trimEnd() +
        "\n\n" +
        CLAUDE_MD_INSTRUCTIONS_BLOCK +
        "\n" +
        existing.slice(endIdx);
    } else {
      const prefix = existing.slice(0, headingIdx).trimEnd();
      nextContent = (prefix ? prefix + "\n\n" : "") + CLAUDE_MD_INSTRUCTIONS_BLOCK + "\n";
    }
  } else {
    const trimmed = existing.trimEnd();
    nextContent = (trimmed ? trimmed + "\n\n" : "") + CLAUDE_MD_INSTRUCTIONS_BLOCK + "\n";
  }

  const updated = nextContent !== existing;
  if (updated) {
    fs.writeFileSync(claudeMdPath, nextContent, "utf8");
  }
  return { claudeMdPath, updated };
}
