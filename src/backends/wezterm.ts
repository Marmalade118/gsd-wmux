/**
 * gsd-wmux — WezTerm Backend
 *
 * Uses `wezterm cli` for pane management and OSC 1337 user variables
 * for status/progress metadata (rendered by the companion Lua config).
 */

import { existsSync } from "node:fs";
import type {
    MuxBackend, MuxConfig, MuxEnvironment, MuxCapabilities,
    MuxProgress, MuxLogLevel,
} from "../types.js";
import {
    phaseVisuals, emitOsc777Notification, emitUserVar, clearUserVar,
    runCliSync, runCliAsync, parseJson,
} from "../utils.js";

let cachedCliAvailability: boolean | null = null;

export class WeztermBackend implements MuxBackend {
    readonly name = "wezterm";

    // ── Detection ──────────────────────────────────────────────────

    isCliAvailable(): boolean {
        if (cachedCliAvailability !== null) return cachedCliAvailability;
        try {
            const result = runCliSync("wezterm", ["cli", "list", "--format", "json"], 3000);
            cachedCliAvailability = result !== null;
        } catch {
            cachedCliAvailability = false;
        }
        return cachedCliAvailability!;
    }

    detect(env: NodeJS.ProcessEnv = process.env): MuxEnvironment {
        const paneId = env.WEZTERM_PANE?.trim() || undefined;
        const cliOk = this.isCliAvailable();
        return {
            available: Boolean(paneId) || cliOk,
            cliAvailable: cliOk,
            socketPath: env.WEZTERM_UNIX_SOCKET?.trim() ?? "(wezterm-named-pipe)",
            workspaceId: "wezterm",
            surfaceId: paneId,
            backend: this.name,
        };
    }

    // ── Status / sidebar (via OSC 1337 user vars) ──────────────────

    setStatus(config: MuxConfig, label: string, phase: string): void {
        if (!config.sidebar) return;
        const visuals = phaseVisuals(phase);
        emitUserVar("gsd_status", label);
        emitUserVar("gsd_phase", phase);
        emitUserVar("gsd_color", visuals.color);
        emitUserVar("gsd_icon", visuals.icon);
    }

    clearStatus(config: MuxConfig): void {
        if (!config.sidebar) return;
        clearUserVar("gsd_status");
        clearUserVar("gsd_phase");
        clearUserVar("gsd_color");
        clearUserVar("gsd_icon");
        clearUserVar("gsd_progress");
        clearUserVar("gsd_progress_label");
        clearUserVar("gsd_last_event");
    }

    setProgress(config: MuxConfig, progress: MuxProgress | null): void {
        if (!config.sidebar) return;
        if (!progress) {
            clearUserVar("gsd_progress");
            clearUserVar("gsd_progress_label");
            return;
        }
        emitUserVar("gsd_progress", progress.value.toFixed(3));
        emitUserVar("gsd_progress_label", progress.label);
    }

    log(config: MuxConfig, message: string, level: MuxLogLevel, _source: string): void {
        if (!config.sidebar) return;
        // WezTerm has no scrollable log pane. Store last event as a user var
        // so the Lua config can render it in the status bar.
        const timestamp = new Date().toLocaleTimeString("en-GB", { hour12: false });
        emitUserVar("gsd_last_event", `[${timestamp}] ${level}: ${message}`);
    }

    // ── Notifications ──────────────────────────────────────────────

    notify(config: MuxConfig, title: string, body: string, _subtitle?: string): boolean {
        if (!config.notifications) return false;
        // WezTerm supports OSC 777 toast notifications natively
        emitOsc777Notification(title, body);
        return true;
    }

    // ── Capabilities / identity ────────────────────────────────────

    getCapabilities(config: MuxConfig): MuxCapabilities | null {
        if (!config.available || !config.cliAvailable) return null;
        return {
            mode: "wezterm",
            access_mode: "cli",
            methods: [
                "split-pane", "spawn", "send-text", "list", "kill-pane",
                "get-text", "set-tab-title", "set-window-title",
                "activate-pane", "adjust-pane-size", "zoom-pane",
            ],
        };
    }

    identify(config: MuxConfig): unknown {
        const stdout = runCliSync("wezterm", ["cli", "list", "--format", "json"]);
        const panes = stdout ? parseJson(stdout) as Array<Record<string, unknown>> | null : null;
        if (!Array.isArray(panes)) return null;
        const currentPaneId = config.surfaceId ?? process.env.WEZTERM_PANE?.trim();
        return panes.find(p => String(p.pane_id) === currentPaneId) ?? panes[0] ?? null;
    }

    // ── Pane management ────────────────────────────────────────────

    async listSurfaceIds(config: MuxConfig): Promise<string[]> {
        const stdout = await runCliAsync("wezterm", ["cli", "list", "--format", "json"]);
        const panes = stdout ? parseJson(stdout) as Array<Record<string, unknown>> | null : null;
        if (!Array.isArray(panes)) return [];
        return panes.map(p => String(p.pane_id));
    }

    async createSplitFrom(
        config: MuxConfig,
        sourceId: string | undefined,
        direction: "right" | "down",
    ): Promise<string | null> {
        if (!config.splits) return null;
        const dirFlag = direction === "right" ? "--right" : "--bottom";
        const args = ["cli", "split-pane", dirFlag];
        if (sourceId) args.push("--pane-id", String(sourceId));
        const stdout = await runCliAsync("wezterm", args);
        return stdout?.trim() || null;
    }

    async sendSurface(config: MuxConfig, surfaceId: string, text: string): Promise<boolean> {
        const payload = text.endsWith("\n") ? text : `${text}\n`;
        const stdout = await runCliAsync("wezterm", [
            "cli", "send-text", "--pane-id", String(surfaceId), "--no-paste", payload,
        ]);
        return stdout !== null;
    }
}
