// pi-caveman — pi & oh-my-pi extension
//
// Caveman mode for pi & oh-my-pi: auto-activates per session, /caveman commands,
// per-turn reinforcement injection, status bar integration.
//
// Flag file: ~/.pi/.caveman-active or ~/.omp/.caveman-active
// Config: ~/.config/caveman/config.json or CAVEMAN_DEFAULT_MODE env
// Upstream: https://github.com/JuliusBrussee/caveman

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  existsSync, mkdirSync, readFileSync,
  writeFileSync, unlinkSync, appendFileSync, renameSync,
} from "node:fs";
import { join, dirname, sep } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Constants ───────────────────────────────────────────────────────────────

const VALID_MODES = [
  "lite", "full", "ultra",
  "wenyan-lite", "wenyan", "wenyan-full", "wenyan-ultra",
] as const;

type Mode = (typeof VALID_MODES)[number];

// ── Session stats ───────────────────────────────────────────────────────────

interface SessionStats {
  turns: number;
  outputTokens: number;
  cacheReadTokens: number;
  inputTokens: number;
}

let sessionStats: SessionStats = {
  turns: 0, outputTokens: 0, cacheReadTokens: 0, inputTokens: 0,
};

let sessionExplicitOff = false;

const COMPRESSION_RATIOS: Record<string, number> = {
  'full': 0.65,
  'lite': 0.35,
  'ultra': 0.75,
  'wenyan': 0.80,
  'wenyan-lite': 0.60,
  'wenyan-ultra': 0.85,
};

function estimateSavings(outputTokens: number, mode: string) {
  const ratio = COMPRESSION_RATIOS[mode];
  if (!ratio) return null;
  const estWithout = Math.round(outputTokens / (1 - ratio));
  const estSaved = estWithout - outputTokens;
  return { estWithout, estSaved, pct: Math.round(ratio * 100) };
}

// ── Display helpers ────────────────────────────────────────────────────────

const ESC = "\x1b[";
const RST = `${ESC}0m`;
const DIM = `${ESC}2m`;
const BOLD = `${ESC}1m`;
const GREEN = `${ESC}32m`;
const YELLOW = `${ESC}33m`;
const RED = `${ESC}31m`;
const CYAN = `${ESC}36m`;
const GRAY = `${ESC}90m`;

function modeColor(mode: string): string {
  if (mode === "off") return GRAY;
  if (mode.startsWith("wenyan")) return CYAN;
  if (mode === "lite") return YELLOW;
  return GREEN; // full, ultra
}

