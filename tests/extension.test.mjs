import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import cavemanExtension, {
  VALID_MODES,
  canonicalMode,
  resolveModeArg,
  parseModeChange,
  loadSkillContent,
  getThesisLine,
  reinforcementLine,
  estimateSavings,
} from "../extensions/caveman.ts";

test("all three skills can be loaded directly without filtering", () => {
  for (const mode of VALID_MODES) {
    const content = loadSkillContent(mode);
    assert.ok(content, `skill content for ${mode} should exist`);
    assert.ok(content.length > 200, `skill content for ${mode} should be non-trivial`);
    // Should NOT have raw YAML frontmatter markers
    assert.ok(!content.startsWith("---"), `skill content for ${mode} should strip frontmatter`);
  }

  // caveman has the 9 rules and answer first
  const caveman = loadSkillContent("caveman");
  assert.ok(caveman.includes("Answer first"));
  assert.ok(caveman.includes("ASD-STE100"));

  // ultracave is fragments only
  const ultracave = loadSkillContent("ultracave");
  assert.ok(ultracave.includes("Ultracave is caveman with the grammar stripped"));

  // megacave is Classical Chinese
  const megacave = loadSkillContent("megacave");
  assert.ok(megacave.includes("以文言答"));
});

test("canonicalMode normalizes current and legacy modes", () => {
  assert.equal(canonicalMode("caveman"), "caveman");
  assert.equal(canonicalMode("ultracave"), "ultracave");
  assert.equal(canonicalMode("megacave"), "megacave");

  // Legacy mappings
  assert.equal(canonicalMode("full"), "caveman");
  assert.equal(canonicalMode("lite"), "caveman");
  assert.equal(canonicalMode("ultra"), "ultracave");
  assert.equal(canonicalMode("wenyan"), "megacave");
  assert.equal(canonicalMode("wenyan-lite"), "megacave");
  assert.equal(canonicalMode("wenyan-full"), "megacave");
  assert.equal(canonicalMode("wenyan-ultra"), "megacave");

  // Invalid / off
  assert.equal(canonicalMode("unknown"), null);
  assert.equal(canonicalMode("off"), null);
});

test("resolveModeArg resolves modes, status, and clear", () => {
  const getDefault = () => "caveman";

  assert.deepEqual(resolveModeArg("", getDefault), { action: "set", mode: "caveman" });
  assert.deepEqual(resolveModeArg("off", getDefault), { action: "clear" });
  assert.deepEqual(resolveModeArg("stop", getDefault), { action: "clear" });
  assert.deepEqual(resolveModeArg("status", getDefault), { action: "status" });

  assert.deepEqual(resolveModeArg("caveman", getDefault), { action: "set", mode: "caveman" });
  assert.deepEqual(resolveModeArg("ultracave", getDefault), { action: "set", mode: "ultracave" });
  assert.deepEqual(resolveModeArg("megacave", getDefault), { action: "set", mode: "megacave" });

  // Legacy aliases
  assert.deepEqual(resolveModeArg("full", getDefault), { action: "set", mode: "caveman" });
  assert.deepEqual(resolveModeArg("ultra", getDefault), { action: "set", mode: "ultracave" });
  assert.deepEqual(resolveModeArg("wenyan", getDefault), { action: "set", mode: "megacave" });

  // Unknown
  assert.deepEqual(resolveModeArg("invalid-mode", getDefault), { action: "unresolved" });
});

test("parseModeChange handles natural language activations", () => {
  assert.equal(parseModeChange("talk like caveman"), "caveman");
  assert.equal(parseModeChange("please switch to caveman mode"), "caveman");
  assert.equal(parseModeChange("be brief"), "caveman");
  assert.equal(parseModeChange("less tokens"), "caveman");
  assert.equal(parseModeChange("activate ultracave"), "ultracave");
  assert.equal(parseModeChange("switch to megacave"), "megacave");
});

test("parseModeChange rejects false positives and questions", () => {
  assert.equal(parseModeChange("what is caveman mode?"), null);
  assert.equal(parseModeChange("i want to start building a caveman-themed game"), null);
  assert.equal(parseModeChange("start a caveman fire"), null);
});

test("parseModeChange handles negation properly", () => {
  assert.equal(parseModeChange("don't activate caveman"), null);
  assert.equal(parseModeChange("never use caveman"), null);
  assert.equal(parseModeChange("don't use vim, activate caveman"), "caveman");
});

test("parseModeChange handles deactivations", () => {
  assert.equal(parseModeChange("stop caveman"), "off");
  assert.equal(parseModeChange("caveman off"), "off");
  assert.equal(parseModeChange("normal mode"), "off");
  assert.equal(parseModeChange("switch back to normal mode"), "off");
});

test("parseModeChange handles slash commands", () => {
  assert.equal(parseModeChange("/caveman"), "caveman");
  assert.equal(parseModeChange("/caveman ultracave"), "ultracave");
  assert.equal(parseModeChange("/caveman megacave"), "megacave");
  assert.equal(parseModeChange("/caveman ultra"), "ultracave");
  assert.equal(parseModeChange("/caveman lite"), "caveman");
  assert.equal(parseModeChange("/caveman wenyan"), "megacave");
  assert.equal(parseModeChange("/caveman off"), "off");

  // Direct slash commands
  assert.equal(parseModeChange("/ultracave"), "ultracave");
  assert.equal(parseModeChange("/megacave"), "megacave");
  assert.equal(parseModeChange("/caveman:ultracave"), "ultracave");
  assert.equal(parseModeChange("/caveman:megacave"), "megacave");
  assert.equal(parseModeChange("/caveman:caveman ultra"), "ultracave");
});

