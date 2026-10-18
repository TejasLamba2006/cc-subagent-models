import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  type BackupMetadata,
  getBackupMetaPath,
  getBackupPath,
  LEGACY_PATCH_MARKER,
  PATCH_MARKER,
  type PatchResult,
  transformCliJsContent,
} from "./patcher.js";

interface NativeInstallationModule {
  index: number;
  name: string;
  contents: Buffer;
  isJavaScript?: boolean;
  isEntrypoint?: boolean;
}

interface ExtractedNativeBundle {
  sourceSha256: string;
  moduleStructSize: number;
  entryPointId: number;
  modules: NativeInstallationModule[];
}

interface TweakccNativeBridge {
  extractClaudeJsModulesFromNativeInstallation: (binPath: string) => ExtractedNativeBundle | null;
  repackNativeInstallationModules: (
    srcPath: string,
    payload: { sourceSha256: string; modules: NativeInstallationModule[] },
    outPath: string,
  ) => void;
}

async function loadNativeBridge(): Promise<TweakccNativeBridge> {
  try {
    const mod = (await import("tweakcc/dist/nativeInstallation.mjs" as string)) as TweakccNativeBridge;
    if (typeof mod.extractClaudeJsModulesFromNativeInstallation === "function") {
      return mod;
    }
  } catch {
    // Search npx cache for tweakcc's nativeInstallation-*.mjs
  }

  const searchDirs: string[] = [];
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  searchDirs.push(
    path.join(localAppData, "npm-cache", "_npx"),
    path.join(os.homedir(), ".npm", "_npx"),
  );

  for (const npxRoot of searchDirs) {
    if (!fs.existsSync(npxRoot)) continue;
    for (const hashDir of fs.readdirSync(npxRoot)) {
      const distDir = path.join(npxRoot, hashDir, "node_modules", "tweakcc", "dist");
      if (!fs.existsSync(distDir)) continue;
      const match = fs
        .readdirSync(distDir)
        .find((f) => f.startsWith("nativeInstallation") && f.endsWith(".mjs"));
      if (match) {
        const modUrl = pathToFileURL(path.join(distDir, match)).href;
        const mod = (await import(modUrl)) as TweakccNativeBridge;
        if (typeof mod.extractClaudeJsModulesFromNativeInstallation === "function") {
          return mod;
        }
      }
    }
  }

  throw new Error(
    "Native binary patching requires `tweakcc` (with `node-lief`) in your npm/npx cache, or run `npx tweakcc --version` once first.",
  );
}

export function isNativeBinaryPatched(binPath: string): boolean {
  try {
    const buf = fs.readFileSync(binPath);
    return buf.includes(Buffer.from(PATCH_MARKER, "utf8"));
  } catch {
    return false;
  }
}

export async function patchNativeBinary(
  binPath: string,
  options: { dryRun?: boolean; claudeVersion?: string } = {},
): Promise<PatchResult & { stagedPath?: string; lockedRunning?: boolean }> {
  const resolvedPath = path.resolve(binPath);
  const backupPath = getBackupPath(resolvedPath);
  const metaPath = getBackupMetaPath(resolvedPath);

  if (isNativeBinaryPatched(resolvedPath)) {
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
      versionHash: existingMeta.versionHash || "patched",
      dryRun: Boolean(options.dryRun),
      syntaxVerified: true,
    };
  }

  const bridge = await loadNativeBridge();
  // If upgrading from V1 patch, extract from clean .cc-backup when available
  const sourceBinForExtract =
    fs.existsSync(backupPath) &&
    (() => {
      try {
        return fs.readFileSync(resolvedPath).includes(Buffer.from(LEGACY_PATCH_MARKER, "utf8"));
      } catch {
        return false;
      }
    })()
      ? backupPath
      : resolvedPath;

  const extracted = bridge.extractClaudeJsModulesFromNativeInstallation(sourceBinForExtract);
  if (!extracted) {
    throw new Error(`Failed to extract embedded Bun JS modules from ${sourceBinForExtract}`);
  }

  let totalSchema = 0;
  let totalSecondary = 0;
  let totalResolver = 0;
  let totalContextWindow = 0;
  const modified: NativeInstallationModule[] = [];

  for (const m of extracted.modules) {
    if (!m.isJavaScript) continue;
    const orig = m.contents.toString("utf8");
    const t = transformCliJsContent(orig);
    if (
      t.schemaMatches > 0 ||
      t.secondaryEnumMatches > 0 ||
      t.resolverMatches > 0 ||
      t.contextWindowMatches > 0
    ) {
      totalSchema += t.schemaMatches;
      totalSecondary += t.secondaryEnumMatches;
      totalResolver += t.resolverMatches;
      totalContextWindow += t.contextWindowMatches;
      modified.push({
        ...m,
        contents: Buffer.from(t.code, "utf8"),
      });
    }
  }

  if (totalSchema === 0 && totalSecondary === 0) {
    throw new Error(`No Agent model enum patterns found inside native binary ${resolvedPath}`);
  }

  if (options.dryRun) {
    return {
      cliPath: resolvedPath,
      backupPath,
      metaPath,
      alreadyPatched: false,
      schemaMatches: totalSchema,
      secondaryEnumMatches: totalSecondary,
      resolverMatches: totalResolver,
      contextWindowMatches: totalContextWindow,
      versionHash: extracted.sourceSha256,
      dryRun: true,
      syntaxVerified: true,
    };
  }

  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(resolvedPath, backupPath);
  }
  const meta: BackupMetadata = {
    cliPath: resolvedPath,
    backupPath,
    versionHash: extracted.sourceSha256,
    patchedAt: new Date().toISOString(),
    ...(options.claudeVersion ? { claudeVersion: options.claudeVersion } : {}),
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf8");

  const stagedPath = `${resolvedPath}.cc-patched`;
  fs.copyFileSync(sourceBinForExtract, stagedPath);
  bridge.repackNativeInstallationModules(
    stagedPath,
    { sourceSha256: extracted.sourceSha256, modules: modified },
    stagedPath,
  );

  let lockedRunning = false;
  try {
    const oldExe = `${resolvedPath}.cc-old`;
    if (fs.existsSync(oldExe)) {
      try {
        fs.unlinkSync(oldExe);
      } catch {
        // Still in use by previous process
      }
    }
    try {
      fs.copyFileSync(stagedPath, resolvedPath);
      fs.unlinkSync(stagedPath);
    } catch {
      fs.renameSync(resolvedPath, oldExe);
      fs.renameSync(stagedPath, resolvedPath);
      try {
        fs.unlinkSync(oldExe);
      } catch {
        // Will be cleaned up on next run after current session exits
      }
    }
  } catch (err: unknown) {
    const code = err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : "";
    if (code === "EBUSY" || code === "EPERM" || code === "ETXTBSY" || code === "EACCES") {
      lockedRunning = true;
    } else {
      throw err;
    }
  }

  return {
    cliPath: resolvedPath,
    backupPath,
    metaPath,
    alreadyPatched: false,
    schemaMatches: totalSchema,
    secondaryEnumMatches: totalSecondary,
    resolverMatches: totalResolver,
    contextWindowMatches: totalContextWindow,
    versionHash: extracted.sourceSha256,
    dryRun: false,
    syntaxVerified: true,
    ...(lockedRunning ? { stagedPath, lockedRunning } : {}),
  };
}
