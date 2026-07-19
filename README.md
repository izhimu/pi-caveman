# pi-caveman

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![pi extension](https://img.shields.io/badge/pi-extension-green.svg)](https://github.com/earendil-works/pi)

Caveman mode for [pi](https://github.com/earendil-works/pi). Ultra-compressed communication — cuts **65% output tokens** (measured), full technical accuracy.

Upstream: [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman)

## Features

- **Auto-activates** on every pi session (default: `full` intensity)
- **6 intensity levels** — from lite (professional but tight) to wenyan-ultra (classical Chinese extreme compression)
- **Per-turn reinforcement** keeps model in caveman mode even after context compression
- **Natural language triggers** — "talk like caveman", "be brief", "stop caveman"
- **Status bar** shows current mode with color-coded indicator
- **Configurable** via env var, repo-local, or user-global config
- **Token savings stats** — tracks and displays estimated savings per session

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
| `/caveman` | Activate with default mode |
| `/caveman lite` | Lite mode — no filler, keep articles |
| `/caveman full` | Full mode — fragments OK, short synonyms |
| `/caveman ultra` | Ultra mode — one word when one word enough |
| `/caveman wenyan` | 文言文 mode (classical Chinese) |
| `/caveman off` | Deactivate |
| `/caveman-config` | Show/set default mode |
| `/caveman-off` | Convenience alias for `/caveman off` |
| `/caveman-status` | Show current mode and config |

Natural-language triggers also work: "talk like caveman", "stop caveman", "normal mode".

## Intensity Levels

| Level | Description |
|-------|-------------|
| **lite** | No filler/hedging. Keep articles + full sentences. Professional but tight |
| **full** | Drop articles, fragments OK, short synonyms. Classic caveman |
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

Quickest way: `/caveman-config ultra` — writes user config, shows all available modes.

Default mode resolution order:

1. `CAVEMAN_DEFAULT_MODE` environment variable
2. Repo-local: `.caveman/config.json` or `.caveman.json` (walks up to root)
3. User: `~/.config/caveman/config.json` (or `%APPDATA%\caveman\config.json` on Windows)
4. `full` (fallback)

Manual config:
```json
{
  "defaultMode": "ultra"
}
```

## How It Works

pi loads extensions from `~/.pi/agent/extensions/` and `.pi/extensions/`. This extension hooks into four lifecycle events:

1. **`session_start`** — writes mode flag, notifies user
2. **`before_agent_start`** — injects reinforcement line per turn
3. **`input`** — intercepts `/caveman` commands and natural-language triggers
4. **`turn_end`** — updates status bar with savings stats

The `SKILL.md` in `skills/caveman/` is auto-discovered by pi's skill system and loaded into system context.

## Project Structure

```
pi-caveman/
├── extensions/
│   └── caveman.ts        # pi ExtensionAPI integration
├── skills/
│   └── caveman/
│       └── SKILL.md      # Caveman behavior rules
├── package.json          # pi package manifest
├── tsconfig.json
├── LICENSE
└── README.md
```

## Flag File

Mode state persisted at `~/.pi/.caveman-active`. Mode transitions logged to `~/.pi/.caveman-mode-log.jsonl`.

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feat/amazing-feature`)
5. Open a Pull Request

## License

[MIT](LICENSE) © [izhimu](https://github.com/izhimu)
