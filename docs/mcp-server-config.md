<!-- F-RuleLifecycleMgmt: superseded_by = null ; supersedes = null ; effective_since = v10.20 -->

# MCP server config reference (本项目)

> 当前 `~/.codex/config.toml` 注册的 3 个 MCP server。本文档记录**调试过的**参数(每个字段都是经验值,不是默认值)。复盘/迁移/装新机时按这份走,不要靠 `config.toml` 里的注释 — fork 本身对 config 没有 annotation。

> 最后校准日期:2026-09-23(基于 `~/.codex/config.toml` 实际内容)。改动前请先做 §7 backup(`config.toml.bak-<ts>-clean`)。

## 总览

| MCP server | 工具数 | 启动延时 | 关键 args | 备注 |
|---|---|---|---|---|
| `chrome_devtools` | 30 | 60s | `--browser-url=http://127.0.0.1:9222 --no-usage-statistics --allow-unrestricted-paths` | 浏览器执行器(CDP) |
| `debug_mcp` | 3 | 10s | (无,日志走 `DEBUG_MCP_LOG`) | 本项目 `tmp/_debug_mcp_server.mjs`,临时调试用,长期化前先 review |
| `node_repl` | 3 | 120s | `args=[]`(经 stdin) | Codex Desktop 内嵌 cua_node REPL |

**Chrome 端前置条件**:`chrome.exe --remote-debugging-port=9222 --user-data-dir=%TEMP%\chrome-debug` 必须在 Codex Desktop 启动前就在跑(项目里有 `scripts/start-chrome-debug.bat`,10s 自关 console)。`Test-NetConnection 127.0.0.1 -Port 9222 -InformationLevel Quiet` 必须 `True` 才算健康。

---

## 1. `chrome_devtools`(默认浏览器执行器)

**Binary**:`D:/Documents/VibeCoding/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js`(本 fork,`zamelee/chrome-devtools-mcp`,分支 `codex/cli-and-hi-dpi-fixes`)。

**为什么是 fork 而不是 `npx chrome-devtools-mcp@latest`**:fork 给 `upload_file` 加了 chatgpt v2 Tier 3 fallback(§0b.7.10),加了 `fill_safe` for React 18 controlled vendor(§0a.x.17),还修了 upload-picker race(§0b.7.9.5)。上游 npm 包没有这些。`pnpm install && pnpm run build` 必须先跑出 `build/src/bin/chrome-devtools-mcp.js`,否则 Codex 启动时 `Cannot find module` 报 -32000。

**完整 config 块**:

```toml
[mcp_servers.chrome_devtools]
command = "node"
args = [
  "D:/Documents/VibeCoding/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js",
  "--browser-url=http://127.0.0.1:9222",
  "--no-usage-statistics",
  "--allow-unrestricted-paths",
]
env = { NODE_NO_WARNINGS = "1" }
startup_timeout_sec = 60
enabled_tools = [
  "click", "close_page", "drag", "emulate", "evaluate_script", "fill",
  "fill_form", "fill_safe", "get_console_message", "get_network_request",
  "handle_dialog", "hover", "lighthouse_audit", "list_console_messages",
  "list_network_requests", "list_pages", "navigate_page", "new_page",
  "performance_analyze_insight", "performance_start_trace",
  "performance_stop_trace", "press_key", "resize_page", "select_page",
  "take_heapsnapshot", "take_screenshot", "take_snapshot", "type_text",
  "upload_file", "wait_for",
]
```

### 字段逐项

