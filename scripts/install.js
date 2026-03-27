#!/usr/bin/env node

/**
 * gsd-wmux install script
 *
 * Copies the compiled dist/ into ~/.gsd/agent/extensions/cmux/
 * replacing the stock cmux library with the multi-backend version.
 *
 * Also patches the GSD notifications module to support Windows toast
 * notifications (the stock version returns null on win32).
 *
 * Usage:
 *   npx gsd-wmux            # install (or update)
 *   npx gsd-wmux --status   # check what's installed
 *   npx gsd-wmux --restore  # revert to stock cmux
 */

import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync, copyFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkgRoot = join(__dirname, "..");

const gsdHome = process.env.GSD_HOME || join(homedir(), ".gsd");
const extensionsDir = join(gsdHome, "agent", "extensions");
const cmuxTarget = join(extensionsDir, "cmux");
const notificationsTarget = join(extensionsDir, "gsd", "notifications.js");
const MARKER = "// gsd-wmux";

function log(msg) {
    console.log(`  gsd-wmux: ${msg}`);
}

function isWmuxInstalled() {
    const indexPath = join(cmuxTarget, "index.js");
    if (!existsSync(indexPath)) return false;
    const content = readFileSync(indexPath, "utf-8");
    return content.includes(MARKER);
}

function getStockBackupPath(file) {
    return `${file}.stock`;
}

function install() {
    log("Installing gsd-wmux...");

    // Ensure target dir exists
    mkdirSync(cmuxTarget, { recursive: true });

    // Back up stock files if they haven't been backed up yet
    const indexPath = join(cmuxTarget, "index.js");
    const stockBackup = getStockBackupPath(indexPath);
    if (existsSync(indexPath) && !existsSync(stockBackup) && !isWmuxInstalled()) {
        copyFileSync(indexPath, stockBackup);
        log("Backed up stock cmux/index.js → cmux/index.js.stock");
    }

    // Copy compiled dist files
    const distDir = join(pkgRoot, "dist");
    if (!existsSync(distDir)) {
        console.error("  ERROR: dist/ not found. Run `npm run build` first.");
        process.exit(1);
    }

    // Copy all dist files into the cmux extension directory
    copyTree(distDir, cmuxTarget);
    log(`Copied gsd-wmux to ${cmuxTarget}`);

    // Write package.json that marks this as a library (pi: {} — no extensions)
    writeFileSync(join(cmuxTarget, "package.json"), JSON.stringify({
        name: "@gsd/cmux",
        private: true,
        type: "module",
        description: "gsd-wmux — multi-backend multiplexer integration (WezTerm, cmux, ...)",
        pi: {},
        _wmux_version: readPkgVersion(),
    }, null, 2) + "\n");

    // Patch notifications for Windows
    patchNotifications();

    log("✓ Installation complete.");
    log("");
    log("  Enable in your project:");
    log("    /gsd cmux on");
    log("");
    log("  For WezTerm status bar, add the Lua snippet from:");
    log(`    ${join(pkgRoot, "wezterm", "gsd-status.lua")}`);
}

function patchNotifications() {
    if (!existsSync(notificationsTarget)) {
        log("⚠ notifications.js not found — skipping Windows patch");
        return;
    }

    const content = readFileSync(notificationsTarget, "utf-8");

    // Already patched?
    if (content.includes(MARKER)) {
        log("notifications.js already patched");
        return;
    }

    // Back up
    const backup = getStockBackupPath(notificationsTarget);
    if (!existsSync(backup)) {
        copyFileSync(notificationsTarget, backup);
    }

    // The stock code has `return null;` at the end of buildDesktopNotificationCommand
    // for the win32 case. We add a win32 block before that.
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
        log("⚠ Could not patch notifications.js — pattern not found");
        return;
    }

    writeFileSync(notificationsTarget, patched);
    log("Patched notifications.js with Windows toast support");
}

function restore() {
    log("Restoring stock cmux...");

    const indexPath = join(cmuxTarget, "index.js");
    const stockBackup = getStockBackupPath(indexPath);
    if (existsSync(stockBackup)) {
        copyFileSync(stockBackup, indexPath);
        log("Restored stock cmux/index.js");
    } else {
        log("⚠ No stock backup found — nothing to restore");
    }

    // Restore notifications
    const notifBackup = getStockBackupPath(notificationsTarget);
    if (existsSync(notifBackup)) {
        copyFileSync(notifBackup, notificationsTarget);
        log("Restored stock notifications.js");
    }

    // Restore package.json
    writeFileSync(join(cmuxTarget, "package.json"), JSON.stringify({
        name: "@gsd/cmux",
        private: true,
        type: "module",
        description: "cmux integration library — used by other extensions, not an extension itself",
        pi: {},
    }, null, 2) + "\n");

    log("✓ Stock cmux restored.");
}

function status() {
    const installed = isWmuxInstalled();
    console.log(`gsd-wmux: ${installed ? "installed" : "not installed"}`);
    console.log(`  Target: ${cmuxTarget}`);
    if (installed) {
        const pkgPath = join(cmuxTarget, "package.json");
        if (existsSync(pkgPath)) {
            const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
            console.log(`  Version: ${pkg._wmux_version ?? "unknown"}`);
        }
    }
    console.log(`  Stock backup: ${existsSync(getStockBackupPath(join(cmuxTarget, "index.js"))) ? "yes" : "no"}`);
    console.log(`  Notifications patched: ${existsSync(notificationsTarget) && readFileSync(notificationsTarget, "utf-8").includes(MARKER) ? "yes" : "no"}`);
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

// ── CLI ────────────────────────────────────────────────────────────

const arg = process.argv[2];
if (arg === "--restore" || arg === "restore") {
    restore();
} else if (arg === "--status" || arg === "status") {
    status();
} else {
    install();
}
