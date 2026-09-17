import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Verify SKILL.md parsing and intensity filtering logic mirrors extension behavior
test("SKILL.md exists and can be filtered per mode", () => {
  const skillPath = join("skills", "caveman", "SKILL.md");
  assert.ok(existsSync(skillPath));
  const raw = readFileSync(skillPath, "utf-8");
  const body = raw.replace(/^---[\s\S]*?---\s*/, "");

  for (const mode of ["lite", "full", "ultra", "wenyan-lite", "wenyan-full", "wenyan-ultra"]) {
    const lines = body.split("\n").reduce((acc, line) => {
      const tableRowMatch = line.match(/^\|\s*\*\*(\S+?)\*\*\s*\|/);
      if (tableRowMatch) {
        if (tableRowMatch[1] === mode) acc.push(line);
        return acc;
      }
      const exampleMatch = line.match(/^- (\S+?):\s/);
      if (exampleMatch) {
        if (exampleMatch[1] === mode) acc.push(line);
        return acc;
      }
      acc.push(line);
      return acc;
    }, []);

    const filtered = lines.join("\n");
    assert.ok(filtered.length > 500, `filtered ruleset for ${mode} should have content`);
    assert.ok(filtered.includes(`| **${mode}** |`), `should contain table row for ${mode}`);
    // Should NOT contain rows for other modes
    for (const other of ["lite", "full", "ultra", "wenyan-lite", "wenyan-full", "wenyan-ultra"]) {
      if (other !== mode) {
        assert.ok(!filtered.includes(`| **${other}** |`), `should NOT contain table row for ${other}`);
      }
    }
  }
});

