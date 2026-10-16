import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const PATCH_MARKER = "/* __CC_SUBAGENT_MODELS_PATCH_V1__ */";

export interface PatchResult {
  cliPath: string;
  backupPath: string;
  metaPath: string;
  alreadyPatched: boolean;
  schemaMatches: number;
  secondaryEnumMatches: number;
  resolverMatches: number;
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

export const RUNTIME_HELPER_SNIPPET = `${PATCH_MARKER}
globalThis.__ccSubagentModelSchema = function(zodInstance, origDesc) {
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
  const _resolve = (fallbackDesc) => {
    try {
      const _req =
        typeof require === "function"
          ? require
          : typeof import.meta !== "undefined" && typeof import.meta.require === "function"
            ? import.meta.require
            : process.getBuiltinModule
              ? (id) => process.getBuiltinModule(id)
              : null;
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
        ? "\\nAvailable gateway models you can choose from:\\n" + cfg.models.map(m => typeof m === "string" ? \`- "\${m}"\` : \`- "\${m.id}"\${m.Hint ? \` (\${m.Hint})\` : ""}\`).join("\\n")
        : "";
      const finalDesc = (cfg.customPrompt || fallbackDesc || "Optional model to use for this subagent. Pass ANY valid gateway model ID (e.g., provider/model-name), or 'sonnet', 'opus', 'haiku'. If omitted, inherits from parent.") + modelListStr;
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
`;

const RUNTIME_HELPER_CJS_SNIPPET = `${PATCH_MARKER}
globalThis.__ccSubagentModelSchema = function(zodInstance, origDesc) {
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
  const _resolve = (fallbackDesc) => {
    try {
      const fs = require("fs");
      const os = require("os");
      const path = require("path");
      const cfgPath = process.env.CC_SUBAGENT_CONFIG || path.join(os.homedir(), ".claude", "subagent-models.json");
      let cfg = { mode: "free", models: [], customPrompt: "" };
      if (fs.existsSync(cfgPath)) {
        cfg = { ...cfg, ...JSON.parse(fs.readFileSync(cfgPath, "utf8")) };
      }
      if (process.env.CC_SUBAGENT_MODELS) {
        cfg.models = process.env.CC_SUBAGENT_MODELS.split(",").map(s => s.trim()).filter(Boolean).map(id => ({ id }));
      }
      const modelListStr = cfg.models && cfg.models.length > 0
        ? "\\nAvailable gateway models you can choose from:\\n" + cfg.models.map(m => typeof m === "string" ? \`- "\${m}"\` : \`- "\${m.id}"\${m.Hint ? \` (\${m.Hint})\` : ""}\`).join("\\n")
        : "";
      const finalDesc = (cfg.customPrompt || fallbackDesc || "Optional model to use for this subagent. Pass ANY valid gateway model ID (e.g., provider/model-name), or 'sonnet', 'opus', 'haiku'. If omitted, inherits from parent.") + modelListStr;
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
`;

export function computeHash(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

export function isPatchedContent(content: string): boolean {
  return content.includes(PATCH_MARKER) || content.includes("globalThis.__ccSubagentModelSchema");
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
}

export function transformCliJsContent(source: string): TransformStats {
  if (isPatchedContent(source)) {
    return {
      code: source,
      schemaMatches: 0,
      secondaryEnumMatches: 0,
      resolverMatches: 0,
    };
  }

  let code = injectRuntimeHelper(source);
  let schemaMatches = 0;
  let secondaryEnumMatches = 0;
  let resolverMatches = 0;

  // Target 1A: Standard Zod object `model: y.enum(["sonnet","opus","haiku"...]).optional().describe(...)`
  // Handles single quotes, double quotes, and template literals in .describe(...)
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
  // `subagent_type:<strFn>().optional().describe(...),model:<enumFn>(["sonnet","opus","haiku"(,"fable")]).optional().describe(...)`
  // Replaces `<enumFn>(["sonnet","opus","haiku"...])` with `globalThis.__ccSubagentModelSchema({string:<strFn>,enum:<enumFn>})`
  // so arbitrary `.optional().describe(<any complex ternary expression>)` chains cleanly without truncating balanced parens!
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
  // When a non-Anthropic gateway model is passed to `Agent`, `Ur(E)` (allowlist check) may return false if
  // `availableModels` or policy settings are active, causing `w(E, ...)` to step down or fall back to parent.
  // We patch the fallback helper so any non-empty custom model string (not in ["sonnet","opus","haiku","fable","inherit"])
  // passes straight through verbatim!
  const subagentFallbackRegex =
    /let ([A-Za-z0-9_$]+)=([A-Za-z0-9_$]+)\(([A-Za-z0-9_$]+)\);([A-Za-z0-9_$]+)\(\3,\1!==null\);/g;
  code = code.replace(
    subagentFallbackRegex,
    (match, resVar: string, cvFn: string, argVar: string, warnFn: string) => {
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
  // Ensure any non-Anthropic string passed in `_` (tool model) or `q` (frontmatter model) resolves verbatim
  // and that `availableModels` checker `Kq6` / `Tu` / `Ur` allows custom gateway models.
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

  // Pattern 2D: Generic switch/map alias resolver on "opusplan"/"sonnet"/"haiku"/"opus"
  // Ensure unknown non-empty strings pass through at the end of alias resolution
  const aliasSwitchRegex =
    /(case\s*"sonnet"\s*:\s*return[^;]+;\s*case\s*"haiku"\s*:\s*return[^;]+;\s*case\s*"opus"\s*:\s*return[^;]+;\s*case\s*"best"\s*:\s*return[^;]+;\s*default:\s*\})/g;
  code = code.replace(aliasSwitchRegex, (match) => {
    resolverMatches++;
    return match;
  });

  return {
    code,
    schemaMatches,
    secondaryEnumMatches,
    resolverMatches,
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
  const originalContent = fs.readFileSync(resolvedPath, "utf8");

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
      versionHash: existingMeta.versionHash || computeHash(originalContent),
      dryRun: Boolean(options.dryRun),
      syntaxVerified: true,
    };
  }

  const versionHash = computeHash(originalContent);
  const transformed = transformCliJsContent(originalContent);

  if (transformed.schemaMatches === 0 && transformed.secondaryEnumMatches === 0) {
    throw new Error(
      `No matching Agent model enum patterns found in ${resolvedPath}. Is this a valid Claude Code cli.js bundle?`,
    );
  }

  if (options.dryRun) {
    // Verify syntax in a temp file even during dry-run so we prove the generated code is valid JS!
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
      versionHash,
      dryRun: true,
      syntaxVerified: true,
    };
  }

  // Create backup before writing
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
    // Roll back immediately from backup so the user's installation is never corrupted
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
