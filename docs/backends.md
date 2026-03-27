# Implementing a New Backend

This guide walks through adding a new terminal multiplexer backend to gsd-wmux.

## Overview

All backends implement the `MuxBackend` interface defined in `src/types.ts`. The auto-detection loop in `src/index.ts` iterates the `BACKENDS` array in order and selects the first backend whose `detect()` method returns `available: true`.

---

## 1. Create the Backend File

Create `src/backends/your-mux.ts`:

```typescript
import { execFileSync } from "node:child_process";
import type {
    MuxBackend,
    MuxCapabilities,
    MuxConfig,
    MuxEnvironment,
    MuxProgress,
} from "../types.js";
import { runCliSync, runCliAsync, parseJson } from "../utils.js";

export class YourMuxBackend implements MuxBackend {
    readonly name = "yourmux";

    private _cliAvailable: boolean | null = null;

    // ─── Detection ──────────────────────────────────────────────────────────

    detect(env: NodeJS.ProcessEnv = process.env): MuxEnvironment {
        const sessionId = env.YOURMUX_SESSION;
        const paneId    = env.YOURMUX_PANE;
        const cli       = this.isCliAvailable();

        const available = (!!sessionId && !!paneId) || cli;

        return {
            available,
            cliAvailable: cli,
            socketPath:   "",           // or the IPC path if applicable
            workspaceId:  sessionId,
            surfaceId:    paneId,
            backend:      available ? this.name : null,
        };
    }

    isCliAvailable(): boolean {
        if (this._cliAvailable !== null) return this._cliAvailable;
        const result = runCliSync("yourmux", ["--version"]);
        this._cliAvailable = result !== null;
        return this._cliAvailable;
    }

    // ─── Status & Progress ───────────────────────────────────────────────────

    setStatus(config: MuxConfig, label: string, phase: string): void {
        if (!config.sidebar) return;
        runCliSync("yourmux", ["set-status", label, "--phase", phase]);
    }

    clearStatus(config: MuxConfig): void {
        runCliSync("yourmux", ["clear-status"]);
    }

    setProgress(config: MuxConfig, progress: MuxProgress | null): void {
        if (!config.sidebar) return;
        if (progress) {
            runCliSync("yourmux", [
                "set-progress",
                String(progress.value),
                "--label", progress.label,
            ]);
        } else {
            runCliSync("yourmux", ["clear-progress"]);
        }
    }

    log(
        config: MuxConfig,
        message: string,
        level: string,
        source: string,
    ): void {
        runCliSync("yourmux", ["log", "--level", level, "--source", source, "--", message]);
    }

    // ─── Notifications ───────────────────────────────────────────────────────

    notify(
        config: MuxConfig,
        title: string,
        body: string,
        subtitle?: string,
    ): boolean {
        if (!config.notifications) return false;
        const args = ["notify", "--title", title, "--body", body];
        if (subtitle) args.push("--subtitle", subtitle);
        return runCliSync("yourmux", args) !== null;
    }

    // ─── Capabilities & Identity ─────────────────────────────────────────────

    getCapabilities(config: MuxConfig): MuxCapabilities | null {
        const raw = runCliSync("yourmux", ["capabilities", "--json"]);
        return raw ? (parseJson(raw) as MuxCapabilities) : null;
    }

    identify(config: MuxConfig): unknown {
        const raw = runCliSync("yourmux", ["identify", "--json"]);
        return raw ? parseJson(raw) : null;
    }

    // ─── Pane Management ─────────────────────────────────────────────────────

    async listSurfaceIds(config: MuxConfig): Promise<string[]> {
        const raw = await runCliAsync("yourmux", ["list-panes", "--json"]);
        if (!raw) return [];
        const data = parseJson(raw);
        // Parse the JSON response and extract pane IDs
        // Shape will depend on your multiplexer's CLI output
        return (data as any[]).map((p) => String(p.id));
    }

    async createSplitFrom(
        config: MuxConfig,
        sourceId: string | undefined,
        direction: "right" | "down",
    ): Promise<string | null> {
        const args = ["split-pane", `--${direction}`];
        if (sourceId) args.push("--pane-id", sourceId);
        const raw = await runCliAsync("yourmux", args);
        if (!raw) return null;
        const data = parseJson(raw) as any;
        return data?.pane_id ? String(data.pane_id) : null;
    }

    async sendSurface(
        config: MuxConfig,
        surfaceId: string,
        text: string,
    ): Promise<boolean> {
        const result = await runCliAsync("yourmux", [
            "send-text",
            "--pane-id", surfaceId,
            text,
        ]);
        return result !== null;
    }
}
```

