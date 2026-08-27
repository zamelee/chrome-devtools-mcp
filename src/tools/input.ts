/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {McpContext} from '../McpContext.js';
import {zod} from '../third_party/index.js';
import type {ElementHandle, KeyInput} from '../third_party/index.js';
import type {TextSnapshotNode} from '../types.js';
import {parseKey} from '../utils/keyboard.js';
import {logger} from '../utils/logger.js';
import type {WaitForEventsResult} from '../WaitForHelper.js';

import {ToolCategory} from './categories.js';
import type {ContextPage} from './ToolDefinition.js';
import {definePageTool} from './ToolDefinition.js';

const dblClickSchema = zod
  .boolean()
  .optional()
  .describe('Set to true for double clicks. Default is false.');

const includeSnapshotSchema = zod
  .boolean()
  .optional()
  .describe('Whether to include a snapshot in the response. Default is false.');

const submitKeySchema = zod
  .string()
  .optional()
  .describe(
    'Optional key to press after typing. E.g., "Enter", "Tab", "Escape"',
  );

function handleActionError(error: unknown, uid: string) {
  logger?.('failed to act using a locator', error);
  throw new Error(
    `Failed to interact with the element with uid ${uid}. The element did not become interactive within the configured timeout.`,
    {
      cause: error,
    },
  );
}

async function selectNativeSelectOption(handle: ElementHandle<Element>) {
  using selectHandle = await handle.evaluateHandle(node => {
    if (!(node instanceof HTMLOptionElement)) {
      return null;
    }

    const select = node.closest('select');
    if (!select || select.multiple || select.disabled || node.disabled) {
      return null;
    }

    const parentElement = node.parentElement;
    if (
      parentElement instanceof HTMLOptGroupElement &&
      parentElement.disabled
    ) {
      return null;
    }

    return select;
  });

  using select = selectHandle.asElement() as ElementHandle<Element> | null;
  if (!select) {
    return false;
  }

  using valueHandle = await handle.getProperty('value');

  const value = await valueHandle.jsonValue();
  if (typeof value !== 'string') {
    return false;
  }
  await select.asLocator().fill(value);

  return true;
}

