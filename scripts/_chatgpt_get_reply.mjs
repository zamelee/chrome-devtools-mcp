#!/usr/bin/env node
/**
 * _chatgpt_get_reply.mjs — collect chatgpt.com last assistant message (USER-ONLY TOOL)
 *
 * AGENTS.md contracts:
 *   §0b.2  USER-ONLY TOOL — raw CDP via 9222; agent 不得自动调用。
 *   §0d.3  TAB REUSE — `browser.pages()` 复用 chatgpt.com tab, 不开新。
 *
 * ORIGIN:
 *   Lifted from D:/Documents/VibeCoding/storyforge-server/tmp/_chrome_test/_get_reply.mjs
 *   (1255 bytes).
 *   Changes vs source:
 *     - 1 个 hardcoded 路径 → env var 参数化 (CHATGPT_OUTPUT_DIR / CHATGPT_REPLY_FILE)
 *     - 加 streaming-aware poll (最多 30s 等 streaming 结束, 不是"假设已结束")
 *     - 加 USER-ONLY / TAB REUSE docstring
 *     - 加 dep check
 *
 * USAGE (any OS with Node 18+):
 *   cd <repo-root>
 *   npm install puppeteer-core    # user-local
 *   node scripts/_chatgpt_get_reply.mjs
 *
 * PARAMS (env, optional):
 *   CHATGPT_OUTPUT_DIR    os.tmpdir()  (default; override via env var to redirect output)
 *   CHATGPT_REPLY_FILE    _chatgpt_reply.md
 *   CHATGPT_TAB_HOST      chatgpt.com
 *   CHATGPT_CDP_URL       http://127.0.0.1:9222
 *   CHATGPT_POLL_MS       3000    poll interval if still streaming
 *   CHATGPT_MAX_POLLS     10      max polls (= 30s with default 3000ms)
 *
 * EXIT CODES:
 *   0  reply saved (streaming finished OR polled to limit)
 *   1  chatgpt tab not found / runtime error
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import os from 'node:os';

let puppeteer;
try {
  puppeteer = (await import('puppeteer-core')).default;
} catch (e) {
  console.error('[fatal] puppeteer-core not installed.\n  Run: npm install puppeteer-core');
  process.exit(1);
}

const OutDir     = process.env.CHATGPT_OUTPUT_DIR  || os.tmpdir();
const ReplyFile  = process.env.CHATGPT_REPLY_FILE  || '_chatgpt_reply.md';
const TabHost    = process.env.CHATGPT_TAB_HOST    || 'chatgpt.com';
const CdpUrl     = process.env.CHATGPT_CDP_URL     || 'http://127.0.0.1:9222';
const PollMs     = parseInt(process.env.CHATGPT_POLL_MS   || '3000', 10);
const MaxPolls   = parseInt(process.env.CHATGPT_MAX_POLLS || '10',   10);

const Out = (name) => path.join(OutDir, name);

const Browser = await puppeteer.connect({ browserURL: CdpUrl, defaultViewport: null });
const Page = (await Browser.pages()).find((p) => p.url().includes(TabHost));
if (!Page) {
  console.error(`[fatal] no tab with URL containing "${TabHost}"`);
  await Browser.disconnect();
  process.exit(1);
}
console.log('[info] target:', Page.url());

async function Snapshot() {
  return Page.evaluate(() => {
    const stopBtn = document.querySelector('[data-testid="stop-button"]');
    const msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
    let lastLen = 0;
    if (msgs.length > 0) {
      const last = msgs[msgs.length - 1];
      lastLen = last.textContent ? last.textContent.length : 0;
    }
    return {
      isStreaming: !!stopBtn,
      lastLen,
      msgCount: msgs.length,
      lastText: msgs.length > 0 ? (msgs[msgs.length - 1].textContent || '') : '',
    };
  });
}

// streaming-aware poll: if still streaming, wait up to MaxPolls * PollMs for it to finish
let snap = await Snapshot();
let pollCount = 0;
while (snap.isStreaming && pollCount < MaxPolls) {
  console.log(`[info] streaming (lastLen=${snap.lastLen}), poll ${pollCount + 1}/${MaxPolls}`);
  await new Promise((r) => setTimeout(r, PollMs));
  snap = await Snapshot();
  pollCount++;
}
if (snap.isStreaming) {
  console.warn(`[warn] still streaming after ${MaxPolls} polls; saving partial reply`);
}

const OutPath = Out(ReplyFile);
fs.writeFileSync(OutPath, snap.lastText, 'utf8');
console.log('[info] saved', snap.lastText.length, 'chars to', OutPath);
console.log('[info] msgCount:', snap.msgCount, 'lastLen:', snap.lastLen);

await Browser.disconnect();
console.log('[done] exit 0');
