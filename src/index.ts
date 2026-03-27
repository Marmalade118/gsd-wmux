// gsd-wmux
/**
 * gsd-wmux — Drop-in replacement for @gsd/cmux
 *
 * This file exports the exact same API surface that GSD extensions import
 * from "../cmux/index.js". The internal implementation auto-detects the
 * active multiplexer backend (WezTerm, cmux) and delegates accordingly.
 *
 * To add a new backend:
 * 1. Implement MuxBackend in src/backends/your-backend.ts
 * 2. Register it in the BACKENDS array below
 * 3. The auto-detection loop will pick it up if its detect() returns available:true
 */

import type {
    MuxBackend, MuxConfig, MuxEnvironment, MuxCapabilities,
    MuxProgress, MuxPreferences, GsdState,
} from "./types.js";
import { WeztermBackend } from "./backends/wezterm.js";
import { CmuxBackend } from "./backends/cmux.js";
import {
    buildStatusLabel, buildProgress,
    emitOsc777Notification, supportsOsc777Notifications,
    shellEscape as _shellEscape, normalizeNotificationText,
} from "./utils.js";

// ── Backend registry ───────────────────────────────────────────────
// Order matters: first available backend wins.
// WezTerm is tried first since it works cross-platform.

const BACKENDS: MuxBackend[] = [
    new WeztermBackend(),
    new CmuxBackend(),
];

// ── State ──────────────────────────────────────────────────────────

const lastSidebarSnapshots = new Map<string, string>();
let muxPromptedThisSession = false;

// ── Auto-detection ─────────────────────────────────────────────────

function resolveBackend(env: NodeJS.ProcessEnv = process.env): { backend: MuxBackend; env: MuxEnvironment } | null {
    for (const backend of BACKENDS) {
        const detected = backend.detect(env);
        if (detected.available) {
            return { backend, env: detected };
        }
    }
    return null;
}

// ── GSD-compatible API surface ─────────────────────────────────────
// Every export below matches the original cmux/index.js exactly.

export function isCmuxCliAvailable(): boolean {
    const resolved = resolveBackend();
    return resolved?.env.cliAvailable ?? false;
}

export function detectCmuxEnvironment(
    env: NodeJS.ProcessEnv = process.env,
    _socketExists?: (path: string) => boolean,
    _cliAvailable?: () => boolean,
): MuxEnvironment {
    const resolved = resolveBackend(env);
    if (resolved) return resolved.env;

    // No backend available — return empty detection (same shape as original)
    return {
        available: false,
        cliAvailable: false,
        socketPath: "",
        workspaceId: undefined,
        surfaceId: undefined,
        backend: null,
    };
}

export function resolveCmuxConfig(
    preferences?: MuxPreferences,
    env: NodeJS.ProcessEnv = process.env,
    _socketExists?: (path: string) => boolean,
    _cliAvailable?: () => boolean,
): MuxConfig {
    const detected = detectCmuxEnvironment(env);
    const cmux = preferences?.cmux ?? {};
    const enabled = detected.available && cmux.enabled === true;
    return {
        ...detected,
        enabled,
        notifications: enabled && cmux.notifications !== false,
        sidebar: enabled && cmux.sidebar !== false,
        splits: enabled && cmux.splits === true,
        browser: enabled && cmux.browser === true,
    };
}

export function shouldPromptToEnableCmux(
    preferences?: MuxPreferences,
    env: NodeJS.ProcessEnv = process.env,
    _socketExists?: (path: string) => boolean,
    _cliAvailable?: () => boolean,
): boolean {
    if (muxPromptedThisSession) return false;
    const detected = detectCmuxEnvironment(env);
    if (!detected.available) return false;
    return preferences?.cmux?.enabled === undefined;
}

export function markCmuxPromptShown(): void {
    muxPromptedThisSession = true;
}

export function resetCmuxPromptState(): void {
    muxPromptedThisSession = false;
}

// Re-export OSC helpers
export { supportsOsc777Notifications, emitOsc777Notification };

// Re-export builders (GSD auto.js uses these)
export { buildStatusLabel as buildCmuxStatusLabel };
export { buildProgress as buildCmuxProgress };

// Re-export shell escape
export { _shellEscape as shellEscape };

// ── CmuxClient (GSD-compatible wrapper) ────────────────────────────

function getBackendForConfig(config: MuxConfig): MuxBackend | null {
    if (!config.backend) return null;
    return BACKENDS.find(b => b.name === config.backend) ?? null;
}

export class CmuxClient {
    config: MuxConfig;
    private backend: MuxBackend | null;

    constructor(config: MuxConfig) {
        this.config = config;
        this.backend = getBackendForConfig(config);
    }

    static fromPreferences(preferences?: MuxPreferences): CmuxClient {
        return new CmuxClient(resolveCmuxConfig(preferences));
    }

    getConfig(): MuxConfig {
        return this.config;
    }

