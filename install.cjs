#!/usr/bin/env node

/**
 * Agent Council installer.
 * Usage: npx cliagent-council   (or: bunx cliagent-council)
 *
 * Clones the repo to ~/.council/agent-council/ and runs setup.
 */

const { execSync } = require("child_process");
const { existsSync, mkdirSync } = require("fs");
const { resolve } = require("path");
const os = require("os");

const REPO = "https://github.com/yogirk/agent-council.git";
const INSTALL_DIR = resolve(os.homedir(), ".council", "agent-council");

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { stdio: "inherit", ...opts });
}

console.log("");
console.log("Agent Council — Installer");
console.log("=========================");
console.log("");

// Check Bun
try {
  execSync("which bun", { stdio: "pipe" });
} catch {
  console.log("Error: Bun is required. Install: curl -fsSL https://bun.sh/install | bash");
  process.exit(1);
}

// Clone or update
if (existsSync(resolve(INSTALL_DIR, ".git"))) {
  console.log("Updating existing installation...");
  run("git pull --ff-only", { cwd: INSTALL_DIR });
} else {
  console.log("Installing Agent Council...");
  mkdirSync(resolve(os.homedir(), ".council"), { recursive: true });
  run(`git clone --depth 1 ${REPO} "${INSTALL_DIR}"`);
}

// Run setup
console.log("");
run("./setup", { cwd: INSTALL_DIR });
