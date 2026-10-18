import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addModelToConfig,
  CLAUDE_MD_SECTION_START,
  parseContextTokens,
  readConfig,
  removeModelFromConfig,
  syncClaudeMdInstructions,
  writeConfig,
} from "../src/config.js";
import { normalizeGatewayModelsUrl, syncGatewayModels } from "../src/gateway-sync.js";
import {
  isPatchedContent,
  patchCliJs,
  restoreCliJs,
  verifySyntaxWithNode,
} from "../src/patcher.js";
import { MOCK_CLI_V2_1_112, MOCK_CLI_V2_1_289 } from "./fixtures/mock-cli.js";

describe("cc-subagent-models patcher & runtime engine", () => {
  let tmpDir: string;
  let cfgPath: string;
  const origEnvConfig = process.env.CC_SUBAGENT_CONFIG;
  const origEnvModels = process.env.CC_SUBAGENT_MODELS;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-subagent-test-"));
    cfgPath = path.join(tmpDir, "subagent-models.json");
    process.env.CC_SUBAGENT_CONFIG = cfgPath;
    delete process.env.CC_SUBAGENT_MODELS;
  });

  afterEach(() => {
    if (origEnvConfig === undefined) {
      delete process.env.CC_SUBAGENT_CONFIG;
    } else {
      process.env.CC_SUBAGENT_CONFIG = origEnvConfig;
    }
    if (origEnvModels === undefined) {
      delete process.env.CC_SUBAGENT_MODELS;
    } else {
      process.env.CC_SUBAGENT_MODELS = origEnvModels;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("patches v2.1.112 cli.js (member Zod y.enum), passes node --check, and executes dynamically in free & enum modes", async () => {
    const cliFile = path.join(tmpDir, "cli-2.1.112.mjs");
    fs.writeFileSync(cliFile, MOCK_CLI_V2_1_112, "utf8");

    const res = patchCliJs(cliFile);
    expect(res.alreadyPatched).toBe(false);
    expect(res.schemaMatches).toBe(1);
    expect(res.secondaryEnumMatches).toBe(1);
    expect(res.resolverMatches).toBeGreaterThanOrEqual(1);
    expect(res.syntaxVerified).toBe(true);
    expect(fs.existsSync(res.backupPath)).toBe(true);

    // Idempotency check
    const secondRes = patchCliJs(cliFile);
    expect(secondRes.alreadyPatched).toBe(true);

    // Configure models in free mode
    writeConfig(
      {
        mode: "free",
        models: [
          { id: "iflow/qwen3-coder-plus", Hint: "Fast free coder" },
          { id: "deepseek/deepseek-reasoner", Hint: "Deep reasoning" },
        ],
      },
      cfgPath,
    );

    const modFree = await import(`${pathToFileURL(cliFile).href}?t=${Date.now()}-free`);
    const schemaFree = modFree.VKY();
    expect(schemaFree.shape.model.type).toBe("string");
    expect(schemaFree.shape.model.isOptional).toBe(true);
    expect(schemaFree.shape.model.description).toContain(
      '- "iflow/qwen3-coder-plus" (Fast free coder)',
    );
    expect(schemaFree.shape.model.description).toContain(
      '- "deepseek/deepseek-reasoner" (Deep reasoning)',
    );

    // Switch config to enum mode WITHOUT re-patching cli.js!
    writeConfig(
      {
        mode: "enum",
        models: [
          { id: "iflow/qwen3-coder-plus", Hint: "Fast free coder" },
          "glm/glm-4.5",
        ],
      },
      cfgPath,
    );

    const schemaEnum = modFree.VKY();
    expect(schemaEnum.shape.model.type).toBe("enum");
    expect(schemaEnum.shape.model.values).toEqual([
      "sonnet",
      "opus",
      "haiku",
      "iflow/qwen3-coder-plus",
      "glm/glm-4.5",
    ]);

    // Verify pass-through model resolution
    expect(modFree.BC6(undefined, "claude-opus-4-7", "iflow/qwen3-coder-plus", "default")).toBe(
      "iflow/qwen3-coder-plus",
    );
    expect(modFree.BC6("glm/glm-4.5", "claude-opus-4-7", undefined, "default")).toBe("glm/glm-4.5");
    expect(modFree.BC6("inherit", "claude-opus-4-7", undefined, "default")).toBe("claude-opus-4-7");

    // Restore from backup cleanly
    const restored = restoreCliJs(cliFile);
    expect(restored.restored).toBe(true);
    expect(isPatchedContent(fs.readFileSync(cliFile, "utf8"))).toBe(false);
  });

  it("patches v2.1.289 cli.js, resolves [<size>] context limits, and strips [<size>] before API wire call", async () => {
    const cliFile = path.join(tmpDir, "cli-2.1.289.mjs");
    fs.writeFileSync(cliFile, MOCK_CLI_V2_1_289, "utf8");

    const res = patchCliJs(cliFile);
    expect(res.alreadyPatched).toBe(false);
    expect(res.schemaMatches).toBe(1);
    expect(res.resolverMatches).toBeGreaterThanOrEqual(1);
    expect(res.contextWindowMatches).toBeGreaterThanOrEqual(2);
    expect(verifySyntaxWithNode(cliFile).valid).toBe(true);

    writeConfig(
      {
        mode: "enum",
        models: [{ id: "evomap/gpt-5.4", Hint: "High capability", contextWindow: 500000 }],
      },
      cfgPath,
    );

    const mod289 = await import(`${pathToFileURL(cliFile).href}?t=${Date.now()}-289`);
    const schema = mod289.Bo();
    expect(schema.shape.model.type).toBe("enum");
    expect(schema.shape.model.values).toContain("evomap/gpt-5.4");
    expect(schema.shape.model.description).toContain(
      '- "evomap/gpt-5.4" (High capability [500k ctx])',
    );

    // Even though Ur(E) only allows `claude-*` models, our patched vH resolver passes gateway models through verbatim!
    expect(mod289.vH(undefined, "claude-opus-5-5", "evomap/gpt-5.4", "default")).toBe(
      "evomap/gpt-5.4",
    );
    expect(mod289.vH(undefined, "claude-opus-5-5", "oc/exo-free[256k]", "default")).toBe(
      "oc/exo-free[256k]",
    );
    // Standard Anthropic aliases still resolve to their tier defaults
    expect(mod289.vH(undefined, "claude-opus-5-5", "haiku", "default")).toBe("claude-haiku-4-5");
    expect(mod289.vH("inherit", "claude-opus-5-5", undefined, "default")).toBe("claude-opus-5-5");

    // Verify context window resolution (`U4u`) and wire suffix stripping (`kd` / `At`)
    expect(mod289.U4u("oc/exo-free[256k]", [])).toBe(256000);
    expect(mod289.U4u("oc/exo-free[1m]", [])).toBe(1000000);
    expect(mod289.U4u("evomap/gpt-5.4", [])).toBe(500000); // from config contextWindow
    expect(mod289.U4u("oc/exo-free", [])).toBe(1000000); // non-Claude default 1M
    expect(mod289.kd("oc/exo-free[256k]")).toBe("oc/exo-free");
    expect(mod289.At("oc/exo-free[500k]")).toBe("oc/exo-free");
  });

  it("supports CC_SUBAGENT_MODELS environment variable override", async () => {
    const cliFile = path.join(tmpDir, "cli-env.mjs");
    fs.writeFileSync(cliFile, MOCK_CLI_V2_1_112, "utf8");
    patchCliJs(cliFile);

    process.env.CC_SUBAGENT_MODELS = "openrouter/auto, local/llama-3.3-70b";
    const mod = await import(`${pathToFileURL(cliFile).href}?t=${Date.now()}-env`);
    const schema = mod.VKY();
    expect(schema.shape.model.description).toContain("openrouter/auto");
    expect(schema.shape.model.description).toContain("local/llama-3.3-70b");
  });

  it("manages config via add/remove with contextWindow and syncs from /v1/models gateway", async () => {
    addModelToConfig("iflow/qwen3-coder-plus", "Fast coding model", cfgPath, "256k");
    addModelToConfig("glm/glm-4.5", "Unit test specialist", cfgPath);

    let cfg = readConfig(cfgPath);
    expect(cfg.models).toHaveLength(2);
    expect(parseContextTokens("256k")).toBe(256000);
    expect(parseContextTokens("1m")).toBe(1000000);

    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          object: "list",
          data: [
            {
              id: "iflow/qwen3-coder-plus",
              owned_by: "iflow",
              capabilities: { tools: true, reasoning: false, contextWindow: 128000 },
            },
            {
              id: "deepseek/deepseek-reasoner",
              owned_by: "deepseek",
              capabilities: { tools: true, reasoning: true, contextWindow: 64000 },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    const syncRes = await syncGatewayModels({
      gatewayUrl: "http://localhost:20128",
      autoHint: true,
      configPath: cfgPath,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    expect(syncRes.gatewayUrl).toBe("http://localhost:20128/v1/models");
    expect(syncRes.savedCount).toBe(2);
    // Preserved manual hint & manual 256k contextWindow on iflow/qwen3-coder-plus
    expect(syncRes.models[0]).toEqual({
      id: "iflow/qwen3-coder-plus",
      Hint: "Fast coding model",
      ownedBy: "iflow",
      contextWindow: 256000,
    });
    // Auto-generated hint & gateway 64k contextWindow on deepseek/deepseek-reasoner
    expect(syncRes.models[1]).toEqual({
      id: "deepseek/deepseek-reasoner",
      Hint: "reasoning, tool-use, 64k ctx",
      ownedBy: "deepseek",
      contextWindow: 64000,
    });

    const rem = removeModelFromConfig("iflow/qwen3-coder-plus", cfgPath);
    expect(rem.removed).toBe(true);
    expect(rem.config.models).toHaveLength(1);
  });

  it("idempotently writes and updates subagent instructions in CLAUDE.md", () => {
    const mdPath = path.join(tmpDir, "CLAUDE.md");
    fs.writeFileSync(mdPath, "# Existing Rule\n\nKeep code simple.\n", "utf8");

    const first = syncClaudeMdInstructions(mdPath);
    expect(first.updated).toBe(true);
    const content1 = fs.readFileSync(mdPath, "utf8");
    expect(content1).toContain("# Existing Rule");
    expect(content1).toContain(CLAUDE_MD_SECTION_START);
    expect(content1).toContain("oc/exo-free[1m]");

    const second = syncClaudeMdInstructions(mdPath);
    expect(second.updated).toBe(false);
  });

  it("normalizes gateway URLs accurately", () => {
    expect(normalizeGatewayModelsUrl("http://localhost:20128")).toBe(
      "http://localhost:20128/v1/models",
    );
    expect(normalizeGatewayModelsUrl("http://localhost:20128/v1")).toBe(
      "http://localhost:20128/v1/models",
    );
    expect(normalizeGatewayModelsUrl("http://localhost:20128/v1/models")).toBe(
      "http://localhost:20128/v1/models",
    );
  });

  it("performs dry-run without modifying target file on disk", () => {
    const cliFile = path.join(tmpDir, "cli-dry.mjs");
    fs.writeFileSync(cliFile, MOCK_CLI_V2_1_289, "utf8");

    const res = patchCliJs(cliFile, { dryRun: true });
    expect(res.dryRun).toBe(true);
    expect(res.schemaMatches).toBe(1);
    expect(res.syntaxVerified).toBe(true);
    expect(isPatchedContent(fs.readFileSync(cliFile, "utf8"))).toBe(false);
    expect(fs.existsSync(res.backupPath)).toBe(false);
  });
});