export const click = definePageTool({
  name: 'click',
  description: `Clicks on the provided element`,
  annotations: {
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  schema: {
    uid: zod
      .string()
      .describe(
        'The uid of an element on the page from the page content snapshot',
      ),
    dblClick: dblClickSchema,
    includeSnapshot: includeSnapshotSchema,
  },
  blockedByDialog: true,
  verifyFilesSchema: [],
  handler: async (request, response, context) => {
    const uid = request.params.uid;
    using handle = await request.page.getElementByUid(uid);
    const aXNode = request.page.getAXNodeByUid(uid);
    const shouldSelectNativeOption =
      !request.params.dblClick && aXNode?.role === 'option';
    try {
      const result = await request.page.waitForEventsAfterAction(async () => {
        if (
          shouldSelectNativeOption &&
          (await selectNativeSelectOption(handle))
        ) {
          return;
        }

        await handle.asLocator().click({
          count: request.params.dblClick ? 2 : 1,
        });
      });
      response.appendResponseLine(
        request.params.dblClick
          ? `Successfully double clicked on the element`
          : `Successfully clicked on the element`,
      );
      response.attachWaitForResult(result);
      if (request.params.includeSnapshot) {
        response.includeSnapshot();
      }
    } catch (error) {
      handleActionError(error, uid);
    }
  },
});

export const clickAt = definePageTool({
  name: 'click_at',
  description: `Clicks at the provided coordinates`,
  annotations: {
    category: ToolCategory.INPUT,
    readOnlyHint: false,
    conditions: ['experimentalVision'],
  },
  schema: {
    x: zod.number().describe('The x coordinate'),
    y: zod.number().describe('The y coordinate'),
    dblClick: dblClickSchema,
    includeSnapshot: includeSnapshotSchema,
  },
  blockedByDialog: true,
  verifyFilesSchema: [],
  handler: async (request, response) => {
    const page = request.page;
    const result = await page.waitForEventsAfterAction(async () => {
      await page.pptrPage.mouse.click(request.params.x, request.params.y, {
        count: request.params.dblClick ? 2 : 1,
      });
    });
    response.appendResponseLine(
      request.params.dblClick
        ? `Successfully double clicked at the coordinates`
        : `Successfully clicked at the coordinates`,
    );
    response.attachWaitForResult(result);
    if (request.params.includeSnapshot) {
      response.includeSnapshot();
    }
  },
});

export const hover = definePageTool({
  name: 'hover',
  description: `Hover over the provided element`,
  annotations: {
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  schema: {
    uid: zod
      .string()
      .describe(
        'The uid of an element on the page from the page content snapshot',
      ),
    includeSnapshot: includeSnapshotSchema,
  },
  blockedByDialog: true,
  verifyFilesSchema: [],
  handler: async (request, response) => {
    const uid = request.params.uid;
    using handle = await request.page.getElementByUid(uid);
    try {
      const result = await request.page.waitForEventsAfterAction(async () => {
        await handle.asLocator().hover();
      });
      response.appendResponseLine(`Successfully hovered over the element`);
      response.attachWaitForResult(result);
      if (request.params.includeSnapshot) {
        response.includeSnapshot();
      }
    } catch (error) {
      handleActionError(error, uid);
    }
  },
});

// The AXNode for an option doesn't contain its `value`. We set text content of the option as value.
// If the form is a combobox, we need to find the correct option by its text value.
// To do that, loop through the children while checking which child's text matches the requested value (requested value is actually the text content).
// When the correct option is found, use the element handle to get the real value.
async function selectOption(
  handle: ElementHandle,
  aXNode: TextSnapshotNode,
  value: string,
) {
  let optionFound = false;
  for (const child of aXNode.children) {
    if (child.role === 'option' && child.name === value && child.value) {
      optionFound = true;
      using childHandle = await child.elementHandle();
      if (childHandle) {
        using childValueHandle = await childHandle.getProperty('value');

        const childValue = await childValueHandle.jsonValue();
        if (typeof childValue === 'string') {
          await handle.asLocator().fill(childValue);
        }

        break;
      }
    }
  }
  if (!optionFound) {
    throw new Error(`Could not find option with text "${value}"`);
  }
}

function hasOptionChildren(aXNode: TextSnapshotNode) {
  return aXNode.children.some(child => child.role === 'option');
}

async function fillFormElement(
  uid: string,
  value: string,
  context: McpContext,
  page: ContextPage,
) {
  using handle = await page.getElementByUid(uid);
  try {
    const aXNode = page.getAXNodeByUid(uid);
    // We assume that combobox needs to be handled as select if it has
    // role='combobox' and option children.
    if (aXNode && aXNode.role === 'combobox' && hasOptionChildren(aXNode)) {
      await selectOption(handle, aXNode, value);
    } else {
      const isToggle = await handle.evaluate(el => {
        if (el instanceof HTMLInputElement) {
          return el.type === 'checkbox' || el.type === 'radio';
        }
        const role = el.getAttribute('role');
        return role === 'checkbox' || role === 'radio' || role === 'switch';
      });

      if (isToggle) {
        if (['true', 'false'].includes(value)) {
          await handle.asLocator().fill(value === 'true');
        } else {
          throw new Error(
            `Checkboxes, radio boxes and toggles require "true" or "false" value, but ${value} was used`,
          );
        }
      } else {
        // Increase timeout for longer input values.
        const timeoutPerChar = 10; // ms
        const fillTimeout =
          page.pptrPage.getDefaultTimeout() + value.length * timeoutPerChar;
        await handle.asLocator().setTimeout(fillTimeout).fill(value);
      }
    }
  } catch (error) {
    handleActionError(error, uid);
  }
}

export const fill = definePageTool({
  name: 'fill',
  description: `Type text into an input, text area or select an option from a <select> element.`,
  annotations: {
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  schema: {
    uid: zod
      .string()
      .describe(
        'The uid of an element on the page from the page content snapshot',
      ),
    value: zod
      .string()
      .describe(
        'The value to fill in. "true" or "false" for checkboxes and toggles, "true" for radio buttons.',
      ),
    includeSnapshot: includeSnapshotSchema,
  },
  blockedByDialog: true,
  verifyFilesSchema: [],
  handler: async (request, response, context) => {
    const page = request.page;
    const result = await page.waitForEventsAfterAction(async () => {
      await fillFormElement(
        request.params.uid,
        request.params.value,
        context as McpContext,
        page,
      );
    });
    response.appendResponseLine(`Successfully filled out the element`);
    response.attachWaitForResult(result);
    if (request.params.includeSnapshot) {
      response.includeSnapshot();
    }
  },
});

export const typeText = definePageTool({
  name: 'type_text',
  description: `Type text using keyboard into a previously focused input`,
  annotations: {
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  schema: {
    text: zod.string().describe('The text to type'),
    submitKey: submitKeySchema,
  },
  blockedByDialog: true,
  verifyFilesSchema: [],
  handler: async (request, response) => {
    const page = request.page;
    const result = await page.waitForEventsAfterAction(async () => {
      await page.pptrPage.keyboard.type(request.params.text);
      if (request.params.submitKey) {
        await page.pptrPage.keyboard.press(
          request.params.submitKey as KeyInput,
        );
      }
    });
    response.appendResponseLine(
      `Typed text "${request.params.text}${request.params.submitKey ? ` + ${request.params.submitKey}` : ''}"`,
    );
    response.attachWaitForResult(result);
  },
});

export const drag = definePageTool({
  name: 'drag',
  description: `Drag an element onto another element`,
  annotations: {
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  schema: {
    from_uid: zod.string().describe('The uid of the element to drag'),
    to_uid: zod.string().describe('The uid of the element to drop into'),
    includeSnapshot: includeSnapshotSchema,
  },
  blockedByDialog: true,
  verifyFilesSchema: [],
  handler: async (request, response) => {
    using fromHandle = await request.page.getElementByUid(
      request.params.from_uid,
    );
    using toHandle = await request.page.getElementByUid(request.params.to_uid);

    const result = await request.page.waitForEventsAfterAction(async () => {
      await fromHandle.drag(toHandle);
      await new Promise(resolve => setTimeout(resolve, 50));
      await toHandle.drop(fromHandle);
    });
    response.appendResponseLine(`Successfully dragged an element`);
    response.attachWaitForResult(result);
    if (request.params.includeSnapshot) {
      response.includeSnapshot();
    }
  },
});

export const fillForm = definePageTool({
  name: 'fill_form',
  description: `Fill out multiple form elements (inputs, selects, checkboxes, radios) at once. ALWAYS prefer this tool over multiple individual 'fill' or 'click' calls when interacting with forms. It is significantly faster, more reliable, and reduces turn count. Example: Fill username, password, and check "Remember Me" in one call.`,
  annotations: {
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  schema: {
    elements: zod
      .array(
        // eslint-disable-next-line @local/enforce-zod-schema
        zod.object({
          uid: zod.string().describe('The uid of the element to fill out'),
          value: zod
            .string()
            .describe(
              'Value for the element. "true" or "false" for checkboxes and toggles, "true" for radio buttons.',
            ),
        }),
      )
      .describe('Elements from snapshot to fill out.'),
    includeSnapshot: includeSnapshotSchema,
  },
  blockedByDialog: true,
  verifyFilesSchema: [],
  handler: async (request, response, context) => {
    const page = request.page;
    let lastResult: WaitForEventsResult = {};
    for (const element of request.params.elements) {
      lastResult = await page.waitForEventsAfterAction(async () => {
        await fillFormElement(
          element.uid,
          element.value,
          context as McpContext,
          page,
        );
      });
    }
    response.appendResponseLine(`Successfully filled out the form`);
    response.attachWaitForResult(lastResult);
    if (request.params.includeSnapshot) {
      response.includeSnapshot();
    }
  },
});
/**
 * F-VendorTier3 (Tier 3 of uploadFile): a vendor-agnostic framework for the
 * "hidden input behind an in-app overlay" pattern observed on web AI composers.
 * Originally motivated by chatgpt.com (2026-08-24 UI change hiding
 * `<input type="file">` behind an in-app overlay menu), but designed so
 * additional vendors can be plugged in by adding to `TIER3_VENDORS` once
 * their selector + URL pattern is empirically verified (see
 * ~/.codex/AGENTS.md §0b.7.10.1 vendor coverage matrix).
 *
 * For matched vendors, Tier 1 (direct upload) and Tier 2 (pre-arm CDP + click
 * button) BOTH fail: the overlay button click does NOT trigger an OS native
 * file chooser, so `Page.setInterceptFileChooserDialog` never fires. Tier 3
 * reaches the input directly via CDP `DOM.querySelector` +
 * `DOM.setFileInputFiles` on the vendor's `inputSelector`. This bypasses the
 * overlay and the OS native chooser. We don't need to make the input visible
 * because `setFileInputFiles` only mutates `HTMLInputElement.files` and
 * dispatches a `change` event; the vendor's file chip is rendered based on
 * `input.files` state regardless of CSS visibility.
 *
 * This helper intentionally does NOT use the a11y snapshot tree or the
 * standard `uploadFile` uid lookup: the inputs are typically `display:none`
 * and not exposed in the snapshot, so uid resolution would always fail.
 */
import {
  pickTier3Vendor,
  TIER3_VENDORS,
  type Tier3Vendor,
} from '../vendor-tier3-config.js';
// TIER3_VENDORS + Tier3Vendor kept as compile-time references to verify
// the sub-module boundary; the runtime path only needs pickTier3Vendor.

async function uploadViaTier3Fallback(
  pptrPage: import('../third_party/index.js').Page,
  filePath: string,
  vendor: Tier3Vendor,
): Promise<void> {
  const cdpSession = await pptrPage.target().createCDPSession();
  try {
    // F-VendorTier3: if the vendor's <input type="file"> is dynamically
    // inserted into the DOM (e.g. gemini reveals it inside a menu opened
    // by an "Upload & tools" button), click the trigger selector first and
    // wait for DOM stabilization before searching for the input. The
    // trigger is assumed NOT to open an OS native file chooser — if it
    // does, the subsequent DOM.querySelector for `vendor.inputSelector`
    // will time out / return null and surface a clear error.
    // F-VendorTier3: dynamic-input vendor (e.g. gemini). The flow:
    //   1. Try to find the input selector directly (handles the case
    //      where the trigger button was already activated by an earlier
    //      step and the menu is already open).
    //   2. If not found AND a triggerSelector is configured, click the
    //      trigger button to open the menu, wait for the input to be
      //      inserted, then re-query.
    // We always check input first to avoid the toggle-button trap: clicking
    // an expandable trigger when the menu is already open CLOSES the menu,
    // which makes a subsequent querySelector(inputSelector) fail.
    const rootNodeId0 = (await cdpSession.send('DOM.getDocument')).root.nodeId;
    const initialInputProbe = await cdpSession.send('DOM.querySelector', {
      nodeId: rootNodeId0,
      selector: vendor.inputSelector,
    });
    if (!initialInputProbe.nodeId && vendor.triggerSelector) {
      const triggerHandle = await pptrPage.$(vendor.triggerSelector);
      if (!triggerHandle) {
        throw new Error(
          `${vendor.triggerSelector} not found for ${vendor.label}. The ` +
            `${vendor.label} composer may not be open, or the trigger ` +
            `selector may be stale.`,
        );
      }
      // F-VendorTier3: blur the composer BEFORE clicking the trigger.
      // Gemini (and similar vendors) suppress trigger-button clicks while
      // the composer is focused — the click is intercepted as a no-op to
      // avoid popping the upload menu while the user is typing. Without
      // this blur, BUG-Round4 manifests: composer="hello" + click trigger
      // → menu stays closed + querySelector(inputSelector) fails. The
      // blur must be done before the click event dispatches.
      await pptrPage.evaluate(() => {
        const active = document.activeElement;
        if (active instanceof HTMLElement) {
          active.blur();
        }
      }).catch(() => {
        /* noop if blur is unavailable */
      });
      try {
        await triggerHandle.scrollIntoView().catch(() => {
          /* element may already be in view */
        });
        await triggerHandle.click();
      } finally {
        await triggerHandle.dispose();
      }
      // Poll DOM for inputSelector to appear, up to a bounded timeout.
      // postTriggerWaitMs is the seed delay before the first poll; the
      // overall wait is bounded by ~1500ms total. We avoid a flat sleep
      // because gemini's Angular menu-open animation varies by network
      // latency; polling converges as soon as the input is inserted.
      const seedWait = vendor.postTriggerWaitMs ?? 0;
      if (seedWait > 0) {
        await new Promise(resolve => setTimeout(resolve, seedWait));
      }
      const pollDeadlineMs = 1500;
      const pollStart = Date.now();
      while (Date.now() - pollStart < pollDeadlineMs) {
        const probe = await cdpSession.send('DOM.querySelector', {
          nodeId: rootNodeId0,
          selector: vendor.inputSelector,
        });
        if (probe.nodeId) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    const {root} = await cdpSession.send('DOM.getDocument');
    const {nodeId} = await cdpSession.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: vendor.inputSelector,
    });
    if (!nodeId) {
      throw new Error(
        `${vendor.inputSelector} not found via DOM.querySelector. The ` +
          `${vendor.label} composer may not be open, or the vendor may have ` +
          `changed its markup.`,
      );
    }
    await cdpSession.send('DOM.setFileInputFiles', {
      files: [filePath],
      nodeId,
    });
  } finally {
    await cdpSession.detach().catch(() => {
      /* best-effort cleanup */
    });
  }
}

export const uploadFile = definePageTool({
  name: 'upload_file',
  description: 'Upload a file through a provided element.',
  annotations: {
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  schema: {
    uid: zod
      .string()
      .describe(
        'The uid of the file input element or an element that will open file chooser on the page from the page content snapshot',
      ),
    filePath: zod.string().describe('The local path of the file to upload'),
    includeSnapshot: includeSnapshotSchema,
  },
  blockedByDialog: true,
  verifyFilesSchema: ['filePath'],
  handler: async (request, response, context) => {
    const {uid, filePath} = request.params;
    using handle = (await request.page.getElementByUid(
      uid,
    )) as ElementHandle<HTMLInputElement>;

    try {
      await handle.uploadFile(filePath);
    } catch {
      // Some sites use a proxy element to trigger file upload instead of
      // a type=file element. In this case, we want to default to
      // Page.waitForFileChooser() and upload the file this way.
      //
      // Pre-arm CDP file chooser interception BEFORE clicking to eliminate
      // the race where the native OS file picker pops before
      // waitForFileChooser()'s listener is registered (see §0b.7.9 in
      // ~/.codex/AGENTS.md). Without pre-arming, the click can trigger
      // a real native dialog that the user has to dismiss manually.
      const cdpSession = await request.page.pptrPage.createCDPSession();
      let interceptArmed = false;
      try {
        await cdpSession.send('Page.setInterceptFileChooserDialog', {
          enabled: true,
        });
        interceptArmed = true;
        const [fileChooser] = await Promise.all([
          request.page.pptrPage.waitForFileChooser({timeout: 3000}),
          handle.asLocator().click(),
        ]);
        await fileChooser.accept([filePath]);
      } catch (fallbackError) {
        const detail =
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError);
        // Tier 3 (F-VendorTier3): vendor-agnostic auto fallback. Originally
        // motivated by chatgpt.com (2026-08-24 UI change hiding the file
        // input), now extended via `TIER3_VENDORS` table (see §0b.7.10.1).
        // For matched URLs, Tier 1 (direct upload) and Tier 2 (pre-arm CDP +
        // click button) BOTH fail: clicking the vendor's "add files" button
        // opens an in-app overlay menu rather than the OS native file chooser,
        // so `Page.setInterceptFileChooserDialog` never fires. Tier 3 reaches
        // the input directly via CDP `DOM.querySelector` + `DOM.setFileInputFiles`
        // on the vendor's configured input selector. This bypasses both the
        // vendor overlay and the OS native chooser. We don't need to make
        // the input visible because `setFileInputFiles` only mutates
        // `HTMLInputElement.files` and dispatches a `change` event; the vendor
        // renders its file chip based on `input.files` state regardless of CSS
        // visibility.
        const tier3Vendor =
          context.isChatgptV2FallbackEnabled()
            ? pickTier3Vendor(request.page.pptrPage.url())
            : null;
        if (tier3Vendor) {
          try {
            await uploadViaTier3Fallback(
              request.page.pptrPage,
              filePath,
              tier3Vendor,
            );
            response.appendResponseLine(
              `File uploaded from ${filePath} via ${tier3Vendor.label} fallback ` +
                `(Tier 3: DOM.setFileInputFiles on ${tier3Vendor.inputSelector}).`,
            );
            if (request.params.includeSnapshot) {
              response.includeSnapshot();
            }
            return;
          } catch (tier3Error) {
            const t3Detail =
              tier3Error instanceof Error
                ? tier3Error.message
                : String(tier3Error);
            throw new Error(
              `Failed to upload file. Tier 2 (pre-arm CDP intercept + click ` +
                `button) failed with: ${detail}. Tier 3 (${tier3Vendor.label} DOM ` +
                `fallback) also failed: ${t3Detail}. Verify that the ` +
                `${tier3Vendor.label} composer is open and that you have ` +
                `permission to upload files. If the Tier 3 path is unreliable ` +
                `for this page, start the server with ` +
                `--disable-chatgpt-v2-fallback to skip it.`,
            );
          }
        }
        throw new Error(
          `Failed to upload file. The element is not a real <input type="file"> ` +
            `and clicking it did not trigger an intercepted file chooser. ` +
            `⚠️ A native OS file picker may be visible on screen — verify ` +
            `visually that no OS dialog is up. If it is, dismiss it (Escape or ` +
            `close button), re-take a snapshot, find the real <input type="file"> ` +
            `element, and retry with that uid. ` +
            `Underlying error: ${detail}`,
        );
      } finally {
        if (interceptArmed) {
          await cdpSession
            .send('Page.setInterceptFileChooserDialog', {enabled: false})
            .catch(() => {
              /* best-effort cleanup */
            });
        }
        await cdpSession.detach().catch(() => {
          /* best-effort cleanup */
        });
      }
    }
    if (request.params.includeSnapshot) {
      response.includeSnapshot();
    }
    response.appendResponseLine(`File uploaded from ${filePath}.`);
  },
});

export const pressKey = definePageTool({
  name: 'press_key',
  description: `Press a key or key combination. Use this when other input methods like fill() cannot be used (e.g., keyboard shortcuts, navigation keys, or special key combinations).`,
  annotations: {
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  schema: {
    key: zod
      .string()
      .describe(
        'A key or a combination (e.g., "Enter", "Control+A", "Control++", "Control+Shift+R"). Modifiers: Control, Shift, Alt, Meta',
      ),
    includeSnapshot: includeSnapshotSchema,
  },
  blockedByDialog: true,
  verifyFilesSchema: [],
  handler: async (request, response) => {
    const page = request.page;
    const tokens = parseKey(request.params.key);
    const [key, ...modifiers] = tokens;

    const result = await page.waitForEventsAfterAction(async () => {
      const heldModifiers: KeyInput[] = [];
      try {
        for (const modifier of modifiers) {
          await page.pptrPage.keyboard.down(modifier);
          heldModifiers.push(modifier);
        }
        await page.pptrPage.keyboard.press(key);
      } finally {
        // Release every modifier that was successfully pressed, even if a
        // later key event throws. Otherwise a failed press leaves modifiers
        // logically held down in the browser (see #2309).
        for (const modifier of heldModifiers.toReversed()) {
          await page.pptrPage.keyboard.up(modifier);
        }
      }
    });

    response.appendResponseLine(
      `Successfully pressed key: ${request.params.key}`,
    );
    response.attachWaitForResult(result);
    if (request.params.includeSnapshot) {
      response.includeSnapshot();
    }
  },
});
