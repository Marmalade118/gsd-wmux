# gsd-wmux

[![npm version](https://img.shields.io/npm/v/gsd-wmux)](https://www.npmjs.com/package/gsd-wmux)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js ≥18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](package.json)

**Multi-backend multiplexer integration for [GSD](https://github.com/gsd-build/gsd-2) / [pi](https://github.com/gsd-build/pi)**

Drop-in replacement for the stock `@gsd/cmux` library that adds WezTerm support and makes it trivial to add new backends (tmux, zellij, psmux, etc.).

## What it does

GSD's auto-mode can publish status, progress, and notifications to your terminal multiplexer. The stock integration only supports [cmux](https://cmux.com) (macOS-only). This package adds:

| Feature | cmux | WezTerm | Stock GSD |
|---|---|---|---|
| **Status bar** | Sidebar widget | Tab bar via user vars + Lua | ❌ |
| **Progress indicator** | Sidebar progress bar | Tab bar progress bar | ❌ |
| **Event log** | Scrollable sidebar log | Last event in status bar | ❌ |
| **Desktop notifications** | cmux CLI | OSC 777 (native) | macOS/Linux only |
| **Pane splits** | `cmux new-split` | `wezterm cli split-pane` | ❌ |
| **Send text to panes** | `cmux send-surface` | `wezterm cli send-text` | ❌ |
| **Grid layouts** | ✅ | ✅ | ❌ |
| **Windows support** | ❌ | ✅ | ❌ |
| **Windows toast notifications** | ❌ | ✅ | ❌ |

## Quick start

```bash
# Install globally
npm install -g gsd-wmux

# Apply to your GSD installation
npx gsd-wmux

# Enable in your project
# (inside pi, run:)
/gsd cmux on
```

### WezTerm status bar (optional)

Copy the Lua snippet into your WezTerm config to see GSD status in the tab bar:

```lua
-- In your ~/.wezterm.lua, add:
local gsd = require('gsd-status')
```

Or copy `wezterm/gsd-status.lua` to your WezTerm config directory.

The status bar shows:
- 🚀 Phase icon (executing, planning, blocked, complete, etc.)
- Current milestone/slice/task label
- Progress bar with completion ratio
- Phase-colored highlights

## How it works

gsd-wmux replaces the cmux integration library at `~/.gsd/agent/extensions/cmux/`. Since GSD imports this library by relative path, the replacement is transparent — all existing GSD code works unchanged.

**Backend auto-detection:**
1. If `WEZTERM_PANE` is set → WezTerm backend
2. If `CMUX_WORKSPACE_ID` + `CMUX_SURFACE_ID` are set → cmux backend
3. If `wezterm cli` is on PATH → WezTerm backend
4. Otherwise → no backend (graceful no-op)

**WezTerm status delivery:**
- Status/progress data is pushed via OSC 1337 user variables (zero-latency, no polling)
- The companion Lua config reads `pane.user_vars.gsd_*` and renders them in the tab bar
- Desktop notifications use WezTerm's native OSC 777 support

## User variables

gsd-wmux sets these user variables on the active pane. Your WezTerm Lua config can read them via `pane:get_user_vars()`:

| Variable | Example | Description |
|---|---|---|
| `gsd_status` | `M001 S01/T02 · executing` | Current unit label |
| `gsd_phase` | `executing` | Phase name |
| `gsd_color` | `#4ade80` | Phase color (hex) |
| `gsd_icon` | `rocket` | Phase icon name |
| `gsd_progress` | `0.429` | Completion ratio (0..1) |
| `gsd_progress_label` | `3/7 tasks` | Human-readable progress |
| `gsd_last_event` | `[14:23:01] info: Task T03 complete` | Last log event |

## Adding a backend

1. Implement `MuxBackend` (see `src/types.ts`) in `src/backends/your-backend.ts`
2. Add it to the `BACKENDS` array in `src/index.ts`
3. The auto-detection loop picks it up if `detect()` returns `available: true`

Example skeleton:

```typescript
import type { MuxBackend, MuxConfig, MuxEnvironment } from "../types.js";

export class MyMuxBackend implements MuxBackend {
    readonly name = "mymux";

    detect(env = process.env): MuxEnvironment {
        // Check env vars, CLI availability, etc.
    }

    isCliAvailable(): boolean { /* ... */ }
    setStatus(config, label, phase) { /* ... */ }
    clearStatus(config) { /* ... */ }
    // ... implement remaining MuxBackend methods
}
```

## Managing the installation

```bash
# Check current state
npx gsd-wmux --status

# Revert to stock cmux
npx gsd-wmux --restore

# Re-apply after a pi update
npx gsd-wmux
```

After updating pi (`npm update -g gsd-pi`), the stock cmux files are restored. Run `npx gsd-wmux` again to re-apply.

## Notifications patch

gsd-wmux also patches GSD's `notifications.js` to add Windows toast notification support. The stock version returns `null` on `win32` — the patched version uses PowerShell + WinRT to show native Windows 10/11 toast notifications.

## Development

```bash
git clone https://github.com/your-username/gsd-wmux.git
cd gsd-wmux
npm install
npm run build
node scripts/install.js
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for a full development guide.

## Documentation

| Document | Description |
|---|---|
| [docs/architecture.md](docs/architecture.md) | System architecture and data flow diagrams |
| [docs/api-reference.md](docs/api-reference.md) | Complete TypeScript API reference |
| [docs/wezterm-setup.md](docs/wezterm-setup.md) | WezTerm status bar setup and customisation |
| [docs/backends.md](docs/backends.md) | Guide to implementing new multiplexer backends |

## License

MIT