---

## 2. Register the Backend

Open `src/index.ts` and add your backend to the `BACKENDS` array. Order determines detection priority — more specific detectors should come first:

```typescript
import { WeztermBackend } from "./backends/wezterm.js";
import { YourMuxBackend } from "./backends/your-mux.js";   // add this
import { CmuxBackend } from "./backends/cmux.js";

const BACKENDS: MuxBackend[] = [
    new WeztermBackend(),
    new YourMuxBackend(),   // add here, before the generic cmux fallback
    new CmuxBackend(),
];
```

---

## 3. Build and Test

```bash
npm run build
node scripts/install.js
```

Open a project in your multiplexer, enable cmux (`/gsd cmux on`), and run a task to verify status appears.

---

## Detection Guidelines

Your `detect()` method should be fast and non-destructive. Preferred checks (in order of reliability):

1. **Environment variables** set by the multiplexer itself (most reliable, zero cost)
2. **Socket/pipe file existence** — `fs.existsSync(socketPath)`
3. **CLI availability** — `runCliSync("yourmux", ["--version"])` with caching

Avoid network calls, spawning subprocesses without caching, or any operation that might block or fail loudly.

```typescript
detect(env = process.env): MuxEnvironment {
    // Fast path: check env vars first
    const paneId = env.YOURMUX_PANE;
    if (paneId) {
        return { available: true, cliAvailable: true, surfaceId: paneId, ... };
    }

    // Slow path: check CLI (cached)
    const cli = this.isCliAvailable();
    return { available: cli, cliAvailable: cli, ... };
}
```

---

## Error Handling

Backend methods must **never throw**. All CLI calls should return `null` on failure. The `runCliSync` and `runCliAsync` utilities from `src/utils.ts` already handle this — prefer them over raw `execFileSync`/`execFile` calls.

```typescript
// Good — silent failure
setStatus(config, label, phase): void {
    runCliSync("yourmux", ["set-status", label]);  // returns null on error
}

// Bad — can throw and break GSD
setStatus(config, label, phase): void {
    execFileSync("yourmux", ["set-status", label]);  // throws if yourmux not found
}
```

---

## MuxBackend Interface Reference

All methods are required. See [api-reference.md](api-reference.md) for full type signatures.

| Method | Required | Description |
|---|---|---|
| `detect(env?)` | Yes | Detect if this backend is available in the current environment |
| `isCliAvailable()` | Yes | Check (and cache) whether the CLI tool is on PATH |
| `setStatus(config, label, phase)` | Yes | Display a status label |
| `clearStatus(config)` | Yes | Remove the status display |
| `setProgress(config, progress)` | Yes | Update the progress bar; `null` clears it |
| `log(config, message, level, source)` | Yes | Append an event to the log |
| `notify(config, title, body, subtitle?)` | Yes | Send a desktop notification; returns `true` if sent |
| `getCapabilities(config)` | Yes | Return backend capability flags; `null` if unsupported |
| `identify(config)` | Yes | Return backend identity info (version, etc.); `null` if unsupported |
| `listSurfaceIds(config)` | Yes | Return list of pane/surface IDs |
| `createSplitFrom(config, sourceId, direction)` | Yes | Create a new split pane; return the new pane ID or `null` |
| `sendSurface(config, surfaceId, text)` | Yes | Send text to a specific pane; return `true` on success |

---

## Documenting the Backend

After implementing your backend, add a brief entry to this file under a new `## Backends` section, describing:

- What environment variables it detects
- What CLI tool it requires
- Any platform limitations
- Any known caveats
