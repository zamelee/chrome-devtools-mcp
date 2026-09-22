# Troubleshooting

## General tips

- Run `npx chrome-devtools-mcp@latest --help` to test if the MCP server runs on your machine.
- Make sure that your MCP client uses the same npm and node version as your terminal.
- When configuring your MCP client, try using the `--yes` argument to `npx` to
  auto-accept installation prompt.
- Find a specific error in the output of the `chrome-devtools-mcp` server.
  Usually, if your client is an IDE, logs would be in the Output pane.
- Search the [GitHub repository issues and discussions](https://github.com/ChromeDevTools/chrome-devtools-mcp) for help or existing similar problems.

## Debugging

Start the MCP server with debugging enabled and a log file:

- `DEBUG=* npx chrome-devtools-mcp@latest --log-file=/path/to/chrome-devtools-mcp.log`

Using `.mcp.json` to debug while using a client:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "chrome-devtools-mcp@latest",
        "--log-file",
        "/path/to/chrome-devtools-mcp.log"
      ],
      "env": {
        "DEBUG": "*"
      }
    }
  }
}
```

## Specific problems

### `Error [ERR_MODULE_NOT_FOUND]: Cannot find module ...`

This usually indicates either a non-supported Node version is in use or that the
`npm`/`npx` cache is corrupted. Try clearing the cache, uninstalling
`chrome-devtools-mcp` and installing it again. Clear the cache by running:

```sh
rm -rf ~/.npm/_npx # NOTE: this might remove other installed npx executables.
npm cache clean --force
```

### `Target closed` error

This indicates that the browser could not be started. Make sure that no Chrome
instances are running or close them. Make sure you have the latest stable Chrome
installed and that [your system is able to run Chrome](https://support.google.com/chrome/a/answer/7100626?hl=en).

### Chrome crashes on macOS when using Web Bluetooth

On macOS, Chrome launched by an MCP client application (such as Claude Desktop) may crash when a Web Bluetooth prompt appears. This is caused by a macOS privacy permission violation (TCC).

To resolve this, grant Bluetooth permission to the MCP client application in `System Settings > Privacy & Security > Bluetooth`. After granting permission, restart the client application and start a new MCP session.

### Remote debugging between virtual machine (VM) and host fails

When attempting to connect to Chrome running on a host machine from within a virtual machine (VM), Chrome may reject the connection due to 'Host' header validation. You can bypass this restriction by creating an SSH tunnel from the VM to the host. In the VM, run:

```sh
ssh -N -L 127.0.0.1:9222:127.0.0.1:9222 <user>@<host-ip>
```

Point the MCP connection inside the VM to `http://127.0.0.1:9222`. This allows DevTools to reach the host browser without triggering the Host validation error.

### Operating system sandboxes

Some MCP clients allow sandboxing the MCP server using macOS Seatbelt or Linux
containers. If sandboxes are enabled, `chrome-devtools-mcp` is not able to start
Chrome that requires permissions to create its own sandboxes. As a workaround,
either disable sandboxing for `chrome-devtools-mcp` in your MCP client or use
`--browser-url` to connect to a Chrome instance that you start manually outside
of the MCP client sandbox.

### WSL

