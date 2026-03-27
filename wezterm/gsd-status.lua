-- gsd-wmux: WezTerm status bar integration for GSD
--
-- Renders GSD auto-mode status, progress, and last event in WezTerm's
-- right status bar. Reads data from user variables set by gsd-wmux
-- via OSC 1337 escape sequences.
--
-- INSTALLATION:
--   Option A: require() this file from your wezterm.lua:
--     require('gsd-status')
--
--   Option B: Copy the wezterm.on() blocks below into your existing
--     update-right-status handler.
--
-- USER VARIABLES (set by gsd-wmux automatically):
--   gsd_status          — current unit label, e.g. "M001 S01/T02 · executing"
--   gsd_phase           — phase name, e.g. "executing", "planning", "blocked"
--   gsd_color           — hex color for the phase, e.g. "#4ade80"
--   gsd_icon            — icon name (for reference; not rendered as glyph)
--   gsd_progress        — 0.000..1.000 completion ratio
--   gsd_progress_label  — human label, e.g. "3/7 tasks"
--   gsd_last_event      — last log event, e.g. "[14:23:01] info: Task T03 complete"

local wezterm = require 'wezterm'

-- ── Phase → Nerd Font icon mapping ─────────────────────────────────

local phase_icons = {
    blocked               = wezterm.nerdfonts.fa_exclamation_triangle,  -- 
    paused                = wezterm.nerdfonts.fa_pause,                 -- 
    complete              = wezterm.nerdfonts.fa_check_circle,          -- 
    ['completing-milestone'] = wezterm.nerdfonts.fa_check_circle,
    planning              = wezterm.nerdfonts.fa_compass,               -- 
    researching           = wezterm.nerdfonts.fa_compass,
    ['replanning-slice']  = wezterm.nerdfonts.fa_compass,
    ['validating-milestone'] = wezterm.nerdfonts.fa_shield,            -- 
    verifying             = wezterm.nerdfonts.fa_shield,
    executing             = wezterm.nerdfonts.fa_rocket,                -- 
}

local function get_phase_icon(phase)
    return phase_icons[phase] or wezterm.nerdfonts.fa_rocket
end

-- ── Progress bar renderer ──────────────────────────────────────────

local function render_progress_bar(ratio, width)
    width = width or 10
    local filled = math.floor(ratio * width + 0.5)
    local empty = width - filled
    -- Use block characters for a clean progress bar
    return string.rep('█', filled) .. string.rep('░', empty)
end

-- ── GSD status renderer ───────────────────────────────────────────

local function render_gsd_status(pane)
    local vars = pane:get_user_vars()
    local status_text = vars.gsd_status or ''
    if status_text == '' then return nil end

    local phase = vars.gsd_phase or 'executing'
    local color = vars.gsd_color or '#4ade80'
    local progress_str = vars.gsd_progress or ''
    local progress_label = vars.gsd_progress_label or ''

    local elements = {}

    -- Separator
    table.insert(elements, { Foreground = { Color = '#5a6374' } })
    table.insert(elements, { Background = { Color = '#1a1d23' } })
    table.insert(elements, { Text = ' │ ' })

    -- Phase icon
    local icon = get_phase_icon(phase)
    table.insert(elements, { Foreground = { Color = color } })
    table.insert(elements, { Text = icon .. ' ' })

    -- Status label
    table.insert(elements, { Foreground = { Color = '#dcdfe4' } })
    table.insert(elements, { Text = status_text })

    -- Progress bar (if available)
    if progress_str ~= '' then
        local ratio = tonumber(progress_str) or 0
        table.insert(elements, { Text = '  ' })
        table.insert(elements, { Foreground = { Color = color } })
        table.insert(elements, { Text = render_progress_bar(ratio, 8) })
        if progress_label ~= '' then
            table.insert(elements, { Foreground = { Color = '#9da5b4' } })
            table.insert(elements, { Text = ' ' .. progress_label })
        end
    end

    table.insert(elements, { Text = ' ' })

    return elements
end

-- ── Register the event handler ─────────────────────────────────────
--
-- This replaces any existing update-right-status handler.
-- If you already have one, merge the render_gsd_status() call into it.

wezterm.on('update-right-status', function(window, pane)
    local process = pane:get_foreground_process_name() or ''
    local title   = pane:get_title() or ''
    local is_ssh  = process:lower():find('ssh') ~= nil

    -- Location indicator (LOCAL/REMOTE)
    local bg_color, fg_color, tag
    if is_ssh then
        bg_color = '#2d4a2d'
        fg_color = '#98c379'
        tag      = 'REMOTE'
    else
        bg_color = '#1e2a3a'
        fg_color = '#61afef'
        tag      = 'LOCAL'
    end

    local display = tag
    if title ~= '' and not title:lower():find('^psmux') then
        if #title > 35 then title = title:sub(1, 32) .. '...' end
        display = tag .. '  ' .. title
    end

    -- Build the status bar elements
    local elements = {}

    -- GSD status (if active)
    local gsd_elements = render_gsd_status(pane)
    if gsd_elements then
        for _, el in ipairs(gsd_elements) do
            table.insert(elements, el)
        end
    end

    -- Leader key hints
    local leader_hint = '  C-/: ↓→split  x close  s launch  o/p ssh  '
    table.insert(elements, { Background = { Color = '#1a1d23' } })
    table.insert(elements, { Foreground = { Color = '#5a6374' } })
    table.insert(elements, { Text = leader_hint })

    -- Location badge
    table.insert(elements, { Background = { Color = bg_color } })
    table.insert(elements, { Foreground = { Color = fg_color } })
    table.insert(elements, { Text = '  ' .. display .. '  ' })

    window:set_right_status(wezterm.format(elements))
end)

-- ── Tab title with GSD annotation ──────────────────────────────────

wezterm.on('format-tab-title', function(tab, tabs, panes, cfg, hover, max_width)
    local pane    = tab.active_pane
    local process = pane.foreground_process_name or ''
    local title   = tab.tab_title ~= '' and tab.tab_title or pane.title or ''
    local is_ssh  = process:lower():find('ssh') ~= nil
    local prefix  = is_ssh and '[R] ' or '[L] '

    -- Check for GSD status on this pane
    local vars = pane.user_vars or {}
    local gsd_phase = vars.gsd_phase or ''
    if gsd_phase ~= '' then
        local icon = get_phase_icon(gsd_phase)
        prefix = icon .. ' '
    end

    if #title > max_width - 5 then
        title = title:sub(1, max_width - 8) .. '...'
    end

    local fg = '#dcdfe4'
    if gsd_phase == 'blocked' then
        fg = '#ef4444'
    elseif gsd_phase == 'complete' or gsd_phase == 'completing-milestone' then
        fg = '#22c55e'
    elseif is_ssh then
        fg = '#98c379'
    end

    return {
        { Foreground = { Color = fg } },
        { Text = prefix .. title },
    }
end)

return {}
