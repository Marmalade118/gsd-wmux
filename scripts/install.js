#!/usr/bin/env node

/**
 * gsd-wmux install script
 *
 * Patches both:
 *   1. ~/.gsd/agent/extensions/cmux/     — the runtime copy GSD imports from
 *   2. <npm>/gsd-pi/dist/resources/extensions/cmux/ — the source pi syncs FROM on every startup
 *
 * Also patches the GSD notifications module to support Windows toast
 * notifications (the stock version returns null on win32).
 *
 * Usage:
 *   npx gsd-wmux            # install (or update)
 *   npx gsd-wmux --status   # check what's installed
 *   npx gsd-wmux --restore  # revert to stock cmux
 */

import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkgRoot = join(__dirname, "..");

const gsdHome = process.env.GSD_HOME || join(homedir(), ".gsd");
const extensionsDir = join(gsdHome, "agent", "extensions");
const cmuxTarget = join(extensionsDir, "cmux");
const MARKER = "// gsd-wmux";

// ── Locate the gsd-pi npm package ──────────────────────────────────

function findGsdPiRoot() {
    // Try common locations
    const candidates = [];

    // npm global
    try {
        const globalPrefix = execSync("npm prefix -g", { encoding: "utf-8", timeout: 5000 }).trim();
        candidates.push(join(globalPrefix, "node_modules", "gsd-pi"));
        // Windows npm puts globals under lib/node_modules on some setups
        candidates.push(join(globalPrefix, "lib", "node_modules", "gsd-pi"));
    } catch { /* ignore */ }

    // Roaming npm on Windows
    if (process.platform === "win32") {
        const appData = process.env.APPDATA;
        if (appData) {
            candidates.push(join(appData, "npm", "node_modules", "gsd-pi"));
        }
    }

    for (const candidate of candidates) {
        if (existsSync(join(candidate, "package.json"))) {
            return candidate;
        }
    }
    return null;
}

function getNpmCmuxDir() {
    const piRoot = findGsdPiRoot();
    if (!piRoot) return null;
    const dir = join(piRoot, "dist", "resources", "extensions", "cmux");
    return existsSync(dir) ? dir : null;
}

function getNpmNotificationsPath() {
    const piRoot = findGsdPiRoot();
    if (!piRoot) return null;
    const path = join(piRoot, "dist", "resources", "extensions", "gsd", "notifications.js");
    return existsSync(path) ? path : null;
}

// ── Helpers ────────────────────────────────────────────────────────

function log(msg) {
    console.log(`  gsd-wmux: ${msg}`);
}

function isWmuxInstalled(dir) {
    const indexPath = join(dir, "index.js");
    if (!existsSync(indexPath)) return false;
    const content = readFileSync(indexPath, "utf-8");
    return content.includes(MARKER);
}

function getStockBackupPath(file) {
    return `${file}.stock`;
}

function readPkgVersion() {
    try {
        const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf-8"));
        return pkg.version ?? "0.0.0";
    } catch {
        return "0.0.0";
    }
}

function copyTree(src, dest) {
    cpSync(src, dest, { recursive: true, force: true });
}

const WMUX_PKG_JSON = (version) => JSON.stringify({
    name: "@gsd/cmux",
    private: true,
    type: "module",
    description: "gsd-wmux — multi-backend multiplexer integration (WezTerm, cmux, ...)",
    pi: {},
    _wmux_version: version,
}, null, 2) + "\n";

const STOCK_PKG_JSON = JSON.stringify({
    name: "@gsd/cmux",
    private: true,
    type: "module",
    description: "cmux integration library — used by other extensions, not an extension itself",
    pi: {},
}, null, 2) + "\n";

// ── Notifications patch ────────────────────────────────────────────

function patchNotificationsFile(filePath, label) {
    if (!filePath || !existsSync(filePath)) {
        log(`⚠ ${label} notifications.js not found — skipping`);
        return;
    }

    const content = readFileSync(filePath, "utf-8");
    if (content.includes(MARKER)) {
        log(`${label} notifications.js already patched`);
        return;
    }

    // Back up
    const backup = getStockBackupPath(filePath);
    if (!existsSync(backup)) {
        copyFileSync(filePath, backup);
    }

    const windowsBlock = `
    ${MARKER}: Windows toast notification support
    if (platform === "win32") {
        // PowerShell-based Windows toast notification via WinRT
        const script = \`
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null;
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null;
$xml = [Windows.Data.Xml.Dom.XmlDocument]::new();
$template = '<toast><visual><binding template="ToastGeneric"><text>\${normalizedTitle.replace(/'/g, "&apos;").replace(/</g, "&lt;")}</text><text>\${normalizedMessage.replace(/'/g, "&apos;").replace(/</g, "&lt;")}</text></binding></visual></toast>';
$xml.LoadXml($template);
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml);
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('GSD').Show($toast);\`;
        return { file: "powershell", args: ["-NoProfile", "-NonInteractive", "-Command", script] };
    }`;

    const patched = content.replace(
        /(\s*)(return null;\s*\})/,
        `$1${windowsBlock}\n$1$2`
    );

    if (patched === content) {
        log(`⚠ Could not patch ${label} notifications.js — pattern not found`);
        return;
    }

    writeFileSync(filePath, patched);
    log(`Patched ${label} notifications.js`);
}

// ── Install to a cmux directory ────────────────────────────────────

