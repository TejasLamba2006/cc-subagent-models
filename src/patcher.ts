import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const PATCH_MARKER = "/* __CC_SUBAGENT_MODELS_PATCH_V2__ */";
export const LEGACY_PATCH_MARKER = "/* __CC_SUBAGENT_MODELS_PATCH_V1__ */";

export interface PatchResult {
  cliPath: string;
  backupPath: string;
  metaPath: string;
  alreadyPatched: boolean;
  schemaMatches: number;
  secondaryEnumMatches: number;
  resolverMatches: number;
  contextWindowMatches?: number;
  versionHash: string;
  dryRun: boolean;
  syntaxVerified: boolean;
}

export interface BackupMetadata {
  cliPath: string;
  backupPath: string;
  versionHash: string;
  patchedAt: string;
  claudeVersion?: string;
}

function buildRuntimeHelperBody(reqExpr: string): string {
  return `globalThis.__ccSubagentModelSchema = function(zodInstance, origDesc) {
  const _makeString = () =>
    zodInstance && typeof zodInstance.string === "function"
      ? zodInstance.string()
      : zodInstance && typeof zodInstance.__ccString === "function"
        ? zodInstance.__ccString()
        : zodInstance();
  const _makeEnum = (vals) =>
    zodInstance && typeof zodInstance.enum === "function"
      ? zodInstance.enum(vals)
      : zodInstance && typeof zodInstance.__ccEnum === "function"
        ? zodInstance.__ccEnum(vals)
        : zodInstance(vals);
  const _fmtCtx = (n) => {
    if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return "";
    if (n % 1000000 === 0) return \`\${n / 1000000}m\`;
    return \`\${Math.round(n / 1000)}k\`;
  };
  const _resolve = (fallbackDesc) => {
    try {
      const _req = ${reqExpr};
      const fs = _req("fs");
      const os = _req("os");
      const path = _req("path");
      const cfgPath = process.env.CC_SUBAGENT_CONFIG || path.join(os.homedir(), ".claude", "subagent-models.json");
      let cfg = { mode: "free", models: [], customPrompt: "" };
      if (fs.existsSync(cfgPath)) {
        cfg = { ...cfg, ...JSON.parse(fs.readFileSync(cfgPath, "utf8")) };
      }
      if (process.env.CC_SUBAGENT_MODELS) {
        cfg.models = process.env.CC_SUBAGENT_MODELS.split(",").map(s => s.trim()).filter(Boolean).map(id => ({ id }));
      }
      const modelListStr = cfg.models && cfg.models.length > 0
        ? "\\nAvailable gateway models you can choose from (append [<size>] e.g. [1m], [256k], [500k] to override context window):\\n" + cfg.models.map(m => {
            if (typeof m === "string") return \`- "\${m}"\`;
            const cw = m.contextWindow ? \` [\${_fmtCtx(m.contextWindow)} ctx]\` : "";
            const h = m.Hint ? \` (\${m.Hint}\${cw})\` : cw ? \` (\${cw.trim()})\` : "";
            return \`- "\${m.id}"\${h}\`;
          }).join("\\n")
        : "\\nTip: Append [<size>] (e.g. model[1m], model[256k], model[500k]) to any subagent model ID to set its context window.";
      const finalDesc = (cfg.customPrompt || fallbackDesc || "Optional model to use for this subagent. Pass ANY valid gateway model ID (e.g., provider/model-name or provider/model-name[1m]), or 'sonnet', 'opus', 'haiku'. If omitted, inherits from parent.") + modelListStr;
      if (cfg.mode === "enum" && cfg.models && cfg.models.length > 0) {
        const ids = Array.from(new Set(["sonnet", "opus", "haiku", ...cfg.models.map(m => typeof m === "string" ? m : m.id)]));
        return _makeEnum(ids).optional().describe(finalDesc);
      }
      return _makeString().optional().describe(finalDesc);
    } catch (e) {
      return _makeString().optional().describe(fallbackDesc);
    }
  };
  if (origDesc !== undefined) {
    return _resolve(origDesc);
  }
  return {
    optional() {
      return {
        describe(d) {
          return _resolve(d);
        }
      };
    },
    describe(d) {
      return _resolve(d);
    }
  };
};
globalThis.__ccResolveModelPassThrough = function(val, fallbackFn) {
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed.length > 0 && trimmed.toLowerCase() !== "inherit") {
      return trimmed;
    }
  }
  return typeof fallbackFn === "function" ? fallbackFn() : val;
};
globalThis.__ccResolveContextWindow = function(modelId) {
  try {
    if (typeof modelId !== "string" || !modelId) return null;
    const m = modelId.match(/\\[(\\d+(?:\\.\\d+)?)\\s*(k|m)\\]/i);
    if (m) {
      const n = parseFloat(m[1]);
      const u = m[2].toLowerCase();
      const tokens = Math.round(n * (u === "m" ? 1000000 : 1000));
      if (tokens >= 8192) return tokens;
    }
    const _req = ${reqExpr};
    const fs = _req("fs");
    const os = _req("os");
    const path = _req("path");
    const cfgPath = process.env.CC_SUBAGENT_CONFIG || path.join(os.homedir(), ".claude", "subagent-models.json");
    const cleanId = modelId.replace(/\\[\\d+(?:\\.\\d+)?\\s*(?:k|m)\\]/gi, "").trim().toLowerCase();
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      if (Array.isArray(cfg.models)) {
        for (const item of cfg.models) {
          if (item && typeof item === "object" && typeof item.id === "string") {
            const itemClean = item.id.replace(/\\[\\d+(?:\\.\\d+)?\\s*(?:k|m)\\]/gi, "").trim().toLowerCase();
            if (itemClean === cleanId && typeof item.contextWindow === "number" && item.contextWindow >= 8192) {
              return Math.round(item.contextWindow);
            }
          }
        }
      }
      if (typeof cfg.defaultContextWindow === "number" && cfg.defaultContextWindow >= 8192 && !cleanId.startsWith("claude-")) {
        return Math.round(cfg.defaultContextWindow);
      }
    }
    if (!cleanId.startsWith("claude-") && !["sonnet", "opus", "haiku", "fable", "best", "opusplan", "inherit"].includes(cleanId)) {
      return 1000000;
    }
  } catch (e) {}
  return null;
};`;
}