test("thesis and reinforcement line match upstream specification", () => {
  assert.equal(
    getThesisLine("caveman"),
    "Respond terse like smart caveman. All technical substance stay. Only fluff die.",
  );
  assert.equal(
    getThesisLine("ultracave"),
    "Respond terse like smart caveman. All technical substance stay. Only fluff die. Then cut again.",
  );
  assert.equal(
    getThesisLine("megacave"),
    "以文言答。技術之實皆存，唯贅言去之。",
  );

  for (const mode of VALID_MODES) {
    const line = reinforcementLine(mode);
    assert.ok(line.startsWith(`CAVEMAN MODE ACTIVE (${mode}).`));
    assert.ok(line.includes("Answer only what was asked"));
    assert.ok(line.includes("Technical terms, code, commands, paths, and errors stay exact."));
  }
});

test("estimateSavings computes savings for modes and aliases", () => {
  const cavemanSavings = estimateSavings(1000, "caveman");
  assert.equal(cavemanSavings.pct, 65);
  assert.equal(cavemanSavings.estWithout, 2857);
  assert.equal(cavemanSavings.estSaved, 1857);

  const ultraSavings = estimateSavings(1000, "ultracave");
  assert.equal(ultraSavings.pct, 75);

  const megaSavings = estimateSavings(1000, "megacave");
  assert.equal(megaSavings.pct, 80);

  // Legacy alias
  const fullSavings = estimateSavings(1000, "full");
  assert.equal(fullSavings.pct, 65);
});

// ── Extension runtime against a mock ExtensionAPI ──────────────────────────

function makeMockPi() {
  const handlers = new Map();
  const commands = new Map();
  const sentMessages = [];
  return {
    commands,
    sentMessages,
    on(event, handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    registerCommand(name, options) {
      commands.set(name, options);
    },
    sendMessage(message, options) {
      sentMessages.push({ message, options });
    },
    async emit(event, ctx) {
      for (const handler of handlers.get(event.type) ?? []) {
        await handler(event, ctx);
      }
    },
  };
}

const silentCtx = () => ({
  hasUI: true,
  ui: { notify() {}, setStatus() {} },
});

// Redirects flag/config paths into a temp dir and pins the default mode, so
// the runtime tests never touch ~/.pi, ~/.omp, or the machine caveman config.
function withSandbox(fn) {
  return async () => {
    const tmp = mkdtempSync(join(tmpdir(), "pi-caveman-test-"));
    const savedXdg = process.env.XDG_CONFIG_HOME;
    const savedMode = process.env.CAVEMAN_DEFAULT_MODE;
    process.env.XDG_CONFIG_HOME = tmp;
    process.env.CAVEMAN_DEFAULT_MODE = "off";
    try {
      await fn();
    } finally {
      if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = savedXdg;
      if (savedMode === undefined) delete process.env.CAVEMAN_DEFAULT_MODE;
      else process.env.CAVEMAN_DEFAULT_MODE = savedMode;
      rmSync(tmp, { recursive: true, force: true });
    }
  };
}

test(
  "status command sends a spec-compliant custom message",
  withSandbox(async () => {
    const pi = makeMockPi();
    cavemanExtension(pi);
    const ctx = silentCtx();

    await pi.emit({ type: "session_start", reason: "startup" }, ctx);
    await pi.commands.get("caveman").handler("ultracave", ctx);
    await pi.emit(
      { type: "turn_end", message: { usage: { input: 10, output: 40, cacheRead: 5 } } },
      ctx,
    );
    await pi.commands.get("caveman").handler("status", ctx);

    assert.equal(pi.sentMessages.length, 1);
    const { message, options } = pi.sentMessages[0];
    assert.equal(message.customType, "caveman-status");
    assert.equal(message.display, false);
    assert.ok(message.content.includes("ultracave"));
    assert.ok(message.content.includes("1 turns"));
    assert.equal(options.triggerTurn, false);
    assert.ok(!("attribution" in message), "attribution is not part of either host's sendMessage payload");
  }),
);

test(
  "session stats survive continuation starts and reset on fresh starts",
  withSandbox(async () => {
    const pi = makeMockPi();
    cavemanExtension(pi);
    const ctx = silentCtx();

    const addTurn = () =>
      pi.emit(
        { type: "turn_end", message: { usage: { input: 10, output: 40, cacheRead: 5 } } },
        ctx,
      );
    const turnsShown = async () => {
      pi.sentMessages.length = 0;
      await pi.commands.get("caveman").handler("status", ctx);
      const match = / (\d+) turns/.exec(pi.sentMessages[0].message.content);
      return Number(match[1]);
    };

    await pi.emit({ type: "session_start", reason: "startup" }, ctx);
    await addTurn();
    assert.equal(await turnsShown(), 1);

    // pi continuation reasons keep the session state
    await pi.emit({ type: "session_start", reason: "reload" }, ctx);
    assert.equal(await turnsShown(), 1);
    await pi.emit({ type: "session_start", reason: "fork" }, ctx);
    assert.equal(await turnsShown(), 1);
    await pi.emit({ type: "session_start", reason: "resume" }, ctx);
    assert.equal(await turnsShown(), 1);

    // oh-my-pi reports mid-process switches as session_switch
    await pi.emit({ type: "session_switch", reason: "resume" }, ctx);
    assert.equal(await turnsShown(), 1);

    // fresh sessions reset
    await pi.emit({ type: "session_start", reason: "startup" }, ctx);
    assert.equal(await turnsShown(), 0);
    await addTurn();
    await pi.emit({ type: "session_switch", reason: "new" }, ctx);
    assert.equal(await turnsShown(), 0);
  }),
);
