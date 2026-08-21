# Changelog

All notable changes to `@izhimu/pi-caveman` will be documented in this file.

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
