# pi-caveman

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![pi extension](https://img.shields.io/badge/pi-extension-green.svg)](https://github.com/earendil-works/pi)
[![npm version](https://img.shields.io/npm/v/@izhimu/pi-caveman.svg)](https://www.npmjs.com/package/@izhimu/pi-caveman)

Caveman mode for [pi](https://github.com/earendil-works/pi) and [oh-my-pi](https://github.com/can1357/oh-my-pi). Ultra-compressed communication — cuts **65% output tokens** (measured) while maintaining full technical accuracy.

Upstream: [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman)

## Features

- **Auto-activates** on every pi / oh-my-pi session (default: `full` intensity)
- **6 intensity levels** — from `lite` (professional, no filler) to `wenyan-ultra` (extreme classical Chinese compression)
- **Per-turn reinforcement** keeps the model concise even as context grows
- **Memory file compression** (`/caveman-compress`) — shrinks `AGENTS.md`, `CLAUDE.md`, and project notes with atomic backup and validation
- **Natural language triggers** — "talk like caveman", "be brief", "stop caveman", "normal mode" (with quote disambiguation)
- **Direct persistence** — `/caveman <mode>` instantly applies and saves default mode across sessions
- **Token savings stats** — tracks session output tokens and estimated savings via `/caveman-status`

## Install

### npm (recommended)

```bash
pi install @izhimu/pi-caveman
```

### From git

```bash
# Global
pi install git:github.com/izhimu/pi-caveman

# Project-local (shared with team via .pi/settings.json)
pi install git:github.com/izhimu/pi-caveman -l
```

### From local path

```bash
pi install /path/to/pi-caveman
pi install ./relative/path/to/pi-caveman
```

### Quick test (no install)

```bash
pi -e ./extensions/caveman.ts
```

## Commands

| Command | Effect |
|---------|--------|
| `/caveman` | Activate with default mode (persists) |
| `/caveman lite` | Lite mode — no filler/hedging, keep articles (persists) |
| `/caveman full` | Full mode — fragments OK, short synonyms (default, persists) |
| `/caveman ultra` | Ultra mode — one word when one word enough (persists) |
| `/caveman wenyan` | 文言文 mode (classical Chinese terseness, persists) |
| `/caveman off` | Deactivate caveman mode (persists) |
| `/caveman-compress <file>` | Compress memory file (`AGENTS.md`, `todos.md`, etc.) |
| `/caveman-status` | Show current mode, session tokens, and config paths |

All `/caveman <mode>` commands automatically persist to user config (`~/.config/caveman/config.json` or `%APPDATA%\caveman\config.json`).

Natural-language triggers also work: "talk like caveman", "stop caveman", "normal mode".

## Intensity Levels

| Level | Description |
|-------|-------------|
| **lite** | No filler/hedging. Keep articles + full sentences. Professional but tight |
| **full** | Drop articles, fragments OK, short synonyms. Classic caveman (default) |
| **ultra** | Strip conjunctions. One word when one word enough |
| **wenyan-lite** | Semi-classical Chinese. Drop filler but keep grammar structure |
| **wenyan-full** | Maximum classical Chinese terseness. 80-90% character reduction |
| **wenyan-ultra** | Extreme abbreviation with classical Chinese feel |

### Examples

**Q: "Why React component re-render?"**

- **lite:** "Your component re-renders because you create a new object reference each render. Wrap it in `useMemo`."
- **full:** "New object ref each render. Inline object prop = new ref = re-render. Wrap in `useMemo`."
- **ultra:** "Inline obj prop, new ref, re-render. `useMemo`."
- **wenyan-full:** "每繪新生對象參照，故重繪；以 useMemo 包之則免。"

## Configuration

Switch and persist directly with `/caveman <mode>` (e.g. `/caveman ultra`).

Default mode resolution order:

1. `CAVEMAN_DEFAULT_MODE` environment variable
2. Repo-local: `.caveman/config.json` or `.caveman.json` (walks up to root)
3. User config: `~/.config/caveman/config.json` (or `%APPDATA%\caveman\config.json` on Windows)
4. `full` (fallback default)

Manual config file format:
```json
{
  "defaultMode": "ultra"
}
```

## How It Works

pi loads extensions and skills declared in `package.json#pi`. This extension hooks into four lifecycle events:

1. **`session_start`** — writes mode flag, notifies user
2. **`before_agent_start`** — injects filtered caveman rules per turn
3. **`input`** — intercepts `/caveman` commands and natural-language triggers (with quoted-span protection)
4. **`turn_end`** — accumulates token usage and savings stats

## Project Structure

```
pi-caveman/
├── extensions/
│   └── caveman.ts          # pi ExtensionAPI integration & mode manager
├── skills/
│   ├── caveman/            # Core compression rules (SKILL.md)
│   └── caveman-compress/   # Local memory file compression engine
├── tests/                  # Validation test suite
├── CHANGELOG.md
├── package.json            # pi package manifest
├── tsconfig.json
├── LICENSE
└── README.md
```

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for release history.

## License

[MIT](LICENSE) © [izhimu](https://github.com/izhimu)