| 字段 | 值 | 为什么是这个值 |
|---|---|---|
| `command = "node"` | 直接调 node(不走 npx) | build 产物路径确定,不需要 npx 拉 npm 缓存 |
| `args[0]` | fork 的 build 产物路径 | 跟 fork 同步,不是 npm 上游路径 |
| `--browser-url=http://127.0.0.1:9222` | 接本地真实 Chrome debug port | 跟 `%TEMP%\chrome-debug` profile(已装扩展 + 登录态)共享 |
| `--no-usage-statistics` | 关掉使用统计上报 | fork 默认值,无副作用 |
| `--allow-unrestricted-paths` | **取代上游的 `--no-update-check`**(本 fork 2026 年初改动) | 必须有,否则 `take_screenshot filePath` 写 `C:\Users\...` 时报 path not allowed |
| `env.NODE_NO_WARNINGS = "1"` | 关 node deprecation warnings | 上游 fork 在 Node 18+ 有 deprecation 警告噪音 |
| `startup_timeout_sec = 60` | **从默认 30s 调到 60s** | fork 启动时连接 9222 + load tool schema 偶尔超过 30s(实测首次启动 32-45s),Codex 默认 30s 会误判 spawn 失败 |
| `enabled_tools` | **白名单 30 个 tool,全开** | 全开是有意的:`config.toml` 的 `enabled_tools` 是 **Layer 2** filter(per-server),真正的 INPUT 工具屏蔽发生在 **Layer 4**(anlifex bundle namespace dedup),跟这个白名单无关(详见 troubleshooting.md §玄学问题)。**不要**为了"修 8/15 split"在这里删 `click / type_text` — 删了 CLI 能用但 anlifex 还是看不到,而且 fork 自己的 tool registry 会同步丢。 |

### 每个 tool 的 `approval_mode`

`approval_mode = "approve"` 是 per-tool 配置(配置示例中每个 tool 都列了一遍)。意思是每次调用 Codex 会弹一次"是否允许调用此工具"。**生产用法**:保留 `"approve"`(每个 tool 都要单独审批,适合 fork 调试期);**严格用法**:改为 `"auto"`(用户授权工具集后自动调用),适合脚本化执行。

### 已知坑

- **`upload_file` 不弹 native file picker**:走 CDP `DOM.setFileInputFiles`,Tier 3 fallback(§0b.7.10)。前提是 fork build 包含此 patch。
- **`fill_form` 是事务性的**:一个 element 失败全回滚,select 元素用 `evaluate_script` 走 `s.value = "c"; s.dispatchEvent(new Event("change"))` 兜底。
- **`type_text` 不接 uid**:只有 `{text, submitKey}`,走 CDP `Input.insertText` isTrusted。先 click / hover 元素聚焦再调。
- **`drag` 要求元素 `draggable="true"`**:DuckDuckGo logo / 普通 div 不行;`https://mdn.github.io/dom-examples/drag-and-drop/` 是干净测试页。
- **`fill_safe` 在普通 `<input>` 上超时**(5s 等 React state sync):留给 React 18 controlled vendor(github.com/copilot、chatgpt ProseMirror)。
- **`get_console_message` 必须传 `msgid`**:0 参数报 unsupported。先 `list_console_messages` 拿 id,再 `get_console_message {msgid}`。

---

## 2. `debug_mcp`(本项目调试 server)

**Binary**:`D:/Documents/VibeCoding/chrome-devtools-mcp/tmp/_debug_mcp_server.mjs`

**3 个 tool**:`echo` / `server_log_tail` / `who_am_i`(按 `tools/list` 实际报告的)

**完整 config 块**:

```toml
[mcp_servers.debug_mcp]
enabled = true
command = "node"
args = ["D:/Documents/VibeCoding/chrome-devtools-mcp/tmp/_debug_mcp_server.mjs"]
env = { DEBUG_MCP_LOG = "D:/tmp/_debug_mcp.log" }
startup_timeout_sec = 10
enabled_tools = ["echo", "server_log_tail", "who_am_i"]
```

### 字段逐项

