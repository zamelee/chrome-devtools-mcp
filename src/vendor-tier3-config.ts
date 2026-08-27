/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Tier3Vendor {
  readonly urlMatch: string;
  readonly inputSelector: string;
  readonly label: string;
  /**
   * Optional: a button to click BEFORE searching for `inputSelector`.
   * Used by vendors whose `<input type="file">` is dynamically inserted into
   * the DOM only after a menu/trigger button is activated (e.g. gemini's
   * "Upload & tools" button reveals the file input inside an in-app menu).
   * Clicking `triggerSelector` is assumed NOT to open an OS native file
   * chooser — if it does, Tier 3 will surface a CDP timeout error and the
   * upload should be retried with a different selector. Do NOT use this for
   * buttons that trigger the OS picker; those are handled by Tier 2.
   */
  readonly triggerSelector?: string;
  /**
   * Optional: delay after `triggerSelector` click before searching for
   * `inputSelector`. Vendors that animate the menu open or insert the input
   * asynchronously should set this to allow DOM stabilization. Default 0.
   */
  readonly postTriggerWaitMs?: number;
}

/**
 * Vendor table for Tier 3 fallback. Add a new entry here ONLY after the
 * selector + URL match have been empirically verified on the live site
 * (per AGENTS.md §0b.7.10.1 vendor coverage matrix). Entries are matched
 * in declaration order; first match wins.
 */
export const TIER3_VENDORS: readonly Tier3Vendor[] = [
  {
    urlMatch: 'chatgpt.com',
    inputSelector: 'input#upload-files',
    label: 'chatgpt v2',
  },
  // F-VendorTier3 (gemini): dynamic-input vendor. The "Upload & tools"
  // button reveals an in-app menu that contains 2 hidden `<input
  // type="file">` elements (class `hidden-file-input`). The two inputs
  // differ only by Angular's `ng-star-inserted` class; the canonical
  // selector picks the one inside `.simplified-file-uploader` (verified
  // 2026-08-26). See `tests/tools/input.test.ts` Tier 3 unit tests +
  // B-2 gemini empirical verification (3 rounds, see §0b.7.10.1).
  {
    urlMatch: 'gemini.google.com',
    inputSelector: '.simplified-file-uploader input.hidden-file-input',
    label: 'gemini',
    triggerSelector: 'button[aria-label="Upload & tools"]',
    postTriggerWaitMs: 500,
  },
  // F-VendorTier3 (copilot): static-input vendor. The file input
  // (#image-uploader) is hidden in the DOM but is the canonical upload
  // target. Note: client-side accept attribute restricts to images +
  // many binary formats; CDP DOM.setFileInputFiles bypasses client filter
  // but server-side may reject .txt/.md. B-2 verification 2026-08-27.
  // See `tests/tools/input.test.ts` Tier 3 unit tests + §0b.7.10.1
  // vendor coverage matrix.
  {
    urlMatch: 'github.com/copilot',
    inputSelector: 'input#image-uploader',
    label: 'copilot',
  },
];

export function pickTier3Vendor(url: string): Tier3Vendor | null {
  return TIER3_VENDORS.find(v => url.includes(v.urlMatch)) ?? null;
}
