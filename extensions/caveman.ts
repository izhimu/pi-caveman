// pi-caveman — pi extension
//
// Caveman mode for pi: auto-activates per session, /caveman commands,
// per-turn reinforcement injection, status bar integration.
//
// Flag file: ~/.pi/.caveman-active
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
  "commit", "review", "compress",
] as const;

type Mode = (typeof VALID_MODES)[number];

// Modes with independent skills — not caveman intensity levels
const INDEPENDENT: Record<string, true> = {
  commit: true, review: true, compress: true,
};

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

// ── Paths ───────────────────────────────────────────────────────────────────

const xdg = process.env.XDG_CONFIG_HOME;
const piDir = xdg ? join(xdg, "pi") : join(homedir(), ".pi");
const flagPath = join(piDir, ".caveman-active");

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
  try {
    const content = readFileSync(flagPath, "utf-8").trim();
    return isValidMode(content) ? content : null;
  } catch {
    return null;
  }
}

function writeFlag(mode: string): void {
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
  try { if (existsSync(flagPath)) unlinkSync(flagPath); } catch {}
}

function logModeChange(newMode: string | null): void {
  try {
    const prev = readFlag();
    if (prev === newMode) return;
    const dir = dirname(flagPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const entry = JSON.stringify({
      ts: new Date().toISOString(), mode: newMode, prev,
    }) + "\n";
    appendFileSync(join(dir, ".caveman-mode-log.jsonl"), entry, { mode: 0o600 });
  } catch {}
}

// ── Mode switching ──────────────────────────────────────────────────────────

function applyMode(mode: string | "off"): void {
  if (mode === "off") { logModeChange(null); deleteFlag(); }
  else { logModeChange(mode); writeFlag(mode); }
}

interface UI {
  hasUI: boolean;
  ui: {
    notify(msg: string, level: string): void;
  };
}

function notifyMode(ui: UI, mode: string): void {
  if (!ui.hasUI) return;
  const label = mode === "wenyan" ? "wenyan-full" : mode;
  ui.ui.notify(`caveman: ${label}`, "info");
}

function clearStatus(ui: UI): void {
  if (!ui.hasUI) return;
  ui.ui.notify("caveman: off", "info");
}

// ── Mode parsing (mirrors caveman hooks/caveman-parse.js) ───────────────────

function parseModeChange(promptRaw: string): string | "off" | null {
  let prompt = (promptRaw || "").trim();
  if (!prompt) return null;

  prompt = prompt.toLowerCase().replace(/\s+/g, " ");

  // Natural-language deactivation (checked first)
  const wantsOff =
    /\b(stop|disable|deactivate|quit|exit|kill)\s+(the\s+)?caveman\b/.test(prompt) ||
    /\bcaveman(\s+mode)?\s+(off|stop|disabled?)\b/.test(prompt) ||
    /\bturn\s+off\s+(the\s+)?caveman\b/.test(prompt) ||
    /^(please\s+)?(go\s+|back\s+to\s+|switch\s+(back\s+)?to\s+|return\s+to\s+)?normal\s+mode\b/.test(prompt) ||
    (/\bnormal\s+mode\b/.test(prompt) && /\bcaveman\b/.test(prompt));

  if (wantsOff) return "off";

  // Natural-language activation (exclude questions)
  const isQuestion =
    /^(what|whats|what's|how|why|when|where|who|does|do|did|is|are|can|could|would|should|tell me|explain)\b/.test(prompt);

  if (!isQuestion) {
    if (
      /\b(activate|enable|start|turn on|use|switch to|want|give me)\b[^.]{0,40}\bcaveman\b/.test(prompt) ||
      /\btalk like\b[^.]{0,40}\bcaveman\b/.test(prompt) ||
      /\bcaveman\s+mode\s+(on|please|now)\b/.test(prompt) ||
      /^caveman(\s+mode)?\s*[.!]*$/.test(prompt) ||
      /\b(less tokens|fewer tokens|be brief|be terse|shorter answers)\b(?!\s+(in|for|on|about|when|during|with)\b)/.test(prompt)
    ) {
      const mode = resolveDefault();
      return mode !== "off" ? mode : null;
    }
  }

  // Slash-command (support bare and namespaced /caveman:<cmd>)
  if (prompt.startsWith("/caveman")) {
    const parts = prompt.split(/\s+/);
    const cmd = parts[0];
    const arg = parts[1] || "";

    if (cmd === "/caveman-commit" || cmd === "/caveman:caveman-commit")   return "commit";
    if (cmd === "/caveman-review" || cmd === "/caveman:caveman-review")   return "review";
    if (cmd === "/caveman-compress" || cmd === "/caveman:caveman-compress") return "compress";

    if (cmd === "/caveman" || cmd === "/caveman:caveman") {
      if (!arg) {
        const mode = resolveDefault();
        return mode === "off" ? "off" : mode;
      }
      if (arg === "off" || arg === "stop" || arg === "disable") return "off";
      if (arg === "wenyan-full") return "wenyan";
      if (isValidMode(arg) && !INDEPENDENT[arg]) return arg;
      return null; // unknown arg — don't silently overwrite
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
  // ── session_start: auto-activate ──────────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    sessionStats = { turns: 0, outputTokens: 0, cacheReadTokens: 0, inputTokens: 0 };
    sessionExplicitOff = false;
    const mode = resolveDefault();
    if (mode === "off") { deleteFlag(); return; }
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
    description: "Switch caveman mode (lite|full|ultra|wenyan|off)",
    getArgumentCompletions: (prefix) => getModeCompletions(prefix),
    handler: async (args, ctx) => {
      const arg = (args || "").trim().toLowerCase();

      // No arg → activate default
      if (!arg) {
        const mode = resolveDefault();
        if (mode === "off") { deleteFlag(); return; }
        applyMode(mode);
        notifyMode(ctx, mode);
        return;
      }

      // Off
      if (arg === "off" || arg === "stop" || arg === "disable") {
        sessionExplicitOff = true;
        applyMode("off");
        clearStatus(ctx);
        return;
      }

      // Wenyan alias
      if (arg === "wenyan-full") {
        applyMode("wenyan");
        if (ctx.hasUI) {
          ctx.ui.notify("caveman: wenyan-full", "info");
        }
        return;
      }

      // Valid mode
      if (isValidMode(arg) && !INDEPENDENT[arg]) {
        applyMode(arg);
        notifyMode(ctx, arg);
        return;
      }

      // Unknown
      if (ctx.hasUI) {
        ctx.ui.notify(
          `unknown mode "${arg}". Use: lite|full|ultra|wenyan-lite|wenyan|wenyan-ultra|off`,
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
      configLines.push(` flag  ${DIM}${truncatePath(flagPath)}${RST}`);

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

  // ── /caveman-config command ──────────────────────────────────────────
  const INTENSITY_MODES = ["lite", "full", "ultra", "wenyan-lite", "wenyan", "wenyan-ultra", "off"];

  pi.registerCommand("caveman-config", {
    description: "Set default caveman mode for new sessions",
    getArgumentCompletions: (prefix) => getModeCompletions(prefix),
    handler: async (args, ctx) => {
      const arg = (args || "").trim().toLowerCase();

      // No arg → show current config + available options
      if (!arg) {
        const def = resolveDefault();
        const configPath = join(cavemanConfigDir(), "config.json");
        const repoConfig = findRepoConfig(process.cwd());

        const lines: string[] = [
          `Current default: ${def}`,
          "",
          "Available modes:",
          "  lite        — no filler/hedging, keep articles + full sentences",
          "  full        — drop articles, fragments OK, short synonyms (default)",
          "  ultra       — one word when one word enough, no abbreviations",
          "  wenyan-lite — semi-classical, keep grammar structure",
          "  wenyan      — maximum classical terseness (文言文)",
          "  wenyan-ultra — extreme abbreviation, classical feel",
          "  off         — disabled by default",
          "",
          "Usage: /caveman-config <mode>",
          `Config file: ${configPath}`,
        ];
        if (process.env.CAVEMAN_DEFAULT_MODE) {
          lines.push(`Note: CAVEMAN_DEFAULT_MODE=${process.env.CAVEMAN_DEFAULT_MODE} overrides config file`);
        }
        if (repoConfig) {
          lines.push(`Note: repo config at ${repoConfig} overrides user config`);
        }

        const msg = lines.join("\n");
        if (ctx.hasUI) ctx.ui.notify(msg, "info");
        pi.sendMessage({
          customType: "caveman-config",
          content: msg,
          display: true,
          attribution: "user",
        }, { triggerTurn: false });
        return;
      }

      // Validate
      if (!isValidMode(arg) && arg !== "off") {
        if (ctx.hasUI) {
          ctx.ui.notify(
            `unknown mode "${arg}". Available: ${INTENSITY_MODES.join(", ")}`,
            "warning",
          );
        }
        return;
      }

      // Write to user config
      const configDir = cavemanConfigDir();
      const cfgPath = join(configDir, "config.json");

      try {
        if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });

        let existing: Record<string, unknown> = {};
        if (existsSync(cfgPath)) {
          try { existing = JSON.parse(readFileSync(cfgPath, "utf-8")); } catch {}
        }
        existing.defaultMode = arg;
        writeFileSync(cfgPath, JSON.stringify(existing, null, 2) + "\n", { mode: 0o600 });

        const label = arg === "off" ? "off" : arg;
        if (ctx.hasUI) {
          ctx.ui.notify(`default mode set to: ${label}`, "info");
          ctx.ui.notify(`config: ${cfgPath}`, "info");
        }
        pi.sendMessage({
          customType: "caveman-config",
          content: `Default mode saved: ${label}\nConfig: ${cfgPath}\nEffective on next session.`,
          display: true,
          attribution: "user",
        }, { triggerTurn: false });
      } catch (e) {
        if (ctx.hasUI) ctx.ui.notify(`failed to write config: ${e}`, "error");
      }
    },
  });

  // ── before_agent_start: per-turn reinforcement ────────────────────────
  // Injects full SKILL.md content (filtered to active mode) + reinforcement line.
  // Mirrors caveman-activate.js behavior: the model sees the complete ruleset
  // on every turn, not just a one-line reminder.
  pi.on("before_agent_start", async (_event, _ctx) => {
    let active = readFlag();
    if (!active && !sessionExplicitOff) active = resolveDefault();
    if (!active || active === "off" || INDEPENDENT[active]) return null;

    const skillContent = loadFilteredSkillContent(active);
    const header = `CAVEMAN MODE ACTIVE — level: ${active === "wenyan" ? "wenyan-full" : active}\n\n`;

    // If SKILL.md found, inject full filtered content; fall back to reinforcement line
    const content = skillContent
      ? header + skillContent
      : reinforcementLine(active);

    return {
      message: {
        customType: "caveman-reinforcement",
        content,
        display: false,
        attribution: "system",
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
      if (change === "off") sessionExplicitOff = true;
      applyMode(change);
    }
  });

}