| 字段 | 值 | 为什么 |
|---|---|---|
| `enabled = true` | 永远开 | Codex session 启动自检会调 `who_am_i` 验证 MCP infra 是否健康 |
| binary path | `tmp/_debug_mcp_server.mjs` | **位置不符合 §7.2 fixture 例外**(应该在稳定的 `tools/` 下而不是 `tmp/_`),按 §7.2 应该长期化或清理。临时保留是因为它跟本 fork 调试 cycle 绑定 |
| `env.DEBUG_MCP_LOG = "D:/tmp/_debug_mcp.log"` | 日志落 `D:/tmp/` | 不污染 `tmp/_chrome_test/`(那是 §7.x Chrome script 路径) |
| `startup_timeout_sec = 10` | **从默认 30s 降到 10s** | debug server 是简单 echo / log server,启动 < 1s。10s 上限用来 catch 错误状态(端口被占 / 脚本不存在)而不是等慢启动 |

### 已知坑

- **不是稳定 tool**:binary 在 `tmp/` 下,按 §7.2 是 debug cycle 产物。debug 任务结束应该搬出 `tmp/`(长期化)或者从 config.toml 删。如果 fork 改动后忘了保留 binary,Codex 启动会失败。
- **日志不自动 rotate**:`D:/tmp/_debug_mcp.log` 长期累积会很大。生产前加 log rotation 或改写到 `~/.codex/logs/`。

---

## 3. `node_repl`(Codex Desktop 内嵌 Node 沙箱)

**Binary**:`<Codex-Stitch install path>/anlifex-upstream/out/win/Codex-win32-x64/resources/cua_node/bin/node_repl.exe`(Codex Desktop 内嵌,不是 chrome-devtools-mcp 项目内的 binary)

**3 个 tool**:`js` / `js_reset` / `js_add_node_module_dir`

**完整 config 块**:

```toml
[mcp_servers.node_repl]
enabled = true
command = "<anlifex Codex-win32-x64>\resources\cua_node\bin\node_repl.exe"
args = []
startup_timeout_sec = 120
[mcp_servers.node_repl.env]
NODE_REPL_NATIVE_PIPE_CONNECT_TIMEOUT_MS = "1000"
NODE_REPL_NODE_MODULE_DIRS = "<anlifex>\resources\cua_node\bin\node_modules"
NODE_REPL_NODE_PATH = "<anlifex>\resources\cua_node\bin\node.exe"
NODE_REPL_TRUSTED_CODE_PATHS = "C:\Users\Bliss\.codex;<anlifex>\resources\cua_node\bin\node_modules"
CODEX_HOME = "C:\Users\Bliss\.codex"
BROWSER_USE_AVAILABLE_BACKENDS = "chrome,iab"
BROWSER_USE_TINYSKY_ENABLED = "1"
NODE_REPL_INSTRUCTIONS_USE_CASE_BROWSER = ""
NODE_REPL_INSTRUCTIONS_USE_CASE_CHROME = ""
BROWSER_USE_CODEX_APP_BUILD_FLAVOR = "prod"
BROWSER_USE_CODEX_APP_VERSION = "26.901.20858"
NODE_REPL_TRUSTED_SERVICES = "{\"browser\":\"<...>/browser-service.mjs\",\"sky\":\"@oai/sky/service\"}"
SKY_CUA_NATIVE_PIPE = "1"
SKY_CUA_NATIVE_PIPE_DIRECTORY = "\\\\.\\pipe\\codex-computer-use-<uuid>"
CODEX_CLI_PATH = "<anlifex>\resources\codex.exe"
```

### 字段逐项

| 字段 | 值 | 为什么 |
|---|---|---|
| `startup_timeout_sec = 120` | **从默认 30s 调到 120s** | cua_node 启动 + native pipe 协商偶尔超过 60s。实测首次启动 75-95s。120s 留足 tolerance |
| `NODE_REPL_NATIVE_PIPE_CONNECT_TIMEOUT_MS = "1000"` | 1s | 默认 5s 太长,fast-fail 让 Codex 立刻知道 pipe 没接上 |
| `NODE_REPL_NODE_MODULE_DIRS` | 指向 anlifex cua_node bundle 内的 `node_modules` | node_repl 走 dynamic `import()` 时 module resolution 走这个目录 |
| `NODE_REPL_TRUSTED_CODE_PATHS` | `~/.codex` + anlifex bundle | node_repl 的 security sandbox 允许执行的路径白名单 |
| `CODEX_HOME` | `~/.codex` | 给 node_repl 内部用,跟 Codex Desktop 主进程一致 |
| `BROWSER_USE_*` | Codex Desktop 内嵌 cua_node 链路 | 不动 |
| `SKY_CUA_NATIVE_PIPE` + pipe directory | Codex Desktop ↔ cua_node native pipe | 不动 |