export const RUNTIME_HELPER_SNIPPET = `${PATCH_MARKER}
${buildRuntimeHelperBody(`typeof require === "function" ? require : typeof import.meta !== "undefined" && typeof import.meta.require === "function" ? import.meta.require : process.getBuiltinModule ? (id) => process.getBuiltinModule(id) : null`)}
`;

const RUNTIME_HELPER_CJS_SNIPPET = `${PATCH_MARKER}
${buildRuntimeHelperBody(`require`)}
`;

export function computeHash(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

export function isPatchedContent(content: string): boolean {
  return content.includes(PATCH_MARKER);
}

export function injectRuntimeHelper(source: string): string {
  if (source.includes(PATCH_MARKER)) {
    return source;
  }

  // Check if file is a @bun-cjs wrapper starting with (function(exports, require, module, __filename, __dirname) {
  const bunCjsMatch = source.match(
    /^(?:\/\/[^\r\n]*\r?\n)*\(function\(exports,\s*require,\s*module,\s*__filename,\s*__dirname\)\s*\{/,
  );
  if (bunCjsMatch) {
    const idx = bunCjsMatch[0].length;
    return source.slice(0, idx) + "\n" + RUNTIME_HELPER_CJS_SNIPPET + source.slice(idx);
  }

  const isEsm = /\bimport\s*[\w*{]/.test(source.slice(0, 4096));
  const snippet = isEsm ? RUNTIME_HELPER_SNIPPET : RUNTIME_HELPER_CJS_SNIPPET;

  // Preserve leading `// @bun` directives at byte 0 so Bun standalone modules keep their loader headers
  const leadingCommentsMatch = source.match(/^(?:#![^\r\n]*\r?\n)?(?:\/\/[^\r\n]*\r?\n)+/);
  if (leadingCommentsMatch) {
    const idx = leadingCommentsMatch[0].length;
    return source.slice(0, idx) + snippet + source.slice(idx);
  }

  if (source.startsWith("#!")) {
    const firstNewline = source.indexOf("\n");
    if (firstNewline !== -1) {
      return source.slice(0, firstNewline + 1) + snippet + source.slice(firstNewline + 1);
    }
  }
  return snippet + source;
}

export interface TransformStats {
  code: string;
  schemaMatches: number;
  secondaryEnumMatches: number;
  resolverMatches: number;
  contextWindowMatches: number;
}

export function transformCliJsContent(source: string): TransformStats {
  if (isPatchedContent(source)) {
    return {
      code: source,
      schemaMatches: 0,
      secondaryEnumMatches: 0,
      resolverMatches: 0,
      contextWindowMatches: 0,
    };
  }

  let code = source;
  let schemaMatches = 0;
  let secondaryEnumMatches = 0;
  let resolverMatches = 0;
  let contextWindowMatches = 0;

  // Target 1A: Standard Zod object `model: y.enum(["sonnet","opus","haiku"...]).optional().describe(...)`
  const zodMemberAgentSchemaRegex =
    /model:\s*([A-Za-z0-9_$]+)\.enum\(\[\s*"sonnet"\s*,\s*"opus"\s*,\s*"haiku"(?:\s*,\s*"fable")?(?:\s*,\s*"inherit")?\s*\]\)\.optional\(\)\.describe\((["'`])((?:\\.|(?!\2).)*)\2\)/g;

  code = code.replace(
    zodMemberAgentSchemaRegex,
    (_match, zodVar: string, quote: string, descBody: string) => {
      schemaMatches++;
      const fullDescExpr = `${quote}${descBody}${quote}`;
      return `model:globalThis.__ccSubagentModelSchema(${zodVar},${fullDescExpr})`;
    },
  );

  // Target 1B: Standalone Zod v4 functions (Claude Code 2.1.280+):
  const standaloneZodAgentSchemaRegex =
    /(subagent_type:\s*([A-Za-z0-9_$]+)\(\)\.optional\(\)\.describe\([^)]+\)\s*,\s*model:\s*)([A-Za-z0-9_$]+)\(\[\s*"sonnet"\s*,\s*"opus"\s*,\s*"haiku"(?:\s*,\s*"fable")?(?:\s*,\s*"inherit")?\s*\]\)/g;

  code = code.replace(
    standaloneZodAgentSchemaRegex,
    (_match, prefix: string, strFn: string, enumFn: string) => {
      schemaMatches++;
      return `${prefix}globalThis.__ccSubagentModelSchema({string:${strFn},enum:${enumFn}})`;
    },
  );

  // Target 1C: Secondary occurrences of `<var>.enum(["sonnet","opus","haiku"(,"fable")(,"inherit")])`
  const secondaryMemberEnumRegex =
    /([A-Za-z0-9_$]+)\.enum\(\[\s*"sonnet"\s*,\s*"opus"\s*,\s*"haiku"(?:\s*,\s*"fable")?(?:\s*,\s*"inherit")?\s*\]\)/g;
  code = code.replace(secondaryMemberEnumRegex, (_match, zodVar: string) => {
    secondaryEnumMatches++;
    return `${zodVar}.string()`;
  });

  // Target 2: Internal Model Alias & Subagent Model Resolver Pass-Through
  // Pattern 2A: Subagent allowlist fallback helper `let <K>=<cv>(<E>);<Fa>(<E>,<K>!==null);`
  const subagentFallbackRegex =
    /let ([A-Za-z0-9_$]+)=([A-Za-z0-9_$]+)\(([A-Za-z0-9_$]+)\);([A-Za-z0-9_$]+)\(\3,\1!==null\);/g;
  code = code.replace(
    subagentFallbackRegex,
    (_match, resVar: string, cvFn: string, argVar: string, warnFn: string) => {
      resolverMatches++;
      return `if(typeof ${argVar}==="string"&&${argVar}.trim()!==""&&!["sonnet","opus","haiku","fable","inherit"].includes(${argVar}.trim().toLowerCase()))return ${argVar}.trim();let ${resVar}=${cvFn}(${argVar});${warnFn}(${argVar},${resVar}!==null);`;
    },
  );

  // Pattern 2B: Teammate / secondary subagent resolver `function <Z>(<e>,<n>){let <o>=<cv>(<e>);return <me>(<e>,<o>!==null),<o>??<ie>(<n>)}`
  const teammateFallbackRegex =
    /let ([A-Za-z0-9_$]+)=([A-Za-z0-9_$]+)\(([A-Za-z0-9_$]+)\);return ([A-Za-z0-9_$]+)\(\3,\1!==null\),\1\?\?([A-Za-z0-9_$]+)\(([A-Za-z0-9_$]+)\)/g;
  code = code.replace(
    teammateFallbackRegex,
    (
      _match,
      resVar: string,
      cvFn: string,
      argVar: string,
      warnFn: string,
      fallbackFn: string,
      parentVar: string,
    ) => {
      resolverMatches++;
      return `let ${resVar}=${cvFn}(${argVar});if(typeof ${argVar}==="string"&&${argVar}.trim()!==""&&!["sonnet","opus","haiku","fable","inherit"].includes(${argVar}.trim().toLowerCase()))return ${argVar}.trim();return ${warnFn}(${argVar},${resVar}!==null),${resVar}??${fallbackFn}(${parentVar})`;
    },
  );

  // Pattern 2C: Legacy / 2.1.112 subagent resolver `function <BC6>(<q>,<K>,<_>,<z>){if(process.env.CLAUDE_CODE_SUBAGENT_MODEL)`
  const legacySubagentResolverRegex =
    /(function\s+[A-Za-z0-9_$]+\(\s*([A-Za-z0-9_$]+)\s*,\s*([A-Za-z0-9_$]+)\s*,\s*([A-Za-z0-9_$]+)\s*,\s*([A-Za-z0-9_$]+)\s*\)\s*\{\s*)(if\s*\(\s*process\.env\.CLAUDE_CODE_SUBAGENT_MODEL\s*\))/g;
  code = code.replace(
    legacySubagentResolverRegex,
    (
      _match,
      fnHeader: string,
      fmModel: string,
      _parentModel: string,
      toolModel: string,
      _permMode: string,
      envCheck: string,
    ) => {
      resolverMatches++;
      return `${fnHeader}if(typeof ${toolModel}==="string"&&${toolModel}.trim()!==""&&!["sonnet","opus","haiku","fable","best","opusplan","inherit"].includes(${toolModel}.trim().toLowerCase()))return ${toolModel}.trim();if(!${toolModel}&&typeof ${fmModel}==="string"&&${fmModel}.trim()!==""&&!["sonnet","opus","haiku","fable","best","opusplan","inherit"].includes(${fmModel}.trim().toLowerCase()))return ${fmModel}.trim();${envCheck}`;
    },
  );

  // Target 3: Per-model & inline `[<size>]` (e.g. `oc/exo-free[1m]`, `glm/glm-4.5[256k]`, `model[500k]`) context window resolution
  // Pattern 3A: Generalize suffix stripping in `kd`/`Dn` (`replace(/\[(1|2)m\]/gi,"")`) and `ml`/`At`/`QO` (`replace(/\[1m\]$/i,"")`, `replace(/\[1m\]/gi,"")`)
  // so arbitrary `[256k]`, `[500k]`, `[1m]`, `[2m]` suffixes are stripped before sending `model` to the gateway API!
  const strip12mRegex = /\.replace\(\/\\\[\(1\|2\)m\\\]\/gi\s*,\s*""\)/g;
  code = code.replace(strip12mRegex, () => {
    contextWindowMatches++;
    return `.replace(/\\[\\d+(?:\\.\\d+)?\\s*(?:k|m)\\]/gi,"")`;
  });

  const strip1mEndRegex = /\.replace\(\/\\\[1m\\\]\$\/i\s*,\s*""\)/g;
  code = code.replace(strip1mEndRegex, () => {
    contextWindowMatches++;
    return `.replace(/\\[\\d+(?:\\.\\d+)?\\s*(?:k|m)\\]$/i,"")`;
  });

  const strip1mGlobalRegex = /\.replace\(\/\\\[1m\\\]\/gi\s*,\s*""\)/g;
  code = code.replace(strip1mGlobalRegex, () => {
    contextWindowMatches++;
    return `.replace(/\\[\\d+(?:\\.\\d+)?\\s*(?:k|m)\\]/gi,"")`;
  });

  // Pattern 3B: Patch context window resolver (`U4u` / `_v`) where `if(<KE>(<e>))return 1e6;` is checked.
  // Before checking `KE(e)`, call `globalThis.__ccResolveContextWindow?.(e)` so:
  //   1) Explicit `model[256k]` / `model[500k]` / `model[1m]` returns 256,000 / 500,000 / 1,000,000
  //   2) Per-model `contextWindow` in `~/.claude/subagent-models.json` is honored
  //   3) Non-Claude gateway models default to 1,000,000 instead of 200,000 (preventing autocompact thrashing when fixed prefix is ~154k)
  const contextWindowFnRegex =
    /(function\s+[A-Za-z0-9_$]+\(\s*([A-Za-z0-9_$]+)\s*,\s*[A-Za-z0-9_$]+\s*\)\s*\{)(if\s*\(\s*[A-Za-z0-9_$]+\(\2\)\s*\)\s*return\s+1e6\s*;)/g;
  code = code.replace(
    contextWindowFnRegex,
    (_match, fnOpen: string, modelVar: string, keCheck: string) => {
      contextWindowMatches++;
      return `${fnOpen}let __ccCw=globalThis.__ccResolveContextWindow?.(${modelVar});if(typeof __ccCw==="number"&&__ccCw>0)return __ccCw;${keCheck}`;
    },
  );

  // Pattern 3C: When a model has an explicit `[<size>]` suffix (e.g. `oc/exo-free[256k]`),
  // make `KV` / `$w` honor that explicit window directly even if `CLAUDE_CODE_AUTO_COMPACT_WINDOW` is set higher in settings.json,
  // and if `CLAUDE_CODE_AUTO_COMPACT_WINDOW` is set (e.g. 698000) while the user explicitly requested `[1m]`, `Math.min(o, c)` works naturally.
  const autoCompactEnvRegex =
    /(if\s*\(\s*process\.env\.CLAUDE_CODE_AUTO_COMPACT_WINDOW\s*\)\s*\{)/g;
  code = code.replace(autoCompactEnvRegex, (match) => {
    contextWindowMatches++;
    return `if(typeof e==="string"&&/\\[\\d+(?:\\.\\d+)?\\s*(?:k|m)\\]/i.test(e)){let __ccExp=globalThis.__ccResolveContextWindow?.(e);if(typeof __ccExp==="number"&&__ccExp>0&&!process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW)return{window:__ccExp,configured:__ccExp,source:"settings"};}${match}`;
  });

  if (
    schemaMatches > 0 ||
    secondaryEnumMatches > 0 ||
    resolverMatches > 0 ||
    contextWindowMatches > 0
  ) {
    code = injectRuntimeHelper(code);
  }

  return {
    code,
    schemaMatches,
    secondaryEnumMatches,
    resolverMatches,
    contextWindowMatches,
  };
}

export function verifySyntaxWithNode(filePath: string): { valid: boolean; error?: string } {
  try {
    execFileSync(process.execPath, ["--check", filePath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15000,
    });
    return { valid: true };
  } catch (err: unknown) {
    const msg =
      err && typeof err === "object" && "stderr" in err
        ? String((err as { stderr?: unknown }).stderr || (err as unknown as Error).message)
        : err instanceof Error
          ? err.message
          : String(err);
    return { valid: false, error: msg.trim() };
  }
}

export function getBackupPath(cliPath: string): string {
  return `${cliPath}.cc-backup`;
}

export function getBackupMetaPath(cliPath: string): string {
  return `${cliPath}.cc-backup.meta.json`;
}

export function patchCliJs(
  cliPath: string,
  options: { dryRun?: boolean; claudeVersion?: string } = {},
): PatchResult {
  const resolvedPath = path.resolve(cliPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Target file not found: ${resolvedPath}`);
  }

  const backupPath = getBackupPath(resolvedPath);
  const metaPath = getBackupMetaPath(resolvedPath);
  let originalContent = fs.readFileSync(resolvedPath, "utf8");

  if (isPatchedContent(originalContent)) {
    const existingMeta: Partial<BackupMetadata> = fs.existsSync(metaPath)
      ? JSON.parse(fs.readFileSync(metaPath, "utf8"))
      : {};
    return {
      cliPath: resolvedPath,
      backupPath,
      metaPath,
      alreadyPatched: true,
      schemaMatches: 0,
      secondaryEnumMatches: 0,
      resolverMatches: 0,
      contextWindowMatches: 0,
      versionHash: existingMeta.versionHash || computeHash(originalContent),
      dryRun: Boolean(options.dryRun),
      syntaxVerified: true,
    };
  }

  // If upgrading from V1 patch and a clean .cc-backup exists, start from the clean backup!
  if (originalContent.includes(LEGACY_PATCH_MARKER) && fs.existsSync(backupPath)) {
    originalContent = fs.readFileSync(backupPath, "utf8");
  }

  const versionHash = computeHash(originalContent);
  const transformed = transformCliJsContent(originalContent);

  if (transformed.schemaMatches === 0 && transformed.secondaryEnumMatches === 0) {
    throw new Error(
      `No matching Agent model enum patterns found in ${resolvedPath}. Is this a valid Claude Code cli.js bundle?`,
    );
  }

  if (options.dryRun) {
    const tmpFile = path.join(
      os.tmpdir(),
      `cc-subagent-models-dryrun-${process.pid}-${Date.now()}.mjs`,
    );
    try {
      fs.writeFileSync(tmpFile, transformed.code, "utf8");
      const check = verifySyntaxWithNode(tmpFile);
      if (!check.valid) {
        throw new Error(`Dry-run syntax check failed: ${check.error}`);
      }
    } finally {
      if (fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
    }

    return {
      cliPath: resolvedPath,
      backupPath,
      metaPath,
      alreadyPatched: false,
      schemaMatches: transformed.schemaMatches,
      secondaryEnumMatches: transformed.secondaryEnumMatches,
      resolverMatches: transformed.resolverMatches,
      contextWindowMatches: transformed.contextWindowMatches,
      versionHash,
      dryRun: true,
      syntaxVerified: true,
    };
  }

  // Create backup before writing (never overwrite an existing clean backup)
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(resolvedPath, backupPath);
  }
  const meta: BackupMetadata = {
    cliPath: resolvedPath,
    backupPath,
    versionHash,
    patchedAt: new Date().toISOString(),
    ...(options.claudeVersion ? { claudeVersion: options.claudeVersion } : {}),
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf8");

  // Write patched content and run `node --check`
  fs.writeFileSync(resolvedPath, transformed.code, "utf8");
  const syntax = verifySyntaxWithNode(resolvedPath);
  if (!syntax.valid) {
    fs.copyFileSync(backupPath, resolvedPath);
    throw new Error(
      `Syntax check (node --check) failed after patching; automatically rolled back from ${backupPath}.\nDetails: ${syntax.error}`,
    );
  }

  return {
    cliPath: resolvedPath,
    backupPath,
    metaPath,
    alreadyPatched: false,
    schemaMatches: transformed.schemaMatches,
    secondaryEnumMatches: transformed.secondaryEnumMatches,
    resolverMatches: transformed.resolverMatches,
    contextWindowMatches: transformed.contextWindowMatches,
    versionHash,
    dryRun: false,
    syntaxVerified: true,
  };
}

export function restoreCliJs(cliPath: string): {
  restored: boolean;
  cliPath: string;
  backupPath: string;
} {
  const resolvedPath = path.resolve(cliPath);
  const backupPath = getBackupPath(resolvedPath);
  const metaPath = getBackupMetaPath(resolvedPath);

  if (!fs.existsSync(backupPath)) {
    throw new Error(`Backup file not found at: ${backupPath}`);
  }

  fs.copyFileSync(backupPath, resolvedPath);
  fs.unlinkSync(backupPath);
  if (fs.existsSync(metaPath)) {
    fs.unlinkSync(metaPath);
  }

  return {
    restored: true,
    cliPath: resolvedPath,
    backupPath,
  };
}
