import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import cavemanExtension, {
  VALID_MODES,
  canonicalMode,
  resolveModeArg,
  parseModeChange,
  loadSkillContent,
  getThesisLine,
  fallbackRuleset,
  reinforcementLine,
  estimateSavings,
  resolveDefault,
  getReinforce,
  saveUserConfigMode,
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

  // Standalone /ultracave and /megacave commands were removed;
  // only /caveman <mode> (and its plugin-namespaced form) switches modes
  assert.equal(parseModeChange("/ultracave"), null);
  assert.equal(parseModeChange("/megacave"), null);
  assert.equal(parseModeChange("/caveman:ultracave"), null);
  assert.equal(parseModeChange("/caveman:megacave"), null);
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

test("fallback rulesets retain all core rules and mode-specific language guidance", () => {
  for (const mode of VALID_MODES) {
    const ruleset = fallbackRuleset(mode);
    assert.ok(ruleset.includes("1. Answer first."));
    assert.ok(ruleset.includes("9. Never perform caveman."));
    if (mode === "megacave") {
      assert.ok(ruleset.includes("8. Prose in 文言."));
      assert.ok(ruleset.endsWith("以文言答。技術之實皆存，唯贅言去之。"));
    } else {
      assert.ok(ruleset.includes("8. User's language."));
    }
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

function withConfigSandbox(fn) {
  return () => {
    const tmp = mkdtempSync(join(tmpdir(), "pi-caveman-config-test-"));
    const cwd = process.cwd();
    const savedXdg = process.env.XDG_CONFIG_HOME;
    const savedMode = process.env.CAVEMAN_DEFAULT_MODE;
    const savedReinforce = process.env.CAVEMAN_REINFORCE;
    process.env.XDG_CONFIG_HOME = join(tmp, "xdg");
    delete process.env.CAVEMAN_DEFAULT_MODE;
    delete process.env.CAVEMAN_REINFORCE;
    process.chdir(tmp);
    try {
      fn(tmp);
    } finally {
      process.chdir(cwd);
      if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = savedXdg;
      if (savedMode === undefined) delete process.env.CAVEMAN_DEFAULT_MODE;
      else process.env.CAVEMAN_DEFAULT_MODE = savedMode;
      if (savedReinforce === undefined) delete process.env.CAVEMAN_REINFORCE;
      else process.env.CAVEMAN_REINFORCE = savedReinforce;
      rmSync(tmp, { recursive: true, force: true });
    }
  };
}

test(
  "defaultMode accepts BOM, UTF-16LE, comments, and trailing commas",
  withConfigSandbox(() => {
    const configDir = join(process.env.XDG_CONFIG_HOME, "caveman");
    const configPath = join(configDir, "config.json");
    mkdirSync(configDir, { recursive: true });
    const json = '{"defaultMode":"off"}';
    const variants = {
      "UTF-8 BOM": Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(json)]),
      "UTF-16LE BOM": Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(json, "utf16le")]),
      "line comment": '// mine\n{"defaultMode":"off"} // trailing',
      "block comment": '/* mine */ {"defaultMode": /* why */ "off"}',
      "trailing comma": '{"defaultMode":"off",}',
      "comment-like string": '{"note":"http://x // y,}","defaultMode":"off",}',
    };
    for (const [name, content] of Object.entries(variants)) {
      writeFileSync(configPath, content);
      assert.equal(resolveDefault(), "off", name);
    }
  }),
);

test(
  "mode writes preserve other JSONC config settings",
  withConfigSandbox(() => {
    const configDir = join(process.env.XDG_CONFIG_HOME, "caveman");
    const configPath = join(configDir, "config.json");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(configPath, '{\n  // keep these settings\n  "reinforce": false,\n  "note": "http://x // y,}",\n}');
    saveUserConfigMode("ultracave");
    const saved = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(saved.defaultMode, "ultracave");
    assert.equal(saved.reinforce, false);
    assert.equal(saved.note, "http://x // y,}");
  }),
);

test(
  "repo config without defaultMode does not hide sibling or parent config",
  withConfigSandbox((tmp) => {
    mkdirSync(join(tmp, ".caveman"));
    writeFileSync(join(tmp, ".caveman", "config.json"), '{"execute":{"mcp":false}}');
    writeFileSync(join(tmp, ".caveman.json"), '{"defaultMode":"off"}');
    const nested = join(tmp, "sub");
    mkdirSync(join(nested, ".caveman"), { recursive: true });
    writeFileSync(join(nested, ".caveman", "config.json"), "{}");
    process.chdir(nested);
    assert.equal(resolveDefault(), "off");
  }),
);

