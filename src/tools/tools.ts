/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {ParsedArguments} from '../bin/chrome-devtools-mcp-cli-options.js';

import * as consoleTools from './console.js';
import * as emulationTools from './emulation.js';
import * as extensionTools from './extensions.js';
import * as inputTools from './input.js';
import * as lighthouseTools from './lighthouse.js';
import * as memoryTools from './memory.js';
import * as networkTools from './network.js';
import * as pagesTools from './pages.js';
import * as performanceTools from './performance.js';
import * as pwaTools from './pwa.js';
import * as screencastTools from './screencast.js';
import * as screenshotTools from './screenshot.js';
import * as scriptTools from './script.js';
import * as slimTools from './slim/tools.js';
import * as snapshotTools from './snapshot.js';
import * as thirdPartyDeveloperTools from './thirdPartyDeveloper.js';
import type {ToolDefinition} from './ToolDefinition.js';
import * as webmcpTools from './webmcp.js';

export const createTools = (args: ParsedArguments) => {
  const rawTools = args.slim
    ? Object.values(slimTools)
    : [
        ...Object.values(consoleTools),
        ...Object.values(emulationTools),
        ...Object.values(extensionTools),
        ...Object.values(inputTools),
        ...Object.values(lighthouseTools),
        ...Object.values(memoryTools),
        ...Object.values(networkTools),
        ...Object.values(pagesTools),
        ...Object.values(performanceTools),
        ...Object.values(pwaTools),
        ...Object.values(screencastTools),
        ...Object.values(screenshotTools),
        ...Object.values(scriptTools),
        ...Object.values(snapshotTools),
        ...Object.values(thirdPartyDeveloperTools),
        ...Object.values(webmcpTools),
      ];

  const tools: ToolDefinition[] = [];
  for (const tool of rawTools) {
    // F-ToolFactoryFilter (2026-08-30) + async fix (2026-09-01): Try to resolve
    // tool factories by invoking them. Module-level helper functions
    // (shouldUseTypeText / fillOrTypeText / probeReactControlledValue in
    // input.js) are NOT tool factories - invoking them with
    // (args: ParsedArguments) throws because they expect a different
    // signature (vendor / page / opts). defineTool/definePageTool wrap
    // user functions as `(args) => factory(args)`, also function-typed, so
    // a pure `typeof === 'object'` filter accidentally killed page.js +
    // screenshot.js tools (listPages, navigatePage, newPage, screenshot).
    // The fix: try/catch invoke. Helper functions throw -> skip.
    // Async helpers/factories return a Promise; createTools is sync and
    // cannot await, so skip. Attach a no-op .catch so Node v24 does not
    // emit an unhandled rejection (which is scheduled at microtask flush
    // even if we never await the Promise). Tool factories return a
    // ToolDefinition object -> push.
    let resolved: unknown = tool;
    if (typeof tool === 'function') {
      try {
        const result = (tool as (a: ParsedArguments) => unknown)(args);
        if (result instanceof Promise) {
          result.catch(() => {});
          continue;
        }
        resolved = result;
      } catch {
        continue;
      }
    }
    if (
      resolved &&
      typeof resolved === 'object' &&
      'name' in resolved &&
      'schema' in resolved
    ) {
      tools.push(resolved as ToolDefinition);
    }
  }

  tools.sort((a, b) => {
    return a.name.localeCompare(b.name);
  });

  return tools;
};
