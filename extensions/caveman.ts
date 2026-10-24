// pi-caveman — pi & oh-my-pi extension
//
// Caveman mode for pi & oh-my-pi: auto-activates per session, /caveman commands,
// per-turn reinforcement injection.
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

// ── Constants & Canonical Mode Mapping ─────────────────────────────────────

export const VALID_MODES = ["caveman", "ultracave", "megacave"] as const;
export type Mode = (typeof VALID_MODES)[number];

export const LEGACY_MODE_MAP: Record<string, Mode> = {
  "full": "caveman",
  "lite": "caveman",
  "ultra": "ultracave",
  "wenyan": "megacave",
  "wenyan-lite": "megacave",
  "wenyan-full": "megacave",
  "wenyan-ultra": "megacave",
};

export function canonicalMode(raw: string): Mode | null {
  const lower = raw.trim().toLowerCase();
  if ((VALID_MODES as readonly string[]).includes(lower)) return lower as Mode;
  return LEGACY_MODE_MAP[lower] ?? null;
}

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

export const COMPRESSION_RATIOS: Record<string, number> = {
  caveman: 0.65,
  ultracave: 0.75,
  megacave: 0.80,
  // legacy aliases for backwards compatibility
  full: 0.65,
  lite: 0.35,
  ultra: 0.75,
  wenyan: 0.80,
  "wenyan-lite": 0.60,
  "wenyan-full": 0.80,
  "wenyan-ultra": 0.85,
};

