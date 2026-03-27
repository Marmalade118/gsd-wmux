# WezTerm Setup Guide

This guide covers everything needed to get GSD status displaying in WezTerm's tab bar and status bar.

## Prerequisites

- [WezTerm](https://wezfurlong.org/wezterm/) installed
- gsd-wmux installed (`npx gsd-wmux`)
- GSD/pi with cmux enabled (`/gsd cmux on`)

---

## Quick Setup

Copy the Lua config into your WezTerm configuration directory and require it:

```lua
-- In ~/.wezterm.lua (or your config file):
local gsd = require('gsd-status')
```

Or if WezTerm can't find `gsd-status` on its module path, use an absolute path:

```lua
local gsd = dofile(wezterm.home_dir .. '/.config/wezterm/gsd-status.lua')
```

The `wezterm/gsd-status.lua` file from this repository should be placed somewhere on the WezTerm Lua module path (typically `~/.config/wezterm/`).

---

## What the Status Bar Shows

When GSD is running a task, the WezTerm status bar displays:

| Element | Example | Description |
|---|---|---|
| Phase icon | `` | Nerd Font glyph for the current phase |
| Unit label | `M001 S01/T02` | Current milestone, slice, and task IDs |
| Phase name | `executing` | Human-readable phase |
| Progress bar | `████░░░░` | Block-character progress indicator |
| Progress ratio | `3/7 tasks` | Completion count |
| Last event | `[14:23] info: T03 complete` | Most recent log message |

The status colours change with the phase:

| Phase | Colour |
|---|---|
| executing | Green (`#4ade80`) |
| planning / researching | Blue (`#3b82f6`) |
| validating / verifying | Cyan (`#06b6d4`) |
| complete | Green (`#22c55e`) |
| paused | Amber (`#f59e0b`) |
| blocked | Red (`#ef4444`) |

---

## How It Works

Status is delivered via **OSC 1337 user variables** — an escape sequence protocol (originally from iTerm2) that WezTerm supports natively. When GSD updates its state, gsd-wmux writes these escape sequences to stdout:

```
\x1b]1337;SetUserVar=gsd_status=<base64-encoded-value>\x07
```

WezTerm receives them and stores the values on the active pane. The companion Lua config reads them in the `update-right-status` event handler:

```lua
wezterm.on('update-right-status', function(window, pane)
    local vars = pane:get_user_vars()
    local status  = vars.gsd_status or ''
    local phase   = vars.gsd_phase  or ''
    local colour  = vars.gsd_color  or '#888888'
    local progress = tonumber(vars.gsd_progress) or 0
    -- ... render status bar
end)
```

This is zero-latency — there is no polling. Status updates appear immediately.

---

## User Variables Reference

All variables are set by gsd-wmux and read by the Lua config:

| Variable | Example value | Description |
|---|---|---|
| `gsd_status` | `M001 S01/T02 · executing` | Full status label |
| `gsd_phase` | `executing` | Phase name |
| `gsd_color` | `#4ade80` | Phase colour as hex |
| `gsd_icon` | `rocket` | Phase icon name |
| `gsd_progress` | `0.429` | Progress ratio (0–1) |
| `gsd_progress_label` | `3/7 tasks` | Human-readable progress |
| `gsd_last_event` | `[14:23:01] info: Task T03 complete` | Last log event |

You can read these in your own Lua config too:

```lua
local vars = pane:get_user_vars()
if vars.gsd_phase == 'blocked' then
    -- do something
end
```

---

## Customising the Lua Config

The `wezterm/gsd-status.lua` file is designed to be modified. Common customisations:

### Change the progress bar style

Find the `render_progress_bar` function and adjust the fill/empty characters:

```lua
local FILL  = '█'   -- filled block
local EMPTY = '░'   -- light shade
local WIDTH = 10    -- number of characters
```

### Add the GSD icon to tab titles

The Lua config registers a `format-tab-title` handler that prepends the phase icon. If you have your own tab title formatter, merge them:

```lua
wezterm.on('format-tab-title', function(tab, tabs, panes, config, hover, max_width)
    local pane = tab.active_pane
    local vars = pane.user_vars
    local icon = phase_icon(vars.gsd_phase or '')
    local title = tab.active_pane.title
    return icon .. ' ' .. title
end)
```

### Show status only on the active tab

The `update-right-status` handler already reads from `window:active_pane()`. No change needed — status reflects whichever pane is focused.

---

## Notifications

WezTerm supports desktop notifications via **OSC 777**. When GSD sends a notification, gsd-wmux emits:

```
\x1b]777;notify;GSD;Task complete\x07
```

WezTerm converts this to a native desktop notification (macOS, Windows, Linux). No additional configuration is needed — it works out of the box.

### Windows Toast Notifications

On Windows, gsd-wmux also patches GSD's `notifications.js` to use PowerShell + WinRT for native toast notifications. This works even when WezTerm's OSC 777 handling is unavailable. The patch is applied automatically by the installer.

---

## Troubleshooting

### Status bar is not showing

1. Verify gsd-wmux is installed: `npx gsd-wmux --status`
2. Verify cmux is enabled in your project: check GSD preferences for `cmux.enabled: true`
3. Check `WEZTERM_PANE` is set in your shell: `echo $WEZTERM_PANE`
4. Confirm the Lua file is being loaded — add a `wezterm.log_info('gsd-status loaded')` at the top

### Variables are set but nothing renders

Run this in the WezTerm debug overlay (Ctrl+Shift+L) to verify variable values:

```lua
local pane = window:active_pane()
local vars = pane:get_user_vars()
for k, v in pairs(vars) do
    if k:sub(1, 4) == 'gsd_' then
        wezterm.log_info(k .. ' = ' .. v)
    end
end
```

### Phase icon shows as a box or question mark

The status bar uses [Nerd Fonts](https://www.nerdfonts.com/) glyphs. Make sure your WezTerm font is a patched Nerd Font variant, e.g.:

```lua
config.font = wezterm.font('JetBrainsMono Nerd Font')
```

### After updating pi, status stopped working

The pi update restored the stock `cmux/index.js`. Re-run the installer:

```bash
npx gsd-wmux
```
