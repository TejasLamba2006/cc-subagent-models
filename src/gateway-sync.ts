import {
  normalizeModelEntry,
  parseContextTokens,
  readConfig,
  type SubagentModelEntry,
  type SubagentModelsConfig,
  writeConfig,
} from "./config.js";

export const DEFAULT_GATEWAY_URL = "http://localhost:20128/v1/models";

export interface RawGatewayModel {
  id?: string;
  name?: string;
  owned_by?: string;
  capabilities?: {
    tools?: boolean;
    reasoning?: boolean;
    vision?: boolean;
    contextWindow?: number;
  };
  context_length?: number;
  max_input_tokens?: number;
}

export interface SyncGatewayOptions {
  gatewayUrl?: string;
  apiKey?: string;
  filter?: string;
  mergeHints?: boolean;
  autoHint?: boolean;
  configPath?: string;
  fetchImpl?: typeof fetch;
}

export interface SyncGatewayResult {
  gatewayUrl: string;
  totalFetched: number;
  savedCount: number;
  models: SubagentModelEntry[];
  configPath: string;
  config: SubagentModelsConfig;
}

export function normalizeGatewayModelsUrl(rawUrl?: string): string {
  const base = (rawUrl || process.env.CC_GATEWAY_URL || DEFAULT_GATEWAY_URL).trim();
  if (base.endsWith("/models")) {
    return base;
  }
  if (base.endsWith("/v1") || base.endsWith("/v1/")) {
    return `${base.replace(/\/+$/, "")}/models`;
  }
  return `${base.replace(/\/+$/, "")}/v1/models`;
}

function buildAutoHint(model: RawGatewayModel): string | undefined {
  const parts: string[] = [];
  if (model.capabilities?.reasoning) {
    parts.push("reasoning");
  }
  if (model.capabilities?.tools) {
    parts.push("tool-use");
  }
  const ctx =
    model.capabilities?.contextWindow || model.context_length || model.max_input_tokens;
  if (typeof ctx === "number" && ctx >= 1000) {
    parts.push(`${Math.round(ctx / 1000)}k ctx`);
  }
  return parts.length > 0 ? parts.join(", ") : undefined;
}

export async function fetchGatewayModels(
  options: SyncGatewayOptions = {},
): Promise<{ gatewayUrl: string; models: RawGatewayModel[] }> {
  const gatewayUrl = normalizeGatewayModelsUrl(options.gatewayUrl);
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  const key = options.apiKey || process.env.CC_GATEWAY_API_KEY;
  if (key) {
    headers.Authorization = `Bearer ${key}`;
    headers["x-api-key"] = key;
  }

  const fetchFn = options.fetchImpl || globalThis.fetch;
  const response = await fetchFn(gatewayUrl, {
    method: "GET",
    headers,
  });

  if (!response.ok) {
    throw new Error(`Gateway returned HTTP ${response.status} from ${gatewayUrl}`);
  }

  const payload = (await response.json()) as
    | { data?: RawGatewayModel[]; models?: RawGatewayModel[] }
    | RawGatewayModel[];

  const rawList: RawGatewayModel[] = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload.models)
        ? payload.models
        : [];

  return { gatewayUrl, models: rawList };
}

export async function syncGatewayModels(
  options: SyncGatewayOptions = {},
): Promise<SyncGatewayResult> {
  const { gatewayUrl, models: rawList } = await fetchGatewayModels(options);
  const currentConfig = readConfig(options.configPath);
  const existingHints = new Map<string, string>();
  const existingCtx = new Map<string, number>();

  if (options.mergeHints !== false) {
    for (const item of currentConfig.models) {
      const norm = normalizeModelEntry(item);
      if (norm.id && norm.Hint) {
        existingHints.set(norm.id, norm.Hint);
      }
      if (norm.id && norm.contextWindow) {
        existingCtx.set(norm.id, norm.contextWindow);
      }
    }
  }

  const filterLower = options.filter?.trim().toLowerCase();
  const seen = new Set<string>();
  const synced: SubagentModelEntry[] = [];

  for (const raw of rawList) {
    const id = (raw.id || raw.name || "").trim();
    if (!id || seen.has(id)) continue;
    if (filterLower && !id.toLowerCase().includes(filterLower)) continue;
    seen.add(id);

    const preservedHint = existingHints.get(id);
    const derivedHint = options.autoHint ? buildAutoHint(raw) : undefined;
    const finalHint = preservedHint || derivedHint;
    const rawCtx = parseContextTokens(
      raw.capabilities?.contextWindow ?? raw.context_length ?? raw.max_input_tokens,
    );
    const finalCtx = existingCtx.get(id) ?? rawCtx;

    synced.push({
      id,
      ...(finalHint ? { Hint: finalHint } : {}),
      ...(raw.owned_by ? { ownedBy: raw.owned_by } : {}),
      ...(finalCtx ? { contextWindow: finalCtx } : {}),
    });
  }

  const nextConfig: SubagentModelsConfig = {
    ...currentConfig,
    models: synced,
    gatewayUrl,
  };
  const configPath = writeConfig(nextConfig, options.configPath);

  return {
    gatewayUrl,
    totalFetched: rawList.length,
    savedCount: synced.length,
    models: synced,
    configPath,
    config: nextConfig,
  };
}
