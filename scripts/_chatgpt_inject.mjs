#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * _chatgpt_inject.mjs — chatgpt.com prompt injection (USER-ONLY TOOL)
 *
 * AGENTS.md contracts:
 *   §0b.2     USER-ONLY TOOL — raw CDP via 9222; agent 不得自动调用。
 *   §0d.3     TAB REUSE — `browser.pages()` 复用 chatgpt.com tab, 不开新。
 *   §0a.x.7.3 SHA1 VERIFY (硬判定) — innerText + normalize + sha1 严格相等。
 *   §0a.x.7.4 SEND 4 轨 — sha1 + offsetParent + disabled + aria-disabled。
 *
 * ORIGIN:
 *   Lifted from D:/Documents/VibeCoding/storyforge-server/tmp/_chrome_test/_inject_chatgpt.mjs
 *   (3055 bytes, raw CDP via puppeteer-core createCDPSession).
 *   Changes vs source:
 *     - 4 个 hardcoded 路径 → env var 参数化 (CHATGPT_PROMPT_FILE / CHATGPT_OUTPUT_DIR)
 *     - 加 SHA1 VERIFY (§0a.x.7.3 硬判定, source 缺)
 *     - 加完整 SEND 4 轨 (sha1 + visible + disabled + aria-disabled, source 漏 sha1 第 1 轨)
 *     - 加 docstring (USER-ONLY / TAB REUSE / SHA1 VERIFY / SEND 4 轨)
 *     - 加 dep check (puppeteer-core 必须 user 自己 npm install)
 *
 * USAGE (any OS with Node 18+):
 *   cd <repo-root>
 *   npm install puppeteer-core    # user-local, 不进 fork 的 package.json
 *   set CHATGPT_PROMPT_FILE=./prompt.md
 *   # CHATGPT_OUTPUT_DIR defaults to os.tmpdir() — override only if needed
 *   node scripts/_chatgpt_inject.mjs
 *
 * PARAMS (env, optional unless noted):
 *   CHATGPT_PROMPT_FILE  <required>            path to UTF-8 prompt file
 *   CHATGPT_OUTPUT_DIR   os.tmpdir()  (default; override via env var to redirect output)
 *   CHATGPT_TAB_HOST     chatgpt.com            URL fragment to match when listing pages
 *   CHATGPT_CDP_URL      http://127.0.0.1:9222   Chrome DevTools HTTP endpoint
 *   CHATGPT_DRY_RUN      (unset)                1 = skip click send (inject only)
 *
 * EXIT CODES:
 *   0  inject + send OK
 *   1  missing env / chatgpt tab not found / other runtime
 *   2  sha1 mismatch (inject incomplete — DO NOT click send)
 *   3  send button 4 轨 not all pass
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import os from 'node:os';

let puppeteer;
try {
  puppeteer = (await import('puppeteer-core')).default;
} catch (e) {
  console.error('[fatal] puppeteer-core not installed.\n  Run: npm install puppeteer-core');
  process.exit(1);
}

const PromptFile = process.env.CHATGPT_PROMPT_FILE;
const OutDir = process.env.CHATGPT_OUTPUT_DIR || os.tmpdir();
const TabHost = process.env.CHATGPT_TAB_HOST || 'chatgpt.com';
const CdpUrl = process.env.CHATGPT_CDP_URL || 'http://127.0.0.1:9222';
const DryRun = !!process.env.CHATGPT_DRY_RUN?.trim();

if (!PromptFile) {
  console.error('[fatal] CHATGPT_PROMPT_FILE env var required (path to UTF-8 prompt file)');
  process.exit(1);
}

const Sha1 = (s) => crypto.createHash('sha1').update(s, 'utf8').digest('hex');
const Norm = (s) => s.replace(/[\s\n]+/g, ' ').trim();
const Out = (name) => path.join(OutDir, name);

const ExpectedRaw = fs.readFileSync(PromptFile, 'utf8');
const ExpectedNorm = Norm(ExpectedRaw);
const ExpectedSha = Sha1(ExpectedNorm);
console.log('[info] prompt length:', ExpectedRaw.length,
            'normalized:', ExpectedNorm.length,
            'sha1:', ExpectedSha);

