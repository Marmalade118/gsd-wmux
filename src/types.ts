/**
 * gsd-wmux — Multiplexer Backend Types
 *
 * Defines the interface that every backend (WezTerm, cmux, tmux, …) must implement.
 * The GSD integration layer talks to this interface, never to a specific backend.
 */

// ── Environment detection ──────────────────────────────────────────

export interface MuxEnvironment {
    /** Whether the backend is available in this environment */
    available: boolean;
    /** Whether the backend's CLI tool is on PATH and functional */
    cliAvailable: boolean;
    /** IPC path — Unix socket for cmux, named pipe for WezTerm, etc. */
    socketPath: string;
    /** Workspace/domain identifier (backend-specific semantics) */
    workspaceId: string | undefined;
    /** Surface/pane identifier for the current terminal */
    surfaceId: string | undefined;
    /** Which backend this detection result comes from */
    backend: string | null;
}

// ── Resolved config (after merging user preferences) ───────────────

export interface MuxConfig extends MuxEnvironment {
    /** Master toggle — backend is available AND user has opted in */
    enabled: boolean;
    /** Route notifications through the mux system */
    notifications: boolean;
    /** Publish status/progress metadata (sidebar, status bar, user vars) */
    sidebar: boolean;
    /** Allow programmatic pane/split creation */
    splits: boolean;
    /** Reserved — browser pane integration */
    browser: boolean;
}

// ── Phase visuals ──────────────────────────────────────────────────

export interface PhaseVisuals {
    icon: string;
    color: string;
}

// ── Progress ───────────────────────────────────────────────────────

export interface MuxProgress {
    /** 0..1 completion ratio */
    value: number;
    /** Human-readable label, e.g. "3/7 tasks" */
    label: string;
}

// ── Capabilities (returned by getCapabilities) ─────────────────────

export interface MuxCapabilities {
    /** Backend access mode description */
    mode: string;
    access_mode: string;
    /** List of supported method names */
    methods: string[];
}

// ── Backend interface ──────────────────────────────────────────────

export type MuxLogLevel = "info" | "success" | "warning" | "error" | "progress";

export interface MuxBackend {
    /** Unique backend identifier, e.g. "wezterm", "cmux" */
    readonly name: string;

    /** Detect whether this backend is available in the current environment */
    detect(env?: NodeJS.ProcessEnv): MuxEnvironment;

    /** Check if the backend's CLI tool is available */
    isCliAvailable(): boolean;

    // ── Status / sidebar ───────────────────────────────────────────

    /** Set the current GSD status label and phase */
    setStatus(config: MuxConfig, label: string, phase: string): void;

    /** Clear all GSD status metadata */
    clearStatus(config: MuxConfig): void;

    /** Set progress indicator */
    setProgress(config: MuxConfig, progress: MuxProgress | null): void;

    /** Log an event (last-event for WezTerm, scrollable log for cmux) */
    log(config: MuxConfig, message: string, level: MuxLogLevel, source: string): void;

    // ── Notifications ──────────────────────────────────────────────

    /** Send a notification. Returns true if delivered. */
    notify(config: MuxConfig, title: string, body: string, subtitle?: string): boolean;

    // ── Capabilities / identity ────────────────────────────────────

    /** Query backend capabilities */
    getCapabilities(config: MuxConfig): MuxCapabilities | null;

    /** Identify the current pane/surface */
    identify(config: MuxConfig): unknown;

    // ── Pane management ────────────────────────────────────────────

    /** List all surface/pane IDs visible to this backend */
    listSurfaceIds(config: MuxConfig): Promise<string[]>;

    /** Create a split pane from sourceId in the given direction. Returns the new pane ID. */
    createSplitFrom(config: MuxConfig, sourceId: string | undefined, direction: "right" | "down"): Promise<string | null>;

    /** Send text to a specific pane */
    sendSurface(config: MuxConfig, surfaceId: string, text: string): Promise<boolean>;
}

// ── GSD state shape (subset needed for status/progress) ────────────

export interface GsdState {
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

// ── User preferences shape (subset consumed by mux integration) ───

export interface MuxPreferences {
    cmux?: {
        enabled?: boolean;
        notifications?: boolean;
        sidebar?: boolean;
        splits?: boolean;
        browser?: boolean;
    };
}
