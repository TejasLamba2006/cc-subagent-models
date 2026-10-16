import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

export interface LocatedCli {
  cliPath: string;
  source:
    | "custom"
    | "claude-local"
    | "config-claude-local"
    | "require-resolve"
    | "npm-global"
    | "which-symlink"
    | "tweakcc-extracted";
  isNativeBinary: boolean;
  nativeBinaryPath?: string;
  version?: string;
  conversionHint?: string;
}

export interface LocateOptions {
  cliPath?: string;
  cwd?: string;
}

export function isBinaryFile(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(512);
    const bytesRead = fs.readSync(fd, buf, 0, 512, 0);
    fs.closeSync(fd);
    if (bytesRead === 0) return false;
    // Check Mach-O, ELF, or Windows PE ("MZ") headers
    if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) return true;
    if (buf[0] === 0x4d && buf[1] === 0x5a) return true;
    const magic32 = buf.readUInt32BE(0);
    if (
      magic32 === 0xfeedface ||
      magic32 === 0xfeedfacf ||
      magic32 === 0xcefaedfe ||
      magic32 === 0xcffaedfe ||
      magic32 === 0xcafebabe
    ) {
      return true;
    }
    for (let i = 0; i < bytesRead; i++) {
      if (buf[i] === 0) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function extractClaudeVersion(filePath: string): string | undefined {
  try {
    if (isBinaryFile(filePath)) {
      const out = execFileSync(filePath, ["--version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      }).trim();
      const m = out.match(/(\d+\.\d+\.\d+)/);
      return m?.[1];
    }
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(4096);
    const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
    fs.closeSync(fd);
    const head = buf.subarray(0, bytesRead).toString("utf8");
    const m = head.match(/\/\/\s*Version:\s*([0-9]+\.[0-9]+\.[0-9]+[^\s]*)/i);
    if (m) return m[1];
    const pkgPath = path.join(path.dirname(filePath), "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      if (typeof pkg.version === "string") return pkg.version;
    }
  } catch {
    // Ignore version read failures
  }
  return undefined;
}

export function buildNativeConversionHint(binaryPath: string, version?: string): string {
  const verTag = version || "2.1.112";
  return [
    `Detected a Bun-compiled native Claude Code binary at: ${binaryPath}`,
    `Native Mach-O/ELF/PE binaries bundle bytecode and cannot be directly syntax-checked as plain cli.js.`,
    `To install a patchable JS distribution of @anthropic-ai/claude-code:`,
    `  npm install -g @anthropic-ai/claude-code@${verTag}`,
    `  # Or run with --convert-to-npm to install the JS package into ~/.claude/local`,
    `  # Or pass --cli-path <path-to-cli.js> if you have an extracted JS bundle (e.g. ~/.tweakcc/native-claudejs-patched.js)`,
  ].join("\n");
}

function resolveWhichClaude(): string | undefined {
  const bin = process.platform === "win32" ? "where.exe" : "which";
  try {
    const out = execFileSync(bin, ["claude"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 4000,
    })
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const candidate of out) {
      if (fs.existsSync(candidate)) {
        try {
          return fs.realpathSync(candidate);
        } catch {
          return candidate;
        }
      }
    }
  } catch {
    // Not in PATH
  }
  const fallbackBin = path.join(
    os.homedir(),
    ".local",
    "bin",
    process.platform === "win32" ? "claude.exe" : "claude",
  );
  if (fs.existsSync(fallbackBin)) {
    try {
      return fs.realpathSync(fallbackBin);
    } catch {
      return fallbackBin;
    }
  }
  return undefined;
}

export function locateCliJs(options: LocateOptions = {}): LocatedCli {
  const home = os.homedir();

  // 1. Custom path via --cli-path or CC_CLI_PATH
  const explicitPath = options.cliPath || process.env.CC_CLI_PATH;
  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Custom cli.js path does not exist: ${resolved}`);
    }
    const isBin = isBinaryFile(resolved);
    const version = extractClaudeVersion(resolved);
    return {
      cliPath: resolved,
      source: "custom",
      isNativeBinary: isBin,
      ...(isBin
        ? {
            nativeBinaryPath: resolved,
            conversionHint: buildNativeConversionHint(resolved, version),
          }
        : {}),
      version,
    };
  }

  // 2. Local Claude installation: ~/.claude/local/... and ~/.config/claude/local/...
  const localClaudePath = path.join(
    home,
    ".claude",
    "local",
    "node_modules",
    "@anthropic-ai",
    "claude-code",
    "cli.js",
  );
  if (fs.existsSync(localClaudePath) && !isBinaryFile(localClaudePath)) {
    return {
      cliPath: localClaudePath,
      source: "claude-local",
      isNativeBinary: false,
      version: extractClaudeVersion(localClaudePath),
    };
  }

  const configClaudePath = path.join(
    home,
    ".config",
    "claude",
    "local",
    "node_modules",
    "@anthropic-ai",
    "claude-code",
    "cli.js",
  );
  if (fs.existsSync(configClaudePath) && !isBinaryFile(configClaudePath)) {
    return {
      cliPath: configClaudePath,
      source: "config-claude-local",
      isNativeBinary: false,
      version: extractClaudeVersion(configClaudePath),
    };
  }

  // 3. require.resolve("@anthropic-ai/claude-code/cli.js") from current working context
  try {
    const req = createRequire(path.join(options.cwd || process.cwd(), "package.json"));
    const resolved = req.resolve("@anthropic-ai/claude-code/cli.js");
    if (fs.existsSync(resolved) && !isBinaryFile(resolved)) {
      return {
        cliPath: resolved,
        source: "require-resolve",
        isNativeBinary: false,
        version: extractClaudeVersion(resolved),
      };
    }
  } catch {
    // Not resolvable from cwd
  }

  // 4. Global npm root: $(npm root -g)/@anthropic-ai/claude-code/cli.js
  try {
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    const npmRoot = execFileSync(npmCmd, ["root", "-g"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
    if (npmRoot) {
      const globalCli = path.join(npmRoot, "@anthropic-ai", "claude-code", "cli.js");
      if (fs.existsSync(globalCli) && !isBinaryFile(globalCli)) {
        return {
          cliPath: globalCli,
          source: "npm-global",
          isNativeBinary: false,
          version: extractClaudeVersion(globalCli),
        };
      }
    }
  } catch {
    // Ignore npm root errors
  }

  // 5. Resolving which claude symlink via fs.realpathSync()
  const whichResolved = resolveWhichClaude();
  if (whichResolved) {
    if (!isBinaryFile(whichResolved) && whichResolved.endsWith(".js")) {
      return {
        cliPath: whichResolved,
        source: "which-symlink",
        isNativeBinary: false,
        version: extractClaudeVersion(whichResolved),
      };
    }
    const tweakccPatched = path.join(home, ".tweakcc", "native-claudejs-patched.js");
    if (fs.existsSync(tweakccPatched) && !isBinaryFile(tweakccPatched)) {
      const ver = extractClaudeVersion(whichResolved) || extractClaudeVersion(tweakccPatched);
      return {
        cliPath: tweakccPatched,
        source: "tweakcc-extracted",
        isNativeBinary: false,
        nativeBinaryPath: whichResolved,
        version: ver,
        conversionHint: buildNativeConversionHint(whichResolved, ver),
      };
    }
    if (isBinaryFile(whichResolved)) {
      const ver = extractClaudeVersion(whichResolved);
      return {
        cliPath: whichResolved,
        source: "which-symlink",
        isNativeBinary: true,
        nativeBinaryPath: whichResolved,
        version: ver,
        conversionHint: buildNativeConversionHint(whichResolved, ver),
      };
    }
  }

  throw new Error(
    "Could not locate @anthropic-ai/claude-code/cli.js. Pass --cli-path <path> or set CC_CLI_PATH.",
  );
}

export function convertNativeToNpmLocal(targetVersion = "2.1.112"): string {
  const localDir = path.join(os.homedir(), ".claude", "local");
  fs.mkdirSync(localDir, { recursive: true });
  const pkgJsonPath = path.join(localDir, "package.json");
  if (!fs.existsSync(pkgJsonPath)) {
    fs.writeFileSync(
      pkgJsonPath,
      JSON.stringify({ name: "claude-local", private: true }, null, 2),
      "utf8",
    );
  }
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  execFileSync(
    npmCmd,
    ["install", `@anthropic-ai/claude-code@${targetVersion}`, "--no-audit", "--no-fund"],
    {
      cwd: localDir,
      stdio: "inherit",
    },
  );
  const cliJs = path.join(localDir, "node_modules", "@anthropic-ai", "claude-code", "cli.js");
  if (!fs.existsSync(cliJs)) {
    throw new Error(
      `Installed @anthropic-ai/claude-code@${targetVersion}, but cli.js was not found at ${cliJs}.`,
    );
  }
  return cliJs;
}
