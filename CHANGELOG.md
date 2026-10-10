# Changelog

All notable changes to `@izhimu/pi-caveman` will be documented in this file.

## [0.4.0] - 2026-10-10

### Added & Changed
- **Three Skills, One Mode Model (Upstream 3.2.0 Sync)**:
  - Replaced the 6 intensity levels with 3 dedicated standalone skills:
    - `caveman`: Default smart terse voice, adhering to 9 core rules.
    - `ultracave`: Grammar stripped, fragments only, each fact once.
    - `megacave`: Classical Chinese (文言文) register with character minimization.
  - Shipped `skills/ultracave/` and `skills/megacave/` skills directories alongside `skills/caveman/`.
  - Added `canonicalMode()` to seamlessly map legacy mode names (`full`, `lite`, `ultra`, `wenyan*`) to the new three-skill architecture.
- **Upstream 3.2.0 Core Rules**:
  - Rule 6: Retain existing file comments in full unless explicitly asked to modify them.
  - Rule 7: Bounded tool runs — no narration between routine tool calls; single-line phase notices.
  - Exceptions: Always use full sentences when offering options or asking clarifying questions to the user.
  - Updated reinforcement thesis line extraction to synchronize with skill definitions.
- **Commands & UX**:
  - Added dedicated `/ultracave` and `/megacave` slash commands.
  - Supported `/caveman status` as a first-class subcommand.
  - Non-permanent status bar: clears status bar on mode changes and session start while providing clean transient toast notifications (`ui.notify`).
- **Testing**:
  - Comprehensive unit test suite covering mode canonicalization, three-skill loading, negation boundaries, and slash command parsing without logic duplication.

## [0.3.0] - 2026-09-17

### Changed & Improved
- **Upstream Core Sync**: Synchronized `skills/caveman/SKILL.md` with upstream Caveman ruleset:
  - Added ASD-STE100 Simplified Technical English clarity register (sentences ≤20 words, imperative instructions, unambiguous terms).
  - Added explicit reply-language precedence (honoring user/project language directives while preserving technical terms).
  - Removed meta-announcements and boilerplate prefixes (`me caveman think`, `Caveman:` tags).
  - Shortened skill description and token-optimized punctuation.
- **Host Adaptation (pi & oh-my-pi)**:
  - Dynamic host directory resolution (`~/.pi` vs `~/.omp`) for flags and logs.
  - Gated prompt reinforcement: injects full ruleset on activation or mode change; subsequent turns use lightweight one-line reminders to save tokens and avoid prompt cache misses.
  - Session persistence: preserves mid-session modes across compactions, reloads, and forks.
  - Removed unsupported `attribution: "system"` property from injected custom messages.
  - Added `"omp"` manifest and optional peer dependencies in `package.json`.
- **Robust Mode Parsing**:
  - Integrated upstream gap whitelist (`ACTIVATION_GAP`) to prevent false positives on phrases like "i want to start building a caveman-themed game".
  - Added clause-bounded negation detection (`don't activate caveman` won't trigger; `don't use vim, activate caveman` works).
- **Pruning**:
  - Removed `caveman-compress` skill and Python scripts to keep the package lightweight and focused purely on core caveman communication.

## [0.2.1] - 2026-08-21

### Changed & Improved
- **Prompt Rules Upstream Sync**: Synchronized core compression rules with upstream Caveman v2.2.0 — added anti-expansion guards (no fake broken grammar), verb preservation on equal token cost, and clear external issue/ticket boundaries.
- **Robust Mode Parser**: Added quoted-span disambiguation to prevent quoted text like `"stop caveman"` from triggering deactivation; added punctuation and quote normalization for `/caveman` arguments.
- **Enhanced `caveman-compress`**: Fixed Windows `cp1252` encoding exceptions, improved CommonMark code fence parsing, and preserved original file line endings (CRLF/LF) atomically.
- **Skill Slimming**: Trimmed redundant cloud-dependent and generic workflow skills to reduce initial system prompt index overhead by ~75%.

## [0.2.0] - 2026-08-16

### Added
- Multi-skill integration for pi package format.
- Namespaced slash commands and extended mode parsing.
- Published package under `@izhimu/pi-caveman`.

## [0.1.0] - 2026-07-15

### Added
- Initial release of pi-caveman extension for the Pi coding agent.
- 6 compression intensity levels (`lite`, `full`, `ultra`, `wenyan-lite`, `wenyan-full`, `wenyan-ultra`).
- Per-turn prompt reinforcement and auto-activation support.
- Session token tracking and estimated savings display via `/caveman-status`.