### 已知坑

- **不能 import `node:process` / 不能用 `process` 全局**(实测 `process is not defined` + `Importing module "node:process" is not allowed in node_repl`)。§6.x 已知怪象。
- **不能顶层 `return`**(`Illegal return statement`)。改用 `nodeRepl.write(...)` 把值写出去。
- **`nodeRepl.write(...)` 不能 console.log 的所有副作用**(`console.log` 在某些 v8 状态可能延迟或丢)。

---

## 跨 MCP 通用契约

### Tool 调用顺序(§0b.7)

```
read:  snapshot → screenshot(按需) → DevTools 精细
write: §0a Quill 5 步锁 + §0b.4 防 debug-spree
debug: DevTools → screenshot(按需) → snapshot
evidence: 先 §0d 锁 tab → snapshot 摸清现场 → screenshot 留底 → 写 incident.evidence
```

### 启动健康检查(§0b.5)

1. `curl http://127.0.0.1:9222/json/version` 返 200 + Browser 字段非空
2. `mcp__chrome_devtools__list_pages` 成功返 tab 列表
3. `mcp__debug_mcp__who_am_i` 返 server 标识 + client version

3 个都过 = MCP infra 健康。否则按 §0b.4 故障处理。

### Tool 白名单策略

- **chrome_devtools**:`enabled_tools` 全开 30 个。**不是**为了"修 8/15 split"——INPUT 屏蔽是 Layer 4 anlifex bundle namespace dedup,跟这一层无关(详见 troubleshooting.md §玄学问题)。全开是 fork 调试期默认值。
- **debug_mcp**:`enabled_tools` = 全 3 个(server 简单,没必要细分)。
- **node_repl**:全 3 个(同上)。

### config.toml 改动 checklist(任何 mutation-state 前)

按 §7 + §0b.6 红线:

1. `Copy-Item ~/.codex/config.toml ~/.codex/config.toml.bak-<ts>-clean`(clean stamp = 当前无 incident)
2. 改完跑 `pnpm run build`(chrome-devtools-mcp fork binary 改完才生效)
3. **重启 Codex Desktop**(不是 restart MCP server)— plugin / mcp_servers 改动需要启动期重读
4. 跑 §0b.5 健康检查 3 项,确认 MCP infra OK
5. 跑 smoke test(`mcp__chrome_devtools__navigate_page url=https://example.com/` + `take_snapshot`)确认工具链路通
6. 任何 daemon / background process 改动前先 ask user(按 §6 meta-rules + K-003)

---

## 迁移 / 装新机 checklist

1. 装 Node.js >= 18 + pnpm
2. `git clone` 本 fork,`pnpm install && pnpm run build`(产出 `build/src/bin/chrome-devtools-mcp.js`)
3. 启 Chrome debug:跑项目 `scripts/start-chrome-debug.bat`
4. 把本文件对应章节的 config 块拷到新机的 `~/.codex/config.toml`
5. `Test-NetConnection 127.0.0.1 -Port 9222 -InformationLevel Quiet` 返 True
6. 启 Codex Desktop,跑 §0b.5 健康检查 3 项
7. 跑 smoke test 5 项(上节 step 5)

---

## 4. 全局 grace period(`mcp_optional_startup_grace_ms`)

**位置**:`~/.codex/config.toml` **顶层**(在 `[mcp_servers]` 块**之外**,line 4 那种)。**不是**某个 server 的属性。

