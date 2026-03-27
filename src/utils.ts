/**
 * gsd-wmux — Shared utilities used by all backends
 */

import { execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import type { PhaseVisuals, MuxProgress, GsdState } from "./types.js";

export const execFileAsync = promisify(execFile);

// ── Phase visuals ──────────────────────────────────────────────────

export function phaseVisuals(phase: string): PhaseVisuals {
    switch (phase) {
        case "blocked":
            return { icon: "triangle-alert", color: "#ef4444" };
        case "paused":
            return { icon: "pause", color: "#f59e0b" };
        case "complete":
        case "completing-milestone":
            return { icon: "check", color: "#22c55e" };
        case "planning":
        case "researching":
        case "replanning-slice":
            return { icon: "compass", color: "#3b82f6" };
        case "validating-milestone":
        case "verifying":
            return { icon: "shield-check", color: "#06b6d4" };
        default:
            return { icon: "rocket", color: "#4ade80" };
    }
}

// ── Status / progress builders ─────────────────────────────────────

export function buildStatusLabel(state: GsdState): string {
    const parts: string[] = [];
    if (state.activeMilestone) parts.push(state.activeMilestone.id);
    if (state.activeSlice) parts.push(state.activeSlice.id);
    if (state.activeTask) {
        const prev = parts.pop();
        parts.push(prev ? `${prev}/${state.activeTask.id}` : state.activeTask.id);
    }
    if (parts.length === 0) return state.phase;
    return `${parts.join(" ")} · ${state.phase}`;
}

export function buildProgress(state: GsdState): MuxProgress | null {
    const progress = state.progress;
    if (!progress) return null;
    const choose = (done: number, total: number, label: string): MuxProgress | null => {
        if (total <= 0) return null;
        return { value: Math.max(0, Math.min(1, done / total)), label: `${done}/${total} ${label}` };
    };
    return choose(progress.tasks?.done ?? 0, progress.tasks?.total ?? 0, "tasks")
        ?? choose(progress.slices?.done ?? 0, progress.slices?.total ?? 0, "slices")
        ?? choose(progress.milestones.done, progress.milestones.total, "milestones");
}

// ── Text helpers ───────────────────────────────────────────────────

export function normalizeNotificationText(value: string): string {
    return value.replace(/\r?\n/g, " ").trim();
}

export function shellEscape(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function parseJson(text: string): unknown {
    try { return JSON.parse(text); }
    catch { return null; }
}

// ── OSC escape sequences ───────────────────────────────────────────

export function supportsOsc777Notifications(env: NodeJS.ProcessEnv = process.env): boolean {
    const termProgram = env.TERM_PROGRAM?.toLowerCase() ?? "";
    return termProgram === "ghostty" || termProgram === "wezterm" || termProgram === "iterm.app";
}

export function emitOsc777Notification(title: string, body: string): void {
    if (!supportsOsc777Notifications()) return;
    const safeTitle = normalizeNotificationText(title).replace(/;/g, ",");
    const safeBody = normalizeNotificationText(body).replace(/;/g, ",");
    process.stdout.write(`\x1b]777;notify;${safeTitle};${safeBody}\x07`);
}

/**
 * Set a WezTerm user variable via OSC 1337 (iTerm2-compatible) escape sequence.
 * WezTerm Lua config reads these via pane.user_vars.<name>.
 */
export function emitUserVar(name: string, value: string): void {
    try {
        const encoded = Buffer.from(String(value), "utf-8").toString("base64");
        process.stdout.write(`\x1b]1337;SetUserVar=${name}=${encoded}\x07`);
    } catch {
        // Non-fatal
    }
}

export function clearUserVar(name: string): void {
    emitUserVar(name, "");
}

// ── CLI helpers ────────────────────────────────────────────────────

export function runCliSync(cmd: string, args: string[], timeoutMs = 3000): string | null {
    try {
        return execFileSync(cmd, args, {
            encoding: "utf-8",
            timeout: timeoutMs,
            env: process.env,
        });
    } catch {
        return null;
    }
}

export async function runCliAsync(cmd: string, args: string[], timeoutMs = 5000): Promise<string | null> {
    try {
        const result = await execFileAsync(cmd, args, {
            encoding: "utf-8",
            timeout: timeoutMs,
            env: process.env,
        });
        return result.stdout;
    } catch {
        return null;
    }
}
