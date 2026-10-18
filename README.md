# cc-subagent-models

If you run Claude Code through a gateway like 9Router, LiteLLM, or OpenRouter, you already have access to dozens of models. The problem is that Claude Code's built-in `Agent` tool won't let you use them for subagents, and even if you force a non-Claude model ID through, Claude Code assumes an unrecognized model has a 200k context limit. When your system prompt, skills, and MCP tools already take 150k tokens, a 200k limit leaves almost no room to read files and causes autocompact to thrash and kill the subagent.

`cc-subagent-models` fixes all three parts of the problem in one patch:

1. Unlocks the `Agent` tool's `model` parameter (`free` string mode or `enum` mode).
2. Passes non-Anthropic model IDs straight through the subagent model resolver.
3. Unlocks per-call and per-model context windows (`oc/exo-free[1m]`, `glm/glm-4.5[256k]`, `deepseek/deepseek-reasoner[500k]`), defaults non-Claude gateway models to 1M so autocompact does not thrash, strips the `[<size>]` suffix before sending the API request to your gateway, and writes the usage instructions directly into `~/.claude/CLAUDE.md`.

```bash
npx cc-subagent-models sync --gateway http://localhost:20128/v1/models
npx cc-subagent-models patch --mode free
```

---

## Spawning subagents with model, effort, and context limit

Once patched, `cc-subagent-models` automatically updates `~/.claude/CLAUDE.md` so your lead session knows how to combine model, effort, and context window in natural prompts:

> "Give this task to `oc/exo-free` on high effort with 256k context"

The lead model translates that into an `Agent` tool call:
- `model`: `"oc/exo-free[256k]"` (or `"oc/exo-free[1m]"`, `"glm/glm-4.5[500k]"`)
- `subagent_type`: `"pstack:effort-high"` (or `"pstack:poteto-agent-high"` when using pstack effort agents)

Claude Code uses `256,000` (or `1,000,000`) as that subagent's context window for autocompact calculation, and strips `[256k]` from the model name before calling your gateway's `/v1/messages` endpoint.

---

## How it works

Instead of baking a static model list into `cli.js`, the patcher injects runtime helpers (`globalThis.__ccSubagentModelSchema` and `globalThis.__ccResolveContextWindow`), rewrites the subagent model resolver to pass non-Anthropic model strings straight through, and widens Claude Code's `[1m]` suffix stripper to strip any `[<number>k|m]` tag before the wire call.

Every time you start `claude`, the helper reads `~/.claude/subagent-models.json` on the fly. When you add a provider in 9Router or change a model's context limit, you do not need to re-patch Claude Code.

It works on both installation formats:
1. Standard npm `cli.js` bundles (`@anthropic-ai/claude-code`).
2. Bun-compiled native binaries (`~/.local/bin/claude` or `claude.exe`) when `tweakcc` (`node-lief`) is present in your local cache.

Before writing anything, the patcher saves a `.cc-backup` copy of your installation and runs `node --check` on JS bundles. If the syntax check fails, it restores the backup immediately.

---

## Quick start

### 1. Curate your subagent models (or sync from your gateway)

If your gateway has 3,000+ models, dumping all of them into the `Agent` tool description will bloat your prompt tokens. Curating 3 to 6 models with clear routing hints and context limits works best:

```bash
npx cc-subagent-models add "oc/exo-free" --context 1m --hint "Fast 1M model for large doc extraction and SOW drafting"
npx cc-subagent-models add "iflow/qwen3-coder-plus" --context 256k --hint "Fast, free coder for file search, grep, and boilerplate"
npx cc-subagent-models add "glm/glm-4.5" --context 128k --hint "Standard refactoring and unit tests"
npx cc-subagent-models add "deepseek/deepseek-reasoner" --context 128k --hint "Complex debugging and algorithmic reasoning"
```

Or pull straight from a `/v1/models` endpoint (defaults to 9Router on port `20128`) with a substring filter:

```bash
npx cc-subagent-models sync --gateway http://localhost:20128/v1/models --filter qwen --auto-hint
```

### 2. Patch Claude Code

```bash
# Default: converts the model schema to z.string(), patches context window resolution, and updates ~/.claude/CLAUDE.md
npx cc-subagent-models patch --mode free

# Strict: builds z.enum(["sonnet", "opus", "haiku", ...yourModels]) at startup
npx cc-subagent-models patch --mode enum
```

Restart `claude`. Your lead model will now see your configured gateway models, their hints, and their context windows inside the `Agent` tool definition, plus the routing instructions in `~/.claude/CLAUDE.md`.

---

## Commands

```text
cc-subagent-models patch [--mode free|enum] [--default-context <size>] [--no-claude-md] [--cli-path <path>] [--dry-run] [--convert-to-npm [version]]
cc-subagent-models sync [--gateway <url>] [--api-key <key>] [--filter <substring>] [--auto-hint]
cc-subagent-models add <model-id> [--hint <description>] [--context <size>]
cc-subagent-models remove <model-id>
cc-subagent-models status [--cli-path <path>]
cc-subagent-models restore [--cli-path <path>]
cc-subagent-models watch [--cli-path <path>]
```

- `patch --dry-run` runs the regex transforms and `node --check` against a temporary copy without touching your installation.
- `patch --no-claude-md` skips writing the subagent instructions block into `~/.claude/CLAUDE.md`.
- `restore` copies `cli.js.cc-backup` (or `claude.exe.cc-backup`) back over the patched file.
- `watch` monitors `cli.js` and re-applies the patch if an auto-update overwrites it.

---

## Config file and environment variables

Config lives at `~/.claude/subagent-models.json`:

```json
{
  "mode": "free",
  "defaultContextWindow": 1000000,
  "models": [
    {
      "id": "oc/exo-free",
      "Hint": "Fast 1M model for large doc extraction",
      "contextWindow": 1000000
    },
    {
      "id": "iflow/qwen3-coder-plus",
      "Hint": "Fast, free coder for file search, grep, and boilerplate",
      "contextWindow": 256000
    }
  ],
  "customPrompt": ""
}
```

You can also override settings per session with environment variables:
- `CC_SUBAGENT_MODELS`: Comma-separated model IDs (`CC_SUBAGENT_MODELS="iflow/qwen3-coder-plus,glm/glm-4.5" claude`).
- `CC_SUBAGENT_CONFIG`: Path to an alternate JSON config file.
- `CC_CLI_PATH`: Explicit path to `cli.js` or native `claude` binary.

---

## Development

```bash
git clone https://github.com/TejasLamba2006/cc-subagent-models
cd cc-subagent-models
npm install
npm run build
npm test
```

Requires Node 18 or newer.

## License

MIT