    canRun(): boolean {
        return this.config.available && this.config.cliAvailable && this.backend !== null;
    }

    // ── Status ─────────────────────────────────────────────────────

    setStatus(label: string, phase: string): void {
        this.backend?.setStatus(this.config, label, phase);
    }

    clearStatus(): void {
        this.backend?.clearStatus(this.config);
    }

    setProgress(progress: MuxProgress | null): void {
        this.backend?.setProgress(this.config, progress);
    }

    log(message: string, level: "info" | "success" | "warning" | "error" | "progress" = "info", source = "gsd"): void {
        this.backend?.log(this.config, message, level, source);
    }

    // ── Notifications ──────────────────────────────────────────────

    notify(title: string, body: string, subtitle?: string): boolean {
        if (!this.backend) return false;
        return this.backend.notify(this.config, title, body, subtitle);
    }

    // ── Capabilities ───────────────────────────────────────────────

    getCapabilities(): MuxCapabilities | null {
        return this.backend?.getCapabilities(this.config) ?? null;
    }

    identify(): unknown {
        return this.backend?.identify(this.config) ?? null;
    }

    // ── Pane management ────────────────────────────────────────────

    async listSurfaceIds(): Promise<string[]> {
        return this.backend?.listSurfaceIds(this.config) ?? [];
    }

    async createSplit(direction: "right" | "down"): Promise<string | null> {
        return this.createSplitFrom(this.config.surfaceId, direction);
    }

    async createSplitFrom(sourceSurfaceId: string | undefined, direction: "right" | "down"): Promise<string | null> {
        if (!this.config.splits || !this.backend) return null;
        return this.backend.createSplitFrom(this.config, sourceSurfaceId, direction);
    }

    /**
     * Create a grid of surfaces for parallel agent execution.
     *
     * Layout strategy (gsd stays in the original surface):
     *   1 agent:  [gsd | A]
     *   2 agents: [gsd | A]
     *             [    | B]
     *   3 agents: [gsd | A]
     *             [ C  | B]
     *   4+:       Continues splitting downward
     */
    async createGridLayout(count: number): Promise<string[]> {
        if (!this.config.splits || count <= 0 || !this.backend) return [];
        const surfaces: string[] = [];

        const selfId = this.config.surfaceId
            ?? process.env.WEZTERM_PANE?.trim();

        // Right column
        const rightCol = await this.backend.createSplitFrom(this.config, selfId, "right");
        if (!rightCol) return [];
        surfaces.push(rightCol);
        if (count === 1) return surfaces;

        // Bottom-right
        const bottomRight = await this.backend.createSplitFrom(this.config, rightCol, "down");
        if (!bottomRight) return surfaces;
        surfaces.push(bottomRight);
        if (count === 2) return surfaces;

        // Bottom-left
        const bottomLeft = await this.backend.createSplitFrom(this.config, selfId, "down");
        if (!bottomLeft) return surfaces;
        surfaces.push(bottomLeft);
        if (count === 3) return surfaces;

        // Additional splits
        let lastSurface = bottomRight;
        for (let i = 3; i < count; i++) {
            const next = await this.backend.createSplitFrom(this.config, lastSurface, "down");
            if (!next) break;
            surfaces.push(next);
            lastSurface = next;
        }
        return surfaces;
    }

    async sendSurface(surfaceId: string, text: string): Promise<boolean> {
        if (!this.backend) return false;
        return this.backend.sendSurface(this.config, surfaceId, text);
    }
}

// ── Top-level convenience functions ────────────────────────────────

function sidebarSnapshotKey(config: MuxConfig): string {
    return config.workspaceId ?? "default";
}

export function syncCmuxSidebar(preferences: MuxPreferences | undefined, state: GsdState): void {
    const client = CmuxClient.fromPreferences(preferences);
    const config = client.getConfig();
    if (!config.sidebar) return;

    const label = buildStatusLabel(state);
    const progress = buildProgress(state);
    const snapshot = JSON.stringify({ label, progress, phase: state.phase });
    const key = sidebarSnapshotKey(config);
    if (lastSidebarSnapshots.get(key) === snapshot) return;

    client.setStatus(label, state.phase);
    client.setProgress(progress);
    lastSidebarSnapshots.set(key, snapshot);
}

export function clearCmuxSidebar(preferences: MuxPreferences | undefined): void {
    const config = resolveCmuxConfig(preferences);
    if (!config.available) return;

    const forceConfig: MuxConfig = { ...config, enabled: true, sidebar: true };
    const client = new CmuxClient(forceConfig);
    const key = sidebarSnapshotKey(config);
    client.clearStatus();
    client.setProgress(null);
    lastSidebarSnapshots.delete(key);
}

export function logCmuxEvent(preferences: MuxPreferences | undefined, message: string, level: "info" | "success" | "warning" | "error" | "progress" = "info"): void {
    CmuxClient.fromPreferences(preferences).log(message, level);
}
