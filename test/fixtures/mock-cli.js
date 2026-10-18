// Sanitized realistic minified snippets extracted from @anthropic-ai/claude-code cli.js across versions (v2.1.112 and v2.1.289)

export const MOCK_CLI_V2_1_112 = `#!/usr/bin/env node
// Version: 2.1.112
import { createRequire as vP5 } from "node:module";

function createMockZod() {
  const makeField = (type, extra = {}) => {
    const obj = {
      type,
      ...extra,
      optional() {
        return makeField(type, { ...extra, isOptional: true, description: this.description });
      },
      describe(desc) {
        return makeField(type, { ...extra, isOptional: this.isOptional, description: desc });
      },
    };
    return obj;
  };
  return {
    object: (shape) => ({ type: "object", shape }),
    string: () => makeField("string"),
    boolean: () => makeField("boolean"),
    enum: (values) => makeField("enum", { values }),
  };
}

const y = createMockZod();
const C6 = (fn) => fn;
const r4o = "A short (3-5 word) description of the task";
const n4o = "The task for the agent to perform";

// Agent tool schema (Zod member style, v2.1.112)
export const VKY = C6(() => y.object({
  description: y.string().describe("A short (3-5 word) description of the task"),
  prompt: y.string().describe("The task for the agent to perform"),
  subagent_type: y.string().optional().describe("The type of specialized agent to use for this task"),
  model: y.enum(["sonnet","opus","haiku"]).optional().describe("Optional model override for this agent. Takes precedence over the agent definition's model frontmatter. If omitted, uses the agent definition's model, or inherits from the parent."),
  run_in_background: y.boolean().optional().describe("Set to true to run this agent in the background. You will be notified when it completes.")
}));

// Secondary frontmatter enum occurrence
export const FrontmatterModelSchema = y.enum(["sonnet","opus","haiku","inherit"]);

// Internal Model Alias Resolver (v2.1.112 style)
const Yw6 = ["sonnet","opus","haiku","best","sonnet[1m]","opus[1m]","opusplan"];
function Go(q) { return Yw6.includes(q); }
function DP(q) { return /\\[1m\\]$/i.test(q); }
function Af() { return process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || "claude-sonnet-4-6"; }
function xT6() { return process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL || "claude-haiku-4-5"; }
function LE() { return process.env.ANTHROPIC_DEFAULT_OPUS_MODEL || "claude-opus-4-7"; }
function BZq() { return LE(); }
function KA() { return false; }
function xF9() { return false; }
function dZ8() { return false; }
export function K5(q) {
  let K = q.trim(), _ = K.toLowerCase(), z = DP(_), Y = z ? _.replace(/\\[1m]$/i, "").trim() : _;
  if (Go(Y)) switch (Y) {
    case"opusplan":return Af()+(z?"[1m]":"");
    case"sonnet":return Af()+(z?"[1m]":"");
    case"haiku":return xT6()+(z?"[1m]":"");
    case"opus":return LE()+(z?"[1m]":"");
    case"best":return BZq();
    default:
  }
  if (KA() && xF9(Y) && dZ8()) return LE() + (z ? "[1m]" : "");
  if (z) return K.replace(/\\[1m\\]$/i, "").trim() + "[1m]";
  return K;
}
function D77() { return "inherit"; }
function tD8() { return false; }
function YM() { return "firstParty"; }
function MT6(a) { return a; }
function HB(opts) { return opts.mainLoopModel; }
function o5(q) { return q.toLowerCase(); }
function YX() { return false; }
function ywK(q) {
  let K = o5(q);
  if (YX() && !DP(q) && (K.includes("opus-4-7") || K.includes("opus-4-6"))) return q + "[1m]";
  return q;
}
function LwK(q, K) {
  let _ = o5(K);
  switch (q.toLowerCase()) {
    case "opus": return _.includes("opus");
    case "sonnet": return _.includes("sonnet");
    case "haiku": return _.includes("haiku");
    default: return !1;
  }
}
export function BC6(q, K, _, z) {
  if(process.env.CLAUDE_CODE_SUBAGENT_MODEL)return K5(process.env.CLAUDE_CODE_SUBAGENT_MODEL);
  let Y = tD8(K), A = ($, j) => {
    if (Y && YM($) === "bedrock") {
      if (tD8(j)) return $;
      return MT6($, Y);
    }
    return $;
  };
  if (_) {
    if (LwK(_, K)) return K;
    let $ = ywK(K5(_));
    return A($, _);
  }
  let O = q ?? D77();
  if (O === "inherit") return HB({ permissionMode: z ?? "default", mainLoopModel: K, exceeds200kTokens: !1 });
  if (LwK(O, K)) return K;
  let w = ywK(K5(O));
  return A(w, O);
}
`;

