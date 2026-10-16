#!/usr/bin/env node
import fs from "node:fs";
import { Command } from "commander";
import pc from "picocolors";
import {
  addModelToConfig,
  getConfigPath,
  normalizeModelEntry,
  readConfig,
  removeModelFromConfig,
  type SubagentPatchMode,
  writeConfig,
} from "./config.js";
import { DEFAULT_GATEWAY_URL, syncGatewayModels } from "./gateway-sync.js";
import { convertNativeToNpmLocal, locateCliJs } from "./locator.js";
import { isNativeBinaryPatched, patchNativeBinary } from "./native-patcher.js";
import {
  getBackupMetaPath,
  getBackupPath,
  isPatchedContent,
  patchCliJs,
  restoreCliJs,
} from "./patcher.js";
import { watchCliJsForUpdates } from "./watcher.js";

const program = new Command();

program
  .name("cc-subagent-models")
  .description(
    "Patch Claude Code's Agent tool to support dynamic gateway subagent models (9Router, LiteLLM, OpenRouter)",
  )
  .version("1.0.0");

program
  .command("patch")
  .description("Patch Claude Code's cli.js for dynamic subagent model selection")
  .option("-m, --mode <mode>", "Schema mode: 'free' (.string()) or 'enum' (.enum(...))")
  .option("-p, --cli-path <path>", "Explicit path to Claude Code's cli.js")
  .option("-d, --dry-run", "Inspect and syntax-check without modifying cli.js on disk", false)
  .option(
    "--convert-to-npm [version]",
    "If native binary detected, install patchable @anthropic-ai/claude-code npm build into ~/.claude/local",
  )
  .action(
    async (opts: {
      mode?: string;
      cliPath?: string;
      dryRun?: boolean;
      convertToNpm?: boolean | string;
    }) => {
      try {
        if (opts.mode) {
          if (opts.mode !== "free" && opts.mode !== "enum") {
            console.error(pc.red(`Invalid --mode '${opts.mode}'. Expected 'free' or 'enum'.`));
            process.exit(1);
          }
          const cfg = readConfig();
          cfg.mode = opts.mode as SubagentPatchMode;
          writeConfig(cfg);
          console.log(
            pc.cyan(`Updated mode to '${cfg.mode}' in ${getConfigPath()}`),
          );
        }

        let located = locateCliJs({ cliPath: opts.cliPath });

        if (located.isNativeBinary && opts.convertToNpm) {
          const targetVer =
            typeof opts.convertToNpm === "string" ? opts.convertToNpm : "2.1.112";
          console.log(
            pc.yellow(
              `Installing @anthropic-ai/claude-code@${targetVer} into ~/.claude/local...`,
            ),
          );
          const newCliPath = convertNativeToNpmLocal(targetVer);
          located = locateCliJs({ cliPath: newCliPath });
        }

        if (located.isNativeBinary) {
          const nativeRes = await patchNativeBinary(located.cliPath, {
            dryRun: Boolean(opts.dryRun),
            claudeVersion: located.version,
          });
          if (nativeRes.alreadyPatched) {
            console.log(pc.green(`✓ Native binary already patched: ${nativeRes.cliPath}`));
            return;
          }
          if (nativeRes.dryRun) {
            console.log(pc.green(`✓ Native binary dry-run succeeded: ${nativeRes.cliPath}`));
          } else if (nativeRes.lockedRunning) {
            console.log(
              pc.yellow(
                `! Native binary is currently running (${nativeRes.cliPath}). Staged patched binary to: ${nativeRes.stagedPath}`,
              ),
            );
          } else {
            console.log(pc.green(`✓ Successfully patched native binary: ${nativeRes.cliPath}`));
            console.log(pc.dim(`  Backup saved to: ${nativeRes.backupPath}`));
          }
          console.log(
            `  Matches: ${pc.bold(String(nativeRes.schemaMatches))} Agent schema, ` +
              `${pc.bold(String(nativeRes.secondaryEnumMatches))} secondary enum(s), ` +
              `${pc.bold(String(nativeRes.resolverMatches))} resolver pass-through(s)`,
          );
          return;
        }

        const result = patchCliJs(located.cliPath, {
          dryRun: Boolean(opts.dryRun),
          claudeVersion: located.version,
        });

        if (result.alreadyPatched) {
          console.log(pc.green(`✓ Already patched: ${result.cliPath}`));
          console.log(pc.dim(`  Version SHA-256: ${result.versionHash}`));
        } else if (result.dryRun) {
          console.log(pc.green(`✓ Dry-run succeeded for: ${result.cliPath}`));
          console.log(
            `  Matches: ${pc.bold(String(result.schemaMatches))} Agent schema, ` +
              `${pc.bold(String(result.secondaryEnumMatches))} secondary enum(s), ` +
              `${pc.bold(String(result.resolverMatches))} resolver pass-through(s)`,
          );
        } else {
          console.log(pc.green(`✓ Successfully patched: ${result.cliPath}`));
          console.log(pc.dim(`  Backup saved to: ${result.backupPath}`));
          console.log(
            `  Matches: ${pc.bold(String(result.schemaMatches))} Agent schema, ` +
              `${pc.bold(String(result.secondaryEnumMatches))} secondary enum(s), ` +
              `${pc.bold(String(result.resolverMatches))} resolver pass-through(s)`,
          );
          console.log(pc.dim(`  Syntax check (node --check): passed`));
          console.log(pc.dim(`  Source SHA-256: ${result.versionHash}`));
        }

        // If locator also found a companion native binary (e.g. tweakcc-extracted), patch the native binary too!
        if (located.nativeBinaryPath && fs.existsSync(located.nativeBinaryPath)) {
          try {
            const natRes = await patchNativeBinary(located.nativeBinaryPath, {
              dryRun: Boolean(opts.dryRun),
              claudeVersion: located.version,
            });
            if (natRes.alreadyPatched) {
              console.log(pc.green(`✓ Companion native binary already patched: ${natRes.cliPath}`));
            } else if (natRes.lockedRunning) {
              console.log(
                pc.yellow(
                  `! Companion native binary is currently in use (${natRes.cliPath}); staged patched binary at: ${natRes.stagedPath}`,
                ),
              );
            } else if (!natRes.dryRun) {
              console.log(pc.green(`✓ Also patched companion native binary: ${natRes.cliPath}`));
            }
          } catch {
            // Ignore if node-lief not available
          }
        }
      } catch (err: unknown) {
        console.error(pc.red(`✗ Patch failed: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    },
  );

program
  .command("sync")
  .description("Fetch models from /v1/models gateway (default: 9Router) into ~/.claude/subagent-models.json")
  .option("-g, --gateway <url>", "Gateway /v1/models endpoint", DEFAULT_GATEWAY_URL)
  .option("-k, --api-key <key>", "Optional Bearer / x-api-key token for gateway")
  .option("-f, --filter <substring>", "Filter model IDs by case-insensitive substring")
  .option("--auto-hint", "Automatically populate capability hints from gateway metadata", false)
  .action(
    async (opts: {
      gateway?: string;
      apiKey?: string;
      filter?: string;
      autoHint?: boolean;
    }) => {
      try {
        const res = await syncGatewayModels({
          gatewayUrl: opts.gateway,
          apiKey: opts.apiKey,
          filter: opts.filter,
          autoHint: Boolean(opts.autoHint),
        });
        console.log(
          pc.green(
            `✓ Synced ${res.savedCount} model(s) (from ${res.totalFetched} total) via ${res.gatewayUrl}`,
          ),
        );
        console.log(pc.dim(`  Saved to: ${res.configPath}`));
        for (const m of res.models.slice(0, 15)) {
          console.log(`  - ${pc.bold(m.id)}${m.Hint ? pc.dim(` (${m.Hint})`) : ""}`);
        }
        if (res.models.length > 15) {
          console.log(pc.dim(`  ...and ${res.models.length - 15} more`));
        }
      } catch (err: unknown) {
        console.error(pc.red(`✗ Sync failed: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    },
  );

program
  .command("add <model-id>")
  .description("Add or update a model ID and routing hint in ~/.claude/subagent-models.json")
  .option("--hint <description>", "Routing hint explaining when the lead LLM should pick this model")
  .action((modelId: string, opts: { hint?: string }) => {
    try {
      const cfg = addModelToConfig(modelId, opts.hint);
      console.log(
        pc.green(
          `✓ Added "${modelId}"${opts.hint ? ` (${opts.hint})` : ""} to ${getConfigPath()} (${cfg.models.length} total models)`,
        ),
      );
    } catch (err: unknown) {
      console.error(pc.red(`✗ Add failed: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    }
  });

program
  .command("remove <model-id>")
  .description("Remove a model ID from ~/.claude/subagent-models.json")
  .action((modelId: string) => {
    try {
      const { config, removed } = removeModelFromConfig(modelId);
      if (removed) {
        console.log(
          pc.green(
            `✓ Removed "${modelId}" from ${getConfigPath()} (${config.models.length} remaining)`,
          ),
        );
      } else {
        console.log(pc.yellow(`Model "${modelId}" was not found in ${getConfigPath()}`));
      }
    } catch (err: unknown) {
      console.error(
        pc.red(`✗ Remove failed: ${err instanceof Error ? err.message : String(err)}`),
      );
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Check cli.js patch state, active schema mode, and configured gateway models")
  .option("-p, --cli-path <path>", "Explicit path to Claude Code's cli.js")
  .action((opts: { cliPath?: string }) => {
    const cfgPath = getConfigPath();
    const cfg = readConfig();

    console.log(pc.bold("=== cc-subagent-models status ==="));
    console.log(`Config file : ${cfgPath} ${fs.existsSync(cfgPath) ? pc.green("(exists)") : pc.dim("(not created yet)")}`);
    console.log(`Schema mode : ${pc.cyan(cfg.mode)} ${cfg.mode === "free" ? pc.dim("(z.string() + dynamic catalog description)") : pc.dim("(z.enum([...models]) + dynamic catalog description)")}`);

    try {
      const located = locateCliJs({ cliPath: opts.cliPath });
      console.log(`CLI path    : ${located.cliPath} ${pc.dim(`[source: ${located.source}${located.version ? `, v${located.version}` : ""}]`)}`);
      if (located.isNativeBinary) {
        const natPatched = isNativeBinaryPatched(located.cliPath);
        console.log(
          `Patch status: ${natPatched ? pc.green("PATCHED (native binary) ✓") : pc.yellow("UNPATCHED (native binary)")}`,
        );
      } else {
        const content = fs.readFileSync(located.cliPath, "utf8");
        const patched = isPatchedContent(content);
        const backupExists = fs.existsSync(getBackupPath(located.cliPath));
        const metaPath = getBackupMetaPath(located.cliPath);
        const meta = fs.existsSync(metaPath)
          ? JSON.parse(fs.readFileSync(metaPath, "utf8"))
          : null;
        console.log(
          `Patch status: ${patched ? pc.green("PATCHED ✓") : pc.yellow("UNPATCHED")}` +
            (backupExists ? pc.dim(` (backup present${meta?.versionHash ? `, sha256: ${String(meta.versionHash).slice(0, 12)}...` : ""})`) : ""),
        );
        if (located.nativeBinaryPath && fs.existsSync(located.nativeBinaryPath)) {
          const natPatched = isNativeBinaryPatched(located.nativeBinaryPath);
          const stagedExists = fs.existsSync(`${located.nativeBinaryPath}.cc-patched`);
          console.log(
            `Native bin  : ${located.nativeBinaryPath} ${natPatched ? pc.green("PATCHED ✓") : stagedExists ? pc.cyan("STAGED (.cc-patched ready)") : pc.yellow("UNPATCHED")}`,
          );
        }
      }
    } catch (err: unknown) {
      console.log(`CLI path    : ${pc.red(err instanceof Error ? err.message : String(err))}`);
    }

    const entries = cfg.models.map(normalizeModelEntry);
    console.log(`Models (${entries.length}) :`);
    if (entries.length === 0) {
      console.log(pc.dim("  (none configured — run `cc-subagent-models sync` or `cc-subagent-models add <id>`)"));
    } else {
      for (const m of entries) {
        console.log(`  - ${pc.bold(m.id)}${m.Hint ? pc.dim(` (${m.Hint})`) : ""}`);
      }
    }
  });

program
  .command("restore")
  .description("Restore Claude Code's cli.js from its .cc-backup file")
  .option("-p, --cli-path <path>", "Explicit path to Claude Code's cli.js")
  .action((opts: { cliPath?: string }) => {
    try {
      const located = locateCliJs({ cliPath: opts.cliPath });
      const res = restoreCliJs(located.cliPath);
      console.log(pc.green(`✓ Restored ${res.cliPath} from ${res.backupPath}`));
    } catch (err: unknown) {
      console.error(
        pc.red(`✗ Restore failed: ${err instanceof Error ? err.message : String(err)}`),
      );
      process.exit(1);
    }
  });

program
  .command("watch")
  .description("Watch cli.js and automatically re-apply the patch after Claude Code updates")
  .option("-p, --cli-path <path>", "Explicit path to Claude Code's cli.js")
  .action((opts: { cliPath?: string }) => {
    try {
      const located = locateCliJs({ cliPath: opts.cliPath });
      if (located.isNativeBinary) {
        console.error(pc.yellow(located.conversionHint || "Cannot watch native binary."));
        process.exit(1);
      }
      console.log(pc.cyan(`Watching ${located.cliPath} for updates... (Ctrl+C to stop)`));
      watchCliJsForUpdates(
        located.cliPath,
        (res) => {
          console.log(
            pc.green(
              `[${new Date().toISOString()}] Auto-repatched ${res.cliPath} (${res.schemaMatches} schema, ${res.resolverMatches} resolver)`,
            ),
          );
        },
        (err) => {
          console.error(
            pc.red(
              `[${new Date().toISOString()}] Auto-repatch error: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
        },
      );
    } catch (err: unknown) {
      console.error(pc.red(`✗ Watch failed: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    }
  });

program.parseAsync(process.argv);