const Browser = await puppeteer.connect({ browserURL: CdpUrl, defaultViewport: null });
const Page = (await Browser.pages()).find((p) => p.url().includes(TabHost));
if (!Page) {
  console.error(`[fatal] no tab with URL containing "${TabHost}" — start Chrome with --remote-debugging-port=9222 and open ${TabHost}`);
  await Browser.disconnect();
  process.exit(1);
}
console.log('[info] target:', Page.url());
await Page.bringToFront();
await new Promise((r) => setTimeout(r, 1500));

const Cdp = await Page.target().createCDPSession();

// Focus #prompt-textarea (chatgpt ProseMirror editor per AGENTS.md §0a.7)
await Page.evaluate(() => document.querySelector('#prompt-textarea')?.focus());
await new Promise((r) => setTimeout(r, 300));

// Clear: Ctrl+A + Delete via raw CDP key events (modifiers: 2 = Control)
async function Key(type, key, code, modifiers) {
  return Cdp.send('Input.dispatchKeyEvent', { type, key, code, modifiers });
}
await Key('keyDown', 'a', 'KeyA', 2);
await Key('keyUp',   'a', 'KeyA', 2);
await new Promise((r) => setTimeout(r, 100));
await Key('keyDown', 'Delete', 'Delete', 0);
await Key('keyUp',   'Delete', 'Delete', 0);
await new Promise((r) => setTimeout(r, 300));

// Inject via raw CDP Input.insertText (isTrusted=true, ProseMirror-safe)
await Cdp.send('Input.insertText', { text: ExpectedRaw });
await new Promise((r) => setTimeout(r, 800));

// SHA1 VERIFY (§0a.x.7.3 硬判定)
const ActualRaw = await Page.evaluate(
  () => document.querySelector('#prompt-textarea')?.innerText ?? ''
);
const ActualNorm = Norm(ActualRaw);
const ActualSha = Sha1(ActualNorm);

console.log('[info] editor innerText length:', ActualRaw.length,
            'normalized:', ActualNorm.length,
            'sha1:', ActualSha);
console.log('[info] editor preview:', JSON.stringify(ActualRaw.slice(0, 100)));

if (ActualSha !== ExpectedSha) {
  console.error('[fatal] SHA1 MISMATCH — injection incomplete');
  console.error('  expected:', ExpectedSha, '(len', ExpectedNorm.length + ')');
  console.error('  actual:  ', ActualSha,  '(len', ActualNorm.length  + ')');
  await Page.screenshot({ path: Out('_chatgpt_inject_failed.png') });
  await Browser.disconnect();
  process.exit(2);
}
console.log('[ok] sha1 matches — injection complete');

// Screenshot before send
await Page.screenshot({ path: Out('_chatgpt_before_send.png') });

// SEND 4 轨 (§0a.x.7.4) — sha1 + visible + disabled + aria-disabled
const SendBtn = await Page.evaluate(() => {
  const btn = document.querySelector('[data-testid="send-button"]');
  if (!btn) {return null;}
  return {
    visible: btn.offsetParent !== null,
    disabled: btn.disabled,
    ariaDisabled: btn.getAttribute('aria-disabled'),
  };
});
console.log('[info] send button:', JSON.stringify(SendBtn));

const T1Sha     = true;  // already verified above
const T2Visible = SendBtn?.visible === true;
const T3Disabled = SendBtn?.disabled === false;
const T4Aria     = SendBtn?.ariaDisabled !== 'true';

if (!(T1Sha && T2Visible && T3Disabled && T4Aria)) {
  console.error('[fatal] send button 4 轨未全过:', {
    T1Sha, T2Visible, T3Disabled, T4Aria,
  });
  await Browser.disconnect();
  process.exit(3);
}
console.log('[ok] send button 4 轨全过');

if (DryRun) {
  console.log('[dry-run] NOT clicking send (CHATGPT_DRY_RUN=1)');
  await Browser.disconnect();
  process.exit(0);
}

await Page.click('[data-testid="send-button"]');
console.log('[ok] clicked send');

// Wait for chatgpt streaming to start
await new Promise((r) => setTimeout(r, 3000));
await Page.screenshot({ path: Out('_chatgpt_streaming.png') });

await Browser.disconnect();
console.log('[done] exit 0');