export const MOCK_CLI_V2_1_289 = `#!/usr/bin/env node
// Version: 2.1.289
import { createRequire as __existingReq } from "node:module";

function makeZodNode(type, extra = {}) {
  return {
    type,
    ...extra,
    optional() {
      return makeZodNode(type, { ...extra, isOptional: true, description: this.description });
    },
    describe(desc) {
      return makeZodNode(type, { ...extra, isOptional: this.isOptional, description: desc });
    },
  };
}
const u = (shape) => ({ type: "object", shape });
const o = () => makeZodNode("string");
const M = () => makeZodNode("boolean");
const j = (values) => makeZodNode("enum", { values });
const f = (fn) => fn;
const r4o = "A short (3-5 word) description of the task";
const n4o = "The task for the agent to perform";
const Ca = () => false;
const a = {
  CLAUDE_CODE_COORDINATOR_FORCE_WORKER_INHERIT_MODEL: false,
  CLAUDE_CODE_SUBAGENT_MODEL: undefined,
  CLAUDE_CODE_SUBAGENT_MODEL_FORCE: false,
  ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-5-5",
  ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-5-5",
  ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-4-5",
  ANTHROPIC_DEFAULT_FABLE_MODEL: "claude-fable-5-1",
};

// Agent tool schema (Standalone Zod v4 functions, v2.1.289)
export var Bo=f(()=>u({description:o().describe(r4o),prompt:o().describe(n4o),subagent_type:o().optional().describe("The type of specialized agent to use for this task"),model:j(["sonnet","opus","haiku","fable"]).optional().describe(\`Optional model override for this agent. Takes precedence over the agent definition's model frontmatter and the configured default subagent model. If omitted, uses the agent definition's model, else the default (inherits from the parent unless a default subagent model is configured). Ignored for subagent_type: "fork" \\u2014 forks always inherit the parent model.\`+(Ca()?a.CLAUDE_CODE_COORDINATOR_FORCE_WORKER_INHERIT_MODEL?" Unavailable on this session: this parameter is ignored \\u2014 do not set it.":" Set this only when EXPLICITLY asked by the user for a specific model, never because the task seems small, simple, or cheap; otherwise omit it so the worker uses the default (the session model, unless a default subagent model is configured).":"")),run_in_background:M().optional().describe("Agents run in the background by default; you will be notified when one completes.")}));

// v2.1.289 Subagent Model Resolver (vH) with strict allowlist Ur(E) that rejects gateway models unless patched
function Xf(opts) { return opts.mainLoopModel; }
function Cbt() { return false; }
function gc() { return "firstParty"; }
function rOe(e) { return e; }
function Ble() { let e = a.CLAUDE_CODE_SUBAGENT_MODEL; return e && e !== "inherit" ? e : "inherit"; }
function Tt(e) {
  const map = { sonnet: a.ANTHROPIC_DEFAULT_SONNET_MODEL, opus: a.ANTHROPIC_DEFAULT_OPUS_MODEL, haiku: a.ANTHROPIC_DEFAULT_HAIKU_MODEL, fable: a.ANTHROPIC_DEFAULT_FABLE_MODEL };
  return map[e.trim().toLowerCase()] || e.trim();
}
// Simulate organization availableModels allowlist that only allows Anthropic models
function Ur(e) { return e.startsWith("claude-"); }
function cv(e) { return null; }
function Fa(e, s) {}
function en(e) { return e; }
function aT(e) { return e; }
export function At(e) { return e.replace(/\\[1m\\]$/i, ""); }
export function kd(e) { return e.replace(/\\[(1|2)m\\]/gi, ""); }
function KE(e) { return /\\[1m\\]/i.test(e); }
const cTr = 200000;
export function U4u(e,t){if(KE(e))return 1e6;return cTr}
function Bs(e, s) { return [e, s]; }
function X$n(e, s) { return false; }

export function vH(e,s,n,r,g){let h=()=>Xf({permissionMode:r??"default",mainLoopModel:s,exceeds200kTokens:!1}),T=Cbt(s),S=(E,O)=>{if(T&&gc(E)==="bedrock"){if(Cbt(O))return E;return rOe(E,T)}return E},v=()=>{let E=Ble();if(E==="inherit")return h();let O=S(Tt(E),E);if(Ur(O))return O;return cv(E)??h()},w=(E,O,F=E)=>{let K=cv(E);Fa(E,K!==null);let L=K!==null?O?en(aT(K)):K:v();if(At(Tt(F)).toLowerCase()!==At(Tt(L)).toLowerCase())g?.(E,L,K!==null?"family_step_down":"parent_inherit");return L};if([e,n]=Bs(e,n),n){if(n==="inherit")return h();if(X$n(n,s))return s;let E=S(en(Tt(n)),n);if(!Ur(E))return w(n,!0,E);return E}if(e!==void 0&&e!=="inherit"){if(X$n(e,s))return s;let E=S(en(Tt(e)),e);if(!Ur(E))return w(e,!0,E);return E}if(e==="inherit")return h();let D=Ble();if(D==="inherit")return h();let z=S(Tt(D),D);if(!Ur(z))return w(D,!1);return z}
`;