function installToDir(targetDir, label) {
    mkdirSync(targetDir, { recursive: true });

    // Back up stock index.js if not already backed up
    const indexPath = join(targetDir, "index.js");
    const stockBackup = getStockBackupPath(indexPath);
    if (existsSync(indexPath) && !existsSync(stockBackup) && !isWmuxInstalled(targetDir)) {
        copyFileSync(indexPath, stockBackup);
        log(`Backed up ${label} stock index.js`);
    }

    // Copy compiled dist files
    const distDir = join(pkgRoot, "dist");
    if (!existsSync(distDir)) {
        console.error("  ERROR: dist/ not found. Run `npm run build` first.");
        process.exit(1);
    }

    copyTree(distDir, targetDir);
    writeFileSync(join(targetDir, "package.json"), WMUX_PKG_JSON(readPkgVersion()));
    log(`Installed to ${label}: ${targetDir}`);
}

// ── Restore a cmux directory ───────────────────────────────────────

function restoreDir(targetDir, label) {
    const indexPath = join(targetDir, "index.js");
    const stockBackup = getStockBackupPath(indexPath);
    if (existsSync(stockBackup)) {
        copyFileSync(stockBackup, indexPath);
        writeFileSync(join(targetDir, "package.json"), STOCK_PKG_JSON);
        log(`Restored ${label} stock files`);
    } else {
        log(`⚠ No ${label} stock backup — nothing to restore`);
    }
}

function restoreNotificationsFile(filePath, label) {
    if (!filePath) return;
    const backup = getStockBackupPath(filePath);
    if (existsSync(backup)) {
        copyFileSync(backup, filePath);
        log(`Restored ${label} notifications.js`);
    }
}

// ── Commands ───────────────────────────────────────────────────────

function install() {
    log("Installing gsd-wmux...\n");

    const npmCmuxDir = getNpmCmuxDir();
    const npmNotifPath = getNpmNotificationsPath();
    const userNotifPath = join(extensionsDir, "gsd", "notifications.js");

    // 1. Patch the npm package source (pi syncs FROM here on every startup)
    if (npmCmuxDir) {
        installToDir(npmCmuxDir, "npm source");
        patchNotificationsFile(npmNotifPath, "npm source");
    } else {
        log("⚠ Could not locate gsd-pi npm package — skipping npm source patch");
        log("  (gsd-wmux will be overwritten next time pi starts)");
    }

    // 2. Patch the user extensions dir (what GSD imports at runtime right now)
    installToDir(cmuxTarget, "user dir");
    patchNotificationsFile(userNotifPath, "user dir");

    log("");
    log("✓ Installation complete.");
    log("");
    log("  Enable in your project:");
    log("    /gsd cmux on");
    log("");
    log("  For WezTerm status bar, add the Lua snippet from:");
    log(`    ${join(pkgRoot, "wezterm", "gsd-status.lua")}`);
}

function restore() {
    log("Restoring stock cmux...\n");

    const npmCmuxDir = getNpmCmuxDir();
    const npmNotifPath = getNpmNotificationsPath();
    const userNotifPath = join(extensionsDir, "gsd", "notifications.js");

    if (npmCmuxDir) {
        restoreDir(npmCmuxDir, "npm source");
        restoreNotificationsFile(npmNotifPath, "npm source");
    }

    restoreDir(cmuxTarget, "user dir");
    restoreNotificationsFile(userNotifPath, "user dir");

    log("");
    log("✓ Stock cmux restored.");
}

function status() {
    const npmCmuxDir = getNpmCmuxDir();
    const userNotifPath = join(extensionsDir, "gsd", "notifications.js");
    const npmNotifPath = getNpmNotificationsPath();

    const userInstalled = isWmuxInstalled(cmuxTarget);
    const npmInstalled = npmCmuxDir ? isWmuxInstalled(npmCmuxDir) : false;

    console.log(`gsd-wmux: ${userInstalled && npmInstalled ? "installed" : userInstalled ? "partially installed (user only)" : "not installed"}`);
    console.log(`  User dir: ${cmuxTarget} — ${userInstalled ? "✅ patched" : "❌ stock"}`);
    console.log(`  npm source: ${npmCmuxDir ?? "(not found)"} — ${npmInstalled ? "✅ patched" : "❌ stock"}`);

    if (userInstalled) {
        const pkgPath = join(cmuxTarget, "package.json");
        if (existsSync(pkgPath)) {
            const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
            console.log(`  Version: ${pkg._wmux_version ?? "unknown"}`);
        }
    }

    const userNotifPatched = existsSync(userNotifPath) && readFileSync(userNotifPath, "utf-8").includes(MARKER);
    const npmNotifPatched = npmNotifPath && existsSync(npmNotifPath) && readFileSync(npmNotifPath, "utf-8").includes(MARKER);
    console.log(`  Notifications: user=${userNotifPatched ? "✅" : "❌"} npm=${npmNotifPatched ? "✅" : "❌"}`);
    console.log(`  Stock backups: ${existsSync(getStockBackupPath(join(cmuxTarget, "index.js"))) ? "yes" : "no"}`);
}

// ── CLI ────────────────────────────────────────────────────────────

const arg = process.argv[2];
if (arg === "--restore" || arg === "restore") {
    restore();
} else if (arg === "--status" || arg === "status") {
    status();
} else {
    install();
}
