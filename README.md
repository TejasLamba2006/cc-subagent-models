# cc-subagent-models

If you run Claude Code through a gateway like 9Router, LiteLLM, or OpenRouter, you already have access to dozens of models. The problem is that Claude Code's built-in `Agent` tool won't let you use them for subagents.

Inside Claude Code, the `model` field on the `Agent` tool is locked to a hardcoded Zod enum (`["sonnet", "opus", "haiku"]` or `["sonnet", "opus", "haiku", "fable"]`). Even if you bypass the schema, the internal model resolver checks the string against an allowlist and drops unknown model IDs right back to the parent session model.

`cc-subagent-models` patches Claude Code once so the lead model can pick any model on your gateway per subagent call. You can send file searches to a fast free Qwen model, unit tests to GLM, and hard debugging to DeepSeek Reasoner without changing your main session model.

```bash
npx cc-subagent-models sync --gateway http://localhost:20128/v1/models
npx cc-subagent-models patch --mode free
```

---

## How it works

Instead of baking a static model list into `cli.js`, the patcher injects a small runtime helper (`globalThis.__ccSubagentModelSchema`) and rewrites the subagent model resolver to pass non-Anthropic model strings straight through to `req.body.model`.

Every time you start `claude`, that helper reads `~/.claude/subagent-models.json` on the fly. When you add a provider in 9Router or edit your routing hints, you do not need to re-patch Claude Code. The next session picks up the new list automatically.

It works on both installation formats:
1. Standard npm `cli.js` bundles (`@anthropic-ai/claude-code`).
2. Bun-compiled native binaries (`~/.local/bin/claude` or `claude.exe`) when `tweakcc` (`node-lief`) is present in your local cache.

Before writing anything, the patcher saves a `.cc-backup` copy of your installation and runs `node --check` on JS bundles. If the syntax check fails, it restores the backup immediately.

---

## Quick start

### 1. Curate your subagent models (or sync from your gateway)

If your gateway has 3,000+ models, dumping all of them into the `Agent` tool description will just bloat your prompt tokens. Curating 3 to 6 models with clear routing hints works best:

```bash
npx cc-subagent-models add "iflow/qwen3-coder-plus" --hint "Fast, free coder for file search, grep, and boilerplate"
npx cc-subagent-models add "glm/glm-4.5" --hint "Standard refactoring and unit tests"
npx cc-subagent-models add "deepseek/deepseek-reasoner" --hint "Complex debugging and algorithmic reasoning"
```

Or pull straight from a `/v1/models` endpoint (defaults to 9Router on port `20128`) with a substring filter:

```bash
npx cc-subagent-models sync --gateway http://localhost:20128/v1/models --filter qwen --auto-hint
```

### 2. Patch Claude Code

```bash
# Default: converts the model schema to z.string() and lists your models in the tool description
npx cc-subagent-models patch --mode free

# Strict: builds z.enum(["sonnet", "opus", "haiku", ...yourModels]) at startup
npx cc-subagent-models patch --mode enum
```

Restart `claude`. Your lead model will now see your configured gateway models and their hints right inside the `Agent` tool definition.

---

## Modes: `free` vs `enum`

In `free` mode, the `model` parameter becomes `z.string().optional()`. The lead model can pass any valid `provider/model-name` string on your gateway, and the models you list in `~/.claude/subagent-models.json` are appended to the parameter description as a routing guide:

```text
Available gateway models you can choose from:
- "iflow/qwen3-coder-plus" (Fast, free coder for file search, grep, and boilerplate)
- "glm/glm-4.5" (Standard refactoring and unit tests)
- "deepseek/deepseek-reasoner" (Complex debugging and algorithmic reasoning)
```

In `enum` mode, the parameter becomes `z.enum(["sonnet", "opus", "haiku", ...yourModels]).optional()`. Use this when you want the JSON schema itself to reject any model ID that isn't in your list.

Switch between modes at any time without re-patching by editing `"mode"` in `~/.claude/subagent-models.json` or running `npx cc-subagent-models patch --mode <free|enum>`.

---

## Commands

```text
cc-subagent-models patch [--mode free|enum] [--cli-path <path>] [--dry-run] [--convert-to-npm [version]]
cc-subagent-models sync [--gateway <url>] [--api-key <key>] [--filter <substring>] [--auto-hint]
cc-subagent-models add <model-id> [--hint <description>]
cc-subagent-models remove <model-id>
cc-subagent-models status [--cli-path <path>]
cc-subagent-models restore [--cli-path <path>]
cc-subagent-models watch [--cli-path <path>]
```

- `patch --dry-run` runs the regex transforms and `node --check` against a temporary copy without touching your installation.
- `restore` copies `cli.js.cc-backup` (or `claude.exe.cc-backup`) back over the patched file.
- `watch` monitors `cli.js` and re-applies the patch if an auto-update overwrites it.

---

## Config file and environment variables

Config lives at `~/.claude/subagent-models.json`:

```json
{
  "mode": "free",
  "models": [
    {
      "id": "iflow/qwen3-coder-plus",
      "Hint": "Fast, free coder for file search, grep, and boilerplate"
    },
    {
      "id": "glm/glm-4.5",
      "Hint": "Standard refactoring and unit tests"
    },
    {
      "id": "deepseek/deepseek-reasoner",
      "Hint": "Complex debugging and algorithmic reasoning"
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
