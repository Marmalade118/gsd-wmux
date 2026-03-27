# gsd-wmux API Reference

**Version:** 0.1.0
**Node.js minimum:** 18+

Complete reference documentation for the gsd-wmux TypeScript package. This package provides a unified multiplexer backend abstraction for GSD (Goal State Driven) — supporting WezTerm, cmux, and extensible for new backends.

---

## Table of Contents

1. [Overview](#overview)
2. [Type Definitions](#type-definitions)
3. [CmuxClient Class](#cmuxclient-class)
4. [Module Functions](#module-functions)
5. [Backend Interface](#backend-interface)
6. [WezTerm Integration](#wezterm-integration)
7. [Environment Detection](#environment-detection)
8. [Utility Functions](#utility-functions)
9. [Error Handling](#error-handling)
10. [Examples](#examples)

---

## Overview

gsd-wmux is a drop-in replacement for the stock `@gsd/cmux` library that abstracts multiplexer backends. It supports:

- **WezTerm** (cross-platform, Windows-native toast notifications)
- **cmux** (macOS, full sidebar integration)
- **Extensible backend system** (add tmux, zellij, psmux, etc.)

The package auto-detects the active terminal multiplexer and delegates all operations accordingly. GSD extensions import from a single unified API and work with any backend.

### Architecture

```
┌─────────────────────────────────┐
│  GSD Extension Code             │
│  (imports gsd-wmux)             │
└────────────────┬────────────────┘
                 │
         ┌───────▼────────┐
         │ CmuxClient     │
         │ Module Fns     │
         └───────┬────────┘
                 │
         ┌───────▼────────┐
         │ Backend Router │
         └───────┬────────┐
                 │        │
    ┌────────────┼────────┼────────────┐
    │            │        │            │
┌───▼──┐  ┌──────▼──┐ ┌──▼──────┐  ┌──▼────┐
│WezTerm│ │ cmux    │ │ (future)│  │(future)
└───────┘  └─────────┘ └─────────┘  └────────┘
```

---

## Type Definitions

### MuxEnvironment

Detected capabilities and transport information for a multiplexer backend.

```typescript
interface MuxEnvironment {
    available: boolean;
    cliAvailable: boolean;
    socketPath: string;
    workspaceId: string | undefined;
    surfaceId: string | undefined;
    backend: string | null;
}
```

**Properties:**

- **`available`** (`boolean`, read-only)
  Whether the backend is usable in the current environment. Determined by checking environment variables, socket existence, or CLI availability.

- **`cliAvailable`** (`boolean`, read-only)
  Whether the backend's command-line tool is on `PATH` and executable. For WezTerm, checks `wezterm` command. For cmux, checks `cmux` command.

- **`socketPath`** (`string`, read-only)
  The IPC transport path:
  - WezTerm: Named pipe (e.g. `\\.\pipe\wezterm-...` on Windows)
  - cmux: Unix socket path (e.g. `/tmp/cmux-XXXXX.socket`)

- **`workspaceId`** (`string | undefined`, read-only)
  Backend-specific workspace or domain identifier:
  - WezTerm: Workspace ID from `wezterm` CLI
  - cmux: Workspace name from `CMUX_WORKSPACE_ID` environment variable
  - Returns `undefined` if not detected

- **`surfaceId`** (`string | undefined`, read-only)
  The active pane or surface ID in the backend:
  - WezTerm: Pane ID from `WEZTERM_PANE` environment variable
  - cmux: Surface ID from `CMUX_SURFACE_ID` environment variable
  - Returns `undefined` if not detected

- **`backend`** (`string | null`, read-only)
  Which backend was detected:
  - `"wezterm"` — WezTerm terminal
  - `"cmux"` — cmux multiplexer
  - `null` — No recognised backend found

---

### MuxConfig

Complete multiplexer configuration, extending `MuxEnvironment` with feature toggles.

```typescript
interface MuxConfig extends MuxEnvironment {
    enabled: boolean;
    notifications: boolean;
    sidebar: boolean;
    splits: boolean;
    browser: boolean;
}
```

**Properties:**

All properties from `MuxEnvironment`, plus:

- **`enabled`** (`boolean`)
  Master toggle. The backend is available AND the user has opted in. When `false`, all operations become no-ops.

- **`notifications`** (`boolean`)
  Route status notifications through the multiplexer system. For WezTerm, uses OSC 777. For cmux, uses the CLI.

- **`sidebar`** (`boolean`)
  Publish status and progress metadata to the backend's display (WezTerm tab bar, cmux sidebar). Sets user variables and progress indicators.

- **`splits`** (`boolean`)
  Permit programmatic pane/split creation and layout management via `createSplit()` and `createGridLayout()`.

- **`browser`** (`boolean`)
  Reserved for future use. Browser pane integration (not currently implemented).

---

### MuxPreferences

User preferences loaded from configuration files or environment.

```typescript
interface MuxPreferences {
    cmux?: {
        enabled?: boolean;
        notifications?: boolean;
        sidebar?: boolean;
        splits?: boolean;
        browser?: boolean;
    };
}
```

**Properties:**

- **`cmux`** (optional object)
  Feature toggles for the cmux backend. Maps directly to `MuxConfig` fields. Only specified fields override defaults; omitted fields use environment-based defaults.

**Example:**

```typescript
const prefs: MuxPreferences = {
    cmux: {
        enabled: true,
        notifications: true,
        sidebar: false,  // Don't publish status to sidebar
    }
};
```

---

### MuxProgress

Progress indicator for the active GSD phase or workflow.

```typescript
interface MuxProgress {
    value: number;
    label: string;
}
```

**Properties:**

- **`value`** (`number`)
  Completion ratio from `0.0` to `1.0`. Example: `0.429` means 42.9% complete.
  - Constraints: Must be within `[0, 1]` inclusive
  - Typical interpretation: sum of completed tasks / total task count

- **`label`** (`string`)
  Human-readable progress description. Examples:
  - `"3/7 tasks"`
  - `"1/2 milestones"`
  - `"2/3 slices, 5/9 tasks"`

---

### MuxCapabilities

Backend capability advertisement returned by `getCapabilities()`.

```typescript
interface MuxCapabilities {
    mode: string;
    access_mode: string;
    methods: string[];
}
```

**Properties:**

- **`mode`** (`string`)
  Backend access mode description. Examples:
  - `"IPC via Unix socket"`
  - `"CLI invocation"`

- **`access_mode`** (`string`)
  Full description of the transport and access method. Examples:
  - `"WezTerm CLI (wezterm) + OSC 1337 user variables"`
  - `"cmux CLI + Unix domain socket at /tmp/cmux.socket"`

- **`methods`** (`string[]`)
  List of supported operation names. Common values:
  - `"setStatus"`
  - `"clearStatus"`
  - `"setProgress"`
  - `"notify"`
  - `"listSurfaceIds"`
  - `"createSplitFrom"`
  - `"sendSurface"`

---

### GsdState

Current state of a GSD workflow (phase, progress, active units).

```typescript
interface GsdState {
    phase: string;
    activeMilestone?: { id: string } | null;
    activeSlice?: { id: string } | null;
    activeTask?: { id: string } | null;
    progress?: {
        tasks?: { done: number; total: number };
        slices?: { done: number; total: number };
        milestones: { done: number; total: number };
    } | null;
}
```

**Properties:**

- **`phase`** (`string`, required)
  Current execution phase. Standard values:
  - `"planning"` — Gathering requirements
  - `"researching"` — Analysing information
  - `"replanning-slice"` — Re-evaluating a slice
  - `"executing"` — Running tasks (default)
  - `"validating-milestone"` — Checking milestone completion
  - `"verifying"` — Final verification
  - `"complete"` — Workflow complete
  - `"completing-milestone"` — Finalising a milestone
  - `"paused"` — Workflow paused
  - `"blocked"` — Workflow blocked (awaiting input/resolution)

- **`activeMilestone`** (optional)
  Current milestone being worked on. Set to `null` when no milestone is active.

- **`activeSlice`** (optional)
  Current slice (logical partition) within a milestone.

- **`activeTask`** (optional)
  Current task being executed.

- **`progress`** (optional)
  Hierarchical progress counters. If specified, contains:
  - `tasks`: `{ done: number, total: number }`
  - `slices`: `{ done: number, total: number }`
  - `milestones`: `{ done: number, total: number }` (always present)

---

### PhaseVisuals

Visual attributes (icon and colour) for a phase.

```typescript
interface PhaseVisuals {
    icon: string;
    color: string;
}
```

**Properties:**

- **`icon`** (`string`)
  Icon identifier used in tab bars and notifications:
  - `"triangle-alert"` — `blocked`
  - `"pause"` — `paused`
  - `"check"` — `complete`, `completing-milestone`
  - `"compass"` — `planning`, `researching`, `replanning-slice`
  - `"shield-check"` — `validating-milestone`, `verifying`
  - `"rocket"` — `executing` (default)

- **`color`** (`string`)
  Hex colour code (e.g. `"#4ade80"`):
  - `"#ef4444"` — Red, `blocked`
  - `"#f59e0b"` — Amber, `paused`
  - `"#22c55e"` — Green, `complete`
  - `"#3b82f6"` — Blue, `planning`
  - `"#06b6d4"` — Cyan, `validating`
  - `"#4ade80"` — Green, `executing`

---

### MuxLogLevel

Severity level for log messages.

```typescript
type MuxLogLevel = "info" | "success" | "warning" | "error" | "progress";
```

**Values:**

- `"info"` — Informational message
- `"success"` — Successful operation
- `"warning"` — Warning (operation continues)
- `"error"` — Error condition
- `"progress"` — Progress update (completion step)

---

### MuxBackend Interface

Backend implementation interface. Extend this to add new multiplexers.

```typescript
interface MuxBackend {
    readonly name: string;
    detect(env?: NodeJS.ProcessEnv): MuxEnvironment;
    isCliAvailable(): boolean;
    setStatus(config: MuxConfig, label: string, phase: string): void;
    clearStatus(config: MuxConfig): void;
    setProgress(config: MuxConfig, progress: MuxProgress | null): void;
    log(config: MuxConfig, message: string, level: MuxLogLevel, source: string): void;
    notify(config: MuxConfig, title: string, body: string, subtitle?: string): boolean;
    getCapabilities(config: MuxConfig): MuxCapabilities | null;
    identify(config: MuxConfig): unknown;
    listSurfaceIds(config: MuxConfig): Promise<string[]>;
    createSplitFrom(config: MuxConfig, sourceId: string | undefined, direction: "right" | "down"): Promise<string | null>;
    sendSurface(config: MuxConfig, surfaceId: string, text: string): Promise<boolean>;
}
```

See [Backend Interface](#backend-interface) section for detailed method documentation.

---

## CmuxClient Class

Main public API. Wraps a `MuxConfig` and delegates to the appropriate backend.

### Constructor

```typescript
constructor(config: MuxConfig)
```

**Parameters:**

- **`config`** (`MuxConfig`, required)
  Configuration object (from `resolveCmuxConfig()`). Must include backend detection results.

**Throws:**

- No exceptions. Invalid config is handled gracefully (backend becomes `null`, operations become no-ops).

**Example:**

```typescript
import { resolveCmuxConfig, CmuxClient } from 'gsd-wmux';

const config = resolveCmuxConfig();
const client = new CmuxClient(config);
```

---

### Static Method: fromPreferences

```typescript
static fromPreferences(preferences?: MuxPreferences): CmuxClient
```

Factory method. Detects the environment and applies user preferences.

**Parameters:**

- **`preferences`** (`MuxPreferences`, optional)
  User-provided overrides. If omitted, all toggles default to environment-based detection.

**Returns:**

- (`CmuxClient`) Initialised client, ready to use.

**Example:**

```typescript
const client = CmuxClient.fromPreferences({
    cmux: { enabled: true, sidebar: true }
});
```

---

### getConfig

```typescript
getConfig(): MuxConfig
```

Returns the current configuration.

**Returns:**

- (`MuxConfig`) The configuration passed to the constructor (or created by `fromPreferences()`).

**Usage:**

Check which backend is active or inspect detected parameters.

```typescript
const cfg = client.getConfig();
console.log(cfg.backend);  // "wezterm" | "cmux" | null
console.log(cfg.enabled);  // boolean
```

---

### canRun

```typescript
canRun(): boolean
```

Determines whether operations will execute or no-op.

**Returns:**

- (`boolean`) `true` if `config.enabled` is `true` and a backend is available.

**Usage:**

Conditional execution based on multiplexer availability.

```typescript
if (client.canRun()) {
    client.setStatus("M001 S01/T02", "executing");
}
```

---

### setStatus

```typescript
setStatus(label: string, phase: string): void
```

Update the current GSD unit label and phase.

**Parameters:**

- **`label`** (`string`, required)
  Descriptive label, e.g. `"M001 S01/T02"` (milestone 001, slice 01, task 02).
  - For WezTerm: Published as `gsd_status` user variable
  - For cmux: Sent to sidebar widget

- **`phase`** (`string`, required)
  Phase name from `GsdState.phase`. See [Phase Visuals](#phase-visuals) for standard values and their visual attributes.

**Throws:**

- No exceptions. If `canRun()` is false, this is a no-op.

**Example:**

```typescript
client.setStatus("M001 S01/T02", "executing");
client.setStatus("M001 S01/T03", "planning");
```

---

### clearStatus

```typescript
clearStatus(): void
```

Erase all GSD status metadata from the backend.

**Parameters:** None

**Throws:** None

**Usage:**

Call when GSD exits or completes to restore the terminal to a clean state.

```typescript
client.clearStatus();
```

---

### setProgress

```typescript
setProgress(progress: MuxProgress | null): void
```

Update the progress indicator.

**Parameters:**

- **`progress`** (`MuxProgress | null`, required)
  Progress object with `value` (0..1) and `label`. Pass `null` to clear the progress indicator.

**Throws:** None

**Example:**

```typescript
client.setProgress({
    value: 0.429,
    label: "3/7 tasks"
});

client.setProgress(null);  // Clear
```

---

### log

```typescript
log(message: string, level?: MuxLogLevel, source?: string): void
```

Emit a log event.

**Parameters:**

- **`message`** (`string`, required)
  Log message text. Examples:
  - `"Task T03 complete"`
  - `"Validating milestone M001"`

- **`level`** (`MuxLogLevel`, optional, default: `"info"`)
  Severity level: `"info" | "success" | "warning" | "error" | "progress"`

- **`source`** (`string`, optional, default: `"gsd"`)
  Source identifier for filtering/routing. Examples:
  - `"gsd"` — Core GSD event
  - `"extension"` — Extension code
  - `"agent"` — AI agent output

**Throws:** None

**Example:**

```typescript
client.log("Starting task execution", "info", "gsd");
client.log("Task complete", "success", "agent");
client.log("Validation failed", "error", "extension");
```

---

### notify

```typescript
notify(title: string, body: string, subtitle?: string): boolean
```

Send a notification to the user.

**Parameters:**

- **`title`** (`string`, required)
  Notification title, e.g. `"Task Complete"`.

- **`body`** (`string`, required)
  Notification body/message, e.g. `"Task T03 finished successfully."`.

- **`subtitle`** (`string`, optional)
  Secondary text. Supported by WezTerm and cmux. Ignored by backends that don't support it.

**Returns:**

- (`boolean`) `true` if delivered; `false` if not delivered or backend unavailable.

**Throws:** None

**Example:**

```typescript
const delivered = client.notify(
    "Milestone Complete",
    "M001 finished successfully",
    "30 tasks completed"
);

if (!delivered) {
    console.warn("Notification could not be delivered");
}
```

---

### getCapabilities

```typescript
getCapabilities(): MuxCapabilities | null
```

Query the active backend's capabilities.

**Returns:**

- (`MuxCapabilities | null`) Capability object, or `null` if no backend is active.

**Example:**

```typescript
const caps = client.getCapabilities();
if (caps) {
    console.log(caps.access_mode);  // "WezTerm CLI + OSC 1337"
    console.log(caps.methods);       // ["setStatus", "notify", ...]
}
```

---

### identify

```typescript
identify(): unknown
```

Query the backend for information about the current pane/surface.

**Returns:**

- (`unknown`) Backend-specific identification data. For WezTerm, returns pane metadata; for cmux, returns surface info. Format depends on backend implementation.

**Example:**

```typescript
const info = client.identify();
console.log(info);  // { pane_id: "0", workspace_id: "default", ... }
```

---

### listSurfaceIds

```typescript
listSurfaceIds(): Promise<string[]>
```

Retrieve all visible pane/surface IDs.

**Returns:**

- (`Promise<string[]>`) Resolves to an array of surface/pane IDs. Empty array if none found or backend unavailable.

**Throws:** None (Promise never rejects; errors are caught and logged internally)

**Example:**

```typescript
const ids = await client.listSurfaceIds();
console.log(ids);  // ["0", "1", "2"]
```

---

### createSplit

```typescript
createSplit(direction: "right" | "down"): Promise<string | null>
```

Create a new split pane from the current surface.

**Parameters:**

- **`direction`** (`"right" | "down"`, required)
  Direction of the split:
  - `"right"` — Create a vertical split to the right
  - `"down"` — Create a horizontal split below

**Returns:**

- (`Promise<string | null>`) Resolves to the new pane ID, or `null` if the operation failed.

**Throws:** None (Promise never rejects)

**Example:**

```typescript
const newPaneId = await client.createSplit("right");
if (newPaneId) {
    console.log(`Created pane: ${newPaneId}`);
} else {
    console.error("Failed to create split");
}
```

---

### createSplitFrom

```typescript
createSplitFrom(sourceSurfaceId: string | undefined, direction: "right" | "down"): Promise<string | null>
```

Create a new split pane from a specific source surface.

**Parameters:**

- **`sourceSurfaceId`** (`string | undefined`, required)
  Source pane ID. If `undefined`, uses the current active pane.

- **`direction`** (`"right" | "down"`, required)
  Direction: `"right"` (vertical) or `"down"` (horizontal)

**Returns:**

- (`Promise<string | null>`) New pane ID or `null` on failure.

**Throws:** None

**Example:**

```typescript
const paneId = await client.createSplitFrom("0", "right");
```

---

### createGridLayout

```typescript
createGridLayout(count: number): Promise<string[]>
```

Create a grid of panes for parallel execution (e.g. multiple agents).

**Parameters:**

- **`count`** (`number`, required)
  Number of agent panes to create. GSD remains in its original pane.
  - `1` → `[gsd | A]`
  - `2` → `[gsd | A]` / `[    | B]`
  - `3` → `[gsd | A]` / `[C   | B]`
  - `4+` → Continues splitting downward

**Returns:**

- (`Promise<string[]>`) Array of new pane IDs (length = `count`). Empty array if operation fails.

**Throws:** None

**Example:**

```typescript
const agentPaneIds = await client.createGridLayout(3);
console.log(agentPaneIds);  // ["pane-1", "pane-2", "pane-3"]

// Send commands to each agent pane
for (const [i, id] of agentPaneIds.entries()) {
    await client.sendSurface(id, `echo "Agent ${i+1}"\n`);
}
```

---

### sendSurface

```typescript
sendSurface(surfaceId: string, text: string): Promise<boolean>
```

Send text input to a specific pane.

**Parameters:**

- **`surfaceId`** (`string`, required)
  Target pane ID (from `listSurfaceIds()` or `createSplit()`).

- **`text`** (`string`, required)
  Text to send. Include newlines (`\n`) to execute commands.

**Returns:**

- (`Promise<boolean>`) `true` if sent; `false` if pane not found or backend unavailable.

**Throws:** None

**Example:**

```typescript
// Execute a command in a specific pane
const success = await client.sendSurface("pane-2", "npm test\n");
if (!success) {
    console.error("Failed to send text to pane");
}
```

---

## Module Functions

Exported top-level functions for environment detection, configuration resolution, and utilities.

### isCmuxCliAvailable

```typescript
function isCmuxCliAvailable(): boolean
```

Check if the `cmux` CLI tool is available on PATH.

**Returns:**

- (`boolean`) `true` if `cmux` command exists and is executable.

**Example:**

```typescript
if (isCmuxCliAvailable()) {
    console.log("cmux backend can be used");
}
```

---

### detectCmuxEnvironment

```typescript
function detectCmuxEnvironment(
    env?: NodeJS.ProcessEnv,
    _socketExists?: (path: string) => boolean,
    _cliAvailable?: () => boolean
): MuxEnvironment
```

Auto-detect available multiplexer backends in the current environment.

**Parameters:**

- **`env`** (`NodeJS.ProcessEnv`, optional, default: `process.env`)
  Environment variables to inspect. Useful for testing.

- **`_socketExists`** (`(path: string) => boolean`, optional)
  Custom socket existence checker. Defaults to `fs.existsSync()`.

- **`_cliAvailable`** (`() => boolean`, optional)
  Custom CLI availability checker. Defaults to built-in detection.

**Returns:**

- (`MuxEnvironment`) Detection result with `available`, `backend`, `socketPath`, etc.

**Example:**

```typescript
const env = detectCmuxEnvironment();
console.log(env.backend);      // "wezterm" | "cmux" | null
console.log(env.available);    // boolean
console.log(env.socketPath);   // IPC path
```

---

### resolveCmuxConfig

```typescript
function resolveCmuxConfig(
    preferences?: MuxPreferences,
    env?: NodeJS.ProcessEnv,
    _socketExists?: (path: string) => boolean,
    _cliAvailable?: () => boolean
): MuxConfig
```

Resolve a complete `MuxConfig` by detecting the environment and applying user preferences.

**Parameters:**

- **`preferences`** (`MuxPreferences`, optional)
  User settings from config files or environment. Overrides detected defaults.

- **`env`** (`NodeJS.ProcessEnv`, optional)
  Custom environment object (for testing).

- **`_socketExists`** (`(path: string) => boolean`, optional)
  Custom socket checker.

- **`_cliAvailable`** (`() => boolean`, optional)
  Custom CLI checker.

**Returns:**

- (`MuxConfig`) Complete configuration with `enabled`, `notifications`, `sidebar`, etc. properly set.

**Algorithm:**

1. Detect environment (WezTerm, cmux, or none)
2. Check if backend is available and CLI tool is on PATH
3. Apply user preferences (if provided), otherwise use defaults
4. Return combined config

**Example:**

```typescript
const config = resolveCmuxConfig({
    cmux: { enabled: true, sidebar: false }
});

const client = new CmuxClient(config);
```

---

### shouldPromptToEnableCmux

```typescript
function shouldPromptToEnableCmux(
    preferences?: MuxPreferences,
    env?: NodeJS.ProcessEnv,
    _socketExists?: (path: string) => boolean,
    _cliAvailable?: () => boolean
): boolean
```

Determine whether to prompt the user to enable multiplexer integration.

**Returns:**

- (`boolean`) `true` if:
  - Backend is available
  - Not yet enabled in preferences
  - User has not previously dismissed the prompt (see `markCmuxPromptShown()`)

**Usage:**

Called by GSD to decide whether to show an interactive setup prompt.

```typescript
if (shouldPromptToEnableCmux()) {
    console.log("Would you like to enable multiplexer integration?");
}
```

---

### markCmuxPromptShown

```typescript
function markCmuxPromptShown(): void
```

Record that the user has been prompted (suppress future prompts).

**Parameters:** None

**Storage:** Writes to `~/.gsd/cmux-prompt-shown` marker file.

**Throws:** None (errors are silently ignored)

---

### resetCmuxPromptState

```typescript
function resetCmuxPromptState(): void
```

Clear the prompt dismissal state (re-enable future prompts).

**Parameters:** None

**Throws:** None

**Usage:**

For testing or if the user wants to be prompted again.

```typescript
resetCmuxPromptState();
```

---

### supportsOsc777Notifications

```typescript
function supportsOsc777Notifications(env?: NodeJS.ProcessEnv): boolean
```

Check whether the terminal supports OSC 777 notifications (iTerm2/WezTerm standard).

**Parameters:**

- **`env`** (`NodeJS.ProcessEnv`, optional, default: `process.env`)
  Environment to inspect.

**Returns:**

- (`boolean`) `true` if the terminal likely supports OSC 777. Based on detecting TERM variables like `xterm-256color`, `screen`, `tmux`, or checking `ITERM_PROGRAM` or `WEZTERM_PANE`.

**Example:**

```typescript
if (supportsOsc777Notifications()) {
    client.notify("Hello", "World");
}
```

---

### emitOsc777Notification

```typescript
function emitOsc777Notification(title: string, body: string): void
```

Emit a raw OSC 777 notification escape sequence to stdout.

**Parameters:**

- **`title`** (`string`) Notification title
- **`body`** (`string`) Notification body

**Throws:** None

**Notes:**

- Used internally by WezTerm backend
- Only has effect if the terminal supports OSC 777
- Writes directly to stdout

**Example:**

```typescript
emitOsc777Notification("Task Complete", "All done!");
```

---

### buildCmuxStatusLabel

```typescript
function buildCmuxStatusLabel(state: GsdState): string
```

Generate a human-readable status label from a `GsdState`.

**Parameters:**

- **`state`** (`GsdState`) Workflow state

**Returns:**

- (`string`) Label string, e.g. `"M001 S01/T02 · executing"`

**Example:**

```typescript
const state: GsdState = {
    phase: "executing",
    activeMilestone: { id: "M001" },
    activeSlice: { id: "S01" },
    activeTask: { id: "T02" }
};

const label = buildCmuxStatusLabel(state);
console.log(label);  // "M001 S01/T02 · executing"
```

---

### buildCmuxProgress

```typescript
function buildCmuxProgress(state: GsdState): MuxProgress | null
```

Generate a `MuxProgress` object from a `GsdState`.

**Parameters:**

- **`state`** (`GsdState`) Workflow state with `progress` field

**Returns:**

- (`MuxProgress | null`) Progress object with `value` and `label`, or `null` if state lacks progress information.

**Example:**

```typescript
const state: GsdState = {
    phase: "executing",
    progress: {
        milestones: { done: 1, total: 3 },
        tasks: { done: 3, total: 7 }
    }
};

const progress = buildCmuxProgress(state);
// { value: 0.428..., label: "3/7 tasks" }
```

---

### shellEscape

```typescript
function shellEscape(value: string): string
```

Escape a string for safe use in shell commands.

**Parameters:**

- **`value`** (`string`) String to escape

**Returns:**

- (`string`) Escaped string, safe to pass to shell.

**Example:**

```typescript
const cmd = `echo ${shellEscape("hello world")}`;
// echo 'hello world'
```

---

### syncCmuxSidebar

```typescript
function syncCmuxSidebar(preferences: MuxPreferences | undefined, state: GsdState): void
```

Synchronise GSD state to the multiplexer's sidebar/status display.

**Parameters:**

- **`preferences`** (`MuxPreferences | undefined`) User preferences
- **`state`** (`GsdState`) Current workflow state

**Throws:** None

**Implementation details:**

- For WezTerm: Sets user variables via `emitUserVar()`
- For cmux: Calls `setStatus()` and `setProgress()`
- No-op if multiplexer is unavailable

**Example:**

```typescript
const state: GsdState = {
    phase: "executing",
    activeMilestone: { id: "M001" },
    progress: { milestones: { done: 1, total: 3 } }
};

syncCmuxSidebar(preferences, state);
```

---

### clearCmuxSidebar

```typescript
function clearCmuxSidebar(preferences: MuxPreferences | undefined): void
```

Clear all GSD metadata from the multiplexer's display.

**Parameters:**

- **`preferences`** (`MuxPreferences | undefined`) User preferences

**Throws:** None

---

### logCmuxEvent

```typescript
function logCmuxEvent(
    preferences: MuxPreferences | undefined,
    message: string,
    level?: MuxLogLevel
): void
```

Log an event to the multiplexer's log/status display.

**Parameters:**

- **`preferences`** (`MuxPreferences | undefined`) User preferences
- **`message`** (`string`) Log message
- **`level`** (`MuxLogLevel`, optional) Log severity

**Throws:** None

**Example:**

```typescript
logCmuxEvent(preferences, "Task T03 complete", "success");
```

---

## Backend Interface

Complete documentation of the `MuxBackend` interface. Implement this to add a new multiplexer.

### readonly name

```typescript
readonly name: string
```

Unique backend identifier (e.g. `"wezterm"`, `"cmux"`, `"tmux"`).

---

### detect()

```typescript
detect(env?: NodeJS.ProcessEnv): MuxEnvironment
```

Detect whether this backend is available in the current environment.

**Parameters:**

- **`env`** (`NodeJS.ProcessEnv`, optional) Environment variables

**Returns:**

- (`MuxEnvironment`) Detection result with:
  - `available: true` — Backend is usable
  - `available: false` — Backend not detected
  - `backend` — Set to `this.name` if available
  - `socketPath` — IPC transport (if available)
  - `workspaceId`, `surfaceId` — Identifiers (if available)

**Example implementation:**

```typescript
detect(env = process.env): MuxEnvironment {
    const pane = env.WEZTERM_PANE;
    if (!pane) {
        return { available: false, ... };
    }
    return {
        available: true,
        backend: "wezterm",
        surfaceId: pane,
        socketPath: "/path/to/socket",
        ...
    };
}
```

---

### isCliAvailable()

```typescript
isCliAvailable(): boolean
```

Check if the backend's CLI tool is on PATH and functional.

**Returns:**

- (`boolean`) `true` if CLI is available

---

### setStatus()

```typescript
setStatus(config: MuxConfig, label: string, phase: string): void
```

Update status label and phase.

**Parameters:**

- **`config`** (`MuxConfig`) Configuration
- **`label`** (`string`) Status label (e.g. `"M001 S01/T02"`)
- **`phase`** (`string`) Phase name

---

### clearStatus()

```typescript
clearStatus(config: MuxConfig): void
```

Clear all status metadata.

---

### setProgress()

```typescript
setProgress(config: MuxConfig, progress: MuxProgress | null): void
```

Update progress indicator or clear if `null`.

---

### log()

```typescript
log(config: MuxConfig, message: string, level: MuxLogLevel, source: string): void
```

Log an event.

---

### notify()

```typescript
notify(config: MuxConfig, title: string, body: string, subtitle?: string): boolean
```

Send a notification. Returns `true` if delivered.

---

### getCapabilities()

```typescript
getCapabilities(config: MuxConfig): MuxCapabilities | null
```

Return backend capability information.

---

### identify()

```typescript
identify(config: MuxConfig): unknown
```

Return backend-specific pane/surface information.

---

### listSurfaceIds()

```typescript
listSurfaceIds(config: MuxConfig): Promise<string[]>
```

List all visible pane/surface IDs.

**Returns:** Promise resolving to array of IDs

---

### createSplitFrom()

```typescript
createSplitFrom(config: MuxConfig, sourceId: string | undefined, direction: "right" | "down"): Promise<string | null>
```

Create a split pane. Returns new pane ID or `null` on failure.

---

### sendSurface()

```typescript
sendSurface(config: MuxConfig, surfaceId: string, text: string): Promise<boolean>
```

Send text to a pane. Returns `true` if successful.

---

## WezTerm Integration

### User Variables

gsd-wmux publishes these user variables on the active WezTerm pane. Access via `pane:get_user_vars()` in your WezTerm Lua config.

| Variable | Type | Example | Description |
|---|---|---|---|
| `gsd_status` | string | `M001 S01/T02 · executing` | Current unit label and phase |
| `gsd_phase` | string | `executing` | Phase name only |
| `gsd_color` | string | `#4ade80` | Phase hex colour |
| `gsd_icon` | string | `rocket` | Phase icon name |
| `gsd_progress` | string | `0.429` | Completion ratio (0..1) |
| `gsd_progress_label` | string | `3/7 tasks` | Human-readable progress |
| `gsd_last_event` | string | `[14:23:01] info: Task T03 complete` | Last log event |

### Phase Visuals Table

| Phase | Icon | Colour |
|---|---|---|
| `blocked` | triangle-alert | #ef4444 (red) |
| `paused` | pause | #f59e0b (amber) |
| `complete` | check | #22c55e (green) |
| `completing-milestone` | check | #22c55e (green) |
| `planning` | compass | #3b82f6 (blue) |
| `researching` | compass | #3b82f6 (blue) |
| `replanning-slice` | compass | #3b82f6 (blue) |
| `validating-milestone` | shield-check | #06b6d4 (cyan) |
| `verifying` | shield-check | #06b6d4 (cyan) |
| `executing` | rocket | #4ade80 (green, default) |

### Companion Lua Config

The gsd-wmux package includes `wezterm/gsd-status.lua`, a companion configuration module that reads these user variables and renders GSD status in the WezTerm tab bar.

**Installation:**

```lua
-- In ~/.wezterm.lua
local gsd = require('gsd-status')
```

Or copy `wezterm/gsd-status.lua` to your WezTerm config directory and require it.

**Features:**

- Displays phase icon and colour in tab bar
- Shows current milestone/slice/task label
- Renders progress bar with completion ratio
- Updates in real-time as user variables change

---

## Environment Detection

### Detection Order

gsd-wmux detects available backends in this order:

1. **WezTerm**: If `WEZTERM_PANE` environment variable is set → backend available
2. **cmux**: If `CMUX_WORKSPACE_ID` and `CMUX_SURFACE_ID` are set → backend available
3. **CLI availability**: Falls back to checking if `wezterm` or `cmux` CLI is on PATH
4. **None**: If no backend is detected, all operations are no-ops

### Environment Variables

| Variable | Backend | Meaning |
|---|---|---|
| `WEZTERM_PANE` | WezTerm | Current pane ID (set by WezTerm) |
| `CMUX_WORKSPACE_ID` | cmux | Workspace name |
| `CMUX_SURFACE_ID` | cmux | Current surface/pane ID |

---

## Utility Functions

### phaseVisuals

```typescript
function phaseVisuals(phase: string): PhaseVisuals
```

Retrieve icon and colour for a phase.

**Parameters:**

- **`phase`** (`string`) Phase name

**Returns:**

- (`PhaseVisuals`) Icon and colour

**Example:**

```typescript
const visuals = phaseVisuals("executing");
// { icon: "rocket", color: "#4ade80" }
```

---

### normalizeNotificationText

```typescript
function normalizeNotificationText(value: string): string
```

Clean notification text (remove control characters, trim whitespace).

---

### parseJson

```typescript
function parseJson(text: string): unknown
```

Safely parse JSON with error handling.

---

### emitUserVar

```typescript
function emitUserVar(name: string, value: string): void
```

Emit a WezTerm OSC 1337 user variable assignment.

**Parameters:**

- **`name`** (`string`) Variable name (e.g. `"gsd_status"`)
- **`value`** (`string`) Variable value

**Throws:** None

---

### clearUserVar

```typescript
function clearUserVar(name: string): void
```

Clear a WezTerm user variable.

---

### runCliSync

```typescript
function runCliSync(cmd: string, args: string[], timeoutMs?: number): string | null
```

Run a CLI command synchronously.

**Returns:**

- (`string | null`) stdout output or `null` on error/timeout

---

### runCliAsync

```typescript
function runCliAsync(cmd: string, args: string[], timeoutMs?: number): Promise<string | null>
```

Run a CLI command asynchronously.

**Returns:**

- (`Promise<string | null>`) Resolves to stdout or `null` on error/timeout

---

## Error Handling

### Design Philosophy

gsd-wmux follows a **graceful degradation** pattern:

1. **Never throws**. All public functions catch errors and return safe defaults (`null`, empty arrays, `false`)
2. **Continues operation** even if a backend is unavailable
3. **Logs errors internally** (visible via process stderr if needed)
4. **Safe defaults** — If the backend is unavailable, operations silently no-op

### Common Scenarios

**Backend unavailable:**
```typescript
const client = new CmuxClient(config);
if (!client.canRun()) {
    // Backend not available, operations will no-op
    console.log("Multiplexer not detected");
}

client.setStatus("M001", "executing");  // Safe no-op
```

**Notification delivery failed:**
```typescript
const delivered = client.notify("Title", "Body");
if (!delivered) {
    console.warn("Could not deliver notification");
    // Continue — this is not a fatal error
}
```

**Async operations:**
```typescript
const ids = await client.listSurfaceIds();
// Returns [] if operation fails; Promise never rejects
```

---

## Examples

### Basic Usage

```typescript
import { CmuxClient, resolveCmuxConfig } from 'gsd-wmux';

// Detect environment and create client
const config = resolveCmuxConfig();
const client = new CmuxClient(config);

// Update status
if (client.canRun()) {
    client.setStatus("M001 S01/T01", "executing");
    client.setProgress({ value: 0.25, label: "1/4 tasks" });
}
```

### With User Preferences

```typescript
const prefs = {
    cmux: {
        enabled: true,
        notifications: true,
        sidebar: true,
    }
};

const client = CmuxClient.fromPreferences(prefs);
```

### Pane Management

```typescript
// Create a split for an agent
const agentPaneId = await client.createSplit("right");
if (agentPaneId) {
    // Run a command in the agent pane
    await client.sendSurface(agentPaneId, "npm test\n");
}

// Create a grid for multiple agents
const paneIds = await client.createGridLayout(3);
for (const [i, id] of paneIds.entries()) {
    await client.sendSurface(id, `echo "Agent ${i+1}"\n`);
}
```

### Full Integration

```typescript
import {
    CmuxClient,
    resolveCmuxConfig,
    buildCmuxStatusLabel,
    buildCmuxProgress,
} from 'gsd-wmux';

const state = {
    phase: "executing",
    activeMilestone: { id: "M001" },
    activeSlice: { id: "S01" },
    activeTask: { id: "T02" },
    progress: {
        milestones: { done: 0, total: 3 },
        tasks: { done: 3, total: 7 }
    }
};

const client = new CmuxClient(resolveCmuxConfig());
if (client.canRun()) {
    const label = buildCmuxStatusLabel(state);
    const progress = buildCmuxProgress(state);

    client.setStatus(label, state.phase);
    if (progress) {
        client.setProgress(progress);
    }

    client.log("Task T02 complete", "success", "agent");
    client.notify("Task Complete", "T02 finished");
}
```

### Custom Backend Implementation

```typescript
import type { MuxBackend, MuxConfig, MuxEnvironment } from 'gsd-wmux';

export class MyMuxBackend implements MuxBackend {
    readonly name = "mymux";

    detect(env = process.env): MuxEnvironment {
        const available = env.MYMUX_SOCKET !== undefined;
        return {
            available,
            cliAvailable: this.isCliAvailable(),
            socketPath: env.MYMUX_SOCKET || "",
            workspaceId: env.MYMUX_WORKSPACE,
            surfaceId: env.MYMUX_PANE,
            backend: available ? "mymux" : null,
        };
    }

    isCliAvailable(): boolean {
        // Check if 'mymux' command is on PATH
        return true;  // Implement your check
    }

    setStatus(config: MuxConfig, label: string, phase: string): void {
        // Implement status update
    }

    // ... implement remaining methods
}
```

---

## Glossary

- **Backend**: A terminal multiplexer implementation (WezTerm, cmux, tmux, etc.)
- **Pane/Surface**: A terminal view or split (backend-specific terminology)
- **Workspace**: A backend-level grouping (WezTerm workspace, cmux workspace)
- **OSC**: Operating System Command — escape sequence for terminal control
- **Socket**: IPC transport (Unix domain socket on Unix, named pipe on Windows)
- **User variable**: WezTerm pane metadata readable by Lua config
- **Phase**: Workflow state (planning, executing, validating, complete, etc.)
- **Milestone**: Top-level unit of work
- **Slice**: Partition within a milestone
- **Task**: Individual unit of execution

---

## References

- [WezTerm Documentation](https://wezfurlong.org)
- [cmux Documentation](https://cmux.com)
- [GSD (Goal State Driven)](https://github.com/gsd-build/gsd-2)
- [OSC 777 Specification](https://specs.frux.org/specs/751)

---

**Document version:** 0.1.0
**Last updated:** 2026-03-27
**License:** MIT