// Test mode parsing logic
const QUOTED_SPAN_REGEX = /(["`])(?:(?!\1).)*\1/g;
const ACTIVATION_VERBS = "(?:activate|enable|start|turn on|use|switch to|want|give me)";
const ACTIVATION_GAP = "(?:\\s+(?:the|to|into|on|in|please|now|it|me|my|this|that|mode))*";
const ACTIVATION_VERB_PHRASE = new RegExp(
  "\\b" + ACTIVATION_VERBS + "\\b" + ACTIVATION_GAP + "\\s+caveman\\b"
);
const ACTIVATION_TALK_LIKE = /\btalk\s+like\s+(?:a\s+|an\s+|the\s+)?caveman\b/;
const NEGATOR = /\b(?:don['’]?t|do not|doesn['’]?t|does not|won['’]?t|will not|never|no need to|rather not)\b/;
const CLAUSE_BOUNDARY = /[.;!?,:—–]|\s-+\s|\bbut\b|\bthen\b/g;

function negatedBefore(text, index) {
  CLAUSE_BOUNDARY.lastIndex = 0;
  let clauseStart = 0;
  let m;
  while ((m = CLAUSE_BOUNDARY.exec(text)) !== null) {
    if (m.index >= index) break;
    clauseStart = m.index + m[0].length;
  }
  return NEGATOR.test(text.slice(clauseStart, index));
}

const BREVITY_TRIGGER = /\b(less tokens|fewer tokens|be brief|be terse|shorter answers)\b(?!\s+(in|for|on|about|when|during|with)\b)/;

const ACTIVATION_TRIGGERS = [
  ACTIVATION_VERB_PHRASE,
  ACTIVATION_TALK_LIKE,
  /\bcaveman\s+mode\s+(on|please|now)\b/,
  /^caveman(\s+mode)?\s*[.!]*$/,
  BREVITY_TRIGGER,
].map((re) => new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"));

function wantsActivation(text) {
  for (const re of ACTIVATION_TRIGGERS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (!negatedBefore(text, m.index)) return true;
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  return false;
}

function normalizeModeArg(arg) {
  return (arg || "").replace(/^[^a-z0-9]+/, "").replace(/[^a-z0-9-]+$/, "");
}

const VALID_MODES = ["lite", "full", "ultra", "wenyan-lite", "wenyan", "wenyan-full", "wenyan-ultra"];

function resolveModeArg(rawArg) {
  const arg = normalizeModeArg(rawArg);
  if (!arg) return { action: "set", mode: "full" };
  if (arg === "off" || arg === "stop" || arg === "disable") return { action: "clear" };
  if (arg === "wenyan-full") return { action: "set", mode: "wenyan" };
  if (VALID_MODES.includes(arg)) return { action: "set", mode: arg };
  return { action: "unresolved" };
}

function parseModeChange(promptRaw) {
  let prompt = (promptRaw || "").trim();
  if (!prompt) return null;

  const collapsed = prompt.toLowerCase().replace(/\s+/g, " ");
  const naturalLanguage = !prompt.startsWith("/");
  const nlPrompt = naturalLanguage ? collapsed.replace(QUOTED_SPAN_REGEX, " ") : "";

  if (naturalLanguage) {
    const wantsOff =
      /\b(stop|disable|deactivate|quit|exit|kill)\s+(the\s+)?caveman\b/.test(nlPrompt) ||
      /\bcaveman(\s+mode)?\s+(off|stop|disabled?)\b/.test(nlPrompt) ||
      /\bturn\s+off\s+(the\s+)?caveman\b/.test(nlPrompt) ||
      /^(please\s+)?(go\s+|back\s+to\s+|switch\s+(back\s+)?to\s+|return\s+to\s+)?normal\s+mode\b/.test(nlPrompt) ||
      (/\bnormal\s+mode\b/.test(nlPrompt) && /\bcaveman\b/.test(nlPrompt));

    if (wantsOff) return "off";

    const isQuestion =
      /^(what|whats|what's|how|why|when|where|who|does|do|did|is|are|can|could|would|should|tell me|explain)\b/.test(nlPrompt);

    if (!isQuestion && wantsActivation(nlPrompt)) {
      return "full";
    }
  }

  if (prompt.startsWith("/caveman")) {
    const parts = prompt.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const rawArg = parts[1] || "";

    if (cmd === "/caveman" || cmd === "/caveman:caveman") {
      const res = resolveModeArg(rawArg);
      if (res.action === "set" && res.mode) return res.mode;
      if (res.action === "clear") return "off";
      return null;
    }
  }

  return null;
}

test("parseModeChange handles natural language activations", () => {
  assert.equal(parseModeChange("talk like caveman"), "full");
  assert.equal(parseModeChange("please switch to caveman mode"), "full");
  assert.equal(parseModeChange("be brief"), "full");
  assert.equal(parseModeChange("less tokens"), "full");
});

test("parseModeChange rejects false positives and questions", () => {
  assert.equal(parseModeChange("what is caveman mode?"), null);
  assert.equal(parseModeChange("i want to start building a caveman-themed game"), null);
  assert.equal(parseModeChange("start a caveman fire"), null);
});

test("parseModeChange handles negation properly", () => {
  assert.equal(parseModeChange("don't activate caveman"), null);
  assert.equal(parseModeChange("never use caveman"), null);
  assert.equal(parseModeChange("don't use vim, activate caveman"), "full");
});

test("parseModeChange handles deactivations", () => {
  assert.equal(parseModeChange("stop caveman"), "off");
  assert.equal(parseModeChange("caveman off"), "off");
  assert.equal(parseModeChange("normal mode"), "off");
  assert.equal(parseModeChange("switch back to normal mode"), "off");
});

test("parseModeChange handles slash commands", () => {
  assert.equal(parseModeChange("/caveman"), "full");
  assert.equal(parseModeChange("/caveman ultra"), "ultra");
  assert.equal(parseModeChange("/caveman lite"), "lite");
  assert.equal(parseModeChange("/caveman wenyan"), "wenyan");
  assert.equal(parseModeChange("/caveman off"), "off");
  assert.equal(parseModeChange("/caveman:caveman ultra"), "ultra");
});
