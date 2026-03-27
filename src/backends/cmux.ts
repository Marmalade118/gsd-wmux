/**
 * gsd-wmux — cmux Backend
 *
 * Preserved from the original GSD cmux integration.
 * Uses the `cmux` CLI and Unix domain socket for IPC.
 */

import { existsSync } from "node:fs";
import type {
    MuxBackend, MuxConfig, MuxEnvironment, MuxCapabilities,
    MuxProgress, MuxLogLevel,
} from "../types.js";
import {
    phaseVisuals, runCliSync, runCliAsync, parseJson,
} from "../utils.js";

const DEFAULT_SOCKET_PATH = "/tmp/cmux.sock";
const STATUS_KEY = "gsd";

let cachedCliAvailability: boolean | null = null;

export class CmuxBackend implements MuxBackend {
    readonly name = "cmux";

    // ── Detection ──────────────────────────────────────────────────

    isCliAvailable(): boolean {
        if (cachedCliAvailability !== null) return cachedCliAvailability;
        try {
            const result = runCliSync("cmux", ["--help"], 1000);
            cachedCliAvailability = result !== null;
        } catch {
            cachedCliAvailability = false;
        }
        return cachedCliAvailability!;
    }

    detect(env: NodeJS.ProcessEnv = process.env): MuxEnvironment {
        const socketPath = env.CMUX_SOCKET_PATH ?? DEFAULT_SOCKET_PATH;
        const workspaceId = env.CMUX_WORKSPACE_ID?.trim() || undefined;
        const surfaceId = env.CMUX_SURFACE_ID?.trim() || undefined;
        const available = Boolean(workspaceId && surfaceId && existsSync(socketPath));
        return {
            available,
            cliAvailable: this.isCliAvailable(),
            socketPath,
            workspaceId,
            surfaceId,
            backend: available ? this.name : null,
        };
    }

    // ── Helpers ────────────────────────────────────────────────────

    private appendWorkspace(args: string[], config: MuxConfig): string[] {
        return config.workspaceId ? [...args, "--workspace", config.workspaceId] : args;
    }

    private appendSurface(args: string[], surfaceId: string | undefined): string[] {
        return surfaceId ? [...args, "--surface", surfaceId] : args;
    }

    // ── Status / sidebar ───────────────────────────────────────────

    setStatus(config: MuxConfig, label: string, phase: string): void {
        if (!config.sidebar) return;
        const visuals = phaseVisuals(phase);
        runCliSync("cmux", this.appendWorkspace([
            "set-status", STATUS_KEY, label,
            "--icon", visuals.icon,
            "--color", visuals.color,
        ], config));
    }

    clearStatus(config: MuxConfig): void {
        if (!config.sidebar) return;
        runCliSync("cmux", this.appendWorkspace(["clear-status", STATUS_KEY], config));
    }

    setProgress(config: MuxConfig, progress: MuxProgress | null): void {
        if (!config.sidebar) return;
        if (!progress) {
            runCliSync("cmux", this.appendWorkspace(["clear-progress"], config));
            return;
        }
        runCliSync("cmux", this.appendWorkspace([
            "set-progress", progress.value.toFixed(3),
            "--label", progress.label,
        ], config));
    }

    log(config: MuxConfig, message: string, level: MuxLogLevel, source: string): void {
        if (!config.sidebar) return;
        runCliSync("cmux", this.appendWorkspace([
            "log", "--level", level, "--source", source, "--", message,
        ], config));
    }

    // ── Notifications ──────────────────────────────────────────────

    notify(config: MuxConfig, title: string, body: string, subtitle?: string): boolean {
        if (!config.notifications) return false;
        const args = ["notify", "--title", title, "--body", body];
        if (subtitle) args.push("--subtitle", subtitle);
        return runCliSync("cmux", args) !== null;
    }

    // ── Capabilities / identity ────────────────────────────────────

    getCapabilities(config: MuxConfig): MuxCapabilities | null {
        if (!config.available || !config.cliAvailable) return null;
        const stdout = runCliSync("cmux", ["capabilities", "--json"]);
        return stdout ? parseJson(stdout) as MuxCapabilities : null;
    }

    identify(config: MuxConfig): unknown {
        const stdout = runCliSync("cmux", ["identify", "--json"]);
        return stdout ? parseJson(stdout) : null;
    }

    // ── Pane management ────────────────────────────────────────────

    async listSurfaceIds(config: MuxConfig): Promise<string[]> {
        const stdout = await runCliAsync("cmux",
            this.appendWorkspace(["list-surfaces", "--json", "--id-format", "both"], config)
        );
        const parsed = stdout ? parseJson(stdout) : null;
        return extractSurfaceIds(parsed);
    }

    async createSplitFrom(
        config: MuxConfig,
        sourceId: string | undefined,
        direction: "right" | "down",
    ): Promise<string | null> {
        if (!config.splits) return null;
        const before = new Set(await this.listSurfaceIds(config));
        const args = ["new-split", direction];
        const scopedArgs = this.appendSurface(this.appendWorkspace(args, config), sourceId);
        await runCliAsync("cmux", scopedArgs);
        const after = await this.listSurfaceIds(config);
        for (const id of after) {
            if (!before.has(id)) return id;
        }
        return null;
    }

    async sendSurface(config: MuxConfig, surfaceId: string, text: string): Promise<boolean> {
        const payload = text.endsWith("\n") ? text : `${text}\n`;
        const stdout = await runCliAsync("cmux", ["send-surface", "--surface", surfaceId, payload]);
        return stdout !== null;
    }
}

// ── Helpers ────────────────────────────────────────────────────────

function extractSurfaceIds(value: unknown): string[] {
    const found = new Set<string>();
    const visit = (node: unknown): void => {
        if (Array.isArray(node)) {
            for (const item of node) visit(item);
            return;
        }
        if (!node || typeof node !== "object") return;
        for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
            if (typeof child === "string"
                && (key === "surface_id" || key === "surface"
                    || (key === "id" && child.includes("surface")))) {
                found.add(child);
            }
            visit(child);
        }
    };
    visit(value);
    return Array.from(found);
}
