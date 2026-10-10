# pi-caveman

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![pi extension](https://img.shields.io/badge/pi-extension-green.svg)](https://github.com/earendil-works/pi)
[![npm version](https://img.shields.io/npm/v/@izhimu/pi-caveman.svg)](https://www.npmjs.com/package/@izhimu/pi-caveman)

Caveman mode for [pi](https://github.com/earendil-works/pi) and [oh-my-pi](https://github.com/can1357/oh-my-pi). Ultra-compressed communication — cuts **65% output tokens** (measured) while maintaining full technical accuracy.

Upstream: [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman)

## Features

- **Auto-activates** on every pi / oh-my-pi session (default: `caveman` mode)
- **3 dedicated skills** — `caveman` (smart concise voice), `ultracave` (payload only, fragments), and `megacave` (文言文 Classical Chinese)
- **9 core upstream 3.2.0 rules** — answer first, kill ceremony, STE clarity, preserved comments, bounded tool runs
- **Per-turn reinforcement** keeps the model concise without prompt bloat or cache misses
- **Natural language triggers** — "talk like caveman", "be brief", "stop caveman", "normal mode" (with negation guard and gap whitelist)
- **Direct persistence & aliases** — `/caveman`, `/ultracave`, `/megacave` instantly apply and persist; legacy aliases (`full`, `lite`, `ultra`, `wenyan`) seamlessly mapped
- **Token savings stats** — tracks session output tokens and estimated savings via `/caveman status` or `/caveman-status`
## Install

### npm (recommended)

For pi:
```bash
pi install @izhimu/pi-caveman
```

For oh-my-pi (omp):
```bash
omp plugin install @izhimu/pi-caveman
```

### From git

```bash
# Global (pi)
pi install git:github.com/izhimu/pi-caveman

# Project-local (pi)
pi install git:github.com/izhimu/pi-caveman -l
```

### Quick test (no install)

```bash
pi -e ./extensions/caveman.ts
# or
omp -e ./extensions/caveman.ts
```

## Commands

| Command | Effect |
|---------|--------|
| `/caveman` | Activate default caveman mode (persists) |
| `/caveman <mode>` | Switch mode: `caveman`, `ultracave`, `megacave`, `off`, `status` (persists) |
| `/ultracave` | Switch directly to ultracave mode (maximum compression, fragments only) |
| `/megacave` | Switch directly to megacave mode (Classical Chinese 文言文) |
| `/caveman status` | Show current mode, session token usage, and config paths |
| `/caveman-status` | Alias for `/caveman status` |
| `/caveman off` | Deactivate caveman mode (persists) |

All `/caveman <mode>`, `/ultracave`, and `/megacave` commands automatically persist to user config (`~/.config/caveman/config.json` or `%APPDATA%\caveman\config.json`). Legacy aliases (`full`, `lite`, `ultra`, `wenyan*`) are transparently mapped.

Natural-language triggers also work: "talk like caveman", "be brief", "less tokens", "stop caveman", "normal mode".

## Skills & Modes

| Skill / Mode | Description | Savings |
|--------------|-------------|---------|
| **`caveman`** | Smart caveman voice. Terse, active voice, 9 upstream 3.2.0 rules (default) | ~65% tokens |
| **`ultracave`** | Maximum compression. Grammar stripped, payload only, fragments | ~75% tokens |
| **`megacave`** | Classical Chinese (文言文). Drastically fewer characters on screen | ~80% tokens |

### Examples

**Q: "Why does my React component re-render?"**

- **caveman:** "New object ref each render. Inline object prop = new ref = re-render. Wrap in `useMemo`."
- **ultracave:** "Inline obj prop, new ref, re-render. `useMemo`."
- **megacave:** "每繪新生對象參照，故重繪；以 `useMemo` 包之則免。"
## Configuration

Switch and persist directly with `/caveman <mode>` (e.g. `/caveman ultra`).

Default mode resolution order:

1. `CAVEMAN_DEFAULT_MODE` environment variable
2. Repo-local: `.caveman/config.json` or `.caveman.json` (walks up to root)
3. User config: `~/.config/caveman/config.json` (or `%APPDATA%\caveman\config.json` on Windows)
4. `caveman` (fallback default)

Manual config file format:
```json
{
  "defaultMode": "ultracave"
}
```

## How It Works

pi and oh-my-pi load extensions and skills declared in `package.json` (`pi` / `omp`). This extension hooks into four lifecycle events:

1. **`session_start`** — writes mode flag, notifies user via toast, preserves mid-session modes across compactions/reloads
2. **`before_agent_start`** — injects full skill ruleset on activation/mode-switch, and lightweight reminders on subsequent turns
3. **`input`** — intercepts `/caveman`, `/ultracave`, `/megacave` commands and natural-language triggers (with negation and clause-boundary guards)
4. **`turn_end`** — accumulates token usage and savings stats

## Project Structure

```
pi-caveman/
├── extensions/
│   └── caveman.ts          # pi & omp ExtensionAPI integration & mode manager
├── skills/
│   ├── caveman/            # Standard caveman voice (SKILL.md)
│   ├── ultracave/          # Grammar-stripped fragments (SKILL.md)
│   └── megacave/           # Classical Chinese 文言文 (SKILL.md)
├── CHANGELOG.md
├── package.json            # pi & omp package manifest
├── tsconfig.json
├── LICENSE
└── README.md
```

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for release history.

## License

[MIT](LICENSE) © [izhimu](https://github.com/izhimu)
