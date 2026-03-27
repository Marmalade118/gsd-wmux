# Contributing to gsd-wmux

Thank you for your interest in contributing! This guide covers how to set up the development environment, add new backends, and submit changes.

## Table of Contents

- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Adding a New Backend](#adding-a-new-backend)
- [Code Style](#code-style)
- [Building](#building)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)

---

## Development Setup

**Prerequisites:**

- Node.js ≥ 18
- npm ≥ 9
- GSD/pi installed (for integration testing)
- WezTerm or cmux (for manual verification)

```bash
git clone https://github.com/gsd-build/gsd-wmux.git
cd gsd-wmux
npm install
npm run build
```

To apply your local build to the GSD installation for manual testing:

```bash
node scripts/install.js
```

To watch for changes during development:

```bash
npm run watch
```

---

## Project Structure

```
gsd-wmux/
├── src/
│   ├── index.ts          # Entry point, backend selection, CmuxClient, exported API
│   ├── types.ts          # All TypeScript interfaces and type definitions
│   ├── utils.ts          # Shared utilities (OSC helpers, status builders, CLI wrappers)
│   └── backends/
│       ├── wezterm.ts    # WezTerm backend implementation
│       └── cmux.ts       # cmux backend implementation
├── scripts/
│   └── install.js        # CLI installer (npx gsd-wmux)
├── wezterm/
│   └── gsd-status.lua    # WezTerm Lua config for status bar rendering
└── docs/
    ├── architecture.md   # System architecture diagrams
    ├── api-reference.md  # Full TypeScript API reference
    ├── wezterm-setup.md  # WezTerm configuration guide
    └── backends.md       # Guide to implementing new backends
```

The `dist/` directory contains compiled output and is committed to the repository so users can `npx gsd-wmux` without a build step.

---

## Adding a New Backend

Adding a new terminal multiplexer backend is the most common type of contribution. See [docs/backends.md](docs/backends.md) for a detailed walkthrough.

**Quick summary:**

1. Create `src/backends/your-mux.ts` implementing `MuxBackend` (from `src/types.ts`)
2. Register it in the `BACKENDS` array in `src/index.ts`
3. Build and test: `npm run build && node scripts/install.js`

The auto-detection loop calls `detect()` on each backend in order and picks the first one that returns `available: true`. Order matters — put more specific detectors before more generic ones.

---

## Code Style

- **TypeScript strict mode** — all types must be explicit; no `any`
- **No external dependencies** — use only Node.js built-in modules (`node:fs`, `node:child_process`, etc.)
- **Silent failures** — CLI calls should catch errors and return `null`/`false`; never throw from backend methods
- **British English** in comments and documentation
- Keep backend implementations self-contained; shared logic belongs in `src/utils.ts`

---

## Building

```bash
npm run build    # Compile TypeScript → dist/
npm run watch    # Watch mode
```

The TypeScript config (`tsconfig.json`) targets ES2022 with Node16 module resolution (ESM). Declaration files and source maps are emitted alongside the compiled JavaScript.

After building, commit both `src/` and `dist/` — the compiled output is included so the package can be used without a build step via `npx`.

---

## Testing

Run the test suite (if tests exist):

```bash
npm test
```

For manual integration testing:

1. Build: `npm run build`
2. Install: `node scripts/install.js`
3. Open a GSD project in the target multiplexer
4. Enable cmux: `/gsd cmux on`
5. Run a task and verify status appears in the status bar

Check the install state at any point:

```bash
node scripts/install.js --status
```

Revert to stock cmux to test the baseline:

```bash
node scripts/install.js --restore
```

---

## Submitting Changes

1. Fork the repository and create a feature branch
2. Make your changes — keep commits focused and descriptive
3. Build the project: `npm run build`
4. Verify the install script works: `node scripts/install.js --status`
5. Open a pull request with a clear description of what changed and why

**For new backends**, include:
- The backend implementation in `src/backends/`
- Registration in `src/index.ts`
- A brief entry in `docs/backends.md`
- Manual testing notes in the PR description