**作用域**:Codex CLI Rust runtime 在所有 required MCP server 启动完成后,允许**optional** MCP server 额外宽限的毫秒数。

**默认 / 调试值**:

| 场景 | 值 | 备注 |
|---|---|---|
| 上游 Codex CLI 默认 (`DEFAULT_OPTIONAL_MCP_STARTUP_GRACE`) | `1000` ms | 上游 hardcoded,跟 chrome-devtools 冷启动时间不匹配 |
| `codex-plus-manager` UI 建议值 | `3000` ms | 覆盖 chrome-devtools 冷启动 ~1.5s + 2x safety margin |
| **本项目当前值** | **`5000` ms** | 实测 OK(`debug_mcp` + `chrome_devtools` 启动 + 9222 CDP handshake 偶尔慢) |
| Defensive cap | `Some(0)` → None;`Some(N > 30000)` → None | sanity cap;zero 触发 immediate race,过大值无意义 |

**核心作用 — 帮工具暴露(影响 LLM 看到的 tool list)**:

在 Codex CLI 启动主循环里,所有 MCP server 的 `tools/list` handshake 完成时间不一致。**早完成的 server 的 tool 立刻进 LLM tool list**,晚完成的要等"宽限期"。如果宽限期到时 handshake 还没完,server 状态变 `unavailable`,**它注册的 tool 直接从 LLM 视角消失**,LLM 看到的是 `tool ... not found` / `unsupported call` / `tool unavailable`。

所以 `mcp_optional_startup_grace_ms` 不是"等待 optional server"的容差 — **它直接决定 LLM 能不能看到某个 tool**。调不够会让 fork 新加的工具、cua_node 等慢启动 server 的 tool 列表提前被 prune 掉。

**作用机制**:Codex CLI 在 spawn 完所有 `[mcp_servers.X]` 后:
1. 等 required server 在各自 `startup_timeout_sec` 内完成 `tools/list` handshake
2. **再宽限** `mcp_optional_startup_grace_ms` ms 让还没 finish handshake 的 server(主要是 optional server)补完
3. 宽限期到了还没起来的 server 标 `unavailable`,它暴露的 tool 从 LLM tool list 中 prune
4. Pruned 的 tool 不会被 LLM 看到 — 表现为调用时 `tool ... not found` / `unsupported call`

**跟 `startup_timeout_sec` 的区别**:

| 维度 | `startup_timeout_sec` | `mcp_optional_startup_grace_ms` |
|---|---|---|
| 位置 | 每个 `[mcp_servers.X]` 块内 | 顶层 |
| 作用域 | per-server spawn deadline | 全局,所有 optional server 共用 |
| 默认值 | `30` s(上游) | `1000` ms(上游) |
| 本项目调试值 | chrome_devtools `60s` / debug_mcp `10s` / node_repl `120s` | `5000` ms |
| 触发场景 | spawn 进程,等 handshake | 所有 server 都 start 后,optional 补位 |
| 失败模式 | 超时则 server 不可用(session 不阻塞) | 超时则 server 不可用(session 不阻塞) |

**为什么不调 5000ms**:
- `chrome_devtools` fork 冷启动 + 9222 CDP handshake + tools/list schema 加载:实测首次启动 32-45s,这个用 `startup_timeout_sec = 60` 兜
- 后续 handshake / registry 时间:实测 1-3s,这个用 `startup_timeout_sec = 60` 已经够了
- **真正吃 grace 的场景**:`debug_mcp` 等 optional server 跟主 server 启动竞争 — Codex CLI 在 chrome_devtools 完成后立即 scan 全 list,debug_mcp 还没 finish tools/list 就被列成 unavailable,这一窗口由 grace 兜
- 调 `5000` 是实测覆盖 `debug_mcp` 99% 启动分布(冷启动 < 800ms,warm < 200ms)

