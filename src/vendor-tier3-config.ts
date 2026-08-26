/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Tier3Vendor {
  readonly urlMatch: string;
  readonly inputSelector: string;
  readonly label: string;
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
];

export function pickTier3Vendor(url: string): Tier3Vendor | null {
  return TIER3_VENDORS.find(v => url.includes(v.urlMatch)) ?? null;
}