test(
  "reinforce resolves through env, repo, and user config",
  withConfigSandbox((tmp) => {
    assert.equal(getReinforce(), true);
    const configDir = join(process.env.XDG_CONFIG_HOME, "caveman");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.json"), '{"reinforce":false}');
    assert.equal(getReinforce(), false);
    writeFileSync(join(tmp, ".caveman.json"), '{"defaultMode":"ultracave"}');
    assert.equal(getReinforce(), false, "defaultMode-only repo config must not hide user reinforce");
    writeFileSync(join(tmp, ".caveman.json"), '{"reinforce":true}');
    assert.equal(getReinforce(), true);
    process.env.CAVEMAN_REINFORCE = "0";
    assert.equal(getReinforce(), false);
    process.env.CAVEMAN_REINFORCE = "1";
    assert.equal(getReinforce(), true);
    process.env.CAVEMAN_REINFORCE = "maybe";
    assert.equal(getReinforce(), true, "invalid env falls through to repo config");
  }),
);

test(
  "Windows user config falls back from APPDATA to ~/.config",
  withConfigSandbox((tmp) => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    const savedHome = process.env.HOME;
    const savedAppdata = process.env.APPDATA;
    delete process.env.XDG_CONFIG_HOME;
    process.env.HOME = join(tmp, "home");
    process.env.APPDATA = join(tmp, "appdata");
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      const homeConfig = join(tmp, "home", ".config", "caveman");
      mkdirSync(homeConfig, { recursive: true });
      writeFileSync(join(homeConfig, "config.json"), '{"defaultMode":"off"}');
      assert.equal(resolveDefault(), "off");
      const appdataConfig = join(tmp, "appdata", "caveman");
      mkdirSync(appdataConfig, { recursive: true });
      writeFileSync(join(appdataConfig, "config.json"), '{"defaultMode":"ultra"}');
      assert.equal(resolveDefault(), "ultracave");
    } finally {
      Object.defineProperty(process, "platform", platform);
      if (savedHome === undefined) delete process.env.HOME;
      else process.env.HOME = savedHome;
      if (savedAppdata === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = savedAppdata;
    }
  }),
);

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
      const results = [];
      for (const handler of handlers.get(event.type) ?? []) {
        results.push(await handler(event, ctx));
      }
      return results;
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
    const savedReinforce = process.env.CAVEMAN_REINFORCE;
    process.env.XDG_CONFIG_HOME = tmp;
    process.env.CAVEMAN_DEFAULT_MODE = "off";
    delete process.env.CAVEMAN_REINFORCE;
    try {
      await fn();
    } finally {
      if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = savedXdg;
      if (savedMode === undefined) delete process.env.CAVEMAN_DEFAULT_MODE;
      else process.env.CAVEMAN_DEFAULT_MODE = savedMode;
      if (savedReinforce === undefined) delete process.env.CAVEMAN_REINFORCE;
      else process.env.CAVEMAN_REINFORCE = savedReinforce;
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
  "reinforce off suppresses reminders but preserves activation and switch rulesets",
  withSandbox(async () => {
    const pi = makeMockPi();
    cavemanExtension(pi);
    const ctx = silentCtx();
    process.env.CAVEMAN_REINFORCE = "0";

    await pi.emit({ type: "session_start", reason: "startup" }, ctx);
    const inactive = await pi.emit({ type: "before_agent_start" }, ctx);
    assert.equal(inactive[0], undefined);

    await pi.commands.get("caveman").handler("ultracave", ctx);
    const activation = await pi.emit({ type: "before_agent_start" }, ctx);
    assert.ok(activation[0].message.content.includes("CAVEMAN MODE ACTIVE — mode: ultracave"));

    const reminder = await pi.emit({ type: "before_agent_start" }, ctx);
    assert.equal(reminder[0], undefined);

    await pi.commands.get("caveman").handler("megacave", ctx);
    const switched = await pi.emit({ type: "before_agent_start" }, ctx);
    assert.ok(switched[0].message.content.includes("CAVEMAN MODE ACTIVE — mode: megacave"));
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