function bar(pct: number, width = 20): string {
  const filled = Math.round((pct / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function truncatePath(p: string, max = 40): string {
  if (p.length <= max) return p;
  const parts = p.split(sep);
  const tail = parts.slice(-2).join(sep);
  return "…" + sep + tail;
}

// ── Paths & Host Resolution ─────────────────────────────────────────────────

function resolveHostDir(): string {
  const isOmp =
    process.title === "omp" ||
    Boolean(process.env.OMP_PROFILE) ||
    process.env.PI_CONFIG_DIR === ".omp" ||
    Boolean(process.env.OMP_AUTORESEARCH_DB_DIR) ||
    (typeof process.argv[1] === "string" && process.argv[1].includes("@oh-my-pi"));
  const dirName = isOmp ? "omp" : "pi";
  const xdg = process.env.XDG_CONFIG_HOME;
  return xdg ? join(xdg, dirName) : join(homedir(), `.${dirName}`);
}

function getFlagPath(): string {
  return join(resolveHostDir(), ".caveman-active");
}

// ── Config resolution (mirrors caveman/src/hooks/caveman-config.js) ─────────

function cavemanConfigDir(): string {
  const xdgHome = process.env.XDG_CONFIG_HOME;
  if (xdgHome) return join(xdgHome, "caveman");
  if (process.platform === "win32") {
    return join(
      process.env.APPDATA || join(homedir(), "AppData", "Roaming"),
      "caveman",
    );
  }
  return join(homedir(), ".config", "caveman");
}

function findRepoConfig(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 64; i++) {
    const a = join(dir, ".caveman", "config.json");
    if (existsSync(a)) return a;
    const b = join(dir, ".caveman.json");
    if (existsSync(b)) return b;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function readConfigMode(configPath: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf-8"));
    const m = parsed?.defaultMode;
    return typeof m === "string" ? m : null;
  } catch {
    return null;
  }
}

function isValidMode(m: string): m is Mode {
  return (VALID_MODES as readonly string[]).includes(m);
}

function resolveDefault(): string {
  // 1. Env var (short-circuits)
  const env = process.env.CAVEMAN_DEFAULT_MODE;
  if (env) {
    const lower = env.toLowerCase();
    if (isValidMode(lower) || lower === "off") return lower;
  }
  // 2. Repo-local config
  const repo = findRepoConfig(process.cwd());
  if (repo) {
    const m = readConfigMode(repo);
    if (m) {
      const lower = m.toLowerCase();
      if (isValidMode(lower) || lower === "off") return lower;
    }
  }
  // 3. User config
  const user = join(cavemanConfigDir(), "config.json");
  if (existsSync(user)) {
    const m = readConfigMode(user);
    if (m) {
      const lower = m.toLowerCase();
      if (isValidMode(lower) || lower === "off") return lower;
    }
  }
  // 4. Default
  return "full";
}

// ── Flag I/O ────────────────────────────────────────────────────────────────

function readFlag(): string | null {
  const flagPath = getFlagPath();
  try {
    if (existsSync(flagPath)) {
      const content = readFileSync(flagPath, "utf-8").trim();
      return isValidMode(content) ? content : null;
    }
  } catch {}

  // Fallback: cross-host check if running under omp but flag written in ~/.pi (or vice versa)
  try {
    const xdg = process.env.XDG_CONFIG_HOME;
    const fallbackDir = flagPath.includes(".omp")
      ? (xdg ? join(xdg, "pi") : join(homedir(), ".pi"))
      : (xdg ? join(xdg, "omp") : join(homedir(), ".omp"));
    const fallbackPath = join(fallbackDir, ".caveman-active");
    if (existsSync(fallbackPath)) {
      const content = readFileSync(fallbackPath, "utf-8").trim();
      return isValidMode(content) ? content : null;
    }
  } catch {}

  return null;
}

function writeFlag(mode: string): void {
  const flagPath = getFlagPath();
  try {
    const dir = dirname(flagPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${flagPath}.tmp.${process.pid}`;
    writeFileSync(tmp, mode, { mode: 0o600 });
    renameSync(tmp, flagPath);
  } catch {
    // Silent fail — never block session
  }
}

function deleteFlag(): void {
  const flagPath = getFlagPath();
  try { if (existsSync(flagPath)) unlinkSync(flagPath); } catch {}
  try {
    const xdg = process.env.XDG_CONFIG_HOME;
    const fallbackDir = flagPath.includes(".omp")
      ? (xdg ? join(xdg, "pi") : join(homedir(), ".pi"))
      : (xdg ? join(xdg, "omp") : join(homedir(), ".omp"));
    const fallbackPath = join(fallbackDir, ".caveman-active");
    if (existsSync(fallbackPath)) unlinkSync(fallbackPath);
  } catch {}
}

function logModeChange(newMode: string | null): void {
  try {
    const prev = readFlag();
    if (prev === newMode) return;
    const dir = dirname(getFlagPath());
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const entry = JSON.stringify({
      ts: new Date().toISOString(), mode: newMode, prev,
    }) + "\n";
    appendFileSync(join(dir, ".caveman-mode-log.jsonl"), entry, { mode: 0o600 });
  } catch {}
}

// ── Mode switching ──────────────────────────────────────────────────────────

function saveUserConfigMode(mode: string): void {
  try {
    const configDir = cavemanConfigDir();
    const cfgPath = join(configDir, "config.json");
    if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
    let existing: Record<string, unknown> = {};
    if (existsSync(cfgPath)) {
      try { existing = JSON.parse(readFileSync(cfgPath, "utf-8")); } catch {}
    }
    existing.defaultMode = mode;
    writeFileSync(cfgPath, JSON.stringify(existing, null, 2) + "\n", { mode: 0o600 });
  } catch {}
}

function applyMode(mode: string | "off"): void {
  if (mode === "off") { logModeChange(null); deleteFlag(); }
  else { logModeChange(mode); writeFlag(mode); }
}

interface UI {
  hasUI: boolean;
  ui: {
    notify(msg: string, level?: "info" | "warning" | "error"): void;
    setStatus?(key: string, text: string | undefined): void;
  };
}

function notifyMode(ui: UI, mode: string): void {
  if (!ui.hasUI) return;
  const label = mode === "wenyan" ? "wenyan-full" : mode;
  ui.ui.notify(`caveman: ${label}`, "info");
  ui.ui.setStatus?.("caveman", `caveman: ${label}`);
}

function clearStatus(ui: UI): void {
  if (!ui.hasUI) return;
  ui.ui.setStatus?.("caveman", undefined);
  ui.ui.notify("caveman: off", "info");
}

// ── Mode parsing (mirrors caveman hooks/caveman-parse.js) ───────────────────

const QUOTED_SPAN_REGEX = /(["`])(?:(?!\1).)*\1/g;

function normalizeModeArg(arg: string): string {
  return (arg || "").replace(/^[^a-z0-9]+/, "").replace(/[^a-z0-9-]+$/, "");
}

interface ModeResolution {
  action: "set" | "clear" | "unresolved";
  mode?: string;
}

function resolveModeArg(rawArg: string, getDefault: () => string): ModeResolution {
  const arg = normalizeModeArg(rawArg);
  if (!arg) {
    if (rawArg) return { action: "unresolved" };
    const mode = getDefault();
    return mode === "off" ? { action: "clear" } : { action: "set", mode };
  }
  if (arg === "off" || arg === "stop" || arg === "disable") return { action: "clear" };
  if (arg === "wenyan-full") return { action: "set", mode: "wenyan" };
  if (isValidMode(arg)) return { action: "set", mode: arg };
  return { action: "unresolved" };
}

// Whitelist gap between activation verb and "caveman" to prevent false positives
// on ordinary prose like "i want to start building a caveman-themed game" (#187)
const ACTIVATION_VERBS = "(?:activate|enable|start|turn on|use|switch to|want|give me)";
const ACTIVATION_GAP = "(?:\\s+(?:the|to|into|on|in|please|now|it|me|my|this|that|mode))*";
const ACTIVATION_VERB_PHRASE = new RegExp(
  "\\b" + ACTIVATION_VERBS + "\\b" + ACTIVATION_GAP + "\\s+caveman\\b"
);
const ACTIVATION_TALK_LIKE = /\btalk\s+like\s+(?:a\s+|an\s+|the\s+)?caveman\b/;

// Negation guard: "don't activate caveman" must not activate caveman
const NEGATOR = /\b(?:don['’]?t|do not|doesn['’]?t|does not|won['’]?t|will not|never|no need to|rather not)\b/;
const CLAUSE_BOUNDARY = /[.;!?,:—–]|\s-+\s|\bbut\b|\bthen\b/g;

function negatedBefore(text: string, index: number): boolean {
  CLAUSE_BOUNDARY.lastIndex = 0;
  let clauseStart = 0;
  let m: RegExpExecArray | null;
  while ((m = CLAUSE_BOUNDARY.exec(text)) !== null) {
    if (m.index >= index) break;
    clauseStart = m.index + m[0].length;
  }
  return NEGATOR.test(text.slice(clauseStart, index));
}

const BREVITY_TRIGGER = /\b(less tokens|fewer tokens|be brief|be terse|shorter answers)\b(?!\s+(in|for|on|about|when|during|with)\b)/;

const ACTIVATION_TRIGGERS: RegExp[] = [
  ACTIVATION_VERB_PHRASE,
  ACTIVATION_TALK_LIKE,
  /\bcaveman\s+mode\s+(on|please|now)\b/,
  /^caveman(\s+mode)?\s*[.!]*$/,
  BREVITY_TRIGGER,
].map((re) => new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"));

function wantsActivation(text: string): boolean {
  for (const re of ACTIVATION_TRIGGERS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (!negatedBefore(text, m.index)) return true;
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  return false;
}

function parseModeChange(promptRaw: string): string | "off" | null {
  let prompt = (promptRaw || "").trim();
  if (!prompt) return null;

  const collapsed = prompt.toLowerCase().replace(/\s+/g, " ");
  const naturalLanguage = !prompt.startsWith("/");
  const nlPrompt = naturalLanguage ? collapsed.replace(QUOTED_SPAN_REGEX, " ") : "";

  // Natural-language deactivation (checked first)
  if (naturalLanguage) {
    const wantsOff =
      /\b(stop|disable|deactivate|quit|exit|kill)\s+(the\s+)?caveman\b/.test(nlPrompt) ||
      /\bcaveman(\s+mode)?\s+(off|stop|disabled?)\b/.test(nlPrompt) ||
      /\bturn\s+off\s+(the\s+)?caveman\b/.test(nlPrompt) ||
      /^(please\s+)?(go\s+|back\s+to\s+|switch\s+(back\s+)?to\s+|return\s+to\s+)?normal\s+mode\b/.test(nlPrompt) ||
      (/\bnormal\s+mode\b/.test(nlPrompt) && /\bcaveman\b/.test(nlPrompt));

    if (wantsOff) return "off";

    // Natural-language activation (exclude questions)
    const isQuestion =
      /^(what|whats|what's|how|why|when|where|who|does|do|did|is|are|can|could|would|should|tell me|explain)\b/.test(nlPrompt);

    if (!isQuestion && wantsActivation(nlPrompt)) {
      const mode = resolveDefault();
      return mode !== "off" ? mode : null;
    }
  }

  // Slash-command (support bare and namespaced /caveman:<cmd>)
  if (prompt.startsWith("/caveman")) {
    const parts = prompt.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const rawArg = parts[1] || "";

    if (cmd === "/caveman" || cmd === "/caveman:caveman") {
      const res = resolveModeArg(rawArg, resolveDefault);
      if (res.action === "set" && res.mode) return res.mode;
      if (res.action === "clear") return "off";
      return null;
    }
  }

  return null;
}

// ── SKILL.md loading (mirrors caveman-activate.js) ──────────────────────────

// Resolve SKILL.md path — try relative to this extension file first, then skills dir
const SKILL_CANDIDATES = [
  join(__dirname, "..", "skills", "caveman", "SKILL.md"),
  join(__dirname, "skills", "caveman", "SKILL.md"),
];

function findSkillPath(): string | null {
  for (const candidate of SKILL_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// Load and filter SKILL.md content for the active mode.
// Mirrors caveman-activate.js: strips frontmatter, keeps only the active
// level's table row and example lines.
function loadFilteredSkillContent(mode: string): string | null {
  const skillPath = findSkillPath();
  if (!skillPath) return null;

  try {
    const raw = readFileSync(skillPath, "utf-8");
    // Strip YAML frontmatter
    const body = raw.replace(/^---[\s\S]*?---\s*/, "");
    const modeLabel = mode === "wenyan" ? "wenyan-full" : mode;

    // Filter: keep header rows + only the active level's row
    const filtered = body.split("\n").reduce<string[]>((acc, line) => {
      // Intensity table rows start with | **level** |
      const tableRowMatch = line.match(/^\|\s*\*\*(\S+?)\*\*\s*\|/);
      if (tableRowMatch) {
        if (tableRowMatch[1] === modeLabel) acc.push(line);
        return acc;
      }
      // Example lines start with "- level:"
      const exampleMatch = line.match(/^- (\S+?):\s/);
      if (exampleMatch) {
        if (exampleMatch[1] === modeLabel) acc.push(line);
        return acc;
      }
      acc.push(line);
      return acc;
    }, []);

    return filtered.join("\n");
  } catch {
    return null;
  }
}

// ── Reinforcement line ──────────────────────────────────────────────────────

function reinforcementLine(mode: string): string {
  const label = mode === "wenyan" ? "wenyan-full" : mode;
  const wenyanHint = mode.startsWith("wenyan")
    ? " MUST respond in 文言文 (classical Chinese). Use classical particles (之/乃/為/其), omit subjects, verbs precede objects."
    : "";
  return (
    `[CAVEMAN ACTIVE — intensity: ${label}.${wenyanHint} ` +
    "Respond terse like smart caveman. All technical substance stay. " +
    "Only fluff die. Fragments OK. Short synonyms. " +
    "No filler/hedging/pleasantries. Code unchanged. Technical terms exact.]"
  );
}

// ── Argument completions ────────────────────────────────────────────────────

const MODE_CHOICES = [
  { value: "lite",        label: "lite",        description: "no filler/hedging, keep articles" },
  { value: "full",        label: "full",        description: "drop articles, fragments OK (default)" },
  { value: "ultra",       label: "ultra",       description: "one word when one word enough" },
  { value: "wenyan-lite", label: "wenyan-lite", description: "semi-classical, keep grammar" },
  { value: "wenyan",      label: "wenyan",      description: "maximum classical terseness (文言文)" },
  { value: "wenyan-ultra",label: "wenyan-ultra", description: "extreme abbreviation, classical feel" },
  { value: "off",         label: "off",         description: "disabled" },
];

function getModeCompletions(prefix: string) {
  const lower = prefix.toLowerCase();
  const matches = MODE_CHOICES.filter(m =>
    m.value.startsWith(lower) || m.label.startsWith(lower)
  );
  return matches.length > 0 ? matches : null;
}

// ── Extension factory ───────────────────────────────────────────────────────

export default function cavemanExtension(pi: ExtensionAPI) {
  let lastInjectedMode: string | null = null;

  // ── session_start: auto-activate ──────────────────────────────────────
  pi.on("session_start", async (event, ctx) => {
    const e = event as Record<string, unknown> | undefined;
    const reason = e?.reason as string | undefined;
    const isContinuation = reason === "resume" || reason === "reload" || reason === "fork";
    if (!isContinuation) {
      sessionStats = { turns: 0, outputTokens: 0, cacheReadTokens: 0, inputTokens: 0 };
      sessionExplicitOff = false;
      lastInjectedMode = null;
    }

    let mode = readFlag();
    if (!mode && !sessionExplicitOff) mode = resolveDefault();
    if (!mode || mode === "off") {
      deleteFlag();
      clearStatus(ctx);
      return;
    }
    applyMode(mode);
    notifyMode(ctx, mode);
  });

  // ── turn_end: accumulate token stats ─────────────────────────────────
  pi.on("turn_end", (event) => {
    const e = event as unknown as Record<string, unknown>;
    const msg = e?.message as Record<string, unknown> | undefined;
    const usage = msg?.usage as Record<string, number> | undefined;
    if (usage) {
      sessionStats.turns++;
      sessionStats.outputTokens += usage.output ?? 0;
      sessionStats.cacheReadTokens += usage.cacheRead ?? 0;
      sessionStats.inputTokens += usage.input ?? 0;
    }
  });

  // ── /caveman command ──────────────────────────────────────────────────
  pi.registerCommand("caveman", {
    description: "Switch and persist caveman mode (lite|full|ultra|wenyan|off)",
    getArgumentCompletions: (prefix) => getModeCompletions(prefix),
    handler: async (args, ctx) => {
      const rawArg = (args || "").trim().toLowerCase();

      // Bare /caveman -> activate default and persist
      if (!rawArg) {
        const def = resolveDefault();
        const mode = def === "off" ? "full" : def;
        sessionExplicitOff = false;
        lastInjectedMode = null;
        applyMode(mode);
        saveUserConfigMode(mode);
        notifyMode(ctx, mode);
        return;
      }

      const res = resolveModeArg(rawArg, resolveDefault);

      if (res.action === "set" && res.mode) {
        sessionExplicitOff = false;
        lastInjectedMode = null;
        applyMode(res.mode);
        saveUserConfigMode(res.mode);
        notifyMode(ctx, res.mode);
        return;
      }

      if (res.action === "clear") {
        sessionExplicitOff = true;
        lastInjectedMode = null;
        applyMode("off");
        saveUserConfigMode("off");
        clearStatus(ctx);
        return;
      }

      // Unknown
      if (ctx.hasUI) {
        ctx.ui.notify(
          `unknown mode "${rawArg}". Use: lite|full|ultra|wenyan-lite|wenyan|wenyan-ultra|off`,
          "warning",
        );
      }
    },
  });

  // ── /caveman-status command ────────────────────────────────────────────
  pi.registerCommand("caveman-status", {
    description: "Show current caveman mode and config",
    handler: async (_args, ctx) => {
      const active = readFlag();
      const def = resolveDefault();
      const configPath = join(cavemanConfigDir(), "config.json");
      const repoConfig = findRepoConfig(process.cwd());
      const mode = active || "off";

      const mc = modeColor(mode);
      const modeLabel = mode === "wenyan" ? "wenyan-full" : mode;
      const defLabel = def === "wenyan" ? "wenyan-full" : def;

      const lines: string[] = [
        `${BOLD}Caveman${RST}: ${mc}${modeLabel}${RST}${def !== mode ? ` ${DIM}(default: ${defLabel})${RST}` : ""}`,
        "",
        ` ${sessionStats.turns} turns ${DIM}│${RST} ${sessionStats.outputTokens.toLocaleString()} out ${DIM}│${RST} ${sessionStats.cacheReadTokens.toLocaleString()} cached ${DIM}│${RST} ${sessionStats.inputTokens.toLocaleString()} in`,
      ];

      const savings = estimateSavings(sessionStats.outputTokens, mode);
      if (savings && savings.estSaved > 0) {
        lines.push(
          "",
          ` saved ${GREEN}${savings.estSaved.toLocaleString()}${RST} tokens ${DIM}(~${savings.pct}%)${RST}  ${GREEN}${bar(savings.pct)}${RST}`,
        );
      }

      const configLines: string[] = [];
      if (process.env.CAVEMAN_DEFAULT_MODE) {
        configLines.push(` env   ${DIM}CAVEMAN_DEFAULT_MODE=${process.env.CAVEMAN_DEFAULT_MODE}${RST}`);
      }
      if (existsSync(configPath)) configLines.push(` user  ${DIM}${truncatePath(configPath)}${RST}`);
      if (repoConfig) configLines.push(` repo  ${DIM}${truncatePath(repoConfig)}${RST}`);
      configLines.push(` flag  ${DIM}${truncatePath(getFlagPath())}${RST}`);

      if (configLines.length) {
        lines.push("", ...configLines);
      }

      const msg = lines.join("\n");
      if (ctx.hasUI) ctx.ui.notify(msg, "info");
      pi.sendMessage({
        content: msg,
        attribution: "user",
      }, { triggerTurn: false });
    },
  });

  // ── before_agent_start: per-turn reinforcement ────────────────────────
  // Injects full SKILL.md content (filtered to active mode) on activation / level-switch.
  // Subsequent continuing turns use a lightweight single-line reminder to preserve tokens & prompt cache.
  pi.on("before_agent_start", async (_event, _ctx) => {
    let active = readFlag();
    if (!active && !sessionExplicitOff) active = resolveDefault();
    if (!active || active === "off") {
      lastInjectedMode = null;
      return null;
    }

    const modeChanged = active !== lastInjectedMode;
    lastInjectedMode = active;

    let content: string;
    if (modeChanged) {
      const skillContent = loadFilteredSkillContent(active);
      const header = `CAVEMAN MODE ACTIVE — level: ${active === "wenyan" ? "wenyan-full" : active}\n\n`;
      content = skillContent
        ? header + skillContent
        : reinforcementLine(active);
    } else {
      content = reinforcementLine(active);
    }

    return {
      message: {
        customType: "caveman-reinforcement",
        content,
        display: false,
      },
    };
  });

  // ── input: intercept user prompts for mode changes ─────────────────────
  pi.on("input", async (event, _ctx) => {
    if (!event || typeof event !== "object" || !("text" in event)) return;
    const text = event.text;
    if (typeof text !== "string") return;
    const change = parseModeChange(text);
    if (change) {
      if (change === "off") {
        sessionExplicitOff = true;
        lastInjectedMode = null;
      } else {
        sessionExplicitOff = false;
        lastInjectedMode = null;
      }
      applyMode(change);
      saveUserConfigMode(change);
    }
  });
}