export function estimateSavings(outputTokens: number, mode: string) {
  const canon = canonicalMode(mode) || mode;
  const ratio = COMPRESSION_RATIOS[canon] ?? COMPRESSION_RATIOS[mode];
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
const CYAN = `${ESC}36m`;
const GRAY = `${ESC}90m`;

export function modeColor(mode: string): string {
  if (mode === "off") return GRAY;
  if (mode === "megacave" || mode.startsWith("wenyan")) return CYAN;
  return GREEN; // caveman, ultracave, full, ultra
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

export function resolveHostDir(): string {
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

export function getFlagPath(): string {
  return join(resolveHostDir(), ".caveman-active");
}

// ── Config resolution (mirrors caveman/src/hooks/caveman-config.js) ─────────

export function cavemanConfigDir(): string {
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

export function findRepoConfig(start: string): string | null {
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

export function readConfigMode(configPath: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf-8"));
    const m = parsed?.defaultMode;
    return typeof m === "string" ? m : null;
  } catch {
    return null;
  }
}

export function resolveDefault(): Mode | "off" {
  // 1. Env var (short-circuits)
  const env = process.env.CAVEMAN_DEFAULT_MODE;
  if (env) {
    const lower = env.toLowerCase();
    if (lower === "off") return "off";
    const canon = canonicalMode(lower);
    if (canon) return canon;
  }
  // 2. Repo-local config
  const repo = findRepoConfig(process.cwd());
  if (repo) {
    const m = readConfigMode(repo);
    if (m) {
      const lower = m.toLowerCase();
      if (lower === "off") return "off";
      const canon = canonicalMode(lower);
      if (canon) return canon;
    }
  }
  // 3. User config
  const user = join(cavemanConfigDir(), "config.json");
  if (existsSync(user)) {
    const m = readConfigMode(user);
    if (m) {
      const lower = m.toLowerCase();
      if (lower === "off") return "off";
      const canon = canonicalMode(lower);
      if (canon) return canon;
    }
  }
  // 4. Default
  return "caveman";
}

// ── Flag I/O ────────────────────────────────────────────────────────────────

export function readFlag(): Mode | null {
  const flagPath = getFlagPath();
  try {
    if (existsSync(flagPath)) {
      const content = readFileSync(flagPath, "utf-8").trim();
      return canonicalMode(content);
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
      return canonicalMode(content);
    }
  } catch {}

  return null;
}

export function writeFlag(mode: Mode): void {
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

export function deleteFlag(): void {
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

function logModeChange(newMode: Mode | null): void {
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

export function saveUserConfigMode(mode: string): void {
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

export function applyMode(mode: Mode | "off"): void {
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
  ui.ui.notify(`caveman: ${mode}`, "info");
  ui.ui.setStatus?.("caveman", undefined);
}

function clearStatus(ui: UI): void {
  if (!ui.hasUI) return;
  ui.ui.setStatus?.("caveman", undefined);
  ui.ui.notify("caveman: off", "info");
}

// ── SKILL.md and Thesis loading (mirrors caveman 3.2.0) ─────────────────────

export function findSkillPath(skillId: string): string | null {
  const candidates = [
    join(__dirname, "..", "skills", skillId, "SKILL.md"),
    join(__dirname, "skills", skillId, "SKILL.md"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function loadSkillContent(mode: Mode): string | null {
  const skillPath = findSkillPath(mode);
  if (!skillPath) return null;
  try {
    const raw = readFileSync(skillPath, "utf-8");
    return raw.replace(/^---[\s\S]*?---\s*/, "");
  } catch {
    return null;
  }
}

export const FALLBACK_THESIS: Record<Mode, string> = {
  caveman: "Respond terse like smart caveman. All technical substance stay. Only fluff die.",
  ultracave: "Respond terse like smart caveman. All technical substance stay. Only fluff die. Then cut again.",
  megacave: "以文言答。技術之實皆存，唯贅言去之。",
};

export function getThesisLine(mode: Mode): string {
  const skillPath = findSkillPath(mode);
  if (skillPath) {
    try {
      const raw = readFileSync(skillPath, "utf-8");
      const body = raw.replace(/^---[\s\S]*?---\s*/, "");
      const lines = body.split("\n");
      const titleIndex = lines.findIndex((l) => l.trim().startsWith("# "));
      if (titleIndex !== -1) {
        for (let i = titleIndex + 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line) return line;
        }
      }
    } catch {}
  }
  return FALLBACK_THESIS[mode] ?? FALLBACK_THESIS.caveman;
}

export function reinforcementLine(mode: Mode): string {
  const thesis = getThesisLine(mode);
  return (
    `CAVEMAN MODE ACTIVE (${mode}). ${thesis} ` +
    "Answer only what was asked: no unrequested background, lists, examples, walkthroughs, or follow-up offers; " +
    "give code, steps, or warnings when the task needs them. " +
    "Security warnings, irreversible actions, multi-step order: normal prose. " +
    "Technical terms, code, commands, paths, and errors stay exact."
  );
}

// ── Mode parsing (mirrors caveman hooks/caveman-parse.js) ───────────────────

const QUOTED_SPAN_REGEX = /(["`])(?:(?!\1).)*\1/g;

export function normalizeModeArg(arg: string): string {
  return (arg || "").replace(/^[^a-z0-9]+/, "").replace(/[^a-z0-9-]+$/, "");
}

export interface ModeResolution {
  action: "set" | "clear" | "status" | "unresolved";
  mode?: Mode;
}

export function resolveModeArg(rawArg: string, getDefault: () => Mode | "off"): ModeResolution {
  const arg = normalizeModeArg(rawArg);
  if (!arg) {
    if (rawArg) return { action: "unresolved" };
    const def = getDefault();
    return def === "off" ? { action: "clear" } : { action: "set", mode: def };
  }
  if (arg === "off" || arg === "stop" || arg === "disable") return { action: "clear" };
  if (arg === "status") return { action: "status" };
  const canon = canonicalMode(arg);
  if (canon) return { action: "set", mode: canon };
  return { action: "unresolved" };
}

// Whitelist gap between activation verb and "caveman" to prevent false positives
const ACTIVATION_VERBS = "(?:activate|enable|start|turn on|use|switch to|want|give me)";
const ACTIVATION_GAP = "(?:\\s+(?:the|to|into|on|in|please|now|it|me|my|this|that|mode))*";
const ACTIVATION_VERB_PHRASE = new RegExp(
  "\\b" + ACTIVATION_VERBS + "\\b" + ACTIVATION_GAP + "\\s+caveman\\b"
);
const ACTIVATION_TALK_LIKE = /\btalk\s+like\s+(?:a\s+|an\s+|the\s+)?caveman\b/;

// Negation guard: "don't activate caveman" must not activate caveman
const NEGATOR = /\b(?:don['’]?t|do not|doesn['’]?t|does not|won['’]?t|will not|never|no need to|rather not)\b/;
const CLAUSE_BOUNDARY = /[.;!?,:—–]|\s-+\s|\bbut\b|\bthen\b/g;

export function negatedBefore(text: string, index: number): boolean {
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

export function wantsActivation(text: string): boolean {
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

export function parseModeChange(promptRaw: string): Mode | "off" | null {
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

    // Direct invocation keywords
    const ultraIdx = nlPrompt.search(/\bultracave\b/);
    if (ultraIdx !== -1 && !negatedBefore(nlPrompt, ultraIdx)) {
      return "ultracave";
    }
    const megaIdx = nlPrompt.search(/\bmegacave\b/);
    if (megaIdx !== -1 && !negatedBefore(nlPrompt, megaIdx)) {
      return "megacave";
    }

    // Natural-language activation (exclude questions)
    const isQuestion =
      /^(what|whats|what's|how|why|when|where|who|does|do|did|is|are|can|could|would|should|tell me|explain)\b/.test(nlPrompt);

    if (!isQuestion && wantsActivation(nlPrompt)) {
      const def = resolveDefault();
      return def !== "off" ? def : null;
    }
  }

  // Slash commands
  if (prompt.startsWith("/")) {
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

// ── Argument completions ────────────────────────────────────────────────────

const MODE_CHOICES = [
  { value: "caveman",   label: "caveman",   description: "smart caveman voice (default)" },
  { value: "ultracave", label: "ultracave", description: "maximum compression, grammar stripped" },
  { value: "megacave",  label: "megacave",  description: "Classical Chinese (文言文)" },
  { value: "status",    label: "status",    description: "show current mode and stats" },
  { value: "off",       label: "off",       description: "disabled" },
];

function getModeCompletions(prefix: string) {
  const lower = prefix.toLowerCase();
  const matches = MODE_CHOICES.filter(m =>
    m.value.startsWith(lower) || m.label.startsWith(lower)
  );
  return matches.length > 0 ? matches : null;
}

// ── Status display ──────────────────────────────────────────────────────────

function displayStatus(
  pi: ExtensionAPI,
  ctx: { hasUI: boolean; ui: { notify(msg: string, level?: "info" | "warning" | "error"): void } },
): void {
  const active = readFlag();
  const def = resolveDefault();
  const configPath = join(cavemanConfigDir(), "config.json");
  const repoConfig = findRepoConfig(process.cwd());
  const mode = active || "off";

  const mc = modeColor(mode);

  const lines: string[] = [
    `${BOLD}Caveman${RST}: ${mc}${mode}${RST}${def !== mode ? ` ${DIM}(default: ${def})${RST}` : ""}`,
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
    customType: "caveman-status",
    content: msg,
    display: false,
  }, { triggerTurn: false });
}

// ── Extension factory ───────────────────────────────────────────────────────

function isContinuationReason(reason: string | undefined): boolean {
  return reason === "resume" || reason === "reload" || reason === "fork";
}

export default function cavemanExtension(pi: ExtensionAPI) {
  let lastInjectedMode: Mode | null = null;

  const resetSessionState = (): void => {
    sessionStats = { turns: 0, outputTokens: 0, cacheReadTokens: 0, inputTokens: 0 };
    sessionExplicitOff = false;
    lastInjectedMode = null;
  };

  const activateSession = (ctx: UI): void => {
    let mode = readFlag();
    if (!mode && !sessionExplicitOff) {
      const def = resolveDefault();
      if (def !== "off") mode = def;
    }
    if (!mode || (mode as string) === "off") {
      deleteFlag();
      clearStatus(ctx);
      return;
    }
    applyMode(mode);
    notifyMode(ctx, mode);
  };

  // ── session boundaries: auto-activate ──────────────────────────────────
  // pi reports lifecycle through session_start with a reason (startup|new|
  // reload|resume|fork). oh-my-pi fires session_start only on initial load
  // and reports mid-process switches as a separate session_switch event with
  // a reason (new|resume|fork); pi never dispatches that event, so the extra
  // registration is a no-op there. Its name is absent from ExtensionAPI's
  // strict on() overloads, hence the loose typing.
  const onSessionEvent = (pi as unknown as {
    on: (event: string, handler: (event: unknown, ctx: UI) => Promise<void>) => unknown;
  }).on;

  const handleSessionBoundary = async (event: unknown, ctx: UI): Promise<void> => {
    const e = event as Record<string, unknown> | undefined;
    if (!isContinuationReason(e?.reason as string | undefined)) resetSessionState();
    activateSession(ctx);
  };

  onSessionEvent("session_start", handleSessionBoundary);
  onSessionEvent("session_switch", handleSessionBoundary);

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
    description: "Switch and persist caveman mode (caveman|ultracave|megacave|status|off)",
    getArgumentCompletions: (prefix) => getModeCompletions(prefix),
    handler: async (args, ctx) => {
      const rawArg = (args || "").trim();

      // Bare /caveman -> activate default and persist
      if (!rawArg) {
        const def = resolveDefault();
        const mode = def === "off" ? "caveman" : def;
        sessionExplicitOff = false;
        lastInjectedMode = null;
        applyMode(mode);
        saveUserConfigMode(mode);
        notifyMode(ctx, mode);
        return;
      }

      const res = resolveModeArg(rawArg, resolveDefault);

      if (res.action === "status") {
        displayStatus(pi, ctx);
        return;
      }

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
          `unknown mode "${rawArg}". Use: caveman|ultracave|megacave|status|off`,
          "warning",
        );
      }
    },
  });

  // ── /caveman-status command ────────────────────────────────────────────
  pi.registerCommand("caveman-status", {
    description: "Show current caveman mode and config",
    handler: async (_args, ctx) => {
      displayStatus(pi, ctx);
    },
  });

  // ── before_agent_start: per-turn reinforcement ────────────────────────
  // Injects full SKILL.md content on activation / mode-switch.
  // Subsequent continuing turns use a lightweight single-line reminder to preserve tokens & prompt cache.
  pi.on("before_agent_start", async (_event, _ctx) => {
    let active = readFlag();
    if (!active && !sessionExplicitOff) {
      const def = resolveDefault();
      if (def !== "off") active = def;
    }
    if (!active || (active as string) === "off") {
      lastInjectedMode = null;
      return null;
    }

    const modeChanged = active !== lastInjectedMode;
    lastInjectedMode = active;

    let content: string;
    if (modeChanged) {
      const skillContent = loadSkillContent(active);
      const header = `CAVEMAN MODE ACTIVE — mode: ${active}\n\n`;
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