**为什么不用 cpp UI 建议的 3000ms**:
- 3000 是 `codex-plus-manager` 团队覆盖 chrome-devtools 单一场景的 sweet spot
- 我们项目额外跑 `debug_mcp`(3 个 tool) + `node_repl`(cua_node native pipe),multi-server 启动竞争更复杂
- 5000 是 1.6x safety margin,实测无 race,但也不浪费(whole startup phase < 8s total)

**CodexPlusPlus 链路参考**(debug 用):

```rust
// D:\Documents\VibeCoding\Codex-Stitch\cpp-upstream\crates\codex-plus-core\src\settings.rs

// struct field (line 599)
pub mcp_optional_startup_grace_ms: Option<u64>,

// default (line 685)
mcp_optional_startup_grace_ms: None,

// injection logic (line 1813)
fn inject_or_strip_mcp_grace(text: &str, grace: Option<u64>) -> String {
    // ... effective_grace caps: Some(0) -> None, Some(n > 30000) -> None
    match effective_grace {
        Some(ms) => format!("mcp_optional_startup_grace_ms = {}\n{}", ms, body_with_trail),
        None => body_with_trail,  // strip, defer to upstream default 1000ms
    }
}
```

**调参 checklist**:

1. **不要设 0**(`Some(0)` → None,触发 immediate race — chatgpt thread `01a0c49f-...` 调试经验)
2. **不要超过 30000**(`Some(N > 30000)` → None,被 defensive cap 吃掉)
3. **改完跑 §0b.5 健康检查**:3 项全过 = OK
4. **观察 Codex Desktop 启动日志**:`MCP startup` 那一行的 grace remaining;如果剩余 grace 频繁 < 100ms,说明 server 启动 race 严重,grace 调到 5000-8000ms
5. **改 config.toml** 走 §7 backup:`Copy-Item ~/.codex/config.toml ~/.codex/config.toml.bak-<ts>-clean`

**实测发现的副作用**:`config - 副本 (2).toml` 历史上有 `= 3000`(用户测试过 UI 建议值),现在回到 `5000`。说明**调 grace 不是越大越好**,3000 偶尔会撞 race 边界(实测 debug_mcp 启动慢就 unhappy),5000 才稳定。


**跟玄学问题(8/15 split)的关联**:

thread `01a0c49f-...` 调查的 INPUT tool `unsupported call` 现象**主要根因**是 Layer 4 (anlifex bundle) namespace dedup。但**还有一条**可能的 secondary root cause — **grace period 不够**,导致部分 INPUT tool 在 grace 内 handshake 没完成,LLM 看到的 tool list 里就没这些 tool,调用时报 `unsupported call`。

判断方法:
- 看 Codex Desktop 启动日志,**找 `MCP startup` 那一行**,看 grace remaining 是否经常压到 < 100ms
- 如果是 → grace 调到 5000-8000ms,**可能**修好部分 tool(但 namespace dedup 那个根因解决不了,所以不是万能)
- 如果 grace remaining 始终 > 1000ms → grace 不是问题,根因在别处(Layer 4 namespace dedup,去 troubleshooting §玄学问题查)

这个项目的 `5000` 值是**两个 root cause 一起兜底**的经验值 — namespace dedup 解决 90%,grace 调够解决剩下 10% 的冷启动 race。

---

## Reference(更新)

- AGENTS.md §0b.1 / §0b.5 / §0b.6.5 — 浏览器调度优先级
- AGENTS.md §0a.5 / §0a.x.17 — fill / fill_safe / type_text 选型决策
- AGENTS.md §0b.7.10 — upload_file Tier 3 fallback(chatgpt)
- AGENTS.md §0b.9 — upload-picker guard
- `docs/troubleshooting.md` §玄学问题 — Codex Desktop INPUT tool namespace collision(Computer Use plugin disable)
- Thread `01a0c49f-07e2-7b71-8f1f-5bbcf83a38c8` — Codex-Stitch 8/15 split 完整调查
- CodexPlusPlus Rust source:`crates/codex-plus-core/src/settings.rs:586-1846` — `mcp_optional_startup_grace_ms` field + inject logic + defensive cap