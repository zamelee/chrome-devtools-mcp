#!/usr/bin/env node

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

process.title = 'chrome-devtools-mcp';
// F-CwdProbe: emit cwd on boot so the watchdog (or any operator) can verify
// the cwd-vs-workspace assumption underlying the cwd-fallback validatePath fix.
// Codex's disk log only captures the main Codex.exe process's output, not its
// spawned MCP server children, so we also append to a stable file under the
// OS temp directory. Single-file append with O_APPEND keeps writes atomic for
// the small (~150-byte) JSON line per process even when N servers race on boot.
const _cwdBootInfo = JSON.stringify({event: 'mcp-boot', pid: process.pid, cwd: process.cwd(), argv: process.argv});
console.error(_cwdBootInfo);
try {
  fs.appendFileSync(path.join(os.tmpdir(), 'codex-devtools-mcp-boot.log'), _cwdBootInfo + '\n');
} catch {}

import {version} from 'node:process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const [major, minor] = version.substring(1).split('.').map(Number);

if (major === 20 && minor < 19) {
  console.error(
    `ERROR: \`chrome-devtools-mcp\` does not support Node ${process.version}. Please upgrade to Node 20.19.0 LTS or a newer LTS.`,
  );
  process.exit(1);
}

if (major === 22 && minor < 12) {
  console.error(
    `ERROR: \`chrome-devtools-mcp\` does not support Node ${process.version}. Please upgrade to Node 22.12.0 LTS or a newer LTS.`,
  );
  process.exit(1);
}

if (major < 20) {
  console.error(
    `ERROR: \`chrome-devtools-mcp\` does not support Node ${process.version}. Please upgrade to Node 20.19.0 LTS or a newer LTS.`,
  );
  process.exit(1);
}

await import('./chrome-devtools-mcp-main.js');