By default, `chrome-devtools-mcp` in WSL requires Chrome to be installed within the Linux environment. While it normally attempts to launch Chrome on the Windows side, this currently fails due to a [known WSL issue](https://github.com/microsoft/WSL/issues/14201). Ensure you are using a [Linux distribution compatible with Chrome](https://support.google.com/chrome/a/answer/7100626).

Possible workarounds include:

- **Install Google Chrome in WSL:**
  - `wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb`
  - `sudo dpkg -i google-chrome-stable_current_amd64.deb`

- **Use Mirrored networking:**
  1. Configure [Mirrored networking for WSL](https://learn.microsoft.com/en-us/windows/wsl/networking).
  2. Start Chrome on the Windows side with:
     `chrome.exe --remote-debugging-port=9222 --user-data-dir=C:\path\to\dir`
  3. Start `chrome-devtools-mcp` with:
     `npx chrome-devtools-mcp --browser-url http://127.0.0.1:9222`

- **Use PowerShell or Git Bash** instead of WSL.

### Windows 10: Error during discovery for MCP server 'chrome-devtools': MCP error -32000: Connection closed

- **Solution 1** Call using `cmd` (For more info https://github.com/modelcontextprotocol/servers/issues/1082#issuecomment-2791786310)

  ```json
  "mcpServers": {
      "chrome-devtools": {
        "command": "cmd",
        "args": ["/c", "npx", "-y", "chrome-devtools-mcp@latest"]
      }
    }
  ```

  > **The Key Change:** On Windows, running a Node.js package via `npx` often requires the `cmd /c` prefix to be executed correctly from within another process like VSCode's extension host. Therefore, `"command": "npx"` was replaced with `"command": "cmd"`, and the actual `npx` command was moved into the `"args"` array, preceded by `"/c"`. This fix allows Windows to interpret the command correctly and launch the server.

- **Solution 2** Instead of another layer of shell you can write the absolute path to `npx`:
  > Note: The path below is an example. You must adjust it to match the actual location of `npx` on your machine. Depending on your setup, the file extension might be `.cmd`, `.bat`, or `.exe` rather than `.ps1`. Also, ensure you use double backslashes (`\\`) as path delimiters, as required by the JSON format.
  ```json
  "mcpServers": {
      "chrome-devtools": {
        "command": "C:\\nvm4w\\nodejs\\npx.ps1",
        "args": ["-y", "chrome-devtools-mcp@latest"]
      }
    }
  ```

### Claude Code plugin installation fails with `Failed to clone repository`

When installing `chrome-devtools-mcp` as a Claude Code plugin (either from the
official marketplace or via `/plugin marketplace add`), the installation may fail
with a timeout error if your environment cannot reach `github.com` on port 443
(HTTPS):

```
Failed to download/cache plugin chrome-devtools-mcp: Failed to clone repository:
  Cloning into '...'...
  fatal: unable to access 'https://github.com/ChromeDevTools/chrome-devtools-mcp.git/':
  Failed to connect to github.com port 443
```

This can happen in environments with restricted outbound HTTPS connectivity,
corporate firewalls, or proxy configurations that block HTTPS git operations.

**Workaround 1: Use SSH instead of HTTPS**

If you have SSH access to GitHub configured, you can redirect all GitHub HTTPS
URLs to use SSH by running:

```sh
git config --global url."git@github.com:".insteadOf "https://github.com/"
```

Then retry the plugin installation. This tells git to use your SSH key for all
GitHub operations instead of HTTPS.

**Workaround 2: Install via CLI instead**

If the plugin marketplace approach fails, you can install `chrome-devtools-mcp`
as an MCP server directly without cloning the repository:

```sh
claude mcp add chrome-devtools --scope user npx chrome-devtools-mcp@latest
```

This bypasses the git clone entirely and uses npm/npx to fetch the package. Note
that this method installs only the MCP server without the bundled skills.

### Connection timeouts with `--autoConnect`

If you are using the `--autoConnect` flag and tools like `list_pages`, `new_page`, or `navigate_page` fail with a timeout (e.g., `ProtocolError: Network.enable timed out` or `The socket connection was closed unexpectedly`), this usually means the MCP server cannot handshake with the running Chrome instance correctly. Ensure:

1. Chrome 144+ is **already** running.
2. Remote debugging is enabled in Chrome via `chrome://inspect/#remote-debugging`.
3. You have allowed the remote debugging connection prompt in the browser.
4. There is no other MCP server or tool trying to connect to the same debugging port.

> [!IMPORTANT]
> In Chrome versions up to 149, connection issues may be caused by frozen or unloaded tabs.
> Chrome DevTools MCP forces all tabs to be loaded, so ensure your system has sufficient resources.
> It is currently not recommended to use Chrome DevTools MCP with browser instances running hundreds of tabs.
> See [Issue #1921](https://github.com/ChromeDevTools/chrome-devtools-mcp/issues/1921) for more details.

<!-- F-RuleLifecycleMgmt: superseded_by = null ; supersedes = null ; effective_since = v10.20 -->

### Codex Desktop: chrome-devtools-mcp INPUT tools report "unsupported call" (玄学)

> **Symptom (post-restart, after Codex Desktop rebuild)**: All `chrome-devtools-mcp` INPUT/NAVIGATION tools (`click`, `click_at`, `drag`, `fill`, `fill_form`, `fill_safe`, `hover`, `press_key`, `type_text`, `upload_file`, `navigate_page`, `new_page`, `select_page`, `get_tab_id`) return `unsupported call` from the Codex Desktop LLM, while the same MCP server works fine in CLI / non-anlifex Codex Desktop builds.

> **Confirms the user noticed**: thread `01a0c49f-07e2-7b71-8f1f-5bbcf83a38c8` (Codex-Stitch, 2026-09-22) — observed 8/15 split after upgrading to `anlifex-upstream` rebuild; toggling the Chrome **browser control** switch did **not** help.

#### Root cause (4 layers)

| Layer | Who | Dimension | What it controls |
|---|---|---|---|
| 1 | `chrome-devtools-mcp` fork source (`src/tools/*.ts`) | per-tool metadata | `annotations.category` + `annotations.readOnlyHint` (descriptive, **does not gate** the tool) |
| 2 | Codex CLI Rust runtime (`omit_tools_from` + `search_tool_enabled`) | per-server | server-level exposure (Direct / Deferred / CodeMode) |
| 3 | Codex CLI `ToolSearchCall` / `ToolSearchOutput` wire protocol | per-tool search | LLM loads a deferred tool after a `tool_search` call |
| 4 | **`anlifex-upstream` Codex Desktop bundle** (client-side filter, no public knob) | per-tool injection | **LLM actually visible tool list — 8/15 split happens here** |

**Layer 2 and Layer 4 are independent**: `omit_tools_from = []` (Layer 2, empty list = exposures open) does **not** override Layer 4's per-tool filter. They describe different things, so there's no contradiction when one says "all open" and the other says "INPUT hidden".

#### Cleanest 8/15 split (real grep evidence, `src/tools/*.ts`)

- 14 **bad** tools = 10/10 INPUT (`click`, `click_at`, `drag`, `fill`, `fill_form`, `fill_safe`, `hover`, `press_key`, `type_text`, `upload_file`) + 4 NAVIGATION that mutate active-tab context (`navigate_page`, `new_page`, `select_page`, `get_tab_id`)
- 15 **ok** tools = the rest (NAVIGATION read-only: `list_pages`, `close_page`, `resize_page`, `take_snapshot`, `wait_for`; plus all `EMULATION`, `DEBUGGING`, `MEMORY`, `NETWORK`, `PERFORMANCE`, plus `handle_dialog` which is INPUT but does not drive the UI forward)

> `readOnlyHint` is **not** the discriminator: 10/15 ok tools are `readOnlyHint: false` (`close_page`, `emulate`, `evaluate_script`, `handle_dialog`, `lighthouse_audit`, `performance_start_trace`, `resize_page`, `take_heapsnapshot`, `take_screenshot`, `take_snapshot`), and 12/14 bad tools are also `readOnlyHint: false`. Two sides are roughly symmetric on this axis.

#### Why INPUT tools collide specifically with the `anlifex-upstream` bundle

The Codex Desktop fork ships a **Computer Use** plugin (bundle path: `unified-computer-use@openai-bundled`, config key: `[plugins."unified-computer-use@openai-bundled"]`, bundle name `unifiedComputerUse` in the JS bundle). Computer Use exposes its own tools with names like `computerUse.click`, `computerUse.type_text`, `computerUse.press_key`, `computerUse.drag`, `computerUse.hover`, `computerUse.fill`, `computerUse.fill_form`, etc. — **same namespace as `chrome-devtools-mcp`'s INPUT tools**.

`anlifex-upstream`'s client-side filter (Layer 4) deduplicates by `name` and keeps only the Codex-bundled implementation per namespace. `chrome-devtools-mcp`'s INPUT tools therefore disappear from the LLM's tool list whenever Computer Use is enabled.

#### Why `handle_dialog` is OK but other INPUT tools are not

`handle_dialog` shares the `INPUT` category but its tool name (`handle_dialog`) does **not** collide with any `computerUse.*` tool — there is no namespace clash, so the Layer-4 filter keeps it.

#### Fix

1. **Disable Computer Use** in Codex Desktop: **Settings → Plugins → "Computer Use"** (`Control Windows apps`) toggle **off** (Visualize stays on — it is a separate feature).
2. **Restart Codex Desktop**. Plugin enable state is read at startup (`bundle` code: `se = a && !o && oe.available; ... G = se && ... && ce?.value == null && UE(s, "741821319").get("enabled", !1)`); without a restart the toggle change does not propagate to the LLM tool list.
3. Verify after restart:

   | Tool | Expected |
   |---|---|
   | `mcp__chrome_devtools__list_pages` | OK |
   | `mcp__chrome_devtools__navigate_page` | OK (was unsupported before) |
   | `mcp__chrome_devtools__click` | OK (was unsupported before) |
   | `mcp__chrome_devtools__type_text` | OK (was unsupported before) |
   | `mcp__chrome_devtools__fill_form` | OK |
   | `mcp__chrome_devtools__drag` / `press_key` / `hover` | OK |

#### What **does not** fix this

- **Toggling Chrome browser control** under **Settings → Computer Use → Control** (the "Google Chrome" row in the "Browser control" section). That toggle only controls whether ChatGPT actually clicks Chrome through the extension; it does **not** touch the LLM-side tool list. The `Computer Use` plugin namespace stays injected, so the Layer-4 dedup continues to hide `chrome-devtools-mcp`'s INPUT tools.
- **`omit_tools_from = []` in Codex CLI** (Layer 2). Empty list means the server is fully exposed; it does not bypass the Layer-4 client filter.
- **Reinstalling `chrome-devtools-mcp` or restarting the MCP server**. The filter is in the Codex Desktop bundle, not in the MCP server.

#### Side note

`chrome-devtools-mcp`'s `click_at` and `get_tab_id` are `conditions: ['experimentalInteropTools']` tools. They are gated by the fork's own experimental flag (not by anlifex). Even after the fix above, they will only show up if `--enable-experimental-interop-tools` is passed to the MCP server; `anlifex-upstream` does not currently pass it.

#### Reference

- Thread `01a0c49f-07e2-7b71-8f1f-5bbcf83a38c8` (Codex-Stitch project, 2026-09-22, 30 turns) — full 4-layer analysis with bundle grep evidence and `se / G / le / ce?.value == null` chain.
- Bundle path: `anlifex-upstream/scripts/mcp-refresh-deploy/app-initial-bca8cba1737e.js`, `computerUse: { installWhenMissing: !0, installWhenMissingRequiresOptIn: !0, name: aTt }`, `unifiedComputerUse: { hidden: !0, installWhenMissing: !0, mcpServerName: Ywt, name: oTt }`.
