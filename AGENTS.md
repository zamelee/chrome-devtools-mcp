## 0a. AI 对话框输入规则与 Quill 防爆锁（5 步严格顺序）

向 Gemini、ChatGPT 等基于 Quill / contenteditable 的 AI 对话框填入长内容时，必须严格按以下 5 步执行；任一步失败立刻停手，执行 §0b.6 封号保护（ban protection）。


> **本节规则适用的工具映射 (v10.7.8 起, 2026-08-13 更新):** 默认浏览器执行器 (按 §0b.1 #1) 是 **chrome-devtools-mcp (我们 fork 的 `zamelee/chrome-devtools-mcp`, CDP `--remote-debugging-port=9222`)**, 工具集前缀 `mcp__chrome-devtools__*`。chrome-devtools-mcp 用于通用浏览器任务 (navigate / click / screenshot / list_pages / evaluate_script 等) + DevTools 专项 (Lighthouse / trace / heap / 仿真 / native dialog)。Chrome-devtools-mcp **没有 `chrome_type` 等价物**——web AI 对话框注入 (`chrome_type` / `chrome_upload_file` / `chrome_javascript` / `chrome_keyboard` / `chrome_click_element`) **只能**通过 `mcp-chrome (HTTP)` 工具集, 但 `mcp-chrome` 当前未在 `~/.codex/config.toml` 注册 (见 §0b), 所以 §0a.x.7/8/9 这部分规则标记 `[dormant]` 暂不生效。决策见 §0b.6.5。

1. **Metadata 登记**：将"预期内容"原样存入会话 metadata 的 `expected_text` 字段，含全量字符。
2. **前置清空与聚焦**：强制聚焦 `.ql-editor`，清空编辑器内部残留的 DOM 节点（含上一轮截断的残余），派发 `input` 事件重置状态。示例代码：
   ```javascript
   const editor = document.querySelector('.ql-editor');
   editor.focus();
   editor.innerHTML = '<p><br></p>';
   editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
   ```
3. **安全填入与等待**：通过 DOM 注入填入，**优先级**（从高到低）：
   - **A. Quill 框架专属 API** —— `quill.updateContents([{retain: 0, insert: content}], 'user')` + 派发 `InputEvent('input', { data: content, inputType: 'insertText', bubbles: true })`。**Quill 唯一可靠路径**（实测：源码可见 + chrome-relay js 验证）。`source='user'` 不可改为 `'api'`（Angular state machine 只对 user-source 反应，否则模型端不更新）。
   - **B. `focus + range + document.execCommand("insertText", false, content)`** —— deprecated 但行为稳定，跨 Quill / Lexical / ProseMirror 通用（Playwright `locator.fill()` 底层亦同）。fallback 首选。
   - **C. CDP `Input.insertText`**（chrome-relay `type`、Playwright `type`、Chrome DevTools MCP 的 `type_text` isTrusted 路径） —— 通过 CDP `Input.insertText` 注入（`isTrusted: true`），跨编辑器通用。等价于"无 keydown 的物理输入"，是 universal 第三选项。
   - **D. 受控 `type_text`（chrome-devtools-mcp）** —— 末位，仅在 A/B/C 都失败时用。**严禁在含反斜杠-n 的长 prompt 上用**：它模拟物理 Enter keystroke → Quill auto-submit。

   填入后 `sleep ≥ 500ms` 等 Quill 内部 Delta 同步。**严禁通过 `fill` / `type_text` 配合 Enter 触发提交**。

<!-- F-RuleLifecycleMgmt: superseded_by = null ; supersedes = null ; effective_since = v10.6 -->
   **实测互斥矩阵（v10.6 patch，F-InputPathMatrix）**：

   | 注入方法 | Quill | Lexical / ProseMirror | 普通 `<textarea>` |
   |---|---|---|---|
   | Quill API (`updateContents` user) | 可靠 | — | — |
   | `execCommand('insertText')` | 可靠 | 可靠 | 失效（现代禁用） |
   | CDP `Input.insertText` (chrome-relay `type`) | 可靠 | 可靠 | 可靠 |
   | Selection + `InputEvent('insertText')` | 失效 | 失效 | 可靠 |
   | `ClipboardEvent('paste')` | 失效 | 失效 | 可靠 |
   | `type_text` (chrome-devtools-mcp) | auto-submit | auto-submit | auto-submit |

   **跨编辑器最稳两条**（实测 2026-07-21 Gemini `b7096a554c265e46` + ChatGPT mobile composer 双确认）：**`execCommand('insertText')`** 与 **CDP `Input.insertText`**。二选一互为冗余。A 是 Quill 专属优化（更快更精准）；D 是禁令（必须严守）。

<!-- F-RuleLifecycleMgmt: superseded_by = null ; supersedes = null ; effective_since = v10.6 -->
   **Shift+Enter 语义注记（v10.6 patch，F-ShiftEnter）**：
   - 上述三种注入方法（Quill API / execCommand / CDP Input.insertText）在 content 含反斜杠-n 时一律生成 hard break（`<p>` 新段落），**不触发 Send**。
   - 真 Shift+Enter（keydown with `shiftKey: true`）产生 soft break（`<br>`）或不产生换行（取决于框架配置）。
   - chrome-relay `keys Shift+Enter` 经实测正确传 `shiftKey: true`，但 Gemini 自定义 Quill 把 Shift+Enter 同样映射成 hard break（仅在"submit vs 不 submit"维度区分，不在"hard vs soft break"维度区分）。
   - **多行 prompt 不依赖 Shift+Enter**：直接 content 含反斜杠-n → 多段落 + 安全。
4. **完整性校验（v10.6 升级：sha1 规范化比对）**：用 `chrome-relay js` 读取以下数据：
   - `.ql-editor.innerText`（**Quill-aware**，含 `<br>` 渲染的换行；**不要**用 `textContent`，它不含 Quill 段落间的换行 —— v10.6 实测 1509-char prompt 下 `textContent.length=1474` 而 `innerText.length=1563`，相差 89 字符）
   - 规范化：`replace(/[\s\n]+/g, ' ').trim()` —— 折叠所有空白字符到单空格
   - 计算 sha1 hex（`crypto.subtle.digest('SHA-1', ...)` → hex string）
   - 对 `expected_text` 做同样规范化 + sha1
   - **判等规则（硬约束）**：`sha1(actualNorm) === sha1(expectedNorm)` 必须**完全相等**（实测 1509-char 复杂 prompt 双侧 sha1 一致：normalized 长度 = 1478，sha1 = `76438e2501d3724d50623f99655ad8e756c9fe5b`）
   - **附带诊断**（debug 用，**不**作硬判定）：
     - `innerTextNormalizedLen === expectedNormalizedLen`（速查维度）
     - `pCount` 应 ≥ `newlines / 2`（每个双反斜杠-n-n 至少产生一个 `<p>`）
     - `brCount` ≥ 0（Quill code block 自动转换会产生额外 `<br>`，实测 9 个）
     - `sendBtn` 仍 enabled（未误触 Send）
     - `.codex-session.json` 的 `lastUserSaid` 不含 `expected_text` 的前 N 字符（防幽灵提交）

   **为何不用旧容差 -5（v10.6 沉淀，2026-07-21 长 prompt 实测）**：1509-char + 40-newlines 复杂 prompt 下，旧规则 `textContent.length ≥ expected.length - newlines - 5` 刚好踩在边界（`gap = 5`，容差耗尽）；长 prompt + 多特殊字符（Unicode / emoji / code fence）下容差可能失真（误判为通过 / 误判为失败）。

   **为何用 innerText 而非 textContent**：`textContent` 把反斜杠-n 当节点边界，不计入长度；Quill 把反斜杠-n 转 `<p>` 后，段落间的换行在 textContent 中消失（实测差 89 字符）；`innerText` 则保留渲染后的换行（v10.6 实测确认）。

   **为何用 sha1 不用直接比字符串**：规范化后字符串长度仍可能差几字符（Quill trailing newline / 空白差异），sha1 是严格相等判定，避免边缘 case 假阳性。

   **不等 → 禁止发送，清空重做，绝不按 Enter、绝不点 Send。**
   **相等 → 进入第 5 步。**
5. **历史指纹二次校验**：在准备点击 Send 前，用 JS 检查页面最新一条已发送的 `You said` 气泡内容（参考 selector：`message-content.user-query, .query-text, [data-test-id="user-query"]`，取最后一个）。若发现页面已提前出现未确认的半截消息，立即中止、清空 Quill、写 incident 标志位。

### 0a.1 机关枪熔断与高危态降级（quill-gun）

- **频次熔断**：同一对话框在 60 秒滑动窗口内累计 ≥ 2 次相同前缀提交即触发熔断，禁用所有 `fill` / `click` 动作。"累计"指次数累计，不要求时间连续（即中间有别的输入动作也计入阈值）。
- **高危态处理**：若检测到机关枪特征，写入 `<cwd>/.codex-session.json` 的 `incident.kind = "quill-gun"`，降级为 read_only / dom_clear / tab_close；**严禁自动循环补发**——补发本身会再次触发触发链。
- **会话接力**：下次会话启动若读到 `incident.kind == "quill-gun"`，按 §0d.5 走"换 Tab / 新建 Thread URL + 继承上下文 metadata"，不复用污染过的 pageId / targetId。

### 0a.2 对话类型与模型选择决策（按目标选 model）

向 Gemini / ChatGPT 等网页 AI 发起对话前，必须先按"目标"决定用哪个 model / 模式，不要默认 Flash-Lite（这是 v4 之前的失职模式）。

**目标 × model 矩阵（按甜点排序）**：

| 档位 | 适用场景 | 错选诊断/惩罚 |
|---|---|---|
| **3.1 Flash-Lite** | 高频 DOM 探活、单纯元素抓取、< 50 行单函数重构 | 用于复杂逻辑 → 幻觉重试死循环，触发超限熔断 |
| **3.5 Flash** | **(默认主力)** 跨文件逻辑分析、标准 Quill 文本生成、常规 API 编写 | 用于深层架构分析 → 可能遗漏隐式依赖 |
| **3.1 Pro** | 多模块联动重构、复杂协议解析、> 150 行代码或长篇文档 | 用于简单 DOM 操作 → 浪费算力 + 显著增加 TTFB |
| **Extended thinking** | `AGENTS.md` 规则级重写、`FATAL` 级事故恢复推演、0→1 系统架构设计 | 严禁日常交互；仅 `incident.kind = FATAL` 或主动申请时调用 |

**错选识别诊断**（A/B 实验验证，A/B 对照数据：Extended thinking 4ms 完成 vs 3.1 Pro 29.16s 真推理）：

- 反馈 < 2 段 + ≤ 5s 出回复 → **你被 Flash-Lite 默认了**，重发时主动切 Pro / Flash。
- mode picker 切到 "Thinking" 但 `Stop response` 按钮 ≤ 30s 消失 → **实际没启用 thinking**，回退到 base model 速度 = 等于没切。立即切 Pro。
- `aria-label` 含 "Flash-Lite Extended" 而你以为切了 Thinking → **标签欺骗**；看实际推理耗时（≥ 29s 才算真启用）确认。
- 选了 Extended thinking 但修复 patch 只给标题不给可粘贴文字 → **回退 Pro**（Pro 给"一句话改动 + 完整新文字"）。

**持久化要求**：每次开 Gemini 对话都登记到 `~/.codex/ai-conversations.json`，含 `model` 字段记录本次用的 model（按 §0c schema）。



<!-- F-RuleLifecycleMgmt: superseded_by = null ; supersedes = null ; effective_since = v10.5 -->
### 0a.6 注入侧 ≠ 模型端：Gemini 端不可控行为（v10.5 patch，F-GeminiUncontrollable）

**核心事实**：§0a 5 步锁的是**注入完整性**（Quill 收到全部文本 + 段落化正常 + 指纹匹配）。**注入侧 100% 通过 ≠ Gemini 端 100% 正确理解。**

**常见 Gemini 端"截断幻觉"**（实测基线 2026-07-21 OpenCodeX 跨项目协作 R1-R6）：
- Gemini 自称「正文被截断」「请重新发」「再次被截断」—— 但 `sha1Match=true`（`innerTextNormLen === expectedNormLen`）
- Gemini 多轮后答非所问（「随时，请抛出你的场景」）
- Gemini 转 fresh session 范式（忘前几轮的 schema 锚点）

**根因**：模型多轮 context cache / RAG parsing 把旧 prompt 上下文丢了，「被截断」是 Gemini 的礼貌话术。**这些不是 §0a 失职，§0a 不覆盖模型端语义推理。**

**协作边界**：
- §0a 只保证「内容完整到达服务端」
- 模型端语义丢失由 §0c.3 Failover 兜底（5 轮无显著进展 → 开新对话 context reset）
- 严禁把模型端现象归咎于 §0a；按 §10 复盘写 incident 时 `kind="gemini-model-context-loss"`，不要写 quill-gun / native-host-encoding 等注入类事故

**判别诊断**（Agent 视角）：
| 现象 | 真因 | 处置 |
|---|---|---|
| `sha1Match` false / `innerTextNormLen` ≠ `expectedNormLen` | §0a step 4 完整性校验失败 — 注入侧 | §0a.1~0a.4 重做（按 §0a step 4 走 sha1 规范化比对） |
| `sha1Match=true` + Gemini 说"被截断" | §0a 已成功 / Gemini 端 context loss | §0c.3 Failover |
| `sha1Match=true` + Gemini 答非所问 | §0a 已成功 / Gemini 端忘 schema 锚 | §0c.3 Failover |
| `expected_text` 进 `.codex-session.json` 但 `.codex-session.json` 体积为 0 | 写入失败（§10 D1.1 WAL 没生效） | §10 复盘 + §7 备份回滚 |

**反例 / 教训**：
- 反例 1：看到 Gemini 说"截断"就清理 + 重发 5 轮 → 同一对话 context cache 还是坏的，浪费 token + 触发 §0a.1 频次熔断
- 反例 2：把 model 端"答非所问"误判成 quill-gun → 写错 incident kind，禁止填 input 反而阻碍正常注入
- 反例 3：连续 5 轮 R1-R6 都 `sha1Match=true` 但 Gemini 端 0 进展（OpenCodeX 实测）→ 必须走 §0c.3 Failover 不能硬撑

（v10.5 patch：F-GeminiUncontrollable §0a.6 — 沉淀「注入侧 0 失误 + Gemini 端答非所问」OpenCodeX R1-R6 真实案例，避免误把模型端 bug 当 §0a 失效）

### 0a.7 ChatGPT.com 输入契约 (chatgpt.com 专属 patch)

适用范围: `https://chatgpt.com/*`;editor 框架 = **ProseMirror** (不是 Quill),严禁把 §0a 主线 (Quill API / A/B/C/D 路径) 直接套到 ChatGPT。

**§0a.x.1 框架指纹**
- editor = `#prompt-textarea`, DIV `contenteditable=true`, class = `ProseMirror ProseMirror-focused`,React 受控。
- 段落 = `<p>`,段落间换行 = hard break (新 `<p>`),empty paragraph 用 trailing `<br class="ProseMirror-trailingBreak">` 标记。

**§0a.x.2 注入路径 (替代 §0a step 3 A/B/C/D)**
- **首选**: `chrome_navigate` / `chrome_click_element` ([data-testid="chat-input"]) + `chrome_type` (走 CDP `Input.insertText`, isTrusted=true,跨编辑器通用)。chrome_type 自带隐式聚焦,不需要前序 click。
- **A 路径 (`ed.innerHTML=...; dispatchEvent InputEvent`) 禁用** —— 失败模式是"提交时丢":DOM 显示有内容但 React controlled value 仍空,Send 后变成空消息。**禁止作为正式输入路径**。
- **C 路径 (`execCommand('insertText')`) deprecated** —— 现代 Chromium 警告;fallback 可用。
- **D 路径 (`type_text` chrome-devtools-mcp) 仍禁** —— 含反斜杠-n 自动 submit (沿用 §0a 禁令 D)。

**§0a.x.2.x Hybrid injection — text via insertText + newline via Shift+Enter (v5 新增):**

适用范围:chatgpt.com 长 prompt (>2000 chars) 或多行 prompt 注入,避免纯 Input.insertText 单调用的 React state 不同步风险 (§0a.x.4.2)。

**§0a.x.2.x.1 注入路径规则:**

- **Text chunks** 走 CDP `Input.insertText` (await 每次,逐块发送)
- **Newline** 走 CDP `Input.dispatchKeyEvent` (keyDown + keyUp, `modifiers: 8` = Shift) — 不能 emit bare Enter keyDown (会 submit,见 §0a.x.4.4)

```js
// 见 production tool _chatgpt_keyboard_path.mjs (storyforge-server/tmp/_chrome_test/)
await hybridInject(cdp, prompt, { chunkSize: 500, newlineDelayMs: 50 });
// 实现: 对每行, text 走 Input.insertText 块, line 末尾走 Shift+Enter keyDown+keyUp
```

**§0a.x.2.x.2 关键 invariant:**

- **每个 cdp.send 必须 await** — 不 await 时顺序无保证,实验无效
- **不要 chunk delay** (只 newline delay) — 引入额外 delay 会成为 "implicit explanation for failures",违反 §0b.4 防 debug-spree
- **\\r\\n → \\n normalization** — Windows 来源的 prompt 必须 `prompt.replace(/\\r\\n/g, '\\n').replace(/\\r/g, '\\n')`,否则键盘路径把 \\r 当 char + \\n 当 Shift+Enter 错误序列
- **chunkSize 是 EXPERIMENT PARAM,不是 correctness constant** — 默认 500, 测试过 1000 和 full-line 也 OK (chatgpt 没规定上限); React 18 + ProseMirror 没有 "500 chars is safe boundary" 这种规则
- **Unicode smoke test** — emoji sequences / ZWJ / variation selectors / CJK supplementary 单独验证, `for...of` 按 code point 迭代 (不是 UTF-16 code unit) 所以 `𠀀` 不会被截

**§0a.x.2.x.3 实测 (v5 A/B/C/D/E):**

| Test | Method | Size | ACK | SUSPECT_HANG |
|---|---|---|---|---|
| A | Input.insertText | 1536 chars | 1293ms | none |
| B v2 | Input.insertText | 1588 chars | 546ms | none |
| C | hybrid (insertText + Shift+Enter) | 1772 chars (5 lines) | 623ms | none |
| D | Input.insertText | 4915 chars | 390ms | none |
| E | hybrid (insertText + Shift+Enter) | 4915 chars (59 lines) | 530ms | none |

→ 在 chatgpt.com 当前 UI,1536-4915 chars 区间 Input.insertText 与 hybrid 都能正常 ACK,未观察到 §0a.x.4.2 描述的 React state 不同步。hybrid 主要价值在多行 prompt 的 newline 正确性 (Test C/E 显示 multi-line content 被 chatgpt 视为多个段落而非合并)。

**§0a.x.2.x.4 何时启用 hybrid:**

- 多行 prompt (≥3 行) — 强烈推荐 hybrid
- 单行 prompt 但 > 4000 chars — 实证 A/B/D 已通过,纯 insertText 即可,hybrid 不必要
- SUSPECT_HANG 真触发时 (post-send watchdog §0a.x.10 报警) — adapter-specific retry 切 hybrid,**最多 1 次**

**§0a.x.2 末尾 — ghost text 清空 3 步强制 (物理清空优先, A 路径降兜底):**
1. 物理聚焦 + Ctrl+A + Delete (首选, 走 React 受控):
   - `chrome_click_element --selector [data-testid="chat-input"]` (触发 focus)
   - `chrome_keyboard --keys "Control+a"` + `chrome_keyboard --keys "Delete"`
   - 校验: `document.querySelector('#prompt-textarea').innerText.length === 0`
2. 物理清空 3 次仍未干净 → JS 探针 (A 路径, 仅 1 次机会): `ed.focus(); ed.innerHTML='<p><br class=ProseMirror-trailingBreak></p>'; ed.dispatchEvent(new InputEvent('input',{bubbles:true}))`,校验 innerText.length === 1。
3. fallback 后 send-btn 仍未 mounted 或三轨校验失败 → 写 `incident.kind="ghost-text-residue"` 走 §10.1 自动置 null;**禁止重试循环**。
**禁止**: 跳过物理清空直接走 JS 探针 / 物理清空不足 3 次就 fallback / fallback 后不校验三轨就 type 注入。

**§0a.x.3 完整性校验 (硬判定):**
- 用 `editor.innerText` (不是 `textContent`;ProseMirror 段落间换行在 innerText 里,textContent 会被吃掉)。
- 规范化: `actual.replace(/[\s\n]+/g, ' ').trim()`,`sha1(actualNorm) === sha1(expectedNorm)` 严格相等。
- 注入后 `sleep >= 500ms` 等 ProseMirror transaction 同步。
- 段落 sanity (debug 信号,**不参与硬判定**): `pCount ≈ expected.split(/\n/).length`。

**§0a.x.4 Send 触发语义 + pre-send 三轨 + post-send watchdog:**

**§0a.x.4.1 pre-send 完整性 (hard gate, 必须通过才点击):**

- Send btn = `[data-testid="send-button"]`。**DOM presence 跟随 editor 是否有内容** —— empty placeholder 状态下节点 unmount (不在 DOM 里,不是 disabled)。
- Send 前 **必须** 顺序完成 3 校验:
  1. `sha1(actualNorm) === sha1(expectedNorm)` 严格相等
  2. `document.querySelector('[data-testid="send-button"]')?.offsetParent !== null` (节点真实存在 + 可见)
  3. `aria-disabled !== 'true'` (防 React 软禁用)
- 三轨任一失败 → 禁止 click Send,重做 §0a.x.2。
- Send 推荐: `chrome_click_element --selector [data-testid="send-button"]`,**不要**按物理 Enter (物理 Enter 必 submit,无长度阈值,21 字符 + Enter 也 submit)。
- Send 前允许一次 sha1 recheck (sleep 100ms) 防 React 状态刷新误报;累计 ≥ 3 次仍失败 → 写 incident.kind="ghost-text-residue" 走 §10.1。
- **严禁** 把 per-para sha1 debug 信号当 click gating 条件 (per-para mismatch 是 debug 维度,不是 hard gate)。

**§0a.x.4.2 pre-send gates 不足 — 必须有 post-send watchdog (新增 v5):**

实测确认:pre-send 3 轨全过 + Send 点击后,chatgpt.com **仍可能** 因 React 18 useSyncExternalStore 与 ProseMirror 集成问题导致**前端已接收点击但 React state 未同步**(典型症状:composer 不清空、user-bubble 不出现、stop-button 不出现、无 fetch)。SHA-1 + send-button attrs **只能证明 DOM 同步,不能证明 React state 同步**。

→ 因此 §0a.x.4 不能止于 click,**click 后必须跑 post-send watchdog** (新 §0a.x.10),检测 submit-ack 超时 (2s) 或 streaming 异常 (60s)。

**§0a.x.4.3 post-send 短窗口期望 (来自实测 A/B/C/D/E 全通过):**

实测覆盖 5 个场景 (见 §0a.x.10),chatgpt.com 在 prompt 长度 1536-4915 chars + Input.insertText 单调用下:
- ACK (composer 清空或 user-bubble 出现) 在 **390-1293 ms**
- 直接进入 STREAMING (stop-button 立即出现) 或经 ACCEPTED 短暂过渡 (~500 ms)
- 之后正常 progress streaming

**这是工程期望值,不是 vendor SLA**。post-send 2s deadline 远高于此,留足 tolerance。

**§0a.x.4.4 物理 Enter 必 submit (沿用):**

物理 Enter 必 submit (无长度阈值,21 字符 + Enter 也 submit) — 此规则与 §0a.x.2.x 键盘路径 Shift+Enter 强绑定。

**§0a.x.5 跨会话接力:**
- URL pattern: `https://chatgpt.com/c/{id}` (首页 `/` 是 empty state **不能**接力)。`pageId`/`tabId` 不可持久 (CDP token),按 §0d L1-L7 重锁定。
- 接手时 JS 探针: `total % 2 === 0` 表示完整问答对 (可追问);`lastRole === "assistant"` 最新是对方回复 (可续接不要重发);`lastRole === "user"` 是我方旧消息 (等回应或开新 prompt);`total % 2 === 1` 半截 (不能追加)。
- 写 `~/.codex/ai-conversations.json` `conversations[]` 字段 (project/platform/url/topic/lastUpdated/incident) (按 §0c.1 schema)。

**§0a.x.6 反例 / 教训 (6 条核心):**
| # | 现象 | 真因 | 处置 |
|---|---|---|---|
| 1 | A 路径"提交时丢":DOM 显示有内容但 Send 后变空消息 | React controlled value 仍空 | 走 §0a.x.2 物理清空 3 步 + chrome_type |
| 2 | Send btn 可见 ≠ editor 有内容 | 必须 sha1 + offsetParent + aria-disabled 三轨 | 详见 §0a.x.4 |
| 3 | 物理 Enter 必 submit,无长度阈值 (21 chars 也 submit) | Enter = submit;Shift+Enter = hard break (新 `<p>`,不 submit) | **严禁** 按 Enter 提交多段 prompt |
| 4 | `chrome-relay js` 末尾不显式 `return ...` 返回 undefined | IIFE 末尾 `()` 或裸表达式丢值 | 必须 `return JSON.stringify(...)` |
| 5 | PowerShell mojibake on multi-line JS / 长 prompt | cmd.exe / PowerShell escape 链触发 Latin-1 decode | 按 §6 走 Python 脚本或写 `_*.js` 临时文件 base64 注入 |
| 6 | 反复换工具不换写法 = debug-spree 反模式 | 同种失败累计 ≥ 3 次触发 | 写 incident.kind="debug-spree" 走 §0d.5 隔离 + §10.1 自动置 null |

**§0a.x.7 附件上传:**

> **[dormant]** (2026-08-13 mark) — 本章节规则的注入路径 (`chrome_type` / `chrome_upload_file` / `chrome_javascript` / `chrome_keyboard`) 依赖 §0b.1 #2 mcp-chrome (HTTP) 工具集。
> 当前 `~/.codex/config.toml` 仅注册 `[mcp_servers.chrome-devtools]` + `[mcp_servers.node_repl]`,无 `mcp-chrome` 入口。
> Agent **不应**主动调用本节规则;若 web AI 对话框注入被明确要求,需先恢复 mcp-chrome 注册或切 stdio 临时方案 (§0b.5 + §0b.6.5 注)。
- Add files btn: `[aria-label="Add files and more"]`。file inputs ×3 (`input[type="file"]` 主 upload + 2 个 `image/*`)。
- **前置**: `chrome://extensions` → Chrome Relay → 启用 "Allow access to file URLs" (否则 `chrome_upload` `file_access_denied`)。
- 三策略按需选用: `chrome_upload set --selector "input[type='file']' <files>` / `choose --click-ref @ref` / `drop --selector ".dropzone"`。

**与 §0a 主线的关系:** §0a.7 是 §0a 5 步锁在 ChatGPT ProseMirror 上的特化。`chrome-relay js` / `chrome type` / `chrome_click_element` 跨 Quill/ProseMirror/textarea 通用。`chrome-relay type` 走 CDP `Input.insertText` (isTrusted),是 ChatGPT 上**唯一**比物理清空更稳的路径。

<!-- F-RuleLifecycleMgmt: superseded_by = null ; supersedes = null ; effective_since = v10.7.x -->

### §0a.x.8 ChatGPT 输入模式决策(附件 vs inline 注入)

> **[dormant]** (2026-08-13 mark) — 本章节规则的注入路径 (`chrome_type` / `chrome_upload_file` / `chrome_javascript` / `chrome_keyboard`) 依赖 §0b.1 #2 mcp-chrome (HTTP) 工具集。
> 当前 `~/.codex/config.toml` 仅注册 `[mcp_servers.chrome-devtools]` + `[mcp_servers.node_repl]`,无 `mcp-chrome` 入口。
> Agent **不应**主动调用本节规则;若 web AI 对话框注入被明确要求,需先恢复 mcp-chrome 注册或切 stdio 临时方案 (§0b.5 + §0b.6.5 注)。

适用范围: chatgpt.com / ProseMirror editor (沿用 §0a.x.1 框架指纹)。

**实测输入路径**(2026-08-03 Free 用户 ZZZ LEE 实测,3 轮 cross-validate):

| input selector | id | accept | 用途 | 何时用 |
|---|---|---|---|---|
| `input#upload-files` | `upload-files` | `""` (任意) | **任何文件类型**(.txt/.md/.pdf/.docx/.csv) | **首选**,精度 100% |
| `input#upload-photos` | `upload-photos` | `image/*` | 仅图片 | 图片 / OCR 场景 |
| `input#upload-camera` | `upload-camera` | `image/*` | 摄像头拍照 | 拍照场景 |

**反例 / 教训**(踩过的坑):

- ❌ 用 `input#upload-photos` 上传 .md → chatgpt UI 显示 file chip,但后端 **拒绝**(非图片),send button 永远 disabled,chatgpt 最终回复 "未收到可读取的 .md 文件" (实测)。
- ❌ 假定 input hidden = chatgpt 拒绝该类型 → 实际 hidden 是 UI 隐藏,功能在,绕过 UI 仍可用 (实测 `input#upload-files` parent `display: none` 但允许 set file)。
- ❌ 用 `input[type="file"][accept="image/*"]` (带 attribute filter) 选错 input → **必须用 id selector or `:not([accept])` 精确锁定 `input#upload-files`**。

**决策门**(按信息量 + 特征 → 选 input + 模式):

| 信息量 + 特征 | 模式 | input selector | 实现 |
|---|---|---|---|
| < 800 chars | inline 单次 | (none) | §0a step 1-5, sha1 |
| 800 - 2000 chars | inline 单次 + sha1 | (none) | §0a 标准路径 |
| 2000 - 4000 chars | inline 分 2 块(每块 ≤ 1500) | (none) | §0a 5 步 × 2 轮 |
| **> 4000 chars** + **非图片内容** | **chatgpt 原生文件解析** | **`input#upload-files`** | write .txt/.md + chrome_upload_file + 短 prompt |
| **> 4000 chars** + **必须图片内容**(原图就是图) | 图片附件 | `input#upload-photos` | chrome_upload_file + 短 prompt |
| 任何长度 + **必须 100% 精确** | chatgpt 原生文件解析 | `input#upload-files` | OCR 损失为零(走 chatgpt 文本提取) |
| 信息量 ≥ 800 + 同时推送附加图片/截图 | 双附件 | 两个 input 都用 | 上传图片 + 短 prompt |

**附件上传的完整性验证**(替代 §0a 5 步 sha1):

1. chrome_upload_file 完成后,**不**校验文件内容(文件已在 chatgpt backend-api/estuary)
2. 验证 chip 显示正常(category=Document / Photo):
   - `input#upload-files` 上传 → chip cat = "Document" (实测)
   - `input#upload-photos` 上传 → chip cat = "Photo" (实测)
3. 看 send button 状态:**`disabled` === `false` 才发送** (props):**四轨校验的第 4 轨** (修正 v2 漏掉的)
   - 如果 `disabled=true` 持续 ≥ 5s → 上传失败,撤 chip 重传
   - 如果 "already uploaded this file" 弹窗 → chatgpt per-account dedup 命中,改用全新文件 / 或先用旧文件
4. Send 一个**短 inline follow-up prompt**: "请读上面附件,列出前 3 个要点" 或 "用一句话总结主题"
5. 读 ChatGPT 回复前 200 chars:
   - 主题相关 → 上传接收成功
   - 答非所问 / "未收到可读取的 [type] 文件" → 上传失败,撤 chip 重传
   - chatgpt 自我提示"未收到" 是**关键错误信号** (实测 2026-08-03)

**Send button 四轨校验**(v10.7.x, F-SendGuard, 修正 §0a.x.4 三轨 → 四轨):

| 校验 | 检查 | 失败处置 |
|---|---|---|
| 1. sha1(actual) === sha1(expected) | text 完整性 | 撤 composer 重注 |
| 2. `send_button.offsetParent !== null` | 可见 | 等渲染 |
| 3. `send_button.disabled === false` (HTML attr) | **未禁用** | 等处理,≥5s 撤 chip 重传 |
| 4. `send_button.getAttribute('aria-disabled') !== 'true'` | ARIA 软禁用 | 同上 |

**四轨任一失败 → 禁止 click Send,按 §0a.x.4 重做。**

**何时强制 inline**(即使超长):

- 内容含 §0a.6 redact 范围的数据(sha1 / base64 / bearer token / 敏感 key)
- 内容是精确的 shell 命令 / git commit message / 精确代码(必须逐字复述)
- chatgpt 后端不允许重复上传相同文件 (实测: chatgpt 弹 "already uploaded this file" 拦截,需要换新文件名 / 内容)

**反例 / 教训**(2026-08-03 实测,3 轮 cross-validate):

- ❌ 4829 chars expected_text 拆 4 块 × 1500 chars execCommand 分块注入 → 撞 16s timeout + sha1 反复校验 + PowerShell heredoc + base64 → 实际成功,但 Codex 端 token 消耗 ~5x
- ❌ 用 `input#upload-photos` 上传 .md → 选错 input,send button 永远 disabled,chatgpt 后端不识别 .md 为图片
- ❌ 假定 chip 显示 = 上传成功 → 实际只 UI 显示,后端可能 reject
- ❌ 跳过 send button `disabled` 校验 → 点击无响应还以为 send 卡住
- ❌ 假定 hidden input = chatgpt 拒绝该类型 → 实际 hidden = UI 隐藏,功能在
- ❌ 假定 PDF/DOCX 等需要 Plus → 实测只验证 .txt/.md/.pdf 推测 OK (未实测)
- ✅ `input#upload-files` + .txt 704 chars → 2 次 MCP call, send 立即 enabled, chatgpt 完整读 + 完整回答 Q1/Q2
- ✅ `input#upload-files` + .md 549 chars → 2 次 MCP call, send 立即 enabled, chatgpt 完整读 + 完整回答 Q1/Q2/Q3
- ✅ `input#upload-photos` + PNG 855 chars → OCR 路径,精度 ~90-95% (反引号 / 反斜杠细节会简化)
- ✅ 文件 chip 显示 "Document" category (实测) vs 图片 "Photo" category,做成 sanity check
- ✅ 重复上传触发 chatgpt 拦截 ("already uploaded this file") → 避免重复消耗 token

**实测精度对比**:

| input | 示例 | 精度损失 | 适用 |
|---|---|---|---|
| `input#upload-files` (.txt/.md) | 704 chars 文本 + 表格 | **0%** (chatgpt 文本提取) | 首选 |
| `input#upload-photos` (PNG) | 855 chars 渲染成图片 | ~5-10% (OCR 简化) | 图片 |
| inline 注入 | 任意 | 0% (sha1 严格) | 短 / 中文本 |

**反例 vs 正例三层 trade-off**:

| 场景 | 信息量 | 首选 | 备选 |
|---|---|---|---|
| 短文档 + 简单回答 | < 800 | inline 单次 | 无 |
| 中等 prompt + 标准问答 | 800 - 2000 | inline + sha1 | 无 |
| 长 prompt + 需精确 | 2000 - 4000 | inline 分 2 块 | 附件 (省 token) |
| 长文档 + 容忍精度损失 | > 4000 | PNG 附件 | inline 分 4+ 块 |
| 长文档 + 必须精确 | > 4000 | **txt/md 附件 (input#upload-files)** | inline 分 4+ 块 |

**反例 / 教训**(踩坑汇总,按出现频率):

- 出现频率 ~30%: **input selector 选错** (用 `[accept="image/*"]` 选到 `upload-photos`)
- 出现频率 ~20%: **跳过 send button disabled 校验** (点击无响应)
- 出现频率 ~15%: **chatgpt 后端 dedup** (per-account 上传过的文件不能再用)
- 出现频率 ~10%: **chip 显示 ≠ 上传成功** (UI optimistic display)
- 出现频率 ~10%: **OCR 损失未察觉** (PNG 路径精度 ~90-95%)
- 出现频率 ~10%: **hidden input 误判** (认为 hidden = 拒绝)
- 出现频率 ~5%: **16s timeout** (chunk 过大)

**实测结果汇总**(2026-08-03):

| 文件类型 | selector | 路径 | 精度 | send button | 备注 |
|---|---|---|---|---|---|
| PNG 855 chars | `input#upload-photos` | OCR | ~90-95% | OK | 反引号细节简化 |
| TXT 704 chars | `input#upload-files` | text extract | 100% | OK | Q1/Q2 精确 |
| MD 549 chars | `input#upload-files` | text extract | 100% | OK | Q1/Q2/Q3 精确 |
| MD 走错 input | `input#upload-photos` | rejected | N/A | 永远 disabled | chatgpt: "未收到 .md" |

**凭这条实测可以修正之前的 AGENTS.md v1/v2 草稿**:Free 用户 chatgpt 物理上**完整支持** .md/.txt 附件,不需要 PNG OCR 路径。**问题从来是 selector 选错**。

## 0b. Browser Orchestration / Search Priority

凡任务涉及网页访问、搜索、内容提取、网页登录态、浏览器内操作、网页 AI 对话、前端 DevTools 调试，**必须先走浏览器调度层**，按下面优先级选工具，而不是直接调用 `web_search` 或手搓 HTTP / WebSocket。

### 0b.1 工具优先级（自上而下）

1. **Chrome DevTools MCP** (默认浏览器执行器, 我们 fork 的 `zamelee/chrome-devtools-mcp` = `ChromeDevTools/chrome-devtools-mcp`) - 通过 CDP 接 Chrome,需先 `--remote-debugging-port=9222` 起 Chrome (用项目里 `scripts/start-chrome-debug.bat`),profile 默认 `%TEMP%\\chrome-debug` (含已装扩展 + 登录态,与老的 `Google ChromeDEBUG.lnk` 共享)。
   - 用于 DevTools 专项能力: Lighthouse / Performance trace / Heap snapshot / CPU·network·UA·colorScheme 仿真 / native dialog / 单条 network / 单条 console 详细查询。
   - 用于通用浏览器任务: navigate / click / read text / screenshot / list_pages / evaluate_script 等。Codex 默认走这个。
   - **不要**用 chrome-devtools-mcp 的 `type_text` / `fill` 触发物理按键——这是 §0a step 3 D 路径禁用,长 prompt 上 \\n 会 auto-submit Quill / ProseMirror。
   - 可用判断: `mcp__chrome_devtools__list_pages` 成功返回; `curl http://127.0.0.1:9222/json/version` 返 200 且 Browser 字段非空。
   - **故障处理**: 若发生 "Allow remote debugging?" 弹窗、连接超时、user data dir 被占等异常,**不得盲目重试**、**不得无限探测端口**、**不得手搓 CDP WebSocket client 绕过 MCP**。详见 §0b.4。
   - 启 Chrome: 跑项目里的 `scripts/start-chrome-debug.bat` (10s 自关 console);profile 默认走 %TEMP%\\chrome-debug。

2. **Chrome Relay (我们 fork 的 `D:\\Documents\\VibeCoding\\chrome-relay`)** - 当 chrome-devtools-mcp 不可用且仍需要真实 Chrome 登录态时的 fallback。
   - 同样基于 `chrome.debugger` 扩展 API,无 Allow 弹窗。
   - 可用判断: `chrome-relay profile list` 返回至少一个 profile,且 `chrome-relay tabs` 可列出 tab。
   - 工具集通常比 mcp-chrome 小;fork 独立维护 (AGENTS.md §13 + 项目级 AGENTS.md 维护策略,绝不上游 PR)。
   - 安装与调度见 §0b.5。

3. **Codex / vendor Chrome 扩展** - sub-rank 标记,不作为独立 rank。
   - 当用户通过 Codex desktop 的 `@Chrome` 提及,或 vendor 扩展流程显显要求时使用。
   - 工具集受 vendor 平台调用面约束,通常比 chrome-devtools-mcp 小。
   - **优先**用 #1/#2 (都是 vendor 扩展模式),**仅**在 vendor 强约束时才回退到原生 vendor 扩展。

4. **Playwright / fresh browser** - 仅用于无需真实登录态的可重复验证、CI 风格测试、隔离 profile 截图。
   - **禁止**拿 Playwright 替代真实 Chrome 登录态任务,除非用户明确允许重新登录或允许 isolated profile。

5. **`web_search`** (最末位) - **禁止自动调用**。
   - 只有用户显式说出 "用 web_search 查"、"用搜索工具"、"web search 一下" 时才能用。
   - `web_search` 连续失败 2 次,视为不可用,不得作为 fallback 自动启用。
   - **计数存储**: `<cwd>/.codex-session.json` 的 `web_search_fail_count: number` 字段 (按 §0d.0 v9 schema 拆分后属高频层);**进程重启必须继承历史计数值** (防止 Crash-Loop 守护进程反复拉起把计数器清零,导致「连败 2 次」硬错误锁死失效,最终把搜索接口打至 429 限流);仅跨自然日 (00:00 Asia/Shanghai) 由 §9 session 启动自检清零 (v8 沉淀,Gemini 反馈 C2)。
   - **域隔离注解**: 此为针对 API 可用性的硬错误拦截 (绝对连续失败计数),与 §0a.1 的"前端 UI 时间滑窗速率"物理隔离,数值不一致不构成逻辑冲突 (按 §0.f.1 总表管理)。
   - **理由**: Agent 长生命周期项目不应因偶发网络抖动永久锁死该能力 (按 v6 沉淀,B1 SRE)。

### 0b.2 调度原则（跨工具共性）

- **失败可解释**：浏览器调度失败时，必须报告"哪个工具、哪一步、什么错误"，不得静默换工具继续。
- **不退化到裸协议**：任何浏览器工具卡住时，**不得自动退到** raw `curl` / 裸 WebSocket / 手搓 CDP client / node REPL 起 Node 内核去调 HTTP。这是 debug-spree 比承认失败更糟——参见历史教训（Gemini 在 9222 debug 中跑出 9m46s 无结论的反例）。
- **既有的输入 / Tab / 持久化规则继续生效**：浏览器内的输入仍受 `0a` 约束，Tab 仍受 `0d` 约束，AI 对话仍受 `0c` 约束。本节不替代这些，只规定"用哪个工具"。
- **不抢活**：用户已经明确在某个 tab / 对话里工作（`@Chrome`、`/open <url>`、会话里贴过 gem URL），不要因为"工具有了"就新建 tab / 新建对话。先沿用现有，再讨论是否新建。

### 0b.3 启用 / 停用矩阵（推荐默认）

| 工具 | 默认状态 | 何时启用 | 何时停用 |
|---|---|---|---|
| Chrome Relay | 装上（CLI 全局 + 扩展 + native host） | 用户希望用真实登录态 Chrome 干活；上传附件时前置：在 chrome://extensions → Chrome Relay 启用 "Allow access to file URLs"，否则任何 `chrome-relay upload` 命令 `file_access_denied`（参考 §0a.x.7） | 用户明确说"暂时别动我的浏览器" |
| Chrome DevTools MCP | `enabled = true` (我们 fork 的 `zamelee/chrome-devtools-mcp`, §0b.1 #1 默认浏览器执行器) | 任何通用浏览器 task (navigate / click / screenshot) + 所有 DevTools 专项 (Lighthouse / trace / heap / 仿真 / native dialog) | 用户明确说"不要动我的浏览器"；fork bug 调查期间需要隔离 mcp-chrome 路径 |
| `web_search` | 禁用 | 用户显式要求 | 连续失败 2 次（24 小时内）即视作不可用；跨日清零（重启不清，按 §0b.1 v8） |

### 0b.4 chrome-devtools-mcp 故障处理（防 debug-spree）

出现下列任一情况时，**立即停止重试**，按下面的顺序处理：

1. **"Allow remote debugging?" 弹窗**：用户在 Chrome 上超时未点 → MCP 工具调用会 hang / 失败。
   - Codex 应当**显式告诉用户**"请在 Chrome 上点 Allow 弹窗"，而不是重试。
   - 不得自动重启 Chrome、不得自动 kill Chrome 进程、不得自动改 user data dir。
   - 如果反复出现 → 推荐改走 `0b.1` 第 1 / 2 项（Chrome Relay 或 vendor 扩展），不再死磕 chrome-devtools-mcp。
2. **"browser already running for `<user-data-dir>`"**：
   - 这不是 Codex 可以"修复"的，是 Chrome 进程与配置错位。
   - Codex 应当**告诉用户**哪个 user data dir 被哪个 PID 占用，让用户决定是关掉 Chrome 还是接受现状（按 SingletonLock 文件 / Chrome 进程命令行查看占用）。
   - 不得自动 `taskkill` Chrome 进程、不得自动删 lockfile、不得自动换 user data dir。
3. **连接超时 / 9222 不响应**：
   - 先用 `curl -sS http://127.0.0.1:9222/json/version` 或 `python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:9222/json/version', timeout=3).read().decode())"` 确认端口状态（按 §6 不推荐 PowerShell `Invoke-WebRequest`）。
   - 不响应 → 告诉用户 Chrome 进程可能挂掉，让用户决定是否重启。
4. **Target Crashed (OOM) 侦测**（v6 沉淀）：
   - 当调试复杂图表或巨型 DOM 时，Chrome Tab 会崩溃成 "Aw, Snap!" 页面。此时 9222 端口仍通、`list_pages()` 也能查到 URL，但任何 DOM `evaluate_script` 都会一直挂起。
   - 操作前用 `chrome-relay screenshot --tab <id>` 取一帧；若返回纯白 / `Target closed` 错误 → 禁止无限 `Wait DOM`，立即触发 `incident.kind = "target-crash"`，按 §0d.5 走换 Tab + `close` 物理清理流程（v8 修订：必须先 `navigate --new` 再 `close`，避免 close 唯一存活 Tab）。
   - 响应但版本不对 → 告诉用户 Chrome 与 chrome-devtools-mcp 版本不兼容，请用户升级其中之一。
5. **"pageId silently rebound" 类错误**（v1.6.0 已修，但旧版本或边缘 case 仍可能出现）：
   - 立刻停手，**重新走 0d.1 的 L1–L7 锁定流程**，不要用旧 pageId 继续操作。

### 0b.5 Chrome 工具安装契约 (chrome-devtools-mcp 主路径 + chrome-relay fallback)

凡任务涉及网页访问、读取、点击、输入、登录态操作,默认安装 **chrome-devtools-mcp** (我们项目 fork `zamelee/chrome-devtools-mcp` 当前在 `codex/cli-and-hi-dpi-fixes` 分支) + 配 Codex config + 起 Chrome debug port。
chrome-relay 是 fork 的旁路 fallback,安装与项目专属 gotchas 见 `D:\\Documents\\VibeCoding\\chrome-relay\\AGENTS.md` §install (本节不再展开).

**主路径 - chrome-devtools-mcp (我们 fork):**
1. 项目源码: `D:\\Documents\\VibeCoding\\chrome-devtools-mcp` (fork `ChromeDevTools/chrome-devtools-mcp` 当前 `codex/cli-and-hi-dpi-fixes` 分支)。Node.js >= 18。
2. 启 Chrome: 跑项目里的 `scripts/start-chrome-debug.bat` (桌面 `Start Chrome with MCP Debug.lnk` 指向同一脚本)。脚本 10s 自关 console,profile 默认 `%TEMP%\\chrome-debug`。
3. 构建产物: `D:\\Documents\\VibeCoding\\chrome-devtools-mcp\\build\\src\\bin\\chrome-devtools-mcp.js`。`npm run build` 在项目里跑 tsc + post-build。
4. Codex 配置 (`C:\\Users\\Bliss\\.codex\\config.toml` 已加):
   `[mcp_servers.chrome-devtools]`
   `command = "node"`
   `args = ["D:/Documents/VibeCoding/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js", "--browser-url=http://127.0.0.1:9222", "--no-usage-statistics", "--no-update-check"]`
   `startup_timeout_sec = 60`
5. 健康标准: `curl http://127.0.0.1:9222/json/version` 返 200 + Browser 字段非空;或 `mcp__chrome_devtools__list_pages` 成功返回。
6. 启停: Codex desktop 重启 → spawn MCP server process → 注册 `mcp__chrome-devtools__*` 工具集(共 N 个,见 server source)。

**Fallback 1 - chrome-relay (我们 fork, 项目级规则见 §13):**
- 项目根: `D:\\Documents\\VibeCoding\\chrome-relay` (fork 上游 `kiluazen/chrome-relay`,**绝不**上 PR,见 §13)。
- 安装要点 (chrome-relay 自身): `pnpm add -g chrome-relay` -> `chrome-relay install` -> Chrome Web Store 装扩展 `cpdiapbifblhlcpnmlmfpgfjlacebokb` -> `chrome-relay doctor` 全绿 -> Codex 侧 `npx -y skills add kiluazen/kstack@chrome-relay`。
- chrome-relay.cmd Windows wrapper gotchas (反斜杠转义、单 arg 长度截断、`return ...` 契约) 见 chrome-relay 项目 AGENTS.md / `tmp/code-backups/`,**不重复**在本全局文件。
- **何时切**: chrome-devtools-mcp 不可用 (9222 不 listening / build 失败 / Codex 启 spawn 失败) 且仍需真实 Chrome 登录态。

**共同前置:** Node.js >= 18, `pnpm` 已装, Chrome 用默认 user-data-dir (避免独占锁,见 §0b.4)。

**§0b.5 通用契约 (跨 chrome-relay / chrome-devtools-mcp js probe):**
- 所有 js 探针末尾必须显式 `return ...`。IIFE 末尾 `()` 或裸表达式都返回 undefined (反例见 §0a.x.6)。
- debug-spree 兜底 (v10.7.1 patch F-DebugSpree): 同种失败 (sha1 mismatch / selector not found / timeout / undefined) 累计 >= 3 次 -> 写 `incident.kind=debug-spree` 走 §0d.5 隔离 + §10.1 自动置 null。物理计数在 `.codex-session-extended.json` `chrome_relay_js_fail_count` (跨进程继承,跨自然日清零)。**严禁**继续"再多试一次"。
- chrome-devtools-mcp 不需要 mcp-chrome 那种 SESSION_EXPIRED 恢复协议 (它走 CDP 直接连 9222,没有 extension bridge 概念)。

### 0b.6 封号保护（ban protection）（incident-driven 主动停下）

检测到任一项高危态（§0a.1 频次熔断 / Quill 半截发送 / §0b.4 的 "Allow remote debugging?" 弹窗超时）时：

- **主动停手并告知用户**：禁用 `fill` / `type_text` / `press_key` / `click` 中所有改输入区状态的命令；**不得"自动清理 + 重试"**——重试会再触触发链，把控制权交还人。
- **仅允许评估类操作**：`evaluate_script` 的 read / DOM 清空 / `window.close()` 仍可用。
- **写 incident**：`<cwd>/.codex-session.json` 加 `incident: { kind, ts, evidence: <Quill 注入类 | 系统错误类> }`，下个会话读到则强制走 §0d.5 隔离。
- **evidence 字段 schema 强约束（v8 沉淀，Gemini 反馈 B2，v9 联合类型扩 A1）**：`evidence` 必须**严格遵守 §0c.1 定义的联合类型 schema**（`Quill 注入类: { src, sha1hex, len }` 或 `系统错误类: { type: "system-error", text, ts }`），**禁止直接塞入纯报错文本**到 src/sha1hex/len 字段；错误信息必须放系统错误类的 `text` 字段。Schema 不匹配时按 §10 复盘流程写 audit_log，不允许"先塞个 string 后续再说"。
- **§0b.6 补充豁免（平衡版 APPEND-ONLY，v6 沉淀，B2 Security 改良版）**：当触发封号保护时，禁止一切业务输入区操作（`fill` / `type_text` / `click` / `press_key`），但为解除事故态，**仅允许以下受控写操作**：
  1. **更新 `.codex-session.json`**（incident 状态 / pending_actions 等字段；写入走 §7.0 backup，stamp = `kind-yyyymmdd`）
  2. **向 `~/.codex/AGENTS.md` 末尾追加事故日志**（Append-only，禁止改 / 删 / 重写既有 §0-§8 规则区块）
  3. **§7.0 pre-write backup 正常生效**，backup stamp = `kind-yyyymmdd`（如 `target-crash-20260721`）
- **【安全红线】**：**豁免态（ban protection 触发中）下**禁止修改既有规则区块（§0-§8 任何已有内容）；试图覆盖规则的动作立即写 `incident.kind = "rule-tamper-attempt"` 并停手。**非豁免态下**用户授权可改既有规则，走 §7 backup + 正常 mutate-state 流程。豁免态 vs 用户授权态的边界由 `incident.kind` 是否为 null 判定（incident 解除即回到用户授权态）。写 incident / 追加事故日志本身是豁免范围内的合法操作，不触发红线。

截图 / HAR / 控制台日志 / 录屏等浏览器内观察产物应归档到项目目录，不留在 Temp。



### 0b.6.5 Chrome 工具选型决策树 (single-page quick reference)

任务进来 → 按这个顺序 5 秒内选工具,详见 §0b.1 各自说明。

```
任务需要 Chrome 操作 (网页读取 / 点击 / 输入 / 登录态 / 截图)
  |
  +-- [Q1] 需要真实用户登录态 / cookies / 已登录扩展? ── NO ─→ §0b.1 #4 Playwright (fresh browser, 默认 isolated profile)
  |                                                        ── YES ─┐
  |                                                                 │
  +-- [Q2] chrome-devtools-mcp 健康? (9222 listening + list_pages 返成功)
  |    ── NO ─→ §0b.1 #2 chrome-relay (我们 fork, 同生态) 作 fallback;仍不可用 ─→ §0b.4 故障处理
  |    ── YES ─┐
  |            ↓
  +-- [Q3] 需要 DevTools 专项能力? (Lighthouse / trace / heap / 仿真 / native dialog)
  |    ── NO ─→ 默认路径 (通用 navigate/click/screenshot 走 chrome-devtools-mcp,见下面"默认")
  |    ── YES ─→ chrome-devtools-mcp (已经在 #1 跑,无需切)
  |
  +-- 默认 ──────────────────────────────────> §0b.1 #1 chrome-devtools-mcp (HTTP/CDP, --remote-debugging-port=9222)

注 (2026-08-13 mcp-chrome 移除后): web AI 对话框注入 (§0a 主线 + §0a.x 系列) 曾依赖 mcp-chrome 专属注入工具集
    (chrome_type / chrome_upload_file / chrome_javascript 等),chrome-devtools-mcp **没有等价物** (§0a step 3 D 路径禁用的物理 type_text)。
    若任务明确要求 §0a.x.7/8/9 路径 ─→ 当前默认浏览器不可达,需先恢复 mcp-chrome 注册或切 stdio 临时方案 (见 §0b.5 + §0a.x.7-§0a.x.9 dormant 章节)。
```
**Q1 决策点 (是否需要真实登录态):**
- YES: 用户当前 Chrome profile 里的 cookies / 登录 / bookmarks / 扩展状态 (包括 mcp-chrome 自己) 是任务成功的必要条件。
- NO: 任务是 CI 风格测试、隔离 profile 截图、可重复验证。Playwright 直接用 default Chrome binary + 新 user-data-dir。

**Q2 决策点 (mcp-chrome 健康):**
- 检查: `curl http://127.0.0.1:12306/health` 返 200 + `bridgeInstanceId` 非空 + `extension.heartbeatAgeMs < 60000`。
- 不健康: bridge 没启动 / extension 没 load / host child 死了 / 端口被占。降级到 chrome-relay (我们 fork,同生态)。

**Q3 决策点 (DevTools 专项, 仅当 Q0=NO):**
- YES: 需要 Lighthouse / Performance trace / Heap snapshot / CPU/network/UA 仿真 / native dialog / 单条 network 或 console 详细查询。chrome-devtools-mcp (已在 #1) 直接用。
- NO: 通用 navigate / click / screenshot,默认走 chrome-devtools-mcp (也在 #1)。
- 注意: 这条之前说"绝不 chrome-devtools-mcp 做 navigate + click + read text"——这条禁令在 chrome-devtools-mcp 是 #1 后**失效**,因为通用浏览器任务现在就该走 chrome-devtools-mcp。

**Q4 决策点 (SESSION_EXPIRED 持续):**
- 触发条件: reload extension 后连续 2 次 MCP call 返 SESSION_EXPIRED。
- 处置: 临时切 stdio (§0b.7.8 #3)。**不要** kill Chrome / 换 user-data-dir / 手搓 CDP (违反 §0b.4)。
- 回切: HTTP variant 健康后反向操作。

**禁止的 fallback 路径 (按 §0b.4):**
- raw `curl` / 裸 WebSocket / 手搓 CDP client / node REPL 起 Node 内核调 HTTP
- 反复换工具不换写法 (debug-spree,累计 >= 3 次同种失败 → incident.kind="debug-spree" 走 §10.1)
- kill Chrome 进程 / 改 user-data-dir / 删 lockfile (Chrome 自己管)



<!-- v10.7.9 lineage, documented/finalized in v1.10.3 (F-CrossVendorDedup §0a.x.9) -->
### §0a.x.9 Cross-Vendor Dedup Decision Table

> **[dormant]** (2026-08-13 mark) — 本章节规则的注入路径 (`chrome_type` / `chrome_upload_file` / `chrome_javascript` / `chrome_keyboard`) 依赖 §0b.1 #2 mcp-chrome (HTTP) 工具集。
> 当前 `~/.codex/config.toml` 仅注册 `[mcp_servers.chrome-devtools]` + `[mcp_servers.node_repl]`,无 `mcp-chrome` 入口。
> Agent **不应**主动调用本节规则;若 web AI 对话框注入被明确要求,需先恢复 mcp-chrome 注册或切 stdio 临时方案 (§0b.5 + §0b.6.5 注)。

- **适用范围** (`introduced in v10.7.9 lineage, finalized in v1.10.3`): 上传附件给 web AI (chatgpt.com / github.com/copilot / gemini.google.com) 时，遇到 dedup / 错误状态的判定 + fallback 决策表。

#### §0a.x.9.0 Quick Decision Summary (Agent runbook)

| Situation | Action |
|---|---|
| Upload > 4000 chars + non-image | File path (chatgpt `input#upload-files` / per-vendor) |
| Dedup dialog visible | Dismiss visible dialog through supported UI action + 走 inline prompt 路径 (no file) |
| Chip only + no errors | `verifyPostcondition: true` (mandatory) |
| Probe succeeds but signals contradict | `uncertain` |
| Probe JS execution fails | `probe_failed` (CI/performance path only; never default production recovery) |

**实现来源**:
- `app/chrome-extension/entrypoints/background/tools/browser/file-upload.ts`
  - `DEDUP_KEYWORDS` (9 regex) + `INSTRUMENTATION_NOISE` (5 regex, chatgpt 专属)
  - `isRealError(text)` + `extractDedupKeyword(text)` + verdict logic
  - 5 status enum: `succeeded` / `rejected` / `dialog_blocked` / `uncertain` / `probe_failed`
- `app/chrome-extension/tests/tools/file-upload-postcondition.test.ts` (13 测试覆盖 DEDUP_KEYWORDS mirror + isRealError + extractDedupKeyword + verdict branches)

#### §0a.x.9.1 Dedup Keyword 矩阵 (v1.10.0 实测)

| Vendor | Selector | accept | Dedup Trigger | UI Surface | Match Keywords |
|---|---|---|---|---|---|
| chatgpt.com | `input#upload-files` | `(empty)` 任意文件 | per-account file hash | `role="dialog"` | `already uploaded` / `已上传` / `重复上传` / `文件已存在` / `already (?:been )?uploaded` |
| chatgpt.com | `input#upload-photos` | `image/*` | 同上 (chip 显示但 backend reject) | `role="dialog"` | 同上 |
| chatgpt.com | `input#upload-camera` | `image/*` | 摄像头拍照场景 | `role="dialog"` | 同上 |
| github.com/copilot | `input[type="file"]` (per-component) | per-component | silent dedup + banner | banner / `role="status"` | `file already exists` / `duplicate (?:file\|upload)` / `same file` / `already attached` |
| gemini.google.com | `input[type="file"]` (per-component) | per-component | content/hash based dedup (implementation observation) | silent (no UI) | hash-based；原 content 从 conversation history 取 |

**DEDUP_KEYWORDS 完整列表** (9 条 regex, from `file-upload.ts`):
```typescript
const DEDUP_KEYWORDS: RegExp[] = [
  /already uploaded/i,
  /file already exists/i,
  /duplicate (?:file|upload)/i,
  /已上传/,             // CJK
  /重复上传/,           // CJK
  /文件已存在/,         // CJK
  /already attached/i,
  /already (?:been )?uploaded/i,
  /same file/i,
];
```

#### §0a.x.9.2 Verdict Decision Table (5 status)

| Status | Trigger 条件 | UI Signal | Agent Action |
|---|---|---|---|
| `succeeded` | `input.files` 含新文件 + chip 显示 + 无 dedup dialog | chip category=Document/Photo | proceed §0a.4 / §0a.x.4 sha1 + 4 轨校验 |
| `rejected` | `input.files` 清空 + visible rejection error | `newErrors[]` 含 backend reject (`unsupported file type` 等) | 撤 chip + retry with 新文件 (不同 content/filename) |
| `dialog_blocked` | visible `role="dialog"` 含 dedup keyword | `dialogText` 含 `already uploaded` 等 | **dismiss visible dialog through supported UI action** + 走 inline prompt 路径 (no file) |
| `uncertain` | probe 成功但 `fileInputFiles` / `chips` / `errors` 互相矛盾 | 主动 `chrome_read_page` + 自己判断 (per §0b.7 调试) |
| `probe_failed` | probe JS 执行错误 | (n/a, 内部) | **CI/performance-only path; never default production recovery** |

#### §0a.x.9.3 Decision Tree (per §0a.x.8 实测 + v1.10.0 patch)

| 信息量 + 特征 | 模式 | Selector | 实现 |
|---|---|---|---|
| < 800 chars | inline 单次 | (none) | §0a 5 步锁 |
| 800-2000 chars | inline 单次 + sha1 | (none) | §0a 标准路径 |
| 2000-4000 chars | inline 分 2 块 | (none) | §0a 5 步 × 2 轮 |
| > 4000 chars + 非图片 + 任意 vendor | 原生文件解析 | `input#upload-files` (chatgpt) / per-vendor | `.txt`/`.md` + `chrome_upload_file` + 短 prompt |
| > 4000 chars + 必须图片 | 图片附件 | `input#upload-photos` (chatgpt) | `chrome_upload_file` + 短 prompt |
| 任意长度 + 必须 100% 精确 | 原生文件解析 | 同上 | OCR 损失为零 (走 chatgpt 文本提取) |
| 任何长度 + 同时推送附加图片/截图 | 双附件 | 两个 input 都用 | 上传图片 + 短 prompt |

#### §0a.x.9.4 Instrumentation Noise (chatgpt.com 专属)

chatgpt.com embed performance-marker scripts (`__oai_logHTML`, `__oai_SSR_*`, `requestAnimationFrame`, inline `addEventListener` lambdas) inside `role="alert"` nodes。`INSTRUMENTATION_NOISE` 5 regex 在 `isRealError()` 前置过滤:
```typescript
const INSTRUMENTATION_NOISE: RegExp[] = [
  /__oai_(?:logHTML|logTTI|SSR_HTML|SSR_TTI)/,
  /addEventListener\(`input`/,
  /requestAnimationFrame\(/,
  /window\.__oai_/,
  /performance\.mark/,
];
```

`isRealError(text)` flow:
1. 若 `text` 匹配任意 INSTRUMENTATION_NOISE regex → 返回 `false` (不算真 error)
2. 否则匹配 `(?:error|fail|rejected|invalid|unsupported|denied|forbidden)/i` → 返回 `true`

#### §0a.x.9.5 反例 / 教训 (2026-08-03 chatgpt + 2026-08-10 mcp-chrome 实测)

| # | 现象 | 真因 | 处置 |
|---|---|---|---|
| 1 | 用 `input#upload-photos` 上传 .md → send button 永远 disabled | chatgpt 后端不识别 .md 为图片 | 改用 `input#upload-files` (accept=empty) |
| 2 | 假定 chip 显示 = 上传成功 | 实际只 UI optimistic display，后端可能 reject | 必须走 `verifyPostcondition` probe + send button 4 轨校验 |
| 3 | 跳过 send button `disabled` 校验 → 点击无响应 | React 受控 value 软禁用 | §0a.x.4 第 4 轨：`send_button.disabled === false` |
| 4 | 假定 hidden input = chatgpt 拒绝该类型 | 实际 hidden = UI 隐藏，功能在 | 直接 `chrome_upload_file --selector 'input#upload-files'` (parent display: none 但允许 set file) |
| 5 | chatgpt 后端 dedup (per-account 上传过的文件不能再用) | per-account file hash dedup，比 normalized hash 更严 | 改用全新文件内容 + dismiss visible dialog + 走 inline prompt 路径 |
| 6 | 反复改文件名 / 加 padding / 加 timestamp 改 normalized hash 试图 dedup miss | chatgpt dedup 算法比文件内容 hash 更严 (per-account) | 不要循环尝试 miss；走 §0a.x.9.2 `dialog_blocked` 处置 (dismiss + inline) |
| 7 | 假定 `chrome_javascript` 末尾裸表达式返回 undefined | IIFE / bare expression 返回 undefined | 必须显式 `return JSON.stringify(...)` (per §0a.x.6 #4) |
| 8 | dedup dialog 触发时 chatgpt 叠加 3 层 lock（dialog + backdrop-blur + body scroll-lock + `pointer-events: none`） | chatgpt modal mode 不允许 click outside dismiss | 必须三件一起清：hide dialog + hide `.fixed.inset-0.z-50` + 解锁 body。详见 §0a.x.9.6。 |

#### §0a.x.9.6 chatgpt Modal Lock 三层结构（生产事故案例 2026-08-10）

**触发条件**: chatgpt dedup dialog 显示后，chatgpt 自动加 3 层 lock，必须三件一起清：

| 层 | DOM/CSS 标识 | 处置 |
|---|---|---|
| Dialog | `[role="dialog"]` | `display: none` |
| Backdrop overlay | `.fixed.inset-0.z-50` (`backdrop-blur`) | `display: none` |
| Body lock | `<body>` `pointer-events: none` + `[data-scroll-locked]` + computed `overflow: hidden` (from stylesheet `body[data-scroll-locked]`) | `removeAttribute('data-scroll-locked')` + `body.style.setProperty('overflow', 'visible', 'important')` + `body.style.setProperty('pointer-events', 'auto', 'important')` |

**实测 unlock JS** (per chatgpt.com 2026-08-10 mcp-chrome 实测 + Copilot v1.10.4 review):
```javascript
// Step 1: hide dialog + backdrop
document.querySelectorAll('[role="dialog"]').forEach(d => { d.style.display = 'none'; });
document.querySelectorAll('.fixed.inset-0.z-50').forEach(o => { o.style.display = 'none'; });
// Step 2: remove scroll-lock attribute
document.body.removeAttribute('data-scroll-locked');
// Step 3: force inline overflow + pointer-events (override stylesheet rule)
document.body.style.setProperty('overflow', 'visible', 'important');
document.body.style.setProperty('pointer-events', 'auto', 'important');

// Step 4 (v1.10.4, per Copilot §a): remove stale event listeners
// chatgpt dedup dialog attaches Escape keydown + click-outside + focus-trap listeners.
// Hiding CSS doesn't remove them; listeners may re-trigger dialog or block interactions.
// cloneNode trick replaces each dialog node with a clean clone, dropping all attached listeners.
document.querySelectorAll('[role="dialog"]').forEach(d => {
  const clone = d.cloneNode(true);
  d.parentNode?.replaceChild(clone, d);
});
// Also remove aria-hidden on sibling elements (focus trap artifact)
document.querySelectorAll('[aria-hidden="true"]').forEach(el => { el.removeAttribute('aria-hidden'); });
```

**反例**: 仅 hide dialog 不足以解锁（backdrop 仍模糊 + body 仍 pointer-events: none + Escape key 仍能 re-open dialog）。

#### §0a.x.9.7 维护规则（when to update this table）

| Trigger | 必须同步的内容 |
|---|---|
| **新 vendor 接入** (Perplexity / DeepSeek / Claude 等) | 加一行到 §0a.x.9.1 Dedup Keyword 矩阵 (selector + accept + dedup trigger + UI surface + match keywords) |
| **regex 变更** (DEDUP_KEYWORDS / INSTRUMENTATION_NOISE / isRealError) | 同步 `app/chrome-extension/tests/tools/file-upload-postcondition.test.ts` (test 必须 mirror)，并在 §0a.x.9.1 + §0a.x.9.4 同步更新 |
| **新 status 加入 verdict enum** | 在 §0a.x.9.2 加新行（含 trigger / UI signal / agent action），并在 §0a.x.5 chatgpt input contract cross-check |
| **production 事故发现 §0a.x.9 未覆盖场景** | 加到 §0a.x.9.5 反例表（生产事故条目，标日期 + vendor），不要"等下个 patch" |
| **Selector DOM API 变更** (vendor redesign class/ID, 例如 `.fixed.inset-0.z-50` → `.modal-overlay`) | 更新 §0a.x.9.1 (selector 列) + §0a.x.9.6 (若影响 modal lock)，并跑 file-upload-postcondition.test.ts 验证更新后的 selector |
| **Dedup keyword drift** (vendor 错误消息措辞变更, 例如 "already uploaded" → "file previously shared") | 用新 vendor 错误消息做测试 + 加到 DEDUP_KEYWORDS + 同步 test mirror + 加一行到 §0a.x.9.5 反例 |

<!-- F-RuleLifecycleMgmt: superseded_by = null ; supersedes = null ; effective_since = v10.7.9 lineage, finalized in v1.10.3 -->


#### §0a.x.9.8 Bridge 重连状态机 + Recovery Telemetry (v1.11)

适用范围: `app/native-server/src/control-state.ts` + `app/native-server/src/server/index.ts`。

**核心动机** (chatgpt Q1 D2 + v1.10.4 recovery telemetry 合并): bridge 在 extension reload / heartbeat-stale / process restart 时的状态对外不可见，导致 /health 健康检查只看 heartbeatAge 一个维度，无法判定"刚刚断过 → 正在重连 → 已恢复"。v1.11 引入 5 态状态机 + 3 个 recovery 计数器对外暴露。

**5 态 BridgeState (RFC §6.1.5)**:

| State | 含义 | 触发转移 (transition reason) |
|---|---|---|
| `DISCONNECTED` | 初始 / heartbeat-stale / process 刚启动未注册 | 默认初值；`heartbeat-stale` 转移至此 |
| `BACKOFF` | 重连退避中 (指数 backoff 准备下次重试) | `heartbeat-stale` 后 + 进入 backoff schedule |
| `RECONNECTING` | 正在尝试重连 (next attempt pending) | backoff 定时器触发后 |
| `CONNECTED` | heartbeat 收到，恢复连接 | `heartbeat-received` |
| `READY` | 业务可用 (与 CONNECTED 区别: READY 表示 service 内部 ready 状态) | 后续扩展预留 |

**RecoveryTelemetry 字段** (/health endpoint 对外暴露):

| 字段 | 含义 | 何时递增 |
|---|---|---|
| `reinitializeCount` | bridge 进入 `CONNECTED`/`READY` 且上一态不是已连接态 (即"完成一次重连") | `DISCONNECTED → CONNECTED`、`BACKOFF → READY`、`RECONNECTING → CONNECTED` |
| `lastReinitializeAt` | 上次重连完成时间 (epoch ms) | 同 `reinitializeCount` |
| `disconnectCount` | 进入 `DISCONNECTED` 累计次数 | 任何态 → `DISCONNECTED` |
| `lastDisconnectAt` | 上次断开时间 (epoch ms) | 同 `disconnectCount` |
| `backoffAttempts` | 进入 `BACKOFF` 累计次数 | 任何态 → `BACKOFF` |
| `lastBackoffAt` | 上次进入 backoff 时间 (epoch ms) | 同 `backoffAttempts` |

**transition trigger (production 实测)**:

| Trigger | Source 调用方 | 目标态 | 频率 |
|---|---|---|---|
| `init` | bridge 进程启动初始化 | `CONNECTED` (默认) | 一次性 |
| `heartbeat-received` | `/internal/heartbeat` HTTP handler (server/index.ts:622) | `CONNECTED` | ~60s |
| `heartbeat-stale` | registry 监控逻辑 (待 v1.11.x 接) | `DISCONNECTED` → `BACKOFF` | 按 stale threshold |
| `extension-reload-detected` | `observeHeartbeat` 检测 ownerId 变化 (reload-context.ts) | `RECONNECTING` | reload 时 |
| `restart` | bridge process restart 信号 | `DISCONNECTED` (reset counters) | 一次性 |

**/health endpoint 暴露字段**:

```typescript
{
  status: 'ok' | 'degraded',
  bridgeInstanceId: string,
  bridgeUptimeMs: number,
  extension: { id, version, heartbeatAgeMs, liveTargets } | null,
  bridgeState: BridgeState,        // v1.11 新增
  recovery: RecoveryTelemetry,     // v1.11 新增
}
```

agent 侧读 `/health` 判读规则:
- `bridgeState === 'connected' || bridgeState === 'ready'` → 服务可用
- `bridgeState === 'reconnecting' || bridgeState === 'backoff'` → 服务刚断过，正在恢复 (看 `recovery.lastDisconnectAt` 判定何时断)
- `bridgeState === 'disconnected'` 且 `recovery.disconnectCount > 0` → bridge 当前没收到 heartbeat，需 reload extension
- `recovery.reinitializeCount > 0` → bridge 已多次自动恢复，根因可能是浏览器 extension 不稳定 (应报 incident)

**反例 / 教训** (chatgpt v1.10.4 feedback):

- ❌ 之前 /health 只给 boolean + heartbeatAge，无法区分"刚启动未连" vs "运行中断过" vs "一直在重连"
- ❌ 重连次数未对外暴露 → 用户看不到 reload 风暴的实际严重度
- ❌ 没有状态机时，agent 看到 `bridgeUptime < 60s` 误判"刚重启"，但实际是「心跳超时 → 自动恢复」后只重启了 1s timer

**与 §0b / §0d / §10 的关系**:

- §0b: §0b.7.8 #2 重载后 read 类立即可用 / write 类要等 — 此节是新维度"状态机 + counter"补强
- §0d: 事故态接力时若 `recovery.reinitializeCount` 频繁递增 → 写入 incident kind="extension-instability" 推荐
- §10: 半年内同类 `extension-instability` >= 3 次 → 升级永久审计 (按 §10 复盘流程)
- §0a.x.9: 仅 §0a.x.9 的补充，不影响现有 cross-vendor dedup 决策表

**Ref**: `docs/rfcs/2026-08-02-mcp-session-soft-degradation.md §6.1.5` (chatgpt Q1 D2 路线)。

### §0a.x.9.9 v1.11.2 EPIPE / ECONNRESET suppression (postmortem)

> **[dormant]** (2026-08-13 mark) — 本章节规则的注入路径 (`chrome_type` / `chrome_upload_file` / `chrome_javascript` / `chrome_keyboard`) 依赖 §0b.1 #2 mcp-chrome (HTTP) 工具集。
> 当前 `~/.codex/config.toml` 仅注册 `[mcp_servers.chrome-devtools]` + `[mcp_servers.node_repl]`,无 `mcp-chrome` 入口。
> Agent **不应**主动调用本节规则;若 web AI 对话框注入被明确要求,需先恢复 mcp-chrome 注册或切 stdio 临时方案 (§0b.5 + §0b.6.5 注)。

适用范围: `app/native-server/src/index.ts` (uncaughtException) + `app/native-server/src/native-messaging-host.ts` (`sendMessage()` 内部)。

**事故源头 (2026-08-10 21:11,Stage 1 verification 期间发现)**:
- v1.11.1 hotfix 让 bridge "stays alive for HTTP" after Chrome disconnect (commit 5c11741)
- 但 Node.js 的 `stdout` pipe 不会因为对端关闭而自动 close — 它仍然指向原来那个 broken pipe
- 下次 `sendMessage()` write 触发 `EPIPE: broken pipe, write`
- `index.ts:30` 原 uncaughtException handler 调 `process.exit(1)` → **bridge 死亡**
- **latency**: 这个 bug 自 2026-08-01 一直在 stderr (几十个文件,几千次 EPIPE) — 之前因为 bridge 在 `cleanup()` 立刻 `process.exit(0)`,EPIPE 还没机会触发;v1.11.1 让 bridge 长活反而把这个 latent bug 暴露

**修复策略 (v1.11.2, commit b3e88d3)**:
- 两层防御 (defense in depth):
  1. `app/native-server/src/index.ts` uncaughtException handler 加 transientCodes Set (`EPIPE` / `ECONNRESET` / `ENOTCONN` / `ERR_STREAM_DESTROYED`),命中时只 stderr log + return,不 exit; 其它 error (TypeError 等) 仍然 `process.exit(1)`
  2. `app/native-server/src/native-messaging-host.ts` `sendMessage()` 加 `isTransientPipeError()` helper; `stdout.write()` 的 callback 和外层 try/catch 命中时 silently return,不冒泡到 uncaughtException
- `app/native-server/src/index.test.ts` (new): 4 jest tests via `child_process.spawn` 跑 mirror handler,验证:
  - EPIPE → exit code 0 (kept alive)
  - ECONNRESET → exit code 0 (kept alive)
  - TypeError → exit code 99 (regression guard, still fatal)
  - Error without `.code` property → exit code 99 (regression guard, still fatal)

**why suppress 而不是 retry**: stdout pipe 是 broken 不是 busy。retry 没用。suppress + log 让 bridge 继续 serve 现有 Codex session,等下次 Chrome reconnect cycle 自然复活。

**why suppress 这 4 个 code**: Node.js v20+ 文档把这 4 类都归为 "OK to ignore" 的 transient pipe error (对端关闭连接类)。同根因,一起处理。

**why stderr 不 suppress**: stderr 是 bridge 自己的诊断通道 (wrapper.bat 重定向到 `native_host_stderr_*.log`)。如果 stderr EPIPE (比如日志文件被 lock),那是真的 fatal — 不能 swallow,否则失声。

**Stage 2 verification (post-fix)**:
- /health polled every 10 sec for 5 min (30 samples)
- All 30: `bridgeState=connected`, `recovery.disconnectCount=0`, `reinitializeCount=1` (initial only)
- uptimeMs: 32s -> 322s (monotonic, no restarts)
- heartbeatAgeMs: cycling 9s-29s (within normal cadence)
- **PASS**: zero disconn deltas, zero dead samples, vs. v1.11.1 era "97 spawns in 5 minutes"

**与 §0b / §10 的关系**:
- §0b.7.8 #3 fallback 推荐方向未变 (HTTP 仍首选,stdio 仍禁用)。v1.11.2 只是让 HTTP keep-alive 真的稳定
- §10: 此次发现是 **M2 工具环境层**事故 (`kind=extension-instability`)。虽未达 §0.f.2 FATAL,但暴露了 v1.11.1 lifecycle hotfix 的盲点。建议**下一次同类 hotfix 必须做 "stays alive + error path" 双重分析**,不能只看 happy path
- §0.f.3 优先级判定: 半年内同类 extension-instability >= 3 次 → 永久审计。当前阈值未触发 (此为首次 v1.11.x 系列的 extension-instability)

**known follow-ups (已写进 v1.11.2 CHANGELOG,待 chatgpt 评审后处理)**:
- Q3: orphan 进程内存累积 (每 restart 留 ~50MB)
- Q6: wrapper.bat 退出但 bridge 还可能存在 (orphan 桥)
- Q4: MCP StreamableHTTP close-after-response 行为需测
- Q5: bridge graceful shutdown 信号 (SIGUSR1 等)

**Ref**: v1.11.2 commit `b3e88d3` + tag `v1.11.2` on `work/zamelee-bootstrap` (2026-08-10 22:55 推送 origin)。


<!-- F-RuleLifecycleMgmt: superseded_by = null ; supersedes = null ; effective_since = v10.8.x -->

### §0a.x.11 post-receive response completeness validation (防止 summarize-truncation 反例)

**问题 (2026-08-15 storyforge-server 反推 + SSE 流式调研反例):**

向 ChatGPT / Gemini 提问多 Q (例如 Q1/Q2/Q3/Q4) 后, summarize 时 必须验证 chatgpt 是否真的把每个 Q 都答了。实测反例: ChatGPT 回答到 Q3 就进入"最终三个拍板"表格, 没有单独答 Q4 — 但 Agent 看到 Q2 内部 Check 5 涉及 `include_usage`, 推断 Q4 默认 ON, 然后在 summarize 里**伪造一个独立的 "Q4 — 默认 ON" 段**, 用户质问"截断发送"才意识到。

**判别诊断 (post-receive 三轨):**

| 检查 | 方法 | 不通过怎么办 |
|---|---|---|
| 1. 提问计数 vs 回答计数 | summarize 前正则 `matchAll(/(?:Q\d+|第.问|第\d+)/g)` 提问侧; 同样正则扫 chatgpt 回答侧; 比较集合 | 不通过 → 重新 fetch chatgpt 完整回答 (snapshot 可能截断); 或二次提问补全缺失 Q |
| 2. 截断信号 | 扫描末尾 200 chars 是否含 `...` / `等等` / `继续` / `let me continue` / `I'll explain` / `next: ...` / `<!--more-->` | 命中 → 不总结, 先 fetch 完整回答 |
| 3. 拍板总表 vs 标题数 | 如果用户要求 "请按之前格式答 Q1-Q4", chatgpt 回答应该有 4 个 H2/H3; summarize 前 grep `<h[123]>` | 不匹配 → 列缺失 Q, 明确告知用户 |

**硬约束 (新增, v10.8.x):**

- **summarize 时禁止伪造 chatgpt 没回答的 Q** — 即使 Q4 的"正确"答案可以推断出来, 也必须写"chatgpt 未单独答 Q4 (我推断: ...)" 或 "Q4 是从 Q2 Check 5 推断, 不是 chatgpt 直接拍板"。
- **截断怀疑时**: 立即停手 summarize, 重新 fetch 完整 chatgpt 回答 (页面 snapshot + `document.querySelector('[data-message-author-role=assistant]').innerText`), 再总结。
- **实测: chatgpt 长回答经常**在 H3 表格 / 大代码块后停在 8000-9000 chars, 不会自动继续。Agent 看到 "最终三个拍板" 表格就要怀疑"是否漏了 Q"。

**反例 (2026-08-15 真实案例):**

- 提问 Q1 (JSON detection) + Q2 (SSE probe) + Q3 (early-abort saving) + Q4 (include_usage 默认?)
- ChatGPT 实际回答: Q1 完整 / Q2 完整 (含 Check 5 include_usage, 但属于 Q2 内容) / Q3 完整 / Q4 未单独答
- Agent summarize 输出: "Q4 — 默认 ON" (凭空捏造, 实际是 Q2 Check 5 推断)
- 用户第一次反馈"截断发送"才暴露问题

**incident.kind = "chatgpt-response-truncated-pretending-complete"** (新增 v10.8.x):

```
{
  kind: "chatgpt-response-truncated-pretending-complete",
  ts: "<ISO8601>",
  evidence: {
    type: "system-error",
    text: "summarize 时 X 个 Q 缺失, Agent 推断补全. 提问侧 Q 数: N, 回答侧 Q 数: M, M < N. 缺失 Q: [Q1, Q2, ...]",
    ts: "<ISO8601>"
  }
}
```

**与 §0a.x.10 区别**: §0a.x.10 是"提交后", 检测 chatgpt 是否 ACK + 是否 streaming; §0a.x.11 是"接收后", 检测 chatgpt 回答是否**完整覆盖提问**。

**与 §0a.6 区别**: §0a.6 是 "Gemini 端模型语义丢失"; §0a.x.11 是 "Agent summarize 时截断 / 遗漏", 与 chatgpt 端无关, 是 Agent 自身失误。

**反例 (用户已反馈, v10.8.x 沉淀):**

- 看到 chatgpt 答到 Q3 + "最终三个拍板" 表就以为完结, 跳过 Q4 验证
- summarize 时把 Q2 Check 5 内容"升格"为独立 Q4 拍板
- 缺: 提问前先在本地记录预期 Q 列表 (e.g. `expected_questions = ['Q1', 'Q2', 'Q3', 'Q4']`), 回答后逐项验证

**F-RuleLifecycleMgmt**: effective_since = v10.8.x, supersedes = null

**下次复盘 checklist (避免同类 bug)**:
- [ ] 任何 lifecycle-changing hotfix 都要搜 stderr 找 latent 异常码 (这里 EPIPE 早就有几千次,但 v1.11.1 的 keep-alive 才让它致命)
- [ ] 涉及 process.on(uncaughtException) 的代码 change,review 时必须加 unit test 用 `child_process.spawn` 验证 error path
- [ ] Node.js stream 写 closed pipe 时 throw EPIPE — 任何 stdout.write callback + outer try/catch 都必须能 handle
### §0a.x.10 提交后 watchdog (post-send submit-ack watchdog, v5 新增)

**核心问题**:pre-send 3 轨全过 (§0a.x.4.1) + 点击 send 后,chatgpt.com 可能进入 **"前端接收点击但 React state 未同步"** 状态 (composer 不清空、user-bubble 不出现、stop-button 不出现、无 fetch) — **SHA-1 + send-button attrs 只证明 DOM 同步,不能证明 React state 同步** (React 18 useSyncExternalStore 与 ProseMirror 集成缺陷)。

→ watchdog 是检测器,不是修复器。检测到 SUSPECT_HANG 后由 adapter 决定下一步 (chatgpt 可 hybrid fallback 一次,page-stuck 则 halt + escalate)。

**§0a.x.10.1 状态机 (vendor-neutral core):**

SUBMIT_PENDING (ACK timer 运行)
  - composer 清空/替换          → ACCEPTED
  - 新 user-bubble 出现          → ACCEPTED
  - streaming 立即出现            → STREAMING (implicit ACK)
  - ACK timer > 2s              → SUSPECT_HANG
  - ACK timer > 5s              → SUSPECT_HANG + ESCALATED (screenshot + incident)

ACCEPTED (generation timer 运行, NOT yet STREAMING)
  - streaming started            → STREAMING
  - no streaming yet:
       < 30s  → waiting
       30s    → WARN
       60s    → STALLED (stallPhase=generation-start)

STREAMING (progress timer 运行, 重启 on each text growth)
  - text growth                  → progress (reset timer)
  - no observable activity:
       < 10s  → normal
       10-30s → suspicious
       30-60s → WARN
       60s    → STALLED (stallPhase=streaming-progress)

**CRITICAL**: 2s 是 ACK deadline,**不是 generation-start deadline**。两个独立 timer,两个不同时钟测两件事 (submit ACK vs generation startup)。实测 (A/B/C/D/E) 2s 远高于实测 390-1293ms ACK latency。

**§0a.x.10.2 ACK predicate (多信号 OR):**

submitAck =
    composer cleared (textLen = 0)
 OR composer replaced (identity changed)
 OR newCurrentUserMessage (count delta vs before-click snapshot)
 OR currentConversationStreamingStarted (stop-button appeared)

NOT stop-button alone as independent ACK signal — stop-button 是 STREAMING evidence,不是 submit ACK 自身。

**§0a.x.10.3 progressObserved (CORE 计算, 不是 adapter):**

拍 STREAMING entry 时的 baseline:
  streamingStartObs = currentSnapshot  // textLen=0 (新消息刚开始)

progressObserved =
    currentObs.assistantTextLen > streamingStartObs.assistantTextLen
 OR currentObs.assistantIdentity changed (新 assistant message)
 OR currentObs.streamingReason changed (新活动类型)

**关键 gotcha**:不要用 beforeObs (click 之前的) 当 progress baseline — beforeObs 的 assistant.textLen 是**上一轮回复**的字符数 (e.g., 5500+),新回复从 0 开始,**永远 < 上一轮**,progress 永远检测不到。**必须用 STREAMING entry 时的 snapshot**。

**§0a.x.10.4 已知失败模式 (chatgpt 玄学 BUG):**

| 现象 | 真因 | 处置 |
|---|---|---|
| SUSPECT_HANG (click 后 2s 无 ACK) | ProseMirror + React 桥接问题 / chatgpt 后端慢 | adapter-specific hybrid fallback 1 次 |
| Page-stuck (no send-button + no stop-button + composer 无响应) | chatgpt 内部调度卡死,需刷新 | **NO auto-retry**,halt + escalate to user (刷新决策) |
| STALLED generation-start (60s no streaming) | chatgpt 后端/queue/transport | incident 写入,no retry (同 SUSPECT_HANG 但根因不同) |
| STALLED streaming-progress (60s no text growth) | 流中断/render 卡死 | 同上 |

**§0a.x.10.5 watchdog 不 auto-retry + 不 auto-refresh 的原则:**

- 检测 ≠ 修复 (per chatgpt 第一次 review: "watchdog's job is detection, not recovery")
- 不要自动点 stop-button (selector race / 误 abort 真实成功请求)
- 不要自动刷新页面 (会丢用户状态,掩盖原始 evidence)
- 修复决策交给 adapter 或 user

**§0a.x.10.6 架构边界 (per plan v5):**

CORE (_webai_submit_ack.mjs, vendor-neutral):
  - observation (re-resolve scope each cycle)
  - before/after snapshot orchestration (stable observable facts)
  - progressObserved 计算
  - ACK predicate (单一规则)
  - state machine + 两个独立 timer + state/deadline token (no stale setTimeouts)
  - timeout/progress accounting (configurable)

VENDOR ADAPTER (_chatgpt_submit_ack_config.mjs):
  - resolve scope → main element (chatgpt; NOT [role=main])
  - locate elements within scope
  - classify network events
  - translate vendor UI → normalized evidence (getStreamingState → {active, reason})
  - failureMode classification (page-stuck vs input-pipeline, 当前为 placeholder)

核心架构规则:
- Core NEVER asks vendor-specific questions
- Core ASKS for normalized evidence only
- Adapter NEVER owns time/state semantics
- Adapter functions all take scope parameter (no scope-less)

**§0a.x.10.7 工具位置:**

所有 production tools 在 storyforge-server/tmp/_chrome_test/ (跨项目引用,见 §8):
- _webai_submit_ack.mjs (core watchdog)
- _chatgpt_submit_ack_config.mjs (chatgpt adapter)
- _chatgpt_keyboard_path.mjs (hybrid inject helper)
- _run_experiment_A.mjs ... _run_experiment_E.mjs (5 个验证测试)

**§0a.x.10.8 Incident kind schema (per §0c.1 union type):**

- submit-not-acknowledged — SUSPECT_HANG (input pipeline issue), evidence: pre/post snapshots + sha1 + button attrs + elapsedMs + screenshot
- submit-acknowledged-stalled — STALLED, stallPhase: "generation-start" | "streaming-progress", evidence: 同上 + streamingState history
- 未来: page-stuck failureMode (当前未触发,留作 §10 P1 round)
**§0a.x.10.9 P1.5 Network telemetry (v3.2):**

- **Core 持续订阅** 4 个 CDP 网络事件: requestWillBeSent / responseReceived / loadingFailed / loadingFinished, 全部进 ring buffer (cap 1000, 超过截断末 500)。
- **Adapter 分类** 每个事件: 用 URL 正则匹配是否属"我们的" generation request。**chatgpt.com 实际 URL 模式** = /backend-api/f/conversation (有 /f/ 前缀, 不是裸 /backend-api/conversation)。错误正则会导致 0 events 捕获。
- **Kind 分类**: generation_request (POST sent) / generation_response (200 OK) / generation_error (4xx-5xx) / other (其它)。
- **Incident 携带**: SUSPECT_HANG / STALLED 触发时, evidence.relevantNetworkEvents 包含 clickTime 之后所有 cls != null 的事件。

**§0a.x.10.10 P1.6 failureMode + page-stuck detection (v3.2):**

失败模式分 2 类:

| failureMode | 含义 | 决策依据 |
|---|---|---|
| input-pipeline | ProseMirror + React bridge 同步失败 | focus probe 仍响应 (composer 接受 focus) |
| page-stuck | chatgpt 内部调度卡死 | focus probe 失败 OR composer 找不到 OR heap > 500MB |
| unknown | 信号不足 | 默认 fallback |

**focus probe 逻辑** (in probeFailureSignals):
1. composer.focus() 取焦点
2. composer.blur() 释放焦点
3. document.body.focus() 试聚焦 body
4. composer.focus() 再聚焦 composer
5. 如果最后 composer 是 activeElement -> responsive; 否则 stuck

**Heap 阈值**: 500MB 视作 page-stuck (经验值)。可用 telemetry 调整。

**Adapter 行为分流** (chatgpt-specific):
- failureMode = input-pipeline -> 1 次 keyboard path 重新注入 (max 1 retry/prompt)
- failureMode = page-stuck -> NO retry, halt + escalate to user (刷新决策)
- failureMode = unknown -> 走 input-pipeline + 已未知 tag

**§0a.x.10.11 实测数据 (P1.5 + P1.6 验证, 2026-08-14):**

跑了 4 个测试 (Test F minimal / F3 / F4) 在 337-4746 chars 范围 + chatgpt.com 当前 UI:

| Test | Prompt | ACK | 网络事件 | relevant 事件 | SUSPECT_HANG |
|---|---|---|---|---|---|
| F minimal | 337 chars | 410ms | 0 (cancel before) | 0 | none |
| F3 | 1525 chars | 440ms | 51 | 5 | none |
| F4 | 4746 chars | ~280ms | 57 | 5 | none |

**关键发现**:
1. P1.5 网络 telemetry 端到端验证: 5 relevant events 在 Test F3/F4 都被正确捕获 + 分类 (generation_request / generation_response 200 + mimeType text/event-stream = 流式响应)。
2. chatgpt.com 当前 UI 在 4746 chars + Input.insertText 单调用下**不触发 SUSPECT_HANG**。原 "occurs at > 2000 chars" 假设在当前 chatgpt 实现下不能复现 (可能是 chatgpt 内部已经修复了 useSyncExternalStore 同步问题)。
3. Watchdog 状态机正确: SUBMIT_PENDING -> STREAMING transition 在 280-440ms (远低于 2s threshold)。
4. failureMode 分类代码就位但**未触发** (因为 SUSPECT_HANG 本身未触发)。当 SUSPECT_HANG 真发生时, probe 会自动跑 + 分类。

**§0a.x.10.12 实测发现 chatgpt 当前 URL 模式修正:**

实验用 _probe_network.mjs 捕获的 chatgpt.com 实际请求 URL:

- POST /backend-api/f/conversation/prepare (pre-flight, 200)
- POST /backend-api/f/conversation (主生成请求, 200 text/event-stream)
- POST /backend-api/sentinel/chat-requirements/prepare (200)
- POST /backend-api/sentinel/ping (200, 多次)
- POST /backend-api/sentinel/chat-requirements/finalize (200)
- POST /backend-api/lat/r (latency 报告)
- POST /backend-api/beacons/event (analytics)
- POST /ces/v1/t (CES tracking)
- POST /ces/v1/rgstr (register)
- POST /ces/v1/m (more CES)

**Adapter regex 必须 match**: /backend-api/(?:f/)?conversation(?:/)? (即允许可选的 /f/ 前缀)。

<!-- F-RuleLifecycleMgmt: superseded_by = null ; supersedes = null ; effective_since = v10.14.5 -->

### §0a.x.10.15 Pre-send state probe + post-send monitor (避免"已答却重发"陷阱)

适用范围: 任何 chatgpt / gemini / claude 网页 AI 的 send 前 + send 后立即探针。沉淀自 2026-08-24 storyforge-server Round 4 真实连环坑 (type_text Enter 触发 → 部分 prompt 自动 send → 我没 monitor → 继续 "修正" 重发 → chatgpt 答 2 次,我只看了第 2 次,第 1 次被忽略)。

**核心问题**: §0a.x.10 (post-send watchdog) 检测 ACK + streaming,但**不覆盖"send 实际已发生但 Agent 不知道"** 的失败模式。当 type_text D 路径模拟物理 Enter 触发 send (per §0a step 3 D 禁令),Agent 可能不知道 send 已发生,继续 "修正" 文本,导致**同一问题被 send 2 次**,chatgpt 答 2 次,但 Agent 只看后一次,token 浪费 + 第一答丢失。

**Pre-send probe (mandatory before ANY send click)**:
1. JS 探针: assistantBubbles.length 与 userBubbles.length
2. 若 lastAssistant 已存在 + 对应 lastUser 是我刚才发的 (含 partial 或完整) → DO NOT send corrective;先读 reply
3. 若 chatgpt 还在 streaming (lastAssistant 文本增长中) → WAIT, 不要堆叠 send
4. 若 userBubbles.length > assistantBubbles.length + 1 → 之前有未答 user message,不要重发

**Post-send monitor (immediately after click 或 accidental Enter)**:
1. composer 应清空 (composer.innerText.length === 0)
2. userBubblesCount 应 +1
3. 若 userBubblesCount 没变 → send 实际没发生,检查 send button (disabled === false / aria-disabled !== 'true' / offsetParent !== null per §0a.x.4.1)
4. 若 composer 没清空 → 可能有 2 行残留 (per §0a.x.2.4 ghost text),清空但**不要重发**,等 chatgpt 处理现有消息

**误触 Enter recovery (实测 2026-08-24 Round 4)**:
- 触发场景: type_text 含 \n → 模拟物理 Enter keystroke → 自动 submit
- 立即跑 post-send monitor:发现 userBubbles 已 +1 (确认 send 真的发生了)
- **不要**立刻 Ctrl+A + Delete + 重发 (这是 §0a step 3 D 禁令的反模式陷阱)
- 读 lastAssistant reply — chatgpt 即使收到 partial prompt 也可能猜出意图 (实测: Round 4 reply 1 在仅 "_chatgpt_round4_prompt.md文件请读上面两个附件:" 部分 prompt 下仍产出 6988 字符结构化答案)
- 仅当 reply 不满意时,才考虑 follow-up (用 follow-up 而不是 retry — 不要重发同一问题)

**Pre-send check 探针模板** (chatgpt ProseMirror):
```javascript
// 必须 send 前跑 (per §0a.x.4.1 + 本节叠加)
const userBubbles = document.querySelectorAll('[data-message-author-role="user"]');
const assistantBubbles = document.querySelectorAll('[data-message-author-role="assistant"]');
const lastUserText = userBubbles[userBubbles.length - 1]?.textContent?.substring(0, 100) || null;
const lastAssistantText = assistantBubbles[assistantBubbles.length - 1]?.textContent?.substring(0, 100) || null;
return {
  userCount: userBubbles.length,
  assistantCount: assistantBubbles.length,
  lastUserText,
  lastAssistantText,
  // 关键判定: userCount > assistantCount 表示有 user message 没答
  unanswered: userCount > assistantCount,
  // 关键判定: assistantCount >= userCount 表示所有 user message 都已答
  allAnswered: assistantCount >= userCount && userCount > 0
};
```

**反例 (本次真实案例 2026-08-24 Round 4)**:

| # | 现象 | 真因 | 修复 |
|---|---|---|---|
| 1 | type_text 含 \n → 部分 prompt 自动 send | §0a step 3 D 禁令违反 (我明知 type_text 含 \n 会自动 submit 还用了) | §0a step 3 D 路径已禁,本节补充 post-send monitor 兜底 |
| 2 | send 已发生但 Agent 不知道,继续 "修正" 重发 | 无 pre-send probe 规则 | 本节新增 pre-send probe |
| 3 | chatgpt 答 2 次,Agent 只看后一次,第一答被忽略 | 无 post-send 状态记录 | 本节新增 post-send monitor |
| 4 | click uid=15_3728 以为 send button,实际是 "开始听写" | snapshot uid 不稳定,chatgpt 行动 button 应走 data-testid | §0a.x.2.x.5 增强 — chatgpt 行动 button 必须用 data-testid selector |

**与既有规则的关系**:
- **§0a.x.10**: 检测 submit-ack + streaming;本节检测 "send 真的发生了吗" + "chatgpt 已答了吗"
- **§0a.x.11**: 检测回答完整性 (Q1-Q4 都答了?);本节检测 "send 前 chatgpt 已答过类似问题吗"
- **§0a.x.4.1**: pre-send 3 轨 (sha1 + send button attrs);本节是更高一层 "状态探针"
- **§0a.1 quill-gun**: 60s 内 ≥2 次相同前缀提交触发熔断;本节更细粒度 — 任何重发前先读已有 reply
- **§0c.2 handoff probe**: 接管对话时用 total%2 + lastRole 判定;本节是 send 时版本
- **§0a.x.2.x.5 (新增)**: chatgpt 行动 button (send / attach / voice) 必须用 data-testid selector,不走 a11y uid (uid 不稳定,可能指错元素)

(v10.14.5 patch: F-PreSendProbe §0a.x.10.15 — 沉淀 2026-08-24 Round 4 type_text Enter 触发的"send 不知道已发生 → 重发 → 第一答丢失"连环坑; 真实案例 + 4 行反例表 + Pre-send probe 模板; 与 §0a.x.10 / §0a.x.11 / §0a.x.4.1 互补但职责分离)

### 0a.x.17 React 18 controlled input + long content must use type_text (v10.14.8 patch, F-ReactControlledInput)

**Problem**: chrome-devtools-mcp's `fill` tool on a React 18 controlled textarea (e.g. github.com/copilot's `#copilot-chat-textarea`) triggers **React state desync**: DOM `.value` has content but React `memoizedProps.value` is empty string. Result:
  - Send button **does not render** (`offsetParent === null` not because disabled, the node does not exist at all)
  - Enter fires React onKeyDown reading React state.value === '', submit fails
  - Composer clears (React re-render pulls DOM back to React state)
  - Long content (>1500 chars) never posts

**Empirical evidence (2026-08-29, B-2 D2)**:
  - Real github.com/copilot + 3925 chars test:
    - `fill` path: `DOM.value=3971`, `React memoizedProps.value=0`, Send button not rendered
    - `type_text` path (CDP `Input.insertText`): `DOM.value=3925`, `React memoizedProps.value=3925`, Send button visible + enabled

**Root cause**: puppeteer `element.fill()` dispatches input event without `inputType=insertText`, React 18 synthetic event system ignores it. CDP `Input.insertText` carries `source='user'` + `inputType=insertText'`, React trusts and onChange syncs state.

**Fix path** (src/tools/input.ts + tests/tools/input.test.ts):
  1. **Primary**: long content (>=1500 chars) or known React 18 controlled vendor -> use `type_text` (CDP `Input.insertText`)
  2. **Fallback**: short content / plain textarea / known non-controlled vendor -> `fill` retained
  3. **Helper**: `fillReactControlledInput(page, opts)` auto-picks by (length, vendor) + post-fill verifies React memoizedProps.value === textarea.value

**Vendor decision table**:

| Vendor | Editor | Path | Notes |
|---|---|---|---|
| github.com/copilot | `<textarea id="copilot-chat-textarea">` (React 18 controlled) | **type_text** | long content must; short content also prefer type_text |
| chatgpt.com | `<div id="prompt-textarea" contenteditable="true">` (ProseMirror) | type_text | **fill BROKEN (Item 3 empirical 2026-08-29)**: ProseMirror collapses ALL newlines into 1 paragraph on fill path - 3926-char test became 1 paragraph with 0 newlines vs type_text 14 paragraphs / 63 newlines preserved. path C already used; threshold may need to be lower than 1500 for chatgpt since ProseMirror newlines handling breaks regardless of length |
| gemini.google.com | `.simplified-file-uploader input.hidden-file-input` (Angular) | fill OK | Angular listens to input event regardless of inputType |
| Plain `<input>` / `<textarea>` (no controlled) | -- | fill OK | React onChange filter not triggered |

**Post-fill probe template** (option 3):
```js
() => {
  const ta = document.getElementById('copilot-chat-textarea');
  const reactKey = Object.keys(ta).find(k => k.startsWith('__reactFiber'));
  let reactValue = null;
  if (reactKey) {
    let fiber = ta[reactKey];
    let depth = 0;
    while (fiber && depth < 30) {
      if (fiber.memoizedProps && fiber.memoizedProps.value !== undefined) { reactValue = fiber.memoizedProps.value; break; }
      fiber = fiber.return; depth++;
    }
  }
  return { domLen: ta.value.length, reactLen: reactValue && reactValue.length, sync: ta.value === reactValue };
}
```

**Relation to existing rules**:
  - sec 0a step 3 path C (`type_text` via CDP Input.insertText): this section is that path's application on React 18 controlled vendor
  - sec 0a.x.4.1 Send Guard: this section adds a pre-fill gate (React state must sync after fill)
  - sec 0a.x.10.15 Pre-send probe: this section is the symmetric pre-fill version (probe after fill, not before send)

<!-- F-RuleLifecycleMgmt: superseded_by = null ; supersedes = v10.14.7 ; effective_since = v10.14.8 -->








### 0b.7 Chrome 调用顺序契约（snapshot 优先 / screenshot 奢侈化 / DevTools 精细化）

约束 Codex 在所有 Chrome 调度场景下的读 / 写顺序，避免 LLM 不必要地消耗截图 token。screenshot 不是默认动作，是奢侈品。

**核心原则 1 — snapshot 优先**：
- 默认用 `chrome-relay snapshot` 作为读操作第一步。它产出结构化文本 + `@ref`，token 量级低，LLM 可直接消费成"点击 / 填入 / 滚动"等动作。
- 一律先用 snapshot 摸清页面结构 / 节点 / 状态，再判断是否需要 screenshot。
- snapshot 不开 console / network 也不动 DOM，纯读，不破坏 §0a / §0d 锁定态。

**核心原则 2 — screenshot 按需**：
- 仅在以下视觉验证必要时才生成 screenshot：
  - 需要看 UI 渲染效果（颜色 / 排版 / 动效 / 截图富媒体）
  - snapshot 表达不了的状态（canvas / SVG 内容 / 复杂动画进行中）
  - 用户明确要求"看一眼"或"截给我看"
- 单次任务只截必要的 panel / 区域，不要"整页全截"。
- 输出绝对路径 PNG（如 `_v10_2_fig2_wal.png`）给用户直接查看；不要把 PNG 再丢回 LLM 上下文。

**核心原则 3 — DevTools 精细化**：
- 当 snapshot + screenshot 都不够时（如需看 console log / network trace / 性能 profile / heap snapshot），用 chrome-devtools-mcp 或 chrome-relay `js` 注入做精细 DOM / 调试。
- 不要"为截图而截图" — screenshot 解决不了 timing / state / dynamic DOM。
- console 报错 / network 失败 / heap snapshot / Lighthouse 等必须走 DevTools（按 §0b.1 第 3 项定位）。

**核心原则 4 — 不向 LLM 喂原始截图**：
- screenshot 仅在用户或会话显式要求时才生成；不要"顺便看一眼然后丢回 LLM 上下文"。
- 截图是给**人**看的强证据，不是给模型再处理的输入；喂截图进 LLM 是 §0b 价值的反模式（v10.2 沉淀，避免 §0b.4 debug-spree 复发 — 历史教训：Gemini 在 9222 debug 中曾跑出 9m46s 无结论，靠纯截图探针而非真诊断）。

**核心原则 5 — 默认 flow（顺序硬约束）**：
- **读顺序**：`snapshot → (按需) screenshot → (精细) DevTools`。读多写少时，screenshot 几乎不开。
- **写顺序**：遵循 §0a 的 Quill 5 步走，不在本节重复。
- **调试顺序**：`DevTools → (按需) screenshot → snapshot`。多用于排错事故。
- **证据顺序**：先 §0d 锁定 tab → snapshot 摸清现场 → 按需 screenshot 留底 → 上报用户并写入 `incident.evidence`。

**与 §0b 调度层的契约**：
- 入口：所有 Chrome 操作仍走 §0b.1 调度优先级（Chrome Relay 1 > vendor 扩展 2 > chrome-devtools-mcp 3 > Playwright 4 > web_search 5）。
- §0b.7 仅约束**拿到 Chrome 后**的内部读取顺序，不代替 §0b.1 的工具选择。
- 与 §0d（多 Codex 会话 Tab 锁定契约）：**先锁 → 再读**，锁完前不进 snapshot。
- 与 §0b.4（故障处理）：截图用于弹窗 / 崩溃 / Allow 超时的事故取证；不用于普通导航。

**反例 / 警告**：
- 反例 1：每次 Chrome 操作都先 `screenshot` 喂给 LLM → 单任务可能产生 10+ 张截图，token 浪费巨大且不必要。
- 反例 2：用 screenshot 检查"表单是否已填上" → 这种用 §0a.5 JS 探针判 textContent 即可，不需要视觉。
- 反例 3：用 screenshot 检查"console 报错" → 截图看不到 console，必须 DevTools captureConsoleMessages。
- 反例 4：误以为 screenshot 越多证据越强 → 真实诊断力 = 结构化探针 + JS evaluate，而非视觉。
- 反例 5：把 mermaid SVG 截图发给 LLM 让它"理解图意" → 图意已经在源码 / node label 文本里；SVG 是给人看的，不是给模型再推理的。

**与既有规则的关系**：
- §0a：Quill 输入流程的 5 步仍生效；screenshot 不替代 §0a.4 的 sha1+innerText 完整性校验（v10.6 升级，已弃 textContent 容差 -5 路径）。
- §0b.2：调度原则（失败可解释 / 不退化到裸协议 / 不抢活）继续生效，本节不代替。
- §0b.5：Chrome Relay 安装与调度契约仍生效；本节补充"拿到 Chrome 后如何使用 snapshot / screenshot 顺序"。
- §0c：AI 对话持久化的 URL 仍依赖 snapshot 拿到 url / title，screenshot 是补底而非首选。
- §0d：tab 锁定流程**前置**于本节读取；锁不住 tab 谈何读。

<!-- F-RuleLifecycleMgmt: superseded_by = null ; supersedes = null ; effective_since = v10.2 -->
（v10.2 patch：F-ChromeOrder §0b.7 — 沉淀用户反馈"先 snapshot → screenshot 按需 → DevTools 精细"）


<!-- F-RuleLifecycleMgmt: superseded_by = null ; supersedes = null ; effective_since = v10.4 -->
### 0b.7.6 已知怪象：in-app browser URL 显示截断 / file:// 解析（v10.4 patch，F-InAppQuirk）

Codex Desktop app 自带 in-app browser（`control-in-app-browser`，见 skills 列表）打开本地 file:// URL 时，观察到 **URL 栏显示怪象**：

- **真实文件路径**：`<dir>/_v10_2_render.html`（含 `/` 分隔）
- **in-app browser URL 栏显示**：`file:///C:/Users/.../<dir>_v10_2_render.html`（**缺 `/` 分隔符**）

这是 Electron / Chromium 内核的 file:// 协议解析怪象 + Codex Desktop URL bar 显示截断的组合产物，**不是真实文件系统路径被合并**。用 PowerShell `Get-ChildItem` / `Get-Item` 二次确认可证实：拼合后路径 `<dir>file.html`（缺斜杠）的文件**不存在**；含斜杠的 `<dir>/file.html` 才**真的存在**。

实际访问无问题（用户可点开页面读到完整 HTML），但 URL 显示误导。

**fallback 优先级**（按本节默认顺序，越上越省事，越下越稳）：
1. **本地一次性访问**：`file:///C:/Users/.../file.html` 直接用 → 接受 URL 栏显示怪
2. **本地多次访问 / 需要 CDN / 长 session**：起 `python -m http.server <port>` → `http://127.0.0.1:<port>/file.html`
3. **Codex 会话内预览 + 真实登录态**：chrome-relay navigate（按 §0b.1 调度层级）

**反例 / 教训**：
- **反例 1**：看到 in-app browser URL 怪以为是 path 写错了 → **不要被 URL 栏误导**，用 PowerShell `Get-Item <abs-path>` 二次确认真实文件存在
- **反例 2**：因为 URL 显示怪立刻切到 HTTP server → 引入额外 server 进程不一定必要，本地 + 一次性访问 file:// 完全够用（避免无谓的 §7 temp file 噪声）
- **反例 3**：截到 in-app browser 怪 URL 后跟 user 复述说"路径真的被合并了" → 是错的，要用真实文件系统访问核对再确认
- **反例 4**：把 in-app browser URL 错误当成 §0b 的 bug → 它是 Codex Desktop app 渲染层产物，不是 Codex Agent 的 bug；按 §11 fallback 走 file:// → http:// → chrome-relay

**与 §11 的关系**：
- **§11** 约束 Markdown 文本里的路径表达（forward-slash 强制）
- **§0b.7.6** 约束文件系统访问路径的显示 / 解析（file:// 显示怪 vs http:// 稳定）
- 两者不重叠，是不同范畴的 fallback —— §11 是输出格式契约，§0b.7.6 是已知怪象 + fallback 优先级

**与 §0d 的关系**：
- 多 Codex 会话共用 Chrome 时的 tab 锁定（§0d）只约束 Chrome tab，**不约束 in-app browser tab**
- in-app browser 是独立 Chromium 内核，跟 chrome-relay / chrome-devtools-mcp 完全分离
- 因此 in-app browser 的怪象不能用 §0d / §0b.4 故障处理流程处理，按本节 fallback 走

**内部测试方法**（v10.4 patch 沉淀）：
- 在 Codex Desktop in-app browser 实际访问，确认 URL 栏显示（不要用 PixPin 截图当 evidence，因为 PixPin 有 normalize bias）
- 真实文件存在性必须用 PowerShell `Get-Item` 二次确认
- `view_image` 工具绕过 Codex Desktop 渲染层，不能作 §0b.7.6 怪象证据

（v10.4 patch：F-InAppQuirk §0b.7.6 — 沉淀 v10.3 PixPin URL 反馈的 in-app browser 路径显示怪象，与 §11 互补但范畴不同）

### 0b.7.7 chrome_screenshot savePath 集成化(v10.7.7 patch, F-ScreenshotSavePath)

<!-- F-RuleLifecycleMgmt: superseded_by = null ; supersedes = null ; effective_since = v10.7.7 -->

`mcp__mcp_chrome__chrome_screenshot` 工具的 inputSchema **早已包含** `savePath?: string` 参数
(见 packages/shared/src/tools.ts + app/chrome-extension/entrypoints/background/tools/browser/screenshot.ts)。
之前 LLM 因为没看 inputSchema 重复发明 ad-hoc `save_shot.py` 脚本,本节固化正确用法。

**默认行为**:
- **不传** `savePath` 也不传 `savePng` → 返回 `{base64Data, mimeType}`,LLM 用 `view_image` 一次性显示,**零落盘**
- **传** `savePath` (绝对路径,forward-slash) → bridge 内部 `fs.writeFileSync` 写盘,**绕过 Chrome download API**,
  返回 `{filePath, size}`,**不返回 base64**
- **传** `savePng=true` → 走 Chrome download API,**可能弹 Save As 对话框**,已 deprecated,**严禁使用**

**v1.9.5 新增** — 非图片落盘用 `chrome_save_text`:

- **目标**:保存 assistant response / scraped text / 配置等纯文本到磁盘,**不弹 Save As**
- **API**: `chrome_save_text({ text, filePath, mimeType? })` → bridge 走 `prepareFile` 走 atomic write-rename
- **绝对禁用**:在 page context 用 `new Blob([text]); URL.createObjectURL; a.click()` 触发下载 — 100% 弹 Chrome Save As 弹窗
  (实测 2026-08-05 github copilot 抓全文时弹窗),即使 a.download + programmatic click 也走 Chrome download UI
- **替代**:任何 page content 落盘都走 `chrome_save_text` (text/binary) 或 `chrome_screenshot savePath` (image)


**核心原则**(对应 §0b.7 已有"screenshot 不是默认动作,是奢侈品"):
1. **默认零落盘** — 截图只用于 `view_image` 即时显示,不持久化,不污染 `tmp/_inspect/`
2. **用户决策可控** — LLM 显式 `savePath` 才存盘(场景:留给后续 commit / 报告证据 / 用户收藏)
3. **避免 ad-hoc 脚本** — LLM 严禁再写 `base64 → b64decode → open('wb').write + view_image` 这种序列;
   bridge `savePath` 一次性完成

**v1.9.5 新增** — `chrome_upload_file` 加 `verifyPostcondition` (默认 true):

- 痛点:chatgpt.com + github.com/copilot 上传后 chip 已显示但 agent 看不到 chip,误把上次上传遗留的 stale error toast 当成本次失败
  (实测 2026-08-05:copilot .md 上传被拒后,后续 .txt 上传 chip 已出现但 stale toast 仍在 DOM,agent 误判失败)
- 修法:upload 完成后 CDP `Runtime.evaluate` 跑 JS probe,采集 `input.files` + visible chips + visible errors
  → 返回 `{ status: 'succeeded' | 'rejected' | 'uncertain' | 'probe_failed', fileInputFiles, chipTexts, newErrors, reason }`
- 不弹窗、不阻塞 upload;probe 失败不 fail upload,只是 status=uncertain
- 显式 `verifyPostcondition: false` 可关闭 (CI 性能优化场景)

**反例 / 教训**(2026-08-01 实测):
- ❌ Ad-hoc Python 脚本 `save_shot.py`:每次跑 base64 decode + writeFile + view_image,
  污染 tmp/_inspect/ 一堆 PNG(且 tmp/_inspect/ 不在 git 仓库,用户看不见清理进度)
- ❌ `savePng=true` + CDP `Browser.setDownloadBehavior`:会触发 Chrome 的 Save As 弹窗
  (实测 2026-07-28 用户报告"刚刚又弹了一个下载框(保存文本)")
- ✅ `savePath='D:/Documents/.../x.png'`:bridge 直接 fs.writeFileSync,**绕过 Chrome download 弹窗**

**与既有规则的关系**:
- **§0a.2**: file:// URI 禁止(无关,savePath 是绝对文件系统路径,不是 file:// URI)
- **§11**: Markdown 引用路径 forward-slash — 给 native host 的 savePath 同理用 forward-slash
  (避免 Windows 反斜杠 escape 链)
- **§7**: pre-write backup before mutate-state — savePath 写文件前 LLM 要 §7 backup 目标路径
  (避免覆盖既有文件,尤其是用同一个 savePath 复用时)
- **§0b.7**: screenshot 是奢侈品 — `savePath` 是奢侈品里的"用户显式要留底"路径,
  不是默认动作,不是 fallback

(实施: packages/shared/src/tools.ts + app/chrome-extension/entrypoints/background/tools/browser/screenshot.ts 早已实现 savePath,本节只是文档化发现 — 之前因为没看 inputSchema 导致重复发明 ad-hoc 脚本)



### 0b.7.8 (空 — mcp-chrome 行为契约 已删除 per 2026-08-13 实际 config.toml 状态)

> 原 §0b.7.8 (reload / session / fallback / SESSION_EXPIRED 等 ~350 行 mcp-chrome 专属契约) 已整体删除。
> 原因: 当前 `~/.codex/config.toml` 不再注册 mcp-chrome 系列 (§0b.1 #2/#3)。
> chrome-devtools-mcp (§0b.1 #1) **没有** SESSION_EXPIRED / session / heartbeat 概念 (走 CDP,不是 extension 桥)。
> 历史归档: 参考 `D:\Documents\VibeCoding\mcp-chrome` 项目的 release notes。本文件不在 git 内,无可恢复 history。

### 0b.7.9 Chrome 上传方向 picker 防护契约 (F-UploadPickerGuard) (v10.14 patch, effective_since = 2026-08-20)

(2026-08-23 bump to v10.14.1 — added §0b.7.9.9 F-ChatgptDedup covering chatgpt.com own-UI dedup dialog vs OS native picker distinction)

<!-- F-RuleLifecycleMgmt: superseded_by = null ; supersedes = null ; effective_since = v10.14 -->

(2026-08-23 bump to v10.14.1 — added §0b.7.9.9 F-ChatgptDedup covering chatgpt.com own-UI dedup dialog vs OS native picker distinction)

适用范围: 所有浏览器 MCP 路径下的"上传附件到 web AI"操作 (chatgpt.com / gemini.google.com / copilot.github.com / 任何含 `<input type="file">` 的页面)。

本节是 §0b.7.7 的**对仗章节** — §0b.7.7 约束 save 方向 (screenshot / text → 本地文件, 禁弹 Save As), 本节约束 upload 方向 (本地文件 → 页面 `<input>`, 禁弹 native file picker)。两个方向共享同一个原则:**绕开 OS 对话框, 直接走 CDP / atomic write**, 不要让 Chrome 弹任何 native modal。

#### §0b.7.9.0 触发场景与现实风险

| 场景 | 风险 | 后果 |
|---|---|---|
| `mcp__chrome_devtools__upload_file` uid 锁到按钮 (不是 `<input type="file">`) | 工具 fallback 路径走 `Promise.all([waitForFileChooser, click])` 竞态 | native file picker 弹出, Agent 不知道, 等 3s timeout 后才报错; **用户必须手动关 picker, 继续按 Send 还会再弹** |
| Agent 自己 `click(uid)` 触发"上传"按钮未先 setup file chooser intercept | click 早于 intercept 注册 → 原生 chooser 直接可见 | 同上, 且更严重 (Agent 没有等 timeout, 直接往下走 → 上传没生效 + Send 后 user-bubble 空) |
| Agent 用 raw CDP / node REPL / puppeteer-core 25.x `keyboard.insertText` 写文件路径 | 路径被当文本注入, 文件从未真上传 | 上传失效, 但无 native dialog |

**核心约束**: Chrome 上传附件**永远不弹 native file picker**。这条比"上传成功"更重要 — picker 弹了等于 Agent 失去对该 tab 的控制权, 直到用户手动关。

#### §0b.7.9.1 5 条硬规则 (Agent 必须遵守)

1. **`upload_file` uid 必须直接锁定 `<input type="file">` 节点**。用 `take_snapshot` 看 selector 对应的 uid (例如 chatgpt `input#upload-files` / `input#upload-photos` / `input#upload-camera`, copilot per-component `input[type="file"]`), **不**走 fallback。
2. **调用前 `evaluate_script` 探针**: `document.querySelector('input[type=file][data-target]')?.files.length === 0` 确认 input 存在 + 初始空, 否则改 selector 重 snapshot。
3. **调用后立刻 `take_snapshot` + `list_console_messages`**: 检查是否出现 `[role="dialog"]` 含 `Choose File` / `Open` / `Select File` / `Browse` / `选择文件` / `浏览` / `打开` 等关键字 — 命中 → picker 一定弹了, **立刻走 §0b.7.9.4 恢复**。
4. **绝不**用 `click(uid)` 替代 `upload_file` 触发上传按钮; **绝不**走 `drag` / drop 模拟去触发文件选择 (chatgpt / copilot chip 不接受 drag-drop); **绝不**走 raw CDP `Input.dispatchMouseEvent` click on `<input type=file>` (那也会弹 picker)。
5. **绝不**用 puppeteer-core 25.x `keyboard.insertText` / `element.type()` / `chrome-devtools-mcp type_text` 写文件路径 — 路径被当文本注入, 不是真上传。

#### §0b.7.9.2 自感知 3 轨 (post-upload detection)

按信号可靠性递减, 任一轨命中 → 判定 picker 弹了或上传失败:

| 轨 | 信号 | 怎么感知 | 命中后处置 |
|---|---|---|---|
| **L1 DOM 探针 (最直接)** | 调用后 500ms `evaluate_script` 查 `[role="dialog"]` + 关键字 | `document.querySelectorAll('[role="dialog"]')` 含 `Choose File` / `Open` / `选择文件` / `浏览` 等 | picker 弹了 → 走 §0b.7.9.4 恢复 |
| **L2 input 状态 (验证生效)** | `document.querySelector('input[type=file]').files.length` 是否从 0 变 1; `input.value` 是否含文件名 | 文件没上去 = upload 失败 / picker 没收 / 没传对 input | 重做 `upload_file` 锁正确 selector |
| **L3 CDP 层 (最干净, 工具自带)** | `Page.fileChooserOpened` event 监听 + 拦截记录 | chrome-devtools-mcp `upload_file` 工具内部已埋 (§0b.7.9.5) | 工具自己报"intercept failed — picker may be visible" |

**最稳组合**: L1 + L2 在 agent 端跑 (本节协议约束), L3 在工具端跑 (代码层 fix) — 两层独立、双重保险。**不可只依赖单轨** — L2 在某些 vendor (chatgpt `input#upload-photos`) 上即使没真传成功也可能显示非空 (vendor optimistic display), 必须 L1 + L2 联合判定。

#### §0b.7.9.3 调用前后必跑的探针 (硬约束)

```javascript
// Pre-upload (before upload_file)
const probe = await evaluate(() => {
  const inputs = [...document.querySelectorAll('input[type="file"]')];
  return inputs.map(i => ({
    id: i.id,
    name: i.name,
    accept: i.accept,
    hidden: i.offsetParent === null,
    files: i.files?.length ?? 0,
  }));
});
// expect: at least 1 input, target one identified, files.length === 0

// upload_file 调用 (uid = target input's uid)

// Post-upload (after upload_file returns, wait 500ms)
const post = await evaluate(() => {
  return {
    dialogs: [...document.querySelectorAll('[role="dialog"]')].map(d => d.innerText),
    fileInputs: [...document.querySelectorAll('input[type="file"]')].map(i => ({
      id: i.id,
      files: i.files?.length ?? 0,
      fileNames: [...(i.files ?? [])].map(f => f.name),
    })),
    consoleErrors: window.__lastConsoleErrors ?? [],
  };
});
// expect: dialogs.length === 0 AND target input.files.length >= 1 AND no error
```

**任一 expect 不满足 → 禁止继续往下点 Send, 按 §0b.7.9.4 恢复。**

#### §0b.7.9.4 检测到 picker 弹了 / 上传失败的恢复动作

按优先级执行, **严禁同时跑多条**:

1. **dismiss dialog**: `mcp__chrome_devtools__handle_dialog --action dismiss` (关闭 OS dialog) 或 `mcp__chrome_devtools__press_key Escape` (兜底)。
2. **关掉 / 撤回 stale UI**: 如果 vendor (chatgpt / copilot) 显示了 stale chip 或 stuck state, 刷新页面或导航回同 URL (按 §0d.5 物理清理顺序: 先 `navigate --new` 再 close, 避免 close 唯一 tab)。
3. **修 selector 重注**: `take_snapshot` 重新找真实 `<input type="file">` 节点 (注意 chatgpt `display: none` 的 input 仍可用, 见 §0a.x.8 表); 用新 uid 再调 `upload_file`。
4. **写 incident**: 若连续 ≥ 2 次同样 selector 失败, 写 `incident.kind = "upload-picker-leaked"`, evidence 严格按 §0c.1 schema (`{ src: "user-query", sha1hex, len }` Quill 注入类或 `{ type: "system-error", text, ts }` 系统错误类, 二选一)。
5. **绝不**继续往下点 Send / 不要"等它自己好" / 不要"换工具再试一次" — 走 §0d.5 隔离 + §10 复盘。

#### §0b.7.9.5 工具层 fix (chrome-devtools-mcp)

`src/tools/input.ts` `uploadFile` handler 已埋两层防御 (v10.14 patch, commit landed 2026-08-20):

- **CDP pre-arm**: 在 fallback 路径 (`Promise.all([waitForFileChooser, click])`) 之前, 先 `Page.setInterceptFileChooserDialog({enabled: true})` 经由 `pptrPage.createCDPSession()` 直接发 CDP 命令, 保证 intercept 在 click resolve 前已 active — 消除 race 窗口。
- **错误信息升级**: fallback 失败时 throw 带 `⚠️ A native OS file picker may be visible on screen` 字样 + 具体恢复指引 ("dismiss it (Escape), re-take snapshot, find the real `<input type="file">`, retry")。Agent / 用户**不可能**再"稀里糊涂" — 错误信息里直接写明 picker 可能 visible。
- **finally cleanup**: `setInterceptFileChooserDialog({enabled: false})` + `cdpSession.detach()`, best-effort。

**测试覆盖** (`tests/tools/input.test.ts`):
- 已存"uploads a file when clicking an element opens a file uploader"测试 fallback 路径 (button → file chooser) 仍 pass。
- "throws an error if the element is not a file input" 测试错误信息改成正则匹配 `/Failed to upload file\..*native OS file picker may be visible/`, 验证新错误信息。
- 全 input.test.ts 34/34 pass; 全测试套 754/761 pass (3 个失败是 pre-existing flaky, 见 §14 §0b.4 排查, 与本节无关)。

#### §0b.7.9.6 vendor selector 引用 (不重复, 跨章引用)

具体"哪个 vendor 锁哪个 `<input type="file">` 节点"由下列章节维护, 本节只引用不重复:

| Vendor | 章节 | 备注 |
|---|---|---|
| chatgpt.com | §0a.x.7, §0a.x.8 | `input#upload-files` (任意文件) / `input#upload-photos` (图片) / `input#upload-camera` (拍照) |
| github.com/copilot | §0a.x.7, §0a.x.9.1 | per-component `input[type="file"]` |
| gemini.google.com | §0a.x.9.1 | per-component `input[type="file"]` (silent dedup) |
| 其它 vendor | §0a.x.9.7 (维护规则) | 新 vendor 接入时按 §0a.x.9.7 同步加 DEDUP_KEYWORDS / selector |

**注意**: §0a.x.7 / §0a.x.8 / §0a.x.9 系列原本仅 mcp-chrome (HTTP) 工具集生效, 标注 `[dormant]`。本 patch (v10.14) 起, **§0a.x.7 的"3 策略 upload"知识 (`set` / `choose` / `drop`) 适用于所有浏览器 MCP** — 工具换了但 vendor selector 知识不变, 只是 §0a.x.7 [dormant] 标记针对的是注入工具集 (`chrome_type` / `chrome_upload_file`), 不是 selector 知识本身。

#### §0b.7.9.7 与既有规则的关系

- **§0b.7.7 (save 方向)**: 本节的对仗章节, 共享"绕开 native dialog"原则, 但方向相反。
- **§0a.x.7 / §0a.x.8 / §0a.x.9 (vendor selector + dedup)**: 本节只引用, 不重复维护 selector / dedup 关键字。
- **§0b.4 chrome-devtools-mcp 故障处理**: picker 真弹了 → 不进 §0b.4 (那是"Allow remote debugging?"弹窗 / SingletonLock / 连接超时); 而是 §0b.7.9.4 恢复流程。
- **§0b.5 Chrome 工具安装契约**: 本节是 §0b.5 选定 chrome-devtools-mcp 后**如何使用**的细化, 不是替代。
- **§0d.5 事故态锁定**: 连续 ≥ 2 次 upload 失败 → 写 `incident.kind = "upload-picker-leaked"` 走 §0d.5 物理清理顺序 (先 navigate --new 再 close)。
- **§0c.1 evidence schema**: §0b.7.9.4 第 4 步 incident evidence 严格按 `{ src, sha1hex, len }` 或 `{ type: "system-error", text, ts }`, 禁止自由文本。
- **§11 forward-slash 路径**: 文件路径传 `upload_file --filePath` 时走 forward-slash (Windows `C:/...`), 见 §11.1。

#### §0b.7.9.8 反例 / 教训 (2026-08-20 chrome-devtools-mcp fork 实测)

| # | 现象 | 真因 | 修复 |
|---|---|---|---|
| 1 | 调用 `upload_file` 后用户报"刚才弹了个框被我手动关了" | fallback 路径 race: `waitForFileChooser` listener 晚于 click resolve 注册, native picker 弹出未被 intercept | §0b.7.9.5 CDP pre-arm 修复 + §0b.7.9.4 错误信息明示 picker visible |
| 2 | Agent 反复 `click` 上传按钮 + `wait_for_navigation`, 始终传不上去 | 每次 click 都触发 picker, 但 Agent 不知道 — picker 一直 visible, 文件从未传 | §0b.7.9.1 规则 1 + §0b.7.9.2 L1/L2 探针 |
| 3 | Agent 用 puppeteer-core 25.x `keyboard.insertText` 写文件路径, 期望上传 | 路径被当文本输入到 `<input>` 旁的 `<textarea>` 或键盘缓冲区, 文件从未上传; 但因为 puppeteer 没报 picker 弹 → Agent 没发现 | §0b.7.9.1 规则 5 + §0b.7.9.2 L2 `input.files.length === 0` 检测 |
| 4 | Agent 看到 upload_file 返回 success 就往下点 Send, 结果 user-bubble 显示空附件 | vendor (chatgpt) optimistic display: chip 显示但 backend 拒绝; send button disabled 但 Agent 没看 disabled 状态 | §0a.x.8 §0a.x.4 第 4 轨 `send_button.disabled === false` 校验 + §0b.7.9.3 post-upload 探针 L2 |
| 5 | Agent 在错误信息里看到 "Failed to upload file" 就重试, 反复 5+ 次同样失败, 触发 §0a.1 频次熔断 | 没意识到 fallback 失败意味着 picker 已 visible, 继续 click 只会再弹 | §0b.7.9.5 错误信息明示 + §0b.7.9.4 恢复流程 + §0d.5 隔离 |

**核心教训**: "上传成功" vs "picker 没弹" 是两件事, 工具以前只报"上传失败", picker 是否 visible 全靠用户告知。本 patch (v10.14) 起, 工具 / 协议 / 文档三层都把"picker 是否 visible"提升为 first-class 状态, Agent 不可能再"稀里糊涂"。

(v10.14 patch: F-UploadPickerGuard §0b.7.9 — 沉淀 2026-08-20 用户反馈"picker 弹了被手动关"案例 + chrome-devtools-mcp fork `uploadFile` handler race fix + agent 协议 3 轨自感知; 与 §0b.7.7 save 方向对仗; vendor selector 引用 §0a.x.7 / §0a.x.8 / §0a.x.9 不重复)

#### §0b.7.9.9 chatgpt.com 自有 UI 弹窗 (文件去重, 2026-08-24 实测修订)

<!-- F-RuleLifecycleMgmt: superseded_by = null ; supersedes = v10.14.1 ; effective_since = v10.14.2 -->

**与 §0b.7.9.5 (native picker) 严格区分**: 此弹窗**不是** OS 原生文件选择器,**是** chatgpt.com 前端的 in-app 警告框 (黑底白字, 内容类似 "你已上传过此文件。尝试上传一些新内容。" + "确定" 按钮)。

**触发条件 + 路径差异** (2026-08-24 实测, 修正 v10.14.1):

| 上传路径 | 是否触发 modal | 实际行为 | 备注 |
|---|---|---|---|
| **UI drag-drop** (`drop` event) | **触发** modal | chatgpt 前端拦截 drop, 显示黑底白字警告 | 用户必须手动点"确定"才能继续 |
| **UI OS file picker** (click button → native picker) | **触发** modal | 跟 drag-drop 同样, 前端判定重复即弹 | 同上 |
| **MCP `upload_file` (CDP `DOM.setFileInputFiles`)** | **不触发** modal | 文件真传上去, 但 chatgpt 看到同名 file → 自动给文件名加 `(1)` `(2)` suffix (per-account filename cache) | 文件**已成功上传**, 不阻塞流程; chip 显示 `xxx(1).md` |

**关键观察**: 同一份文件 (e.g. `McpContext.ts.2`), 走 MCP `upload_file` 路径反复调用, chatgpt **从不**弹 modal, 只是文件名累加 suffix. modal 只在 UI 路径触发. v10.14.1 假设 "filename + content-hash per-account" 太宽 — 实际只 UI 路径跑前端 dedup 检查, CDP 路径绕过前端 JS 直接 set input.files.

**Modal 触发时的语义** (per 用户 2026-08-24 澄清, 修正 v10.14.1):
- 文件**已经成功上传** (modal 是通知, 不是失败)
- modal 文案 "尝试上传一些新内容" = 提示你可以选**别的**文件继续 (不是要求)
- 点 "确定" 后上传 slot 清空, **必须重选文件**才能继续
- **必须手动点 "确定"** — 这是 in-page modal, 不点就阻塞 UI

**与 native picker 的 4 个关键区别**:

| 维度 | chatgpt 自有 UI 弹窗 (§0b.7.9.9) | OS native picker (§0b.7.9.5) |
|---|---|---|
| 外观 | 黑底白字 modal, "确定" 按钮 | OS 文件管理器窗口, 列出目录 |
| 来源 | chatgpt.com 前端 JS (in-page) | OS 进程 (out-of-page) |
| chrome-devtools-mcp `Page.fileChooserOpened` | **不会触发** (因为不在 CDP 层) | 会触发 |
| 屏蔽方法 | 点 "确定" 继续, **不会** cancel upload | 按 Escape 或关窗口, **会** cancel upload |

**Agent 自感知规则** (2026-08-24 修订, 5 条):

1. 看到 `[role="dialog"]` 含 "你已上传过此文件" / "已上传" / "已存在" / "重复" 等中文 (或英文 "already uploaded" / "duplicate") → **chatgpt 自有 UI**, 不是 picker, **必须手动点 "确定" 才能继续** (per 用户 2026-08-24 强调 "这是必须的"). 之后上传 slot 已清空, 重选文件继续或换其它内容.
2. **不要**走 §0b.7.9.4 的 "dismiss dialog → 改 selector 重注" 流程 — chatgpt 自有 UI 不是 picker, 没有 native dialog 可以 dismiss, 错误地按 Escape 不会关闭它.
3. **不要**给用户建议 "重新上传同一个文件" 作为 fallback (UI 路径上) — chatgpt 会再次弹 modal. **替代**: 改 MCP `upload_file` 路径 (它自动加 suffix, 不弹 modal); 或换其它新文件; 或开新 conversation; 或走 inline text 贴内容.
4. **不要**因为 chip 显示 `xxx(1).md` 就当上传失败 — `(1)` suffix 是 chatgpt per-account filename cache 的 auto-rename, 文件**已成功上传**. 走 §0a.x.8 §0a.x.4 第 4 轨 `send_button.disabled === false` 校验, disabled=false 表示 backend 已接收.
5. 在 §0b.7.9.3 post-upload probe 里**额外加一项** `dialogs.some(d => /已上传|重复|duplicate|already uploaded/i.test(d.innerText))`,命中 → 走 §0b.7.9.9 而不是 §0b.7.9.4 (modal dismiss flow). 同时检查 chip 文本是否含 `(1)` `(2)` suffix — 命中说明走的是 MCP 路径且 chatgpt 做了 auto-rename (无需操作).

**实测** (2026-08-23 + 2026-08-24 storyforge-server / chrome-devtools-mcp 双锚):
- 2026-08-23: 反复 `evaluate_script` 重传 `McpContext.ts.2` 5 次 → 第 3 次起 chatgpt 弹 "你已上传过此文件" 框 (黑底白字) → 点 "确定" → 上传继续. 这是 chatgpt.com 自己的 dedup, 不是 native picker.
- 2026-08-24: 同 chat 反复走 MCP `upload_file` 上传 `cdt-20260824_090032-combined-source-ab.md` 多次 → **无 modal**, 但 chip 显示 `cdt-20260824_090032-combined-source-ab(1).md` (auto-rename). 验证 MCP 路径 bypass modal.

(v10.14.2 patch: F-ChatgptDedup §0b.7.9.9 — 修订 v10.14.1 假设 "filename + content-hash per-account 触发", 实证 MCP `DOM.setFileInputFiles` 路径 bypass modal (仅 auto-rename suffix), modal 只在 UI drag/picker 路径触发; 5 条 Agent 自感知规则重写; 加 "MCP 路径 vs UI 路径" 决策表; 修正 modal 语义 (通知非失败); 双锚 2026-08-23 + 2026-08-24)

<!-- F-RuleLifecycleMgmt: superseded_by = null ; supersedes = v10.14.2 ; effective_since = v10.14.4 -->

**MCP 路径 dedup 行为 (2026-08-24 Round 2 实证补充)**:

- **Backend layer** (chatgpt per-account 文件名 cache): MCP 路径 bypass dedup 检查 (per §0b.7.9.9 v10.14.2)。同一个文件反复上传, backend 接收到的 `input.files[0].name` 是原始名 (e.g. `hosts`), dedup 只发生在**前端 chip 显示**层。
- **Frontend layer** (composer 显示): chatgpt 的 composer 维护自己的 file list state (与 `input.files` **不直接同步**)。同名文件再次上传时, composer 行为是**原地刷新该 chip** 而不是新建 (1) (2) suffix chip。不同文件上传则新增 chip,与已有 chip 并排。
- **input.files 始终 = 1** (per `DOM.setFileInputFiles` replace 语义): 即使 composer 显示多 chip, `input.files.length` 永远是 1 (最后一个上传的文件)。chatgpt 内部 state 才是 source of truth。

**Empirical 修订 (B-2 D1, 2026-08-27)**: 当前 chatgpt.com (2026-08-27) 对同一文件名反复调用 MCP `upload_file` 不再触发 §0b.7.9.9 v10.14.2 描述的黑底白字 modal — 改为**per-account dedup via `(N)` suffix chip rename**。实测同一 thread 内连传 5 次 `_b2_b1_r2.txt` 得到的 chip 依次是 `_b2_b1_r2.txt` → `_b2_b1_r2(1).txt` → `_b2_b1_r2(2).txt` → `_b2_b1_r2(3).txt` → `_b2_b1_r2(4).txt`,每个 chip LLM 都视为独立上传并读其内容。modal 路径在 chatgpt UI drag/picker 触发 (v10.14.2 仍然适用) — 未来 chatgpt UI 改动可能让 modal 路径回归,**两条都保留**: modal dismiss (上) + chip rename (本注)。

**0-byte file 行为 (B-2 C2, 2026-08-27)**: CDP `setFileInputFiles` 接受 0-byte 文件 (input.files.length = 1),但 chatgpt server-side 拒绝 — 无 chip 渲染, LLM 报告 "no new attachment record found"。将 0-byte 上传视为**静默失败** (无 error toast, 无 chip 显示): 上传后必须验证 chip 出现 + LLM acknowledge。

<!-- F-RuleLifecycleMgmt: superseded_by = null ; supersedes = v10.14.4 ; effective_since = v10.14.5 -->

### 0b.8 DevTools 探针优先 (F-DevToolsProbeFirst) (v10.10 patch)

<!-- F-RuleLifecycleMgmt: superseded_by = null ; supersedes = null ; effective_since = v10.10 -->

**核心原则**: 任何"改了没生效" / "事件没触发" / "状态不对" 的问题,**第 1 步必跑 F12 探针** (`mcp__chrome_devtools__evaluate_script` / `take_snapshot` / `list_console_messages` / `list_network_requests` / `take_screenshot`),**不进入第 2 步改源码** — computed style 才是 CSS 真相, a11y tree 才是 DOM 真相, console 才是运行时真相。源码"应该对的" ≠ 实际生效。

**精神同源 §0a.5 完整性校验**: sha1 验证 prompt 注入完整性,不是看用户输入框有什么 — DevTools 探针验证 CSS 生效,不是看 CSS 源码写了什么。**两类陷阱一样:肉眼/源码/期望, 都不能替代真实运行时信号。**

#### §0b.7.10 chatgpt UI v2 - Tier 3 auto fallback (2026-08-24 empirical)

<!-- F-RuleLifecycleMgmt: superseded_by = null ; supersedes = null ; effective_since = v10.14.3 -->

**Problem**: 2026-08-24 chatgpt hid its <input type="file"> behind an in-app menu overlay. Tier 1 (direct upload) + Tier 2 (pre-arm CDP + click button) BOTH fail:

- **Tier 1**: input is display:none with parent class="hidden", a11y snapshot tree never resolves uid
- **Tier 2**: clicking the "add files" button only opens chatgpts own overlay, does NOT trigger OS native file chooser, so CDP Page.setInterceptFileChooserDialog never fires and waitForFileChooser times out at 3000ms

**Tier 3 auto fallback** (chrome-devtools-mcp src/tools/input.ts uploadViaChatgptV2Fallback):

When Tier 2 fails, if BOTH of:
1. context.isChatgptV2FallbackEnabled() is true (default true, opt out via --disable-chatgpt-v2-fallback)
2. request.page.pptrPage.url().includes("chatgpt.com") is true

Tier 3 fires, going directly to CDP DOM.querySelector("input#upload-files") + DOM.setFileInputFiles. We do NOT need to make the input visible because setFileInputFiles only mutates input.files and dispatches a change event; React listens regardless of CSS visibility.

**For agents**: transparent fallback - no need to know chatgpt UI changed. But Tier 3 success response includes a hint (`File uploaded from X via chatgpt v2 fallback (Tier 3: DOM.setFileInputFiles on input#upload-files)`) so it is visible in tool output for diagnostics.

**For operators**:
- Default true (typical CodeX user case: cross-project uploads). No config needed.
- If Tier 3 breaks on a future chatgpt UI change, start server with --disable-chatgpt-v2-fallback to fall back to original Tier 2 behavior.
- When Tier 3 fails, the error message hints at --disable-chatgpt-v2-fallback as the escape hatch.

**Relation to §0a.x.7 / §0a.x.8 / §0a.x.9**: those [dormant] sections describe mcp-chrome (HTTP) chatgpt injection protocol - not active because mcp-chrome is not registered. Tier 3 auto fallback is on the chrome-devtools-mcp fork (our zamelee fork) and is ACTIVE. **When chatgpt UI changes again, look here first, not at §0a.x.7.**

**Round-trip empirical** (2026-08-24, chatgpt URL 01a031b5-7bf6-7160-aaa9-1316e6d962d3):
- Round 1: upload C:\Windows\System32\drivers\etc\hosts via Tier 3, chip appears, inject prompt, Send, chatgpt reads hosts file and answers
- Round 2: same file uploaded again (chatgpt per-account dedup adds (1) suffix), Tier 3 still fires
- Round 3: reuse R2 upload, change prompt only, still successful

**Test coverage**: tests/tools/input.test.ts describe("Tier 3 chatgpt v2 fallback") has 1 smoke test (URL not chatgpt.com -> Tier 3 does not fire). The other 3 chatgpt-URL tests are not included because pushState to chatgpt.com from about:blank raises SecurityError; documented in test file.

**Future chatgpt UI change**: agent should report Tier 3 failure symptoms (no chip + chatgpt v2 fallback error message) for re-evaluation; new Tier 4 can be added if needed.

**input.files replace semantics** (2026-08-24 Round 2/3 empirical):
- Tier 3 uses CDP `DOM.setFileInputFiles`, which is **replace** semantics, not append. Each call overwrites the entire `input.files` array, so `input.files.length` stays at 1 across multiple uploads.
- Even when composer displays multiple chips (different files accumulated), `input.files.length` is always 1 (the latest uploaded file). chatgpt's composer maintains its own file list state independent of `input.files`. Tier 3 triggers chatgpt's internal file list, not `HTMLInputElement.files`. So "multi-file side-by-side display" is chatgpt's state updating, not input.files accumulating.
- When an agent tests, expecting `input.files.length === N` after N uploads is WRONG. Correct expectation: `input.files.length === 1` (always), but composer chip list contains N entries.

**Zero false-positive guarantees** (verified 3 rounds x 2 threads):
- `menuOpen: false` - Tier 3 does not open chatgpt's in-app menu overlay
- `dialogs: []` - Tier 3 bypasses §0b.7.9.9 chatgpt dedup modal (MCP path skips UI dedup check)
- No OS native file chooser - CDP `DOM.setFileInputFiles` mutates `input.files` directly without triggering `Page.fileChooserOpened`

#### §0b.7.10.1 Vendor Coverage Matrix (F-VendorCoverage, 2026-08-26)

<!-- F-RuleLifecycleMgmt: superseded_by = null ; supersedes = v10.14.5 ; effective_since = v10.14.7 -->

| vendor | upload 路径 | dedup 行为 (B-2) | inject 路径 | 状态 |
|---|---|---|---|---|
| chatgpt.com | Tier 3 (CDP `DOM.setFileInputFiles` on `input#upload-files`) | `(N)` suffix chip rename, no modal (per §0b.7.9.9 v10.14.5) | `chrome_type` (dormant) / `execCommand` fallback | ✅ active, 6/6 round×thread + B-2 Round 4/6 验证 |
| gemini.google.com | Tier 3 (CDP `DOM.setFileInputFiles` on `.simplified-file-uploader input.hidden-file-input` via `triggerSelector='button[aria-label="Upload & tools"]'`) | silent dedup, same filename → no new chip (Angular state) | `chrome_type` (dormant) / `execCommand` fallback | ✅ active (commit a80a5b7), B-2 Round 4/5/6 验证 |
| github.com/copilot | Tier 2 fallback (`pre-arm Page.setInterceptFileChooserDialog` + click "Upload from computer" submenu) | `v2/v3/vN` suffix chip rename | `chrome_type` (dormant) / `execCommand` fallback | ✅ active (generic Tier 1/2 path), B-2 Round 4 验证 |

**说明**:
- ✅ active = Tier 3 已 empirical 验证, agent 可直接调用
- ⚠️ partial = Tier 1/2 通用路径可用, 但 Tier 3 vendor-specific fallback 未实现（此项目目前所有 3 个 vendor 均为 ✅ active）
- `chrome_type` / `chrome_javascript` 走 `mcp-chrome` (HTTP) 工具集, 当前 `~/.codex/config.toml` 未注册, 因此 §0a.x.7/8/9 全部 [dormant]
- `execCommand('insertText')` 是 §0a step 3 B 路径 (deprecated but stable), chatgpt 首选是 CDP `Input.insertText` 但需要 `chrome_type` 工具支持
- 真实实验补齐按 B 阶段推进: B-1 mock fixture → B-2 3 round × 3 vendor 实证 (Round 4-6 已完成)

#### §0b.7.10.2 Conversation state contamination guard (F-StateContamination, 2026-08-27)

<!-- F-RuleLifecycleMgmt: superseded_by = null ; supersedes = null ; effective_since = v10.14.6 -->

**问题**: chrome-devtools-mcp 的 `upload_file` 工具（所有 Tier）始终返回成功，但 **vendor 前端 chat composer 内部 state 污染**会让上传看起来成功而 vendor LLM 实际收不到：

- **chatgpt**: `Remove attachment` UI 只清 chip 不清 `<input>.files`。下一次 `upload_file` 命中 §0a.x.9.5 的 MCP dedup auto-rename → chip 显示为 `(1).txt`，但 chatgpt backend 可能忽略或读取旧文件 → LLM 说"我看不到附件"。
- **gemini**: chip render 由 gemini 内部 Angular state 驱动。Composer dirty state（多个累积 chip）会让新上传的 chip 不显示（gemini dedup 行为）。
- **copilot**: 同上，chip 累积。

**核心矛盾**: 服务器侧 setFileInputFiles / OS picker / upload handler 都成功了，但 vendor 前端 state 决定了 LLM 是否能看到附件。

**调试 recipe**（每次跑 `upload_file` 之前必跑）:

```js
// F-StateContamination diagnostic - call BEFORE upload_file to detect
// leftover state from earlier rounds. 5 signals together reveal whether
// a failure is upload-side (Tier 1/2/3) or state-contamination.
() => {
  const inputs = [...document.querySelectorAll('input[type="file"]')];
  const chips = [...document.querySelectorAll('[class*="file"], [class*="chip"], [class*="attachment"]')]
    .filter(el => el.innerText && el.innerText.length > 0);
  const composer = document.querySelector('[contenteditable="true"], textarea, #prompt-textarea');
  const dialogs = document.querySelectorAll('[role="dialog"]').length;
  return {
    inputs: inputs.map(i => ({id: i.id, files: i.files?.length, fileNames: [...(i.files ?? [])].map(f => f.name)})),
    chipCount: chips.length,
    composerText: composer?.innerText?.slice(0, 100) ?? null,
    dialogs,
    bodyContainsExpectedFile: document.body.innerText.includes('<expected-file-name>'),
  };
}
```

**红灯规则**（任一命中就先 reset 再继续）:

1. `inputs[i].files.length > 0` 但 `chipCount === 0` → vendor UI 与 input state 错位 → 点击 vendor 的 Remove attachment 或 New chat 重置
2. `chipCount > 1` 且本次只打算上传 1 个文件 → 累积污染 → 选 New chat 重置
3. `inputs[i].files` 包含与本次文件名完全不同的文件 → 上次未清理 → 选 New chat 重置
4. `dialogs > 0` → 有未关闭的 dialog / popover → 先 Escape + click outside
5. composerText 非空但不是本次预期的 prompt → 上一轮没清理 → select-all + delete 或 New chat

**B-2 A1 chatgpt 真案例**（2026-08-27 重做发现）:
- 第一轮 A1：chatgpt 说"我看不到附件"
- 用户问："是不是改变了方法？"
- 重做发现：方法没变，是 Round 6 残留 input.files=[r1] → 这次 setFileInputFiles 命中 (1) 后缀 → chatgpt 后端忽略旧文件 → LLM 看不到
- 修复：先 navigate to new chat → composer 干净 → 上传 → chip 显示 `(1).txt` → LLM 看到 "Round 1 test content"
- 教训：每次 `upload_file` 之前必跑 5 信号 recipe；命中红灯先 reset

**服务器侧 hard guard**（commit 92ef0df 之后的 input.ts）:

 `uploadViaTier3Fallback` 入口做 baseline inspect:
- `DOM.querySelectorAll('input[type="file"]')` 计数现有 input
- 如果 `staleInputCount > 0` → `console.warn` 提示污染风险
- 不 fail hard（避免误伤合法重试），但 surface observation
- 配合调用方的 5 信号 recipe 一起：服务器侧提供 baseline 警告 + 调用方做完整 reset

(v10.14.6 patch: F-StateContamination §0b.7.10.2 - B-2 A1 chatgpt 重做发现 + 调试 recipe + 服务器侧 baseline warn guard)

#### §0b.8.1 触发场景与必跑探针表

| 症状 | 第 1 步必跑探针 (chrome-devtools-mcp 工具) | 反例 (实测 2026-08-14 ::selection 透明色坑) |
|---|---|---|
| 改了 CSS 类 / Tailwind token / `var(--x)` 但视觉无变化 | `evaluate_script` 跑 `getComputedStyle(elem).backgroundColor` + `getPropertyValue('--x')` 看实际渲染值 | `src/index.css` 写了 `background: var(--accent-muted)`,源码看着对,实际 `getComputedStyle().backgroundColor === "rgba(0, 0, 0, 0)"` (RGB triplet 没 alpha 通道,fallback 透明) |
| 改了 React event handler (`onClick` / `onMouseDown` / `onSelect`) 不触发 | `evaluate_script` 查 element 真实 props (`el.onmousedown` / `getEventListeners(el)` via CDP `Runtime.getProperties`) | 改了 `onMouseDown` 但没真正 attach,源码 import 路径错 |
| 改了 Zustand store action 但 UI 不刷新 | `evaluate_script` 跑 store.getState() + `take_snapshot` 比 a11y tree 是否更新 | store update 触发了,但 selector 没选到导致 re-render |
| LLM 调用参数改了 (max_tokens / temperature / model),返回异常 | `list_network_requests` 看 actual payload (不是源码期望值) | 源码写 8000 但 provider 限制 4096,实际截断 |
| 改完代码,Ctrl+S 后视觉无变化 | `take_screenshot` (用 `savePath` 留底) 对比 vs. evaluate_script 跑 `getComputedStyle` 验证 CSS 加载 | Vite HMR 没生效 / 缓存没刷 / CSS 没被引入 |
| 拖选文字但看不见高亮 | `evaluate_script` 跑 `window.getSelection().toString()` + 测 `::selection` background 是否真带 alpha | `::selection { background: transparent }` 或 RGB triplet 缺 alpha (本节 §0b.8 真实 case) |
| Modal / overlay 不出现 / 出现后无法关闭 | `evaluate_script` 跑 `document.querySelector('[role="dialog"]')` + `getComputedStyle(el).display` + `body.getAttribute('data-scroll-locked')` | modal 三层 lock (§0a.x.9.6) 只清了 1 层 |
| 页面滚动异常 / sticky 元素位置错 | `evaluate_script` 跑 `getBoundingClientRect()` + `window.scrollY` | CSS `transform` 创建新 stacking context 影响 sticky |

#### §0b.8.2 探针模板速查 (直接复用,不必每次现想)

| 探针目的 | `evaluate_script` 模板 |
|---|---|
| 查元素 computed CSS 实际值 | `getComputedStyle(document.querySelector('sel')).backgroundColor` |
| 查 CSS 变量实际值 | `getComputedStyle(document.documentElement).getPropertyValue('--x')` |
| 查 RGB triplet 渲染带 alpha | 建临时 div, `tmp.style.cssText = 'background:rgb(var(--x) / 0.35)'`, `getComputedStyle(tmp).backgroundColor` |
| 查拖动路径元素链 | `document.elementsFromPoint(x, y).slice(0, 5)` (含 tag + cls) |
| 查 Range / selection API | `window.getSelection().toString()` + `.rangeCount` |
| 查全局事件 handler | `document.onselectstart` / `document.onmousedown` / `document.ondragstart` / `document.oncontextmenu` |
| 查 React 根 mount 状态 | `document.getElementById('root').children.length` (≥1 表示已 mount) |
| 查 fixed overlay 列表 | 遍历 `[...document.querySelectorAll('*')]`, filter `position: fixed` + `zIndex > 0` + 可见 rect |
| 查所有 user-select: none | 遍历 `[...document.querySelectorAll('*')]`, filter `getComputedStyle(e).userSelect === 'none'` + 可见 rect |
| 测临时 background 实际渲染 | `const t = document.createElement('div'); t.style.cssText = '...'; document.body.appendChild(t); getComputedStyle(t).backgroundColor; t.remove();` |
| CDP 真原生拖动 | `drag` (uid→uid),或 `mcp__chrome_devtools__press_key` Ctrl+A |
| 视觉对比 | `take_screenshot` + `savePath` (按 §0b.7.7) |
| console 错误 | `list_console_messages` (`types: ["error", "warn"]`) |
| network 失败 | `list_network_requests` + `get_network_request` 单条详情 |

#### §0b.8.3 反模式 (禁止)

- ❌ **反复改源码试错 ≥ 3 次还没看到效果** → 改 path 不是正解,必跑 F12 探针看 computed / runtime 真相
- ❌ **`web_search` 查"CSS 不生效的常见原因"** → F12 比搜索引擎快,1 秒出答案
- ❌ **看完源码说"我应该改对了"** → computed style 才是 CSS 生效真相,源码期望 ≠ 浏览器渲染
- ❌ **截图反复对比,不开 DevTools 看 computed** → 截图不告诉你"为什么",computed style 告诉你
- ❌ **Range API selection 测 OK 就以为用户拖选也 OK** → Range API 是程序化选择,拖选走 CDP `Input.dispatchMouseEvent`,两者不同路径 (但这次实测都 OK,真因不在 selection 路径)
- ❌ **看到 selection API 工作但视觉看不见** → 不是 selection 没生效,是 `::selection` 颜色透明。**先去 F12 看 background 实际值,再决定改 CSS 还是改 JS** (本节 §0b.8 真实 case,2026-08-14)

#### §0b.8.4 触发纪律 (v10.10 强约束)

**任何"看起来没生效"的问题,第 1 步必跑 F12 探针,不进入第 2 步改源码:**

1. **症状定义清楚**: 用户报告什么 / 期望什么 / 实测什么 (3 句话内)
2. **必跑探针**: 按 §0b.8.1 表选对应工具,**先看真实值再判断**
3. **诊断结论**: 探针结果与源码期望的 diff → 决定改源码 / 改配置 / 接受现状
4. **修复后必再跑探针验证**: 改完源码 → 重启服务 → 硬刷 → **重新跑同一探针**,看到实际值变了才算 fix 通过

**违反此纪律的累计计数**: 同一会话内跳过探针直接改源码 ≥ 3 次 → 按 §0.f.1 `web_search_fail_count` 类似机制,在 `~/.codex/AGENTS.md` 末尾 audit_log 记录 (`kind="devtools-probe-skipped"`),给 §10 复盘参考。**不是 incident**,只是 governance signal。

#### §0b.8.5 与既有规则的关系

- **§0b.1 #1 chrome-devtools-mcp**: 本节的所有探针默认走这个工具 (HTTP/CDP, `--remote-debugging-port=9222`)。§0b.8 是 §0b.1 的"什么时候用"细化。
- **§0b.4 chrome-devtools-mcp 故障处理**: F12 探针失败时按 §0b.4 故障路径处理 (不是 §0b.8 触发 debug-spree)。
- **§0b.7 Chrome 调用顺序契约**: §0b.7 约束"拿到 Chrome 后读多写少",§0b.8 约束"读的第一动作是 DevTools 探针"。两者不冲突,顺序: §0b.1 (选工具) → §0b.7 (读流程) → §0b.8 (探针优先)。
- **§0a.5 sha1 完整性校验**: 精神同源,§0a.5 是 Quill 注入完整性,§0b.8 是运行时信号完整性。两者都反对"期望 ≠ 真实"的盲区。
- **§0c 跨会话接力**: 探针结果可写进 `~/.codex/ai-conversations.json` `conversations[].probe_evidence` 字段 (extension,非强制,辅助后续会话快速 resume)。

#### §0b.8.6 反例 / 教训 (2026-08-14 storyforge-server ::selection 真实 case)

| # | 现象 | 误判 path | 真因 (F12 探针 1 秒出) | 修复 |
|---|---|---|---|---|
| 1 | 用户拖选文字看不到 selection 高亮 | 反复改 `user-select: text` / 移除 `select-none` / 加 `!important` (3 轮 commit) | `getComputedStyle()` 显示 `::selection { background: rgba(0, 0, 0, 0) }` — `--accent-muted` 是 RGB triplet `"214 168 108"`,`background: var(--accent-muted)` 浏览器 fallback 到透明 | 改 CSS 为 `background: rgb(var(--accent-muted) / 0.35)` |
| 2 | LLM 调用参数改了 max_tokens,实际输出仍截断 | 反复调源码里 hardcoded 值 | `list_network_requests` 显示 actual payload 包含期望值,但 server 端 reject (`context_length_exceeded`) | 改 server-side context length,不是 client-side max_tokens |
| 3 | "主题切换按钮点了但页面没变色" | 反复改 theme CSS | `getPropertyValue('--bg-base')` 显示值变了,但 `document.documentElement.getAttribute('data-theme')` 没切换 | 修 onClick handler 没真正调用 setTheme |
| 4 | "新建项目按钮点了没反应" | 反复改 button onClick | `el.onclick === null` + React DevTools profiler 显示 component 没 re-render | 修 React props 没透传 (memo + defaultProps trap) |

**核心教训**: 探针 1 秒能定位的真因,源码试错要 3-5 轮 commit 才撞到。**F12 优先不是省事,是基本功**。

(v10.10 patch: F-DevToolsProbeFirst §0b.8 — 沉淀 2026-08-14 ::selection RGB triplet alpha 真实 case + 配套探针模板; 与 §0a.5 sha1 精神同源,反对"源码期望 ≠ 运行时真实"盲区; 探针速查表 + 反模式 + 触发纪律 + 与既有规则边界)

### 持久化映射
- 每个项目应在固定位置登记"项目 × AI 对话 ID"映射，避免每次新会话都开新对话。
  - 推荐位置：`<project>/docs/ai-conversations.md`（项目内，跟随仓库）
  - 或全局：`~/.codex/ai-conversations.json`（跨项目集中管理）
- 映射表至少包含：项目名、平台（gemini/chatgpt/claude）、对话 URL、对话主题、最近更新日期。

### 跨会话接手（**不能跳过的两动作**）
接手一个已在对方页面发起的对话（handoff / 上一会话留下某 gem URL）时：

1. **第一步（必做）**：检查项目映射表是否已记录该对话 ID。
   - 已记录 → 打开同一 URL 续接，**不要新建对话**。
   - 未记录 → 立即补登（项目名、URL、主题、日期）。

2. **第二步（必做）**：用 Chrome DevTools snapshot 对方对话页面，
   看清"最新一条"是对方模型的回复还是我方旧消息；
   - 如果上一会话已经问过同样问题并且对方已经给了答复，**不要重发**。
   - 对方 UI 状态标签（Searching / Refining / Answer now）不可信，
     以"最新一条对方回复是否含具体答案"为准。

### 新建对话
- 项目里没有现成 ID 时再新建。
- 新建后**立即**把 ID 写进映射表，并在 commit message / handoff 里附上 URL，
  方便下个会话接力。

### URL pattern 参考
- Gemini: `https://gemini.google.com/app/{id}`
- ChatGPT: `https://chatgpt.com/c/{id}`
- Claude:  `https://claude.ai/chat/{id}`
- 国产（豆包/文心/通义/元宝）类似 — 抓 URL 里的最后一段 ID 即可。

### 0c.1 mapping schema：附加 `incident` 字段（事故态接力）

每个 entry 含以下字段：

- `project` — 项目名
- `platform` — gemini / chatgpt / claude / ...
- `url` — gem URL 或 chat URL
- `topic` — 简要主题
- `lastUpdated` — ISO 日期
- `tabId` *(可选)* — 当前 session 的 tabId
- `incident` *(可选)* — `null` 或 `{ kind: "quill-gun" | "allow-popup-timeout" | ..., ts: ISO8601, evidence: <Quill 注入类 | 系统错误类> }`

**evidence 联合类型 schema（v9 沉淀，Gemini 反馈 A1）**：

`evidence` 必须是以下两种 schema 之一，二选一明确：

**Quill 注入类**（用于 quill-gun / native-host-encoding 等 UI 事故）：
```typescript
{
  src: "prompt" | "user-query" | "last-said",  // 证据源
  sha1hex: string,                              // 内容 sha1 hex digest (40 字符)
  len: number                                   // 原始长度
}
```

**系统错误类**（用于 allow-popup-timeout / target-crash / context-pollution 等非 UI 事故）：
```typescript
{
  type: "system-error",     // 固定值
  text: string,             // 错误描述（≤ 200 字符）
  ts: ISO8601                // 错误发生时间
}
```

**判定规则**：根据 `incident.kind` 选 schema——UI 事故用 Quill 注入类，系统事故用系统错误类。**禁止混合**——既不能用 src 字段配 text 文本，也不能用 type: "system-error" + sha1hex。schema 不匹配按 §10 复盘流程写 audit_log。

新建对话时若父 entry 有 `incident`，新 entry 必须继承 `kind`（便于 handoff）。



<!-- F-RuleLifecycleMgmt: superseded_by = null ; supersedes = null ; effective_since = v10.5 -->
### 0c.3 Failover：Gemini 多轮上下文丢失处理（v10.5 patch，F-Failover）

当同一个对话连续多轮出现 Gemini 端 context loss 时，**主动 failover**——开新对话强制 context reset + 携带上下文 metadata——而不是硬撑同一对话。

**触发条件**（任一即满足）：
- 同一 Gemini 对话连续 N 轮（默认 `N=5`）后 Gemini 端出现以下任一现象：
  - 自称「正文被截断」「请重新发」「再次被截断」—— 但 `sha1Match=true`、`innerTextNormLen === expectedNormLen`
  - 答非所问（明显忘了前面已确定的 schema / 锚点）
  - 转 fresh session 范式（开场白重复）
- 短 prompt（~700-900 chars 范围）场景：建议阈值 `N=3`（此区间 Gemini 端 cache 命中率已知偏低）
- 跨会话接力后，新对话也复现 context loss：连开 2 个新对话都答非所问 → 视为模型端持续异常 → 升级 incident kind="gemini-model-context-loss"

**Failover 流程**：
1. **停止继续追问** — 严禁循环补发（按 §0a.1 频次熔断类似）
2. **写 incident** — `<cwd>/.codex-session.json` 中 `incident: { kind: "gemini-model-context-loss", evidence: { round_count, last_innerTextNormLen, last_expectedNormLen, last_sha1Match, last_pCount, last_brCount, last_gemini_reply_topic, expected_topic, prompt_chars, sha1Actual, sha1Expected }, ts: ISO8601 }`，evidence 字段严格遵守 §0c.1 schema
3. **写 audit_log** — 同上 evidence 全字段落 audit_log（按 §10 D1.1 WAL 顺序，audit_log 先 fs.writeFileSync 确认落盘再 incident 登记）
4. **建议开新对话（context reset）**：
   - 重新生成新 gem URL（按 §0c.1 新建对话流程）
   - 携带上下文 metadata 进新对话：`topic + schema_anchors + last_round_sha1Match + last_innerTextNormLen + incident.evidence` 作为 init message 第一段
   - init message 顶部声明「本对话承接 `<old-url>` 第 N 轮，模型端出现 context loss，需从头重述 schema 锚点」
5. **mapping 表同步更新** — 在 `~/.codex/ai-conversations.json` 标注 old entry `incident=gemini-model-context-loss`，new entry `inheritsIncident=true`（按 §0c.1 父 entry 继承规则扩展）
6. **fallback 阈值**：N 默认 5；短 prompt 场景 3；按 §0a.6 判别诊断表重新定义

**与 §0c.1 / §0c.2 / §0a.6 / §0.f.2 的关系**：
- **§0c.1 跨会话接手**：mapping 表 + 续接 — `gemini-model-context-loss` 是触发条件之一
- **§0c.2 mapping schema 附加 incident 字段**：事故态接力 — `gemini-model-context-loss` 是合法 incident.kind
- **§0a.6 注入侧 ≠ 模型端**：本节是其行动端
- **§0.f.2 incident.kind 生命周期表**：本节新增 `gemini-model-context-loss` 行（见 §0.f.2）
- **§10 D1.1 WAL 顺序**：本节要求 audit_log 先落盘再 incident 登记，跟 §10 同节奏

**严禁**：
- 硬撑相同对话不 failover → 会触发 quill-gun 类警示 + 浪费 token + 触发 §0a.1 频次熔断
- "再试一次"的循环补发 → 违反 §0a.1
- 把模型端"答非所问"误判成注入事故 → 写错 incident kind 会触发 §10 复盘流程误升级
- Failover 后在 init message 省略 topic / schema_anchors → 新对话也会立刻 context loss

**反例 / 教训**（OpenCodeX 2026-07-21 R6 真案例）：
- 反例 1：R6 (879 chars) `sha1Match=true`、`innerTextNormLen=867`，Gemini 端答非所问 → 应该写 incident + 开新对话，但 opencodex 会话选择了"不再追问 + 用 R5 拍板"——属于手工 failover，绕过规则
- 反例 2：failover 时 init message 仅含 topic，不含 schema 锚 → 新对话马上"随时请抛出场景"再次答非所问
- 反例 3：failover 时只更新 mapping 表，未写 audit_log → §10 复盘时查不到 failover 决策点

（v10.5 patch：F-Failover §0c.3 — 沉淀 OpenCodeX R1-R6 6 轮 0 进展案例，把模型端 context loss 当作 incident 主动 failover，淘汰"再试一次"循环浪费）
## 0d. 多 CodeX 会话共用 Chrome 时的 Tab 锁定契约

> **适用范围 (v10.7.x 起, universal 声明)**: 本节原则适用于所有能 list + navigate tab 的 Chrome 工具路径, 不只限于 mcp-chrome 系列:
>   - mcp-chrome (HTTP/stdio, §0b.1 #2/#3)
>   - chrome-devtools-mcp (§0b.1 #1, 默认浏览器执行器)
>   - chrome-relay (我们 fork, §0b.1 #4)
>   - vendor Chrome 扩展 (§0b.1 #5)
>   - **raw CDP** 工具 (例: `D:\Documents\VibeCoding\chrome-devtools-mcp\scripts\_cdp_inspect.py`, 按 §0b.2 user-only): raw CDP 的 `PUT /json/new` 总是开新 tab, 必须显式 `GET /json/list` 复用 URL 匹配 tab, 否则污染 Chrome 标签栏
>
> pageId / targetId 抽象层不同 (chrome.debugger 层 vs CDP target 层) 不改变 §0d 精神——"复用已有 tab, 不无脑开新"。§0d.0-§0d.5 各节规则均适用, 工具作者在写新 Chrome 工具时应主动平移 §0d 原则, 不能仅因不在 mcp-chrome 体系下就跳过 (2026-08-11 复盘沉淀, 实测踩坑: raw CDP 工具 _cdp_inspect.py v1 (d9fe39a) 漏 §0d 复用, 每跑一次开新 tab)。



`--autoConnect` 模式下，多个 Codex 会话会同时持有同一个 Chrome 实例的 pageId 列表；但 pageId / targetId 是 CDP 内部的 `base::UnguessableToken`，**不可持久化**——Chrome 重启即全部分配新的。这就会导致"两个会话抢同一个 tab"或"指向同一个 tab 的两个 Codex 操作互相覆盖"的事故。本节给出本会话在操作 Chrome 时的最小锁定契约。

### 0d.0 session metadata 三层 schema（v9 真拆文件，从单文件改 3 层）

v8 仍单文件承载（高频 audit_log append 与锁强刷撞写 → JSON 截断风险），v9 落地真拆文件。

#### 三层 schema 拆分

**高频层 `<cwd>/.codex-session.json`（秒级读写，锁强刷新只触这一层）**：

| 字段 | 类型 | 用途 |
|---|---|---|
| `target_url` | string | 期望锁定的目标 URL |
| `locked_pageId` | number \| null | chrome-relay / MCP 锁定的 pageId |
| `locked_url_at_lock` | string | 锁定时刻的 tab URL（操作前校验） |
| `incident` | object \| null | `{ kind, ts, evidence, blacklist_pageIds }`（按 §0c.1 A1 union type） |
| `web_search_fail_count` | number | web_search 连续失败计数 |
| `incident_audit_log` | object[] | 本地轻量 audit_log（高频事故触发时本地 append） |
| `mcp_servers` | object | 已注册 MCP server 元数据 (post-compression 恢复用,见 §9 step 8)。每个 entry: `{tool_prefix, config_key, scope, last_verified}` |

**低频层 `<cwd>/.codex-session-extended.json`（分钟 / 小时级）**：

| 字段 | 类型 | 用途 |
|---|---|---|
| `locked_at` | ISO8601 | 锁定时间 |
| `locked_title` | string | 锁定时刻的 tab title |
| `port_families` | number[] | L4 端口扫描列表，默认 `[3000, 3001, 4000, 5173, 8080]` |
| `pending_actions` | object[] | 长序列 mutate-state 断点续传（按 §7.1） |

**极低频层 `~/.codex/ai-conversations.json`（半年级）**：

顶层 schema（v9 B1 迁移指令）：
```typescript
{
  conversations: [...],      // 旧顶层数组迁移到这里
  _system_incidents: []      // 全局 audit_log（按 §10 E1 业务违规层双写）
}
```

- 旧顶层若仍是 Array，必须先迁移为 Object：备份到 `~/.codex/ai-conversations.json.bak-{ts}` 后，把每个 entry 放入 `conversations` 字段，并初始化 `_system_incidents: []`
- 迁移必须在任何写入（含 §10 audit_log 双写、§0c 新 entry append）之前完成
- 迁移失败 → **保留 incident**，告知用户 ai-conversations.json 迁移失败，下次会话继承事故态

#### 三层 I/O 边界（防 JSON 截断）

- **高频层写入**：直接覆盖，每次写入前先 backup（按 §7.0，stamp = `clean` 或 `kind-yyyymmdd`）
- **低频层写入**：同上
- **极低频层写入**：先迁移 + 加锁（按 §10 D1 事务原子性），失败保留 incident

#### 拆文件原则 v9 沉淀

- 拆文件不是目标，避免 I/O 竞争才是
- v9 拆文件目的：让"锁强刷新"（秒级）只触高频文件，避免与"audit_log append"（每次事故都写）撞写
- 拆文件后 §9 session 启动自检读 3 个文件（高频、低频、极低频），失败各自 fallback 到默认值
- **不能拆错层**：把 audit_log 归入极低频 → 错（每次事故都触发 append 写入频繁，应归高频层）

注意：本节是 cwd 级，不跨项目；跨项目映射用 `~/.codex/ai-conversations.json`（按 §0c.1 schema）。两文件的同步与冲突处理由 §9 session 启动自检负责。

### 0d.1 开工前的锁定流程（必做）

1. `list_pages()` 拿到当前可见 tab 列表（`pageId`、`url`、`title`）。
2. 用 **7 层 fallback** 从已知"目标 URL"或"目标描述"反查具体 tab：
   - **L1**: 完整 URL 全等（去 fragment）—— 唯一性最强。
   - **L2**: origin + path 全等（剥掉 `?ts=12345` 这类 query）—— 剥 query 尾巴。
   - **L3**: origin + path 段前缀 —— `/api/users` 命中 `/api/users/123`。
   - **L4**: 邻近端口扫描 —— 端口飘走时扫 dev port 族。**若 metadata 无 `port_families`，默认扫 `[3000, 3001, 4000, 5173, 8080]`**（Vite / Fastify / 通用 dev server 兜底，按 v6 沉淀，B3 Onboarding）。
   - **L5**: origin 等价 + title 模糊 —— 跨子域兜底。
   - **L6**: title 强关键词 —— 例如"项目技术债"这种语义锚。
   - **L7**: 用户消歧 —— 上面 6 层都出 ≥2 个候选就停下问用户，不许猜。
3. 把锁定结果写到**本会话**的 metadata（**绝不写到全局**）：
   - 路径：`<cwd>/.codex-session.json`（v9 拆文件后只在高频层写，见 §0d.0）
   - 内容：`{ target_url, locked_pageId, locked_url_at_lock }`（高频层字段，其他字段在低频层 .codex-session-extended.json）
4. 后续每次操作前，**先校验** metadata：
   - 重新 `list_pages()` 找到 `locked_pageId`。
   - 比对当前 URL 与 `locked_url_at_lock` —— 不一致说明 tab 被外部动了，重新走 L1–L7。

### 0d.2 URL 字段优先级原则

锚定 tab 时，URL 字段的权重从硬到软：
1. **域名（origin.host）** —— 最高优先级，不能丢。
2. **路径关键段** —— 特别是网页 AI 会话 ID（`/app/{id}`、`/c/{id}`），是身份锚。
3. **端口** —— 是 namespace 边界，**不是身份锚**；dev server 换端口就漂移，必须靠 L4 兜。
4. **query** —— 匹配前先剥掉，不参与判定。
5. **fragment** —— 完全丢弃。

### 0d.3 同 URL 多 Tab 的处理

出现多个 Codex 会话指向同一个 URL 的多个 tab 副本（少见但真实）：
- 约定"操作**最后一个 selected** 的 tab"，不要随机挑。
- 通过 `select_page(pageId)` 显式置顶再做后续操作。
- metadata 锁定的 pageId 不再 selected 但 URL 仍匹配 —— 仍按 metadata 走，**不要自动换锁**；换锁前必须先 `list_pages()` 看新 selected 是什么。

### 0d.4 跨会话接手的兜底

接手一个不属于本会话的 tab 时（handoff / 上一会话留下的 URL）：
- 不要复用上一个会话的 pageId（即使 Chrome 还活着）。
- 必须重新 `list_pages()` + 走 L1–L7 + 写新的本会话 metadata（v9：只写高频层 `<cwd>/.codex-session.json`）。
- 上一会话的 metadata.json 视为遗留，本会话不信任也不删除（避免污染对方状态）。

### 0d.5 事故态锁定（incident-aware）

若 `<cwd>/.codex-session.json` 的 `incident.kind` 是 §0a.1 / §0b.4 列出的 kind：

- **不复用**原 pageId / targetId / §0d.1 L1-L7 中的任何索引——它们绑死事故现场。
- **强制走 L1-L7 兜底**：重新锁定一个干净 tab 或新建 tab（按 §0b.5 Chrome Relay `navigate --new` 优先；MCP `new_page --isolated` 慎用，因为 isolated 没用户 cookies——按 §0b.4 故障处理）。
- **继承上下文**：把 `expected_text` / `incident.evidence` 带进新 tab，避免重新问 Gemini / 用户。
- **优先复用同一 URL 续接**：换 Tab / 新建 Thread URL **会丢 Gemini chat context**（除非用同一 URL 续接）；真要换 Tab / 新建 Thread URL 时，把 expected_text / incident.evidence 带进新 tab 作为补偿，context 视为已丢。
- **pending_actions 状态回退（v8 沉淀，Gemini 反馈 A1）**：触发换 Tab 时，必须将 `<cwd>/.codex-session-extended.json` 的 `pending_actions[]` 中状态为 `in_progress` 的 UI 操作回退为 `pending`，待新 Tab 的 DOM 重新 Ready 后再执行；否则可能在不同 DOM 环境下二次崩溃（如新 Tab 还在 loading，document.querySelector 返回 null 触发 §0a.1 频次熔断）。**v9 拆文件后，pending_actions 在低频层 `.codex-session-extended.json`（不是高频层）**——回退时只动这一个文件，不连带 `<cwd>/.codex-session.json` 高频层重写，避免 JSON 截断。
- **L1 黑名单隔离**：在强制走 L1-L7 兜底时，必须将事故态遗留的 pageId 加入匹配黑名单。**即使该旧 Tab 的 URL 完美命中 L1，也必须强行跳过**。
- **物理清理顺序（v8 修订，Gemini 反馈 A2）**：L1 黑名单隔离 + 物理关闭必须按**严格顺序**执行——
  1. 先 `chrome-relay navigate --new <URL>` 确保至少有一个干净 Tab 存活（**必须先做这一步**，避免 close 唯一存活 Tab 导致整个 Chrome 进程退出、CDP 断开、MCP Server 链式挂掉）
  2. 再 `chrome-relay close <旧 pageId>` 关闭污染 Tab（避免继续吃 Chrome 内存）
  3. 最后走 L1-L7 兜底找新 pageId（黑名单跳过已 close 的）
- **黑名单存储**：`<cwd>/.codex-session.json`（高频层）的 `incident.blacklist_pageIds: number[]`，incident 解除时清空。
- **evidence 字段继承（A1，v9 沉淀）**：新 Tab 操作的 expected_text / incident.evidence 字段，evidence 必须严格按 §0c.1 A1 union type schema（Quill 注入类 `{ src, sha1hex, len }` | 系统错误类 `{ type: "system-error", text, ts }`），禁止自由文本。

## 0e. 外部知识查询 / 防止撞库偏移

涉及外部知识查询（找开源项目 / 找技术方案 / 找 API / 找最佳实践）时，由 **Gemini 担任主向导**，统一调度 DuckDuckGo、GitHub search、Chrome Relay 等工具。

- 禁止无主向导指导的宽泛撞库（DDG / GitHub search 大词泛搜）。
- 禁止把搜索结果直接当作结论；所有来源（含主向导自己）必须经 §0e.3 五条校验。
- web_search 按 §0b.1 默认禁用，连续失败 2 次视为不可用。

理由：宽泛关键词搜索返回的 1.4k 结果里 95% 跟具体问题无关——这是撞库偏移。"撒网捕鱼"不如"主向导定锚 + 精确调度"。

### 0e.1 推荐路径（主向导调度）

按顺序执行；每一步骤都受主向导指挥：

1. **先把问题描述清楚**（业务背景 + 技术栈 + 边界条件 + 已试过的方案 + 上次对话 ID 是否已记录）。
   - **巨 prompt ( > 4000 chars 非图片内容) 走 chatgpt 原生文件解析**: 不要 inline 注入 (易触发 token 浪费 + sha1 反复校验 + PowerShell heredoc 编码问题). 改用 `input#upload-files` 选 .txt/.md → `chrome_upload_file` 上传 + 短 prompt 跟进. 决策表见 §0a.x.8 + dedup 规则见 §0a.x.9.
2. **Gemini 主向导锚定语义**（多轮追问是常态不是例外）：
   - 给候选项目 + 工业级框架候选。
   - 多轮追问直到场景被精准框定。
   - 必要时主向导主动给出"精确搜索词" / "精确 owner/repo"，准备进入下一步调度。
3. **反馈型追问（核心闭环）**：绝不接受主向导第一轮直接给出的"最终结论"。
   - **必反问**话术范例（直接复用即可）：
     - "你给的 X 项目最近 commit 是 2019 年，是不是已经弃坑？请给出当前活跃的替代方案。"
     - "X 库 README 写的是 Vue 2，跟我要的 Vue 3 + TS 栈对不上，请重新匹配。"
     - "你说的 Y 替代品在 GitHub 上搜不到，能给完整 repo URL 吗？"
   - **幻觉对账**：对主向导给出的每个候选项目，强制进入下一步直查。
4. **主向导调度核查 / 扩充**（每次调度后回到第 2 步判断够不够）：
   - **调度 DuckDuckGo**：仅用主向导给出的精确搜索词（如 "<项目名> <具体问题>"），用于查 issue / Stack Overflow / discussions 这种定向问答内容。
   - **调度 GitHub search**：仅用主向导给出的精确 owner/repo/keyword，绝不宽泛撞库。
   - **调度 Chrome Relay**（按 §0b.1）：用主向导给出的 owner/repo 直访候选页面，核对 README 质量 / commit 频率 / 最近 release 时间 / 维护者活跃度 / issue 响应速度。
5. **诚实原则兜底**：所有来源（含主向导自己）都受 §0e.3 五条校验。验证不通过时，必须直接告诉用户"AI 这次给的候选未通过验证"，不准强行拼凑盲目推荐；改回第 2 步换关键词或重新调度。

### 0e.2 撞库偏移陷阱（反例 vs 正例）

**反例 / 后果**：

- 无主向导指导时 `web_search "react indexeddb migrate backend api"` → 1.4k 结果，95% 噪声
- 无主向导指导时 GitHub search "offline first database" → stars 虚高、维护度不清
- 无主向导指导时 DuckDuckGo "best offline first database 2026" → 时间敏感问题，列表化无效
- 让 Gemini 直接给"最佳实践"而不锚定场景 → 模板化 / 幻觉
- 一次问答就锁定项目，没追问替代品 → 错过同等 / 更优解

**正例 / 路径**：

- 问 Gemini "Dexie 离线优先 → Postgres 后端，存量 10k 行冲突解决方向？给具体项目" → 主向导锚定语义
- 反馈型追问 "你给的 X commit 是 2019，当前活跃替代？" → 防止幻觉和过时方案
- Gemini 给出 "owner=pubkey, repo=rxdb, keyword=supabase replication" 后调 GitHub search → 精确核查
- Gemini 给出 "<项目名> <具体问题>" 搜索词后调 DuckDuckGo → 定向问答补盲
- Chrome Relay 直查候选（README / commit 频率 / 最近 release）→ 实例强验证

### 0e.3 防主向导幻觉（5 条硬核 + 1 条提醒）

主向导（Gemini）容易编造听起来合理但实际不存在、已改名或已弃坑的项目。每次引用主向导给的候选，必须通过以下过滤：

**硬核校验（5 条）**：

1. **真实链接检查**：候选项目必须提供合法的 GitHub repo URL / npm 包名 / 官方文档，URL 能在 Chrome Relay 直访下打开。
2. **新鲜度检查**：上次 release < 6 个月视为活跃；> 2 年视为弃坑，直接剔除。
3. **Commit 交叉对账**：通过 Chrome Relay 直访确认其真实活跃度，不存在或长期停更的视为幻觉，**拒绝沿用**。
4. **版本号确认**：高风险决策时要求主向导明确指出当前稳定版本号，不接受"最新版"这种模糊表述。
5. **诚实原则**：验证不通过时，必须直接向用户同步"主向导这次给的候选未通过验证"，不准强行拼凑盲目推荐；改回 §0e.1 第 2 步换关键词或重新调度。

**提醒层（不属硬核校验，**非阻塞**）**：

6. **生态与 License 提醒**（v6 沉淀，v8 补强，v9 B1 维持）：
   - 主向导推荐的候选项目需附带 License 信息（MIT / Apache / BSD / GPL 等）。
   - **强制校验**：License 必须可在仓库根 LICENSE 文件直接验证，禁止"看 README 猜"。
   - **找不到独立 LICENSE 文件的项目**：一律按「未授权闭源风险」进行**强提醒**（不属于硬核幻觉判定，**不是刚性排除**），需用户显式批准后方可继续；推荐同时给一个 License 清晰的替代方案。
   - **提醒但不刚性排除**：闭源 / 禁止商用 / 冷门 License **不直接判定幻觉**，而是显式提示"该 License 可能与项目商业目标冲突"并附候选替代方案，最终决定权交回用户。
   - **理由**：学习者找到可解方案的价值 > 强制合规。让 Codex 看到信号而非阻断决策。

### 0e.4 工具优先级（外部知识查询场景 — 主从架构）

| 工具 | 角色 | 何时用 |
|---|---|---|
| **Gemini / 网页 AI** | **主向导**（唯一决策者） | 锚定语义 + 调度其他工具 + 多轮追问 + 反馈追问；唯一可独立发起搜索的角色 |
| **DuckDuckGo** | 被调度工具 | 仅当 Gemini 主向导给出精确搜索词时调用 |
| **GitHub search** | 被调度工具 | 仅当 Gemini 主向导给出精确 owner/repo/keyword 时调用 |
| **Chrome Relay（按 §0b.1）** | 实例验证工具 | 直访候选页面，核对指标 |
| `**web_search**` | **禁用** | 按 §0b.1 默认禁用 |

### 0e.5 跟既有规则的对接

- **§0c**：用户已经在某 Gemini 对话里问过 → 先按 §0c 检查映射表（`docs/ai-conversations.md` 或 `~/.codex/ai-conversations.json`），决定续接 / 补登 / 新建，不在 §0e 重复会话管理。
- **§0b.1**：所有外部 URL 访问一律走 Chrome Relay（不在本节重复）；GitHub 直查 / Stack Overflow 直访 / 官方文档访问都属此类。
- **§0a**：往 Gemini 对话框填长 prompt（含本节草稿、术语表）时按 §0a 输入完整接收规则，避免 Quill 截断自动提交。
- **§5**：具体外部操作（写文件 / 提交 / 装包 / 新建项目结构）等副作用操作需跟用户对齐；Gemini 主向导游走（DuckDuckGo / GitHub search 调度）不需每步对齐，不要"猜"着开始。
- **§0d.0**： `~/.codex/ai-conversations.json` 在 v9 拆文件后属极低频层，schema 顶层必须为 Object（按 B1 迁移指令）。

<!-- F-RuleLifecycleMgmt: superseded_by = null ; supersedes = null ; effective_since = v10.7.3 -->
## §0.g 规则生命周期管理 (Rule Lifecycle Management)

### §0.g.0 起源 + scope
- 起源: 每条 F- marker 累积到一定规模后,规则之间的依赖 / 覆盖关系越来越难维护 ("Rule Drift")。§0.g 给规则加可追踪性 (traceability) 和显式化覆盖关系,解决 40% "Documentation Drift"。
- **不解决** Runtime Drift (那需要 Rule Registry + Resolver 工业级方案)。
- **不引入** incident.kind="rule-drift" (走 audit + 人工确认,不入 §0.f.2 / §10 E1 / §0d.5)。理由: rule-drift 是 Governance Failure 不是 Runtime Failure。

### §0.g.1 metadata 注入契约
每条 F- marker 落盘 (mutate-state 路径) 时,必须在 markdown 注释里加一行 (由 build script 自动写入, 不手写):
```
<!-- F-RuleLifecycleMgmt: superseded_by = null | F-XXX ; supersedes = F-YYY ; effective_since = vXX.Y.Z -->
```

### §0.g.2 解释原则
- 以 **effective rule** 为准 (effective_since 最新的定义)。superseded rule 仅保留历史, 不参与运行时解释。
- Codex 启动自检 (§9) 或运行时参考某 F- marker 时,默认采用 effective_since 最新的定义;superseded 的旧 F- marker 不参与判断。

### §0.g.3 四联动
1. **§0.g 自身** (本章,治理规则本体)
2. **§9 启动自检**: 扫所有 F- marker 注释, 对 superseded 标记的 patch 输出 `[HINT]` 提示 (非强制,只提示)。`supersedes` 关系图在 §9 自检阶段可视化给 operator。
3. **每个已落 F- marker header** 加 HTML 注释 (v10.7.4 一次性升级 24 个真实已落 marker)
4. **build script include metadata**: 任何 patch 落盘 F-AtomicWrite 路径必须 include HTML 注释 metadata 写入 markdown source。Build 完成时自动校验 `F-XXX 注释数 == 实际已落 patch 数`。

### §0.g.4 当前已知 superseded 关系
(v10.7.3 一次性标注,仅作历史归档。superseded rule **不参与运行时判断**,见 §0.g.2)

| 旧 F- marker | superseded_by | effective_since |
|---|---|---|
| F-GhostTextClear (v10.7.1 §0a.x.2) | F-GhostClearFallback (v10.7.2) | v10.7.2 |
| F-ReturnJS (v10.7.1 §0b.5) | F-ReturnJSPrecision (v10.7.2) | v10.7.2 |

(其他 F- marker 暂无 supersedes 关系,`superseded_by = null`。本表不再追加;新 superseded 关系写到 commit message,本表保持 v10.7.3 快照。)

### §0.g.5 当前活跃调研项 + 待决议
调研 todo (不是规则)。完整 backlog 见 `~/.codex/AGENTS-sessions/research-backlog.md` (placeholder,待建立)。

- **Inventory Diff Invariant** (Gemini Q5 #1): F- marker 累积到 26+, 人工维护元数据极易漏标。必须优先将 inventory diff 纳入 CI/CD 静态扫描 (防漏)。
- **category 字段** (ChatGPT Q2 + Gemini Q3 共识): F-DebugSpreeEx 类 debug heuristic 不同于强制 Rule, 需在 §0.g.4 表增加 category 列区分 (debug heuristic / fallback / rule)。
- **changelog 独立拆分** (ChatGPT Q4 提议): 历史版本信息迁出主体到 lifecycle registry / changelog, footer 5 重保留 (审计价值)。
- **(已撤销,不入强 patch)** CRLF normalization: Probe 7 (2026-07-27) Node.js / Chrome `replace(/[\s\n]+/g, ' ').trim()` 已覆盖 \r (因 \s 包含 \r), sha1 验证通过。v10.7.3 决定维持撤销。**v10.7.4+ 真 Chrome tab 验证**留作后续。

## 0.f 核心阈值与降级状态机总表（防 §0 各节数字 / incident kind 散落）

为防止 §0 多次事故补丁后"数字阈值 + incident kind + 状态机散落各处"，集中在 §0 末尾维护。新增阈值或 incident kind 时，往本表追加即可，不在 §0 各节重复维护。

### 0.f.1 数字阈值集中表

| 触发器 | 阈值 | 位置 | 物理隔离说明 |
|---|---|---|---|
| Quill 机关枪熔断 | 60s 滑动 ≥ 2 次相同前缀提交 | §0a.1 | 前端 UI 时间滑窗（次数累计，不要求连续） |
| web_search 不可用 | 连续失败 2 次（24 小时内） | §0b.1 | API 死链硬错误；跨自然日清零，**进程重启不清零**（v8 沉淀，Gemini 反馈 C2） |
| Quill Delta 同步 | sleep ≥ 500ms | §0a 步骤 3 | DOM 异步等待 |
| **完整性硬判定（v10.6）** | `sha1(actualNorm) === sha1(expectedNorm)` 完全相等 | §0a 步骤 4 | innerText 规范化后 sha1 比对（取代旧 textContent 容差 -5） |
| 规范化白名单 | `replace(/[\s\n]+/g, ' ').trim()` | §0a 步骤 4 | 折叠所有空白到单空格 |
| 段落化诊断（debug） | `pCount ≥ newlines / 2` | §0a 步骤 4 | Quill 段落化完成（**不**参与硬判定） |
| Break 诊断（debug） | `brCount ≥ 0` | §0a 步骤 4 | Quill code block 转换产生额外 `<br>`（**不**参与硬判定） |

**v10.6 重要变更**：原"长度比对容差 -5"已废弃，长 prompt + 特殊字符下失真。新规则只信 sha1 严格相等 + 段落化诊断作为 debug 信号。任何仍引用旧容差 -5 的字段（`tcLen`、`passLen`、`passNl`）应改用 `sha1Match` + `innerTextNormLen` + `expectedNormLen`（v10.6 §0a step 4）。

### 0.f.2 incident.kind 生命周期表（v9 E1 → v10 F1 加优先级 → v10.1 F-FATAL 加 FATAL 级）

| kind | 触发条件 | 冻结范围 | 层级 | **优先级（v10 F1 + v10.1 F-FATAL 升级）** | 恢复路径 |
|---|---|---|---|---|---|
| rule-tamper-attempt | §0b.6 豁免态下试图改既有规则 | 全部写入 + 全部调度 | 业务违规 | **FATAL (H+)** | 用户显式解除 + audit_log + §10 复盘 + 强制告警 |
| quill-gun | §0a.1 频次熔断 | fill / click / press_key | 业务违规 | **H** | §0b.6 豁免 + 用户显式确认 + §10 复盘 |
| context-pollution | AI 对话上下文窗口混乱 | 当前 Gemini 对话 URL | 业务违规 | **H** | 用户显式确认 + §0d.5 重建会话 ID |
| native-host-encoding | 注入 prompt 后 textContent 含 U+FFFD | js 注入路径 | 业务违规 | **H** | 改 base64+atob 注入 + 用户显式确认 + §10 复盘 |
| allow-popup-timeout | §0b.4 Chrome MCP 弹窗超时 | 全部 Chrome 调度 | 工具交互 | **M2** | 用户显式确认（手动 Allow 或改 Chrome Relay）+ §10 复盘 |
| v4-step4-blindspot | §0a 步骤 4 ≤ 5 字符容差不匹配 | 单一对话框 | 工具环境 | **M1** | §10.1 自动置 null + 改 Quill-aware 校验后清空重做 |
| target-crash | §0b.4 Target Crashed 侦测命中 | 当前 Tab 全部 DOM 操作 | 工具环境 | **M1** | §10.1 自动置 null + §10 复盘 + §0d.5（先 navigate --new 再 close） |

**层级判定 v9 + v10.1 F-FATAL 升级**：
- **FATAL (H+) 级**（v10.1 新增）：rule-tamper-attempt 唯一 — 恶意篡改规则 = 无条件覆盖 + 强制告警
- **H 业务违规层**：quill-gun, context-pollution, native-host-encoding — 必须用户显式确认
- **M1 工具环境层**：target-crash, v4-step4-blindspot — Agent 自动置 null（按 v10.1 F-PopLogic 出队替换）
- **M2 工具交互层**：allow-popup-timeout — 必须用户操作

**v10 F1 优先级屏蔽应用 + v10.1 F-FATAL 升级**：FATAL > H > M2 > M1 — FATAL 级（H+）触发时无条件覆盖任何现有状态，不进 pending_kinds 队列，触发即安全告警。

| gemini-model-context-loss | §0c.3 触发条件命中 | 同对话 Chrome tab 继续追问 | 业务违规 | **H** | §0c.3 Failover（开新对话 context reset + 携带 metadata） |
### 0.f.3 事故优先级矩阵与屏蔽原则（v10 沉淀，Gemini v9 反馈 F1 + v10.1 F-FATAL 升级）

**优先级排序**：**FATAL > H > M2 > M1**（v10.1 升级：FATAL 级新增）；H vs H 时保留原 kind 不覆盖。

**新事故触发的优先级判定（每次写入 incident 时执行）**：

1. **现有 incident.kind == null** → 直接置新 kind（按 E1 路径执行）
2. **现有 incident.kind 优先级低于新事故优先级** → **覆盖** incident.kind 为新 kind（log warning：覆盖事件）
3. **现有 incident.kind 优先级等于或高于新事故优先级** →
   - **同优先级（H vs H / M1 vs M1 / M2 vs M2）**：**不覆盖**，新事故追加到 incident.pending_kinds[] 暂存
   - **低优（H 现有 + M1 触发 / H 现有 + M2 触发）**：仅物理清理（§0d.5）+ 把当前低优加入 incident.pending_kinds[]，不释放 incident 字段
   - **FATAL 触发时（v10.1 新规则）**：无条件覆盖现有 incident.kind，原 kind 作废写入 audit_log；FATAL 不进 pending_kinds 队列
4. **禁止**：业务违规降级为工具处理（违反原则）；工具层升级为业务违规（不必要的 user 介入）

**M1 自动解除条件约束（v10 F1.1 + v10.1 F-PopLogic 升级）**：M1 触发时，**仅当** incident.kind == null 时才走 §10.1 自动置 null 流程；若 incident.kind != null（被高优/同优占用），M1 仅走 §0d.5 物理清理 + 把 M1 加入 incident.pending_kinds[]，**绝不释放 incident 字段**。

**incident.pending_kinds[] 暂存队列**：用于在不可覆盖场景暂存低优事故，每个元素 = { kind, ts, evidence }，FATAL 触发时整个队列清空（FATAL 是无条件覆盖），H/M2 触发时按 v10.1 F-PopLogic 出队替换，F-DeferReplay 挂起回放到下次 §9 启动自检。

**incident.blacklist_pageIds[] 保留**：v8 §0d.5 引入，事故态下关闭污染 tab 用，v10 F1 不变。

<!-- F-RuleLifecycleMgmt: superseded_by = null ; supersedes = null ; effective_since = v10.1 -->
### 0.f.3.1 FATAL 级保护契约（v10.1 沉淀，Gemini v10 反馈 F-FATAL）

**FATAL（H+）级 = 唯一 kind 是 rule-tamper-attempt**（恶意篡改既有规则 — §0b.6 豁免态下试图改既有规则）。

**FATAL 触发特性**：

1. **无条件覆盖任何现有 incident.kind**：包括 H/M2/M1 在内的所有 kind 均被覆盖
2. **不入 incident.pending_kinds[] 队列**：FATAL 是同步覆盖，不暂存
3. **强制告警**：FATAL 触发即向用户推送告警（区别于 H 的"等待确认"）
4. **强制进入修复流程**：agent 不可自动置 null，必须用户解除 + 复盘
5. **审计日志强制双写**：本地 incident_audit_log[] + 全局 _system_incidents[]（即使其他 H 事故也只双写业务违规层，FATAL 是强制双写）

**为何要单独 FATAL 级**（v10 之前的失职）：
- v10 H vs H 同级不覆盖走 pending — 把 rule-tamper-attempt 当作 H 同级 = 安全降级
- rule-tamper（恶意改规则）的性质 ≠ quill-gun（UI 连发）的性质 — 必须分离
- v10.1 引入 FATAL 强制压制 H/M2/M1 + 不进队列 + 强制告警

**FATAL 解除流程**：
- 用户显式解除 + incident_audit_log[] + _system_incidents[] 双写 + 全局 AGENTS.md 同步（按 §10 D1）
- 不可由 Agent 自动解除（区别于 M1）
- 解除后必须先做 root_cause 分析（按 §10 步骤 4）— 不能跳过


## 9. Codex Session 启动自检清单（v8 提升：原 §0g，v9 拆文件后多读 2 文件，v10.1 F-DeferReplay 升级 pending_kinds 回放，v1.10.4 F-TypecheckPreFlight 加 mandatory typecheck）

Codex 会话启动时（含继续 / handoff）必须按顺序执行：

0. **(v1.10.4 F-TypecheckPreFlight, per Copilot §d) Mandatory typecheck pre-flight** — 在信任 `docs/handoff/RESOLVED.md` 之前必须 verify：
   ```bash
   pnpm -r exec tsc --noEmit
   ```
   - **Expected**: 0 errors (RESOLVED.md claims 的 baseline)
   - **If non-zero**: 立即 stop + 写新 incident (可能回归) + 不信任 stale RESOLVED entry
   - **RESOLVED.md timestamped versioning** (per v1.10.4 Copilot review): 每个 entry 标 `verified YYYY-MM-DD` + commit hash，agent 比较当前日期与 entry 日期判断 stale

1. **读 cwd 的 3 个文件**（v9 拆文件后）：
   - 高频层 .codex-session.json 不存在 → 全新会话，跳到第 4 步
   - 低频层 .codex-session-extended.json 不存在 → 默认值初始化（locked_at=null, port_families=[3000,3001,4000,5173,8080], pending_actions=[]）
   - 极低频层 ~/.codex/ai-conversations.json 不存在 → 默认值初始化
   - 任一文件存在但 JSON 损坏 → 立即告警用户 + 不自动修复（损坏 = 用户决策点）+ 继续启动但用空 schema

<!-- F-RuleLifecycleMgmt: superseded_by = null ; supersedes = null ; effective_since = v10.1 -->
2. **检查 incident 与 pending_kinds 回放（v10.1 F-DeferReplay 升级）**：
   - 高频层读到 incident.kind != null → 按 §0b.6 豁免态 + §0d.5 事故态锁定走，禁用具副作用操作
   - 读到 incident.kind == null → 进入 **pending_kinds 回放**步骤：
     - incident.pending_kinds[] 非空 → 按 FIFO 出队一个最高优先级 kind，作为新 incident.kind 写入；剩余保留在 pending_kinds[]
     - incident.pending_kinds[] 空 → 正常态，继续
   - 读到 FATAL 级（H+）incident.kind → 强制告警（区别于普通 H），进入用户解除流程

3. **检查 pending_actions（v8 修订，Gemini 反馈 C1 + v9 E1 扩展）**：
   - **仅当 incident.kind == null（正常态）时**，才检查低频层 pending_actions[] 是否非空；若非空 → 打印未完成项清单给用户确认是否续接
   - **若在事故态（incident.kind != null）**，**强制挂起并隐藏续接提示**——避免用户同意续接后立刻触发 §0b.6 安全红线（豁免态严禁业务操作）→ 直接熔断 → 抛 rule-tamper-attempt
   - 事故态下 pending_actions 续接的时机：**incident 解除后**（按 §10 复盘流程），下个会话启动时再做（不立即续接，避免事故态业务操作）
   - **用户授权态下可续接**（即 incident 解除后回到正常态 + 用户显式说"续接"）
   - **v10.1 F-DeferReplay 应用**：如果在 §9 步骤 2 出队了 pending_kinds 写入 incident.kind，那么本步骤仍然按事故态走（incident.kind != null → pending_actions 挂起），等下个会话再续接

4. **读极低频层 ai-conversations.json**：检查 conversations[] 是否有跨项目未结对话，决定是否需要续接；若顶层 schema 是 Array（按 B1 迁移指令需迁移）→ 暂停启动 + 告知用户迁移。

5. **chrome-relay doctor**（按 §0b.5）：若不可用 → 降级到 §0b.1 第 2-4 项

6. **清零 web_search_fail_count**（v8 修订，Gemini 反馈 C2）：
   - **进程重启必须继承 .codex-session.json（高频层）中的历史计数值**，不能清零——防止基础设施断网导致 Agent 初始化即崩溃 + 守护进程自动拉起，每次重启清零 → 「连败 2 次」硬错误锁死策略完全失效 → 把搜索接口打至 429 限流
   - **仅跨自然日**（00:00 Asia/Shanghai）清零，由本节启动自检完成

7. **检查 incident_audit_log**（v9 拆文件后从低频层迁移到高频层 .codex-session.json）：
   - 若半年内同类 incident（按 §10 第 2 步的字符串精确匹配）≥ 3 次 → 升级到 §0.f.2 永久审计（按 §10 复盘流程）
   - 同时查极低频层 _system_incidents[]：跨项目累计也计入阈值统计（v9 双源数据合并）


8. **(v0, post-compression MCP server discovery recovery) 读 mcp_servers[] (per §0d.0 schema)** — Codex context compression / handoff 后,可能丢失 `server name → tool prefix` 映射 (2026-08-13 实测: `resources/list failed: unknown MCP server 'chrome-devtools'`)。启动时读 `<cwd>/.codex-session.json` 高频层 `mcp_servers[]`,作为 fallback 工具发现依据:
   - `mcp_servers[name].tool_prefix`: 用 `mcp__<name>__*` 形式调用工具 (例: `chrome-devtools` → `mcp__chrome-devtools__list_pages`)
   - `mcp_servers[name].config_key`: 实际在 `~/.codex/config.toml` 中 `[mcp_servers.<config_key>]` 段的 key
   - `mcp_servers[name].scope`: `browser` / `node-repl` / `system` / `domain-specific` (按 scope 决定调用前的 sanity check: browser 需要 Chrome 监听 9222;node-repl 不需要)
   - `mcp_servers[name].last_verified`: ISO8601,超过 30 天视为 stale,触发小 verify probe (e.g. `tools/list` 一下)
   - **fallback order**: `mcp_servers[]` 表 (`<cwd>/.codex-session.json`) → 当前 Codex 实际暴露的 `tools/list` (primary;权威)
   - **rationale**: handoff 真实案例 (2026-08-13) — Codex context 压缩后丢失 `chrome-devtools` → `mcp__chrome-devtools__*` 映射,直接 reject "unknown MCP server";有了 `mcp_servers[]` 表 → 启动期修复映射,避免去 handoff 反复跑
   - **写回**: 每次启动自检若发现新 server / scope 变化 → 更新 `mcp_servers[name].last_verified` (走 §7 backup + F-AtomicWrite rename)



## 10. Incident Postmortem (事故复盘)

incident.kind 解除前**必须**按以下流程复盘。详细 WAL / AtomicWrite / PopLogic 实现细节见 §10.x 各子节 (本节给执行框架,§10.x 给 ops 手册)。

### 事务原子性原则 (D1)
- 解除 incident 前先快照 {kind, ts, evidence, blacklist_pageIds, pending_kinds} 到本地变量,**禁止立即 incident = null**。
- 快照成功 + audit_log 写入成功 + 双写成功 (如适用) → 批量完成后**一次性**置 null。
- 任一步失败 → **保留 incident**,告知用户 audit_log 写入失败;下次会话继承事故态。
- **禁止**分两步走 (先置 null 后写 audit_log):若第二步失败,事故态丢失 + 无 audit_log → 高危态消失但根因未修。
- 豁免态下仍生效 (incident 状态变更属于豁免范围内的控写)。

### WAL 顺序 (F4 + v10.1 F-AtomicWrite):
1. **写低频 audit_log**: `writeFileSync` 写 `.codex-session-extended.json` 的 `incident_audit_log[]`。
2. **(并发互斥) 写极低频 _system_incidents[]** (仅业务违规层 + FATAL): 检测 `~/.codex/ai-conversations.lock` 等 3s 后放弃双写 (宁丢日志不堵死主流程)。
3. **(防截断原子写) 变更状态**: 先 `writeFileSync` 到 `.codex-session.json.tmp`,再 `fs.renameSync` 覆盖原文件。**绝对禁止直接覆盖原文件** (SIGKILL/OOM 会 truncate)。
4. **(v10.1 F-PopLogic) 出队替换**: pending_kinds[] 非空 → `shift()` 一个 kind 作为新 incident;空 → null。同时清空 `blacklist_pageIds`。
- 异常处理: 步骤 1 失败 → 重试 3 次仍败 → 写 `incident.kind=quill-gun` 标记 IO-failure;步骤 2 lock 超时 → 放弃双写继续步骤 3;步骤 3 rename 失败 → 重试 + 失败日志;步骤 4 出队失败 → 极不可能,保留 incident。

### 解除分级 (E1):

| 层级 | 适用事故 | 解除条件 | 实现 | audit_log 双写 |
|---|---|---|---|---|
| **FATAL (H+)** | rule-tamper-attempt | **用户显式解除** (强告警) | 强制告警 + 等用户 OK | **强制双写** |
| 业务违规 (H) | quill-gun, context-pollution, native-host-encoding | **用户显式确认** | 告知事故 + 等用户 OK | **必须双写** |
| 工具环境 (M1) | target-crash, v4-step4-blindspot | **Agent 自动置 null** | 走 §10.1 全流程 | 仅本地写 |
| 工具交互 (M2) | allow-popup-timeout | **用户显式确认** | 告知 + 等用户操作 | **不**双写 |

**禁止**: 业务违规降级为工具层 / 工具层升级为业务违规 / FATAL 降级为 H (v10.1 强制)。

### §10 复盘流程
1. **写 incident_audit_log** (F4 同步 I/O + F-AtomicWrite): 本地 + 全局双写 (仅业务违规 + FATAL)。F-AtomicWrite 双写并发互斥: 先取 `~/.codex/ai-conversations.lock`, 超时 3s 放弃。
2. **极低频数据迁移 (B1)**: 写入 `~/.codex/ai-conversations.json` 前检查顶层 schema 是 Array 还是 Object (v9 之前的可能是 Array,需迁移)。迁移失败 → 保留 incident。
3. **半年内同类 incident >= 3 次** (v8 修订, v9 双源): 相同 kind 字符串精确匹配累计 (本地 + 全局 _system_incidents 合并)。**FATAL 独立计数**: FATAL 触发 1 次即升级永久审计。满足条件 → 升级到 §0.f.2 永久审计 + AGENTS.md 加「同类事故防御规则」。
4. **复盘产物**: root_cause + lesson 至少 1 句话 (禁止空字符串)。FATAL 必须包含完整篡改 diff + 攻击向量分析。
5. **跨项目同步**: 同 kind 在 _system_incidents[] 其他项目也出现过 → 同步到全局 `~/.codex/AGENTS.md`,避免每个项目单独踩坑。

### §10.1 工具环境层自动置 null (M1)
流程: F1 优先级屏蔽预校验 → F-DeferReplay 物理清理立即执行 (换 Tab + close,绝不等回放) → 写 incident_audit_log → F-AtomicWrite 原子写 → F-PopLogic 出队替换 → F-DeferReplay 挂起声明 (出队的新 kind 不在本宏任务内执行恢复路径,挂起到下次 §9 自检)。详见 §10.1 ops 手册 (5 patch 联动 F1 + F-PopLogic + F4 + F-AtomicWrite + F-DeferReplay)。
**禁止**: M1 自动置 null 时违反 F1 校验 / 不走 F-PopLogic 直接 null / F-AtomicWrite 直接覆盖原文件 / 出队后立刻执行新 kind 的恢复路径。
工具交互层 (allow-popup-timeout) 不适用此流程;业务违规层不适用;FATAL 不适用。

### §10.2 出队回放契约 (v10.1 F-PopLogic + F-DeferReplay)
- **出队时机**: pending_kinds 元素出队后,**禁止在当前 Node 宏任务内立刻执行**其自身的恢复路径 (M1 的 navigate--new / M2 的弹窗操作 / FATAL 的强制告警推送)。原因: 避免人点击「解除」后 1ms 看到「页面见鬼般闪退」引发恐慌。
- **挂起流程**: §10.1 步骤 7 出队新 kind 到 incident → 落盘 (F-AtomicWrite 步骤 3 Write-Rename) → 不执行新 kind 恢复路径 → 用户退出 → 下次 Codex 启动 §9 自检接管 → 用户显式决定如何处理。
- **FATAL 与 pending_kinds**: FATAL 触发时清空整个 pending_kinds[] (FATAL 是无条件覆盖),被清空元素记入 audit_log 标记「被 FATAL 覆盖作废」。**v10 vs v10.1 关键差异**: v10 仅 H 同级不覆盖走 pending,v10.1 FATAL 触发连同整个 pending_kinds 一起清空。


## 11. Codex Desktop / Markdown 文件 / 媒体引用契约

Codex Desktop app 的 Markdown 渲染器**只接受 forward-slash 形式的本地绝对路径**。反斜杠 / 尖括号包裹 / file:// URI / Linux 风格 `/c/` 都不行 — 这跟 Markdown 标准 / PixPin normalize / 其它 markdown 渲染器都无关，是 Codex Desktop 自己的硬约束。

**实测基线（v10.3, 2026-07-21 PixPin 真截图反馈）**：
- forward-slash 图（图可渲）+ forward-slash 链接（可点）OK
- 反斜杠图 / 链接全部 broken
- `< >` 包裹反斜杠图 / 链接全部 broken
- file:// URI 按 §0a.2 系统约束本来就禁
- `/c/...` Linux/MSYS 风格（v10.2 真实案例）全部 broken

### 11.1 强制格式（违反即失败交付，M2 强制）

- **本地图片 / 视频 / PDF 引用**：永远 forward-slash
  `![alt](C:/Users/Bliss/.../image.png)`
- **本地文件链接**：forward-slash + 强烈建议 `< >` 包裹避免 markdown 解析歧义
  - 含空格或特殊字符必须包：`[label](</C:/Users/Bliss/.../file with space.md>)`
  - 无空格可不包：`[label](C:/Users/Bliss/.../file.md)`
  - 但统一 `< >` 包裹最稳
- **远程 URL**：`http://` / `https://` 用标准 markdown link 即可

### 11.2 禁止格式（写错就 broken，不报错）

- **反斜杠** `C:\Users\...` → broken（本轮 v10.3 实测）
- **尖括号包裹的反斜杠** `<C:\...>` → broken（本轮 v10.3 实测）
- **`/c/...` Linux 风格** → broken（v10.2 真案例：`![alt](/c/Users/...)` 全部占位符）
- **`file://` / `vscode://` URIs（作本地引用时）** → 按 §0a.2 系统约束本来就禁
- **「图见 X 文件」无 markdown 引用** → 用户在 Codex Desktop 里看不到，等同 broken

### 11.3 不同 OS 的 path fallback

| OS | 推荐 path 形式 |
|---|---|
| Windows（Codex Desktop 本轮场景） | `C:/Users/...`（forward-slash 强制） |
| WSL | `/mnt/c/Users/...` 或 `C:/Users/...` 二选一，互测 |
| macOS | `/Users/...` |
| Linux | `/home/...` |

### 11.4 与既有规则的关系

- **§0a.2 系统约束**：`file://` / `vscode://` URIs 禁止 — 与 §11.2 一致
- **§6 字符串处理**：避免 PowerShell quoting — 不重叠，§11 是 Markdown 输出格式
- **§0a.1~0a.2 Quill**：输入规则，不约束文件输出
- **§11 独立成章**，单独维护

### 11.5 反例 / 教训（v10.2 真案例）

- **反例 1**：v10.2 mermaid artifacts 用 `/c/Users/...` 嵌入 → 用户 PixPin 截图证明全部 broken
- **反例 2**：「图在 `m10_2_artifacts` 目录」无 markdown 引用 → 用户无法在 Codex Desktop 内看到图
- **反例 3**：拼串时引入反斜杠（Python `\U` `\D` 误写）→ markdown broken
- **反例 4**：用 PixPin 截图当反馈但 PixPin 注入 markdown 时把反斜杠 normalize 成 forward-slash → 让 LLM 以为反斜杠也能用 → 错（PixPin 自家问题，跟 Codex Desktop 渲染无关）
- **反例 5**：测试「反斜杠也能渲染」用 PixPin 反斜杠路径证明 → 测试方法本身有 normalize bias，结果不可信 — 必须用 Codex Desktop 直接渲染测试

### 11.6 内部测试方法（防止 normalize bias）

- 用 Codex Desktop 直接渲染反斜杠 / `<>` 包裹的路径测试 → 看实际能不能 broken
- 严禁用 PixPin / 其它 screenshot 工具的 normalize 路径证明反斜杠能用
- 严禁看 view_image 工具的预览 → 该预览基于绝对路径直接读文件，不模拟 Codex Desktop 渲染

### 11.7 与 §6 反向校验（Python 输出路径给 markdown 引用时）

- Python 写路径字符串时，`os.path.join("C:", "Users", ...)` 返回 `C:\Users\...`（反斜杠）
- 必须显式转 forward-slash：
  - `path.replace("\\", "/")` 或
  - `pathlib.Path(...).as_posix()` 或
  - `"C:/" + "/".join(parts)`
- 严禁 Python 字符串原样塞进 markdown 标签而不 normalize

<!-- F-RuleLifecycleMgmt: superseded_by = null ; supersedes = null ; effective_since = v10.3 -->
（v10.3 patch：F-FileRef §11 — M2 强制 — 沉淀「路径不对 = 显示不出来也点不出来」教训，升 M2 而非 M1，与「禁止都有了说明权重不够」原则对齐）


### 11.8 Mermaid Safe Authoring (v10.9.0 patch, F-MermaidSafeLabel + F-PreSendLint)

**默认策略: Safe Mermaid First**. Codex Desktop 内置 mermaid 支持, 写 `mermaid` 代码块即自动渲染, 用户能直接看到图. **不要为了避免失败就改用 SVG** -- 那是过度规避, 会让消息文本里全是 base64 / 文件路径, 反而难读.

v10.7.8 起的 "默认 mermaid" 策略升级为 v10.8.0 "Safe Mermaid First" -- 写的时候就避开风险字符, 不要等失败再切 SVG. v10.9.0 新增 P0 self-audit (配套 `~/.codex/tools/lint-mermaid.mjs` 4 层检测) + §11.9 Recovery 流程. 核心变化: 不让 renderer 去解析复杂内容; Mermaid 只负责 "关系", 不是 "内容容器"; JSON / schema / code 永远移出节点.

**P0 self-audit (Agent 写完每个 mermaid 后)**:
- 跑 `node ~/.codex/tools/lint-mermaid.mjs` 对生成的 markdown 检测 (或自己用 Node REPL 内嵌调用)
- 工具做 4 层检测: L1 危险字符 / L2 JSON/object-like / L3 label 长度 / L4 复杂 HTML
- 发现 critical/high severity → Agent 在同一次回复里改写 label (优先挪到下方 Markdown 表格)
- clean → 正常 send

**重要 (chatgpt.com 2026-08-13 评审)**: 4 层检测是 **Codex Desktop renderer 的 empirically observed high-risk pattern**, **不是** Mermaid parser 的确定性规则. 未来 renderer 行为变化可能让这套检测失效, 保持 §11.9 的 1 次 recovery rewrite 兜底.

**根因 (3 个条件组合才会触发 plaintext fallback)** (2026-08-12 storyforge-server 探测流程图实测):
1. node text 内出现 `{}`
2. 同时包含 `:`
3. 同时接近 Mermaid token 语法 (例如 `{type:xxx}` 类似 shape / config 结构)

**字符安全规则** (写节点 label 前自查):

Allowed in node labels:
- English letters / numbers / Chinese text / spaces / `_`
- 中文标点 `，。！？：；`
- `<br/>` (可保留, 实测稳定)

Avoid inside Mermaid node labels:
- `{}` braces / `[]` brackets / `|` pipe
- nested JSON / object literals / API payload / schema examples
- unescaped quotes / complex HTML except `<br/>`
- 连续 `---` (易被 parser 当分隔线)

**复杂结构表达** (按推荐顺序):
1. **方案 A (推荐)**: Mermaid 图 + 外部解释 -- Mermaid 只画关系, JSON / schema / code 挪到下方 Markdown 表格
2. **方案 B**: Mermaid subgraph 分层 (适合架构图)
3. **方案 C**: 全部 Markdown 表格 (Mermaid 不适合 JSON / API payload / schema 展示)

**反例 / 教训** (2026-08-12 storyforge-server 探测流程图实测 + 2026-08-07 角色模块设计讨论实测):

- **反例 1 (本次升级修复)**: 节点 label 含 `response_format={type:json_schema, json_schema:{...}}` (3 个条件全中) -> plaintext fallback. 修法: 把嵌套 JSON 移到下方 Markdown 表格
- 反例 2: 同条消息 5+ 个 mermaid 块, 部分退化成 plaintext (`<br/>` 字面字符 + flowchart 关键字泄露) -> 拆成 2 条或减少块数
- 反例 3: 反复简化 syntax 想修复 mermaid 失败 -> 实测简单 syntax 也会失败, 浪费时间, 应直接切 SVG 或换消息拆
- 反例 4 (新): escape `\{\}` 不可靠 (不同 renderer 行为不一致) - 不要走 `\{...\}` 这种思路, 直接**避免**而不是 escape

**什么时候 SVG 才是必要的** (按重要性递减):

1. **关键决策图 (架构 / 流程 / 决策矩阵) 不容失败** -> 生成 SVG 嵌入, 保证 100% 渲染
2. 检测到节点 label 含禁用字符 / 嵌套 JSON / payload -> 立刻简化或挪到表格, **不要**等失败再切
3. mermaid 块 >= 5 块/消息时, 部分可能退化 plaintext -> 拆消息 or SVG 化
4. 用户明确说 "上次 mermaid 没出来, 重做" -> 立刻切 SVG fallback, 不要反复简化 syntax 重试

**最佳实践** (按默认偏好递减):

1. **Safe Mermaid First** -- 写节点 label 前自查 "字符安全规则", 有禁用字符立刻简化或挪到表格
2. **复杂内容挪到表格** -- JSON / schema / API payload / 大段代码永远不进 mermaid 节点, 缩到下方 Markdown 表格
3. 单消息 mermaid 块数 <= 3 -- 超出拆消息
4. 关键图 (架构决策文档 handoff) -> SVG 嵌入保证 100% 渲染
5. mermaid 渲染失败 (用户反馈) -> 跑 fallback 脚本, 生成 PNG 用 `![alt](abs/path.png)` 嵌入

**SVG fallback 模板** (Python + playwright + mermaid CDN, 仅在关键图渲染失败时用):

```python
from playwright.sync_api import sync_playwright
from pathlib import Path

def render_mermaid_to_png(mmd_path, png_path):
    src = Path(mmd_path).read_text(encoding="utf-8")
    html = (
        "<!doctype html><html><head><meta charset=\"utf-8\">"
        "<script src=\"https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js\"></script>"
        "<style>body{margin:0;padding:24px;background:#0f172a}</style></head><body>"
        f"<div class=\"mermaid\">{src}</div>"
        "<script>mermaid.initialize({startOnLoad:true,theme:\"dark\"})</script>"
        "</body></html>"
    )
    tmp_html = Path(mmd_path).with_suffix(".render.html")
    tmp_html.write_text(html, encoding="utf-8")
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1400, "height": 1000})
        page.goto("file:///" + str(tmp_html.resolve()).replace(chr(92), "/"))
        page.wait_for_timeout(2500)
        page.locator(".mermaid svg").first.screenshot(path=str(png_path))
        browser.close()
```

<!-- F-RuleLifecycleMgmt: superseded_by = null ; supersedes = F-MermaidRender ; effective_since = v10.9.0 -->
(v10.9.0 patch: 升级 v10.8.0 F-MermaidSafeLabel + 新增 F-PreSendLint, 加 P0 self-audit 配套 ~/.codex/tools/lint-mermaid.mjs v1.0.0; 新增 §11.9 Recovery 流程 (F-PlaintextRetry); 反例来自 2026-08-13 storyforge-server mermaid 实测 + chatgpt.com 评审建议)
### 11.9 Mermaid Rendering Failure Recovery (v10.9.0 patch, F-PlaintextRetry)

**职责**: §11.8 是 **Prevention** (写之前避免), §11.9 是 **Recovery** (失败后处理). 不要混淆 — §11.9 不重复 §11.8 的字符安全规则, 只讲 fallback 流程.

**核心流程** (单线, 不分叉):
```
gen mermaid → self-audit (P0, §11.8) → PASS / FAIL → send
                                                  ↓
                                  user/renderer fallback (plaintext)
                                                  ↓
                          1 次 recovery rewrite (max!) → SVG / Markdown table
```

**触发优先级** (按 chatgpt.com 2026-08-13 评审对齐):
- **P0** (核心): 发送前 self-audit, Agent 写完每个 mermaid 后自动跑 `~/.codex/tools/lint-mermaid.mjs` (§11.8)
- **P1**: 用户明确反馈 "图没出来" / "plaintext" / "mermaid 渲染失败"
- **P2**: 用户截图证明 plaintext (PixPin 截图看到 `<br/>` 字面字符 + `flowchart` 关键字)

**Recovery 步骤 (1 次上限, 严禁多次)**:
1. **定位触发节点**: 找出命中 §11.8 的 4 层检测规则的 label (`{}` + `:` + shape-like, 或其它 critical)
2. **移除 risky content**: `{...}` 嵌套 JSON / schema / object literal 挪到下方 Markdown 表格 (§11.8 方案 A)
3. **重写并 send** (注意: **只重试 1 次!**)
4. **仍失败** → 转 SVG fallback 模板 (§11.8) 或 Markdown 表格替代 — 不要无限循环 mermaid retry

**禁止**:
- **反复重试同一份 syntax** (实测 simple syntax 也会 plaintext, 浪费 round-trip — §11.8 反例 3)
- **把 "换 syntax" 当成修复方案** (chatgpt 明确反对: simple syntax 也会触发, 浪费 token)
- **过度简化** (`A[Config: enabled]` 不能因为有 `:` 就重写 — 必须 `colon + object-like` 同时命中才动, 否则误判)
- **全切 SVG** (除非关键决策图, 否则保留 mermaid 风格 — §11.8)
- **SVG 后忘记 `![alt](abs/path.png)`** 标记, §11 路径规则又 broken

**反模式 / 教训** (2026-08-13 storyforge-server 实测):

- **反例 1**: Mermaid `[SelectedModel<br/>{baseUrl, apiKey, model, params}]` 3 条件全中 → plaintext. 修法: 节点写 `[SelectedModel]`, 下方表格列 4 字段 (`baseUrl` / `apiKey` / `model` / `params`)
- **反例 2 (新, 评审沉淀)**: 反复 retry Mermaid 5+ round-trip, 每次换 syntax, 全 plaintext. 修法: 1 次 rewrite 后直接 SVG
- **反例 3 (新, 评审沉淀)**: 误判 `Config: enabled` → 删掉 `enabled` (实际是正常语义). 修法: 必须 `colon + object-like` 同时命中才删, 不要见 `:` 就删
- **反例 4 (新, 评审沉淀)**: SVG fallback 后忘记 Markdown 嵌入 → 用户看不到图. 修法: 转 SVG 必须配 `![alt](abs/path.png)` (§11)

**配套工具**:
- `~/.codex/tools/lint-mermaid.mjs` (v1.0.0) — P0 self-audit, Agent 写完 mermaid 后跑一遍. 工具不保证 100% 准确 — 只是经验性 high-risk pattern 检测.
- 配套 `~/.codex/tools/README.md` 工具索引.

**重要哲学** (chatgpt 评审): "不要把 `{} + : + shape-like` 定义成 Mermaid parser 的确定性规则; 把它定义成 Codex Desktop renderer 的 empirically observed high-risk pattern. 否则这条 AGENTS 规则以后很容易被事实反例打脸."

<!-- F-RuleLifecycleMgmt: superseded_by = null ; supersedes = null ; effective_since = v10.9.0 -->
(v10.9.0 patch: F-PlaintextRetry -- 新增 §11.9 渲染失败恢复流程, 与 §11.8 Prevention 职责分离; 配套 `~/.codex/tools/lint-mermaid.mjs` v1.0.0; 反例来自 2026-08-13 storyforge-server mermaid 实测 + chatgpt.com 评审建议)
### 1.a Python invocation - pick the form by what is in the script, not blanket

- Pure read-only query, single-line, pure ASCII, no `$ { } " '` characters, no non-ASCII
    -> `python -c "<code>"` is fine. Examples: `python -c "import json; print(json.dumps(d, indent=2))"`, `python -c "import os; print(len(os.listdir(p)))"`.
- Multi-line script, OR contains any of `$ { } " '` characters, OR contains non-ASCII (CJK / emoji), OR arguments contain those characters
    -> write the script to a temp file with `[IO.File]::WriteAllText($path, $text, [Text.UTF8Encoding]::new($false))` (or equivalent no-BOM UTF-8), then invoke `python <tempfile> [<args>]`. Reason: `pwsh` evaluates the string before handing it to `python`, so `$var` becomes interpolation and `\n` becomes a newline escape; on top of that, Python's own string quoting then collides with whatever was used on the PowerShell side.
- Anything that writes or edits source files (or any file with a BOM / specific line-ending contract)
    -> temp file + Python must `open(..., encoding="utf-8", newline="")` and preserve the original line-ending and BOM state byte-for-byte outside the changed region. Never silently rewrite the whole file.

## 2. Encoding / Unicode

- All source files must remain UTF-8 encoded without BOM unless explicitly requested
- Never replace non-ASCII characters (Chinese, Japanese, Emoji, etc.) with Unicode escape sequences (`\uXXXX`) unless explicitly requested
- Preserve all Unicode characters exactly as they appear in source files
- For JSON output:
  - Python: use `ensure_ascii=False` to preserve Unicode
  - Node.js: output UTF-8 directly; do not escape Unicode characters
- Do not normalize, transliterate, or change punctuation between ASCII and non-ASCII forms unless explicitly requested
- Detect file encoding before editing, and preserve it

## 3. File Editing / Safety

- Do not rewrite entire files unnecessarily; only touch targeted lines or blocks
- Preserve line endings (CRLF or LF) as used in the original file
- Avoid automatic reformatting or whitespace changes unless explicitly requested
- Never change file permissions or ownership without explicit instruction
- For critical source files, create a backup before applying changes

## 4. Git / Version Control Safety

- Do not commit or stage changes automatically
- Avoid generating diff noise (unrelated whitespace, encoding changes, or line ending changes)
- Prefer running `git diff` or equivalent before any suggested code modifications
- Respect `.gitattributes` and other repository encoding settings

## 5. Code Style / Discussion Mode

- Do not make code changes without explicit user permission
- Discussion mode is default; always propose changes first and wait for confirmation
- Keep the coding style consistent with the existing file/project
- Avoid introducing new dependencies unless explicitly approved
- Preserve the logic and behavior of existing code; do not "optimize" or refactor unless requested
- Special rule for AI-generated code: treat Unicode characters as data, not formatting-never escape or remove them

## 6. String Processing

- Never use PowerShell or `pwsh` for string handling. PowerShell quoting, escaping, and line-ending rules are fragile and have caused data loss in this repo.
- Always use Python (3.10+) for any string manipulation: regex, anchor matching, file encoding (UTF-8 no BOM), CRLF/LF handling, JSON parsing, Base64, etc.
- 处理文本字符串时，**直接写 Python 脚本文件执行**比用 PowerShell 或 Node REPL 更简单、更可靠；不将字符串处理作为优先选择。
- `pwsh` may only be used to launch a Python script by passing the script path as an argument. Never inline string literals, regex patterns, or file contents into a `pwsh -Command` or `pwsh -File` invocation when they contain backticks, quotes, dollars, braces, or non-ASCII characters.
- Python scripts that touch source files must read/write with explicit `encoding="utf-8"` (or binary mode), preserve the original line endings (CRLF vs LF) and BOM state byte-for-byte outside the target region, and never silently rewrite the whole file.

### 6.x Codex 工具 / Node REPL 已知怪象 (v10.8.0 patch, F-ToolGotchas)

实测踩坑沉淀 (2026-08-12 storyforge-server 问 chatgpt 实测, 多工具串联时最常踩):

- **shell_command `timeout_ms` 解析 bug**: `timeout_ms >= 14000` 被识别为 floating point, u64 解析失败 ("invalid type: floating point X, expected u64"). **最大可用 timeout 是 10000ms** (默认). 复杂等待脚本不要靠 timeout 续命, 拆短 + 多次轮询.
- **mcp__node_repl__js 限制** (经常踩, 调试成本高):
  - 没有 `process` / `require` (`process is not defined` / `require is not defined`)
  - 必须用 dynamic `import()`
  - 模块解析从 cwd 往上找 node_modules; `file:///` 绝对 URL import 也经常 `Module not found`
  - **workaround**: 写脚本到 `<cwd>/tmp/_chrome_test/` (有 node_modules) 然后 `node` 跑, 比在 REPL 里折腾稳
- **puppeteer-core 25.x `keyboard.insertText` 不存在**: 物理 `type` 触发 ProseMirror auto-submit (§0a step 3 D 禁令). 必须走 CDP `Input.insertText` (见 §0b.1 #8).

<!-- F-RuleLifecycleMgmt: superseded_by = null ; supersedes = null ; effective_since = v10.8.0 -->

## 7. Backup and Cleanup Discipline

- **Only mutate-state operations need a backup.** Read-only database queries, read-only file inspections, service restarts, and GET API calls must NOT produce a backup. Backups are required for: writing source files, writing database rows, schema migrations, and modifying this file or other config docs.
- **One pre-write backup per modification cycle.** A read -> modify -> write flow produces at most one backup taken right before the write. Git diff is the post-write history; the disk backup is not version control. Never take a `post-patch snapshot`, a second `prepatch` backup inside a patch script, or a `post-change` backup right after writing.
- **Temporary files use a leading underscore prefix** so they can be identified and cleaned up: `_helper.py`, `_probe.ps1`, `_query_out.txt`. Permanent tools never use the underscore. The agent must propose a cleanup list to the user at the end of a workflow phase and must not auto-delete files the user has not approved.
- **Locate the project backup root before any write.** Check this file and `docs/wiki/` for project-specific paths. Defaults if nothing is documented: source backups -> `<project>/tmp/code-backups/`; database backups -> `<project>/tmp/db-backups/`; config / doc backups -> `<project>/tmp/AGENTS-backups/`. Never invent a new backup path without telling the user.
- **Failure modes this rule prevents:** multi-MB `.db.bak` clones created before a read-only SQL query, two identical `.bak` files kept "to be safe" from the same modification, orphan `_*.py` / `_*.ps1` scripts left in backup directories after their job is done, and treating the backup folder as if it were git history.

### 7.x Chrome automation 脚本位置惯例 (v10.8.0 patch, F-ChromeScriptPath)

所有 puppeteer-core / Chrome CDP / Playwright 控制脚本必须放 `<cwd>/tmp/_chrome_test/` 目录:
- 跟 `node_modules/` 同目录, ESM 才能 resolve `puppeteer-core` (避免 `ERR_MODULE_NOT_FOUND`)
- 不要放 `<cwd>/tmp/_xxx.mjs` 一层 — ESM 找不到依赖, 报错 `Cannot find package 'puppeteer-core'`
- 标准结构: `<cwd>/tmp/_chrome_test/package.json` (含 puppeteer-core + ws) + `<cwd>/tmp/_chrome_test/_xxx.mjs` (脚本)

<!-- F-RuleLifecycleMgmt: superseded_by = null ; supersedes = null ; effective_since = v10.8.0 -->

### 7.0 backup scheme：事故态命名（incident-stamp）

全局 mutate-state（动 `~/.codex/AGENTS.md` / config / project registry 等控制面）前的 pre-write backup 必须含 incident-stamp：

- **命名**：`AGENTS.md.bak-<timestamp>-<incident-stamp>`
- 若当前 `<cwd>/.codex-session.json`（v9 拆文件后属高频层）有 incident，stamp = `kind-yyyymmdd`（如 `quill-gun-20260721`）
- 若无 incident，stamp = `clean`

便于事故回滚定位（写入事故态 → 一键定位备份 → 回滚）。

### 7.1 Action Queue 断点续传备份（v6 沉淀，§C §7，v9 拆文件后路径更新）

执行长序列 mutate-state（如跨 5+ 文件的层叠重构）前，除了按 §7 主规则备份目标文件，**必须**将当前 Plan / TODO list 序列化到 `<cwd>/.codex-session-extended.json`（v9：低频层，不要写到高频层 `.codex-session.json`）的 `pending_actions` 字段：

```json
{
  "pending_actions": [
    {"file": "src/api/users.ts", "intent": "改写 createUser 函数，加 zod 校验", "status": "done"},
    {"file": "src/api/users.test.ts", "intent": "加 createUser 边界用例", "status": "in_progress"},
    {"file": "src/db/schema.prisma", "intent": "User 表加 emailUnique 索引", "status": "pending"}
  ]
}
```

若 Agent 在第 N 步崩溃 / OOM / 进程被杀，下个会话启动时读 `pending_actions` 即可知道"我还要改哪 N-K 个文件"，实现真断点续传。

完成后在 commit message 末尾追加 `Closes pending_actions[N-K..N]` 标记，便于后续审计。

**v9 拆文件后路径变更**：v8 时 `pending_actions` 在 `<cwd>/.codex-session.json` 高频层；v9 拆文件后迁到 `<cwd>/.codex-session-extended.json` 低频层（因为 pending_actions 写频次约分钟级，不属于秒级高频）。任何读 / 写 `pending_actions` 的代码必须改路径，否则会找不到字段。

## 8. Project Ownership Boundary (显性东家原则)

每个 Codex 会话必须能随时回答:"我今天属于哪个项目?" —— 拿不准时不许动手。

### 判断顺序(从硬到软)

1. **本项目 AGENTS.md 顶部"显性归属"声明**(如有) —— 最高优先级。
2. **会话启动时 Codex 附带的 cwd / 项目根** —— desktop app 默认会锚到这里。
3. **用户首条消息指向的项目** —— 只在 (1)(2) 都没有时回退使用,典型场景是临时无主对话。
4. **会话内显性切换** —— 用户随时可以说"现在去 A" 或 "切去 B", 以本会话最新一条为准,旧归属作废。

跨项目临时任务(A 会话里帮 B 改个小 bug)**不撤销** A 的显性归属 —— 它只是这次会话的一个临时任务,完成后回到 A。

### 自检与纠错回归

- 任何时候,如果"我属于哪个项目"与"当前操作对象"不一致:
  - 默认先停下来问一句"我属于 A,您让我改 B,要不要切换?"
  - 不要装作本来就属于 B。
- 用户纠正后立即重新执行 1–4,并在 handoff / commit message 里注明切换。

### 留痕规则

- 跨项目临时操作(在 A 的 commit 或 A 的 handoff 里改了 B 的东西):
  - 默认不写进任何项目的 handoff
  - 如果必须留痕(例如告诉另一个 AI 这事还没做完),标注:
    `⚠️ 临时跨项目操作 by 非本项目会话,非本项目常规责任`

### 11.10 源码 / commit message 路径 (跨语言, 防回归规则)

**严禁源码、commit message、PR description 中出现 user-specific home 路径**, 例如:
- `/Users/<name>/...` (macOS / Linux)
- `C:\\Users\\<name>\\...` 或 `D:\\Users\\<name>\\...` (Windows)
- `D:/Users/<name>/...` (Windows forward-slash)

**正确代换 (按语言):**

| 语言 | 推荐 | 示例 |
|---|---|---|
| Node.js | `os.tmpdir()` | `const dir = process.env.FOO_OUT || os.tmpdir();` |
| Python | `tempfile.gettempdir()` | `dir = os.environ.get("FOO_OUT", tempfile.gettempdir())` |
| bat / cmd | `%USERPROFILE%` / `%TEMP%` / `%LOCALAPPDATA%` | `set "USER_DATA_DIR=%USERPROFILE%\AppData\Local\Temp\chrome-debug"` |
| sh / POSIX | `$HOME` / `$TMPDIR` | `OUT_DIR="${FOO_OUT:-$TMPDIR}"` |

**为什么这条规则存在** (2026-08-12 沉淀, real case):
- `ec0cff5` 之前 `scripts/_cdp_inspect.py` + `scripts/_chatgpt_inject.mjs` + `scripts/_chatgpt_get_reply.mjs` 的 default value 和 docstring 都 hardcode 了 `D:/Users/Bliss/AppData/Local/Temp`, commit 进 public fork `zamelee/chrome-devtools-mcp` 后, 任何 clone 这个 fork 的人都能看到用户 home 路径
- 即使设了 env var, default 的 user-specific 路径仍会被 fallback 命中, **违背参数化目的**
- 这条规则在 §11 markdown forward-slash 风格规则 (§11.1) 之外, 但精神一致: 路径必须可移植

**反例 (commit `ec0cff5` 之前)**

```js
// BAD — hardcoded user home
const OutDir = process.env.CHATGPT_OUTPUT_DIR || 'D:/Users/Bliss/AppData/Local/Temp';
```

```py
# BAD — hardcoded user home
OUT_DIR = os.environ.get("CDP_OUT_DIR", r"D:\Users\Bliss\AppData\Local\Temp")
```

**正例**

```js
// GOOD — portable default
import os from 'node:os';
const OutDir = process.env.CHATGPT_OUTPUT_DIR || os.tmpdir();
```

```py
# GOOD — portable default
import tempfile
OUT_DIR = os.environ.get("CDP_OUT_DIR", tempfile.gettempdir())
```

**触发场景**:
- review 代码 / commit 时看到 `/Users/username` 或 `C:\\Users\\username` → 提醒改成 portable default
- code review 时如果发现 hardcoded home path 在新加的 scripts 里, 要求 author 改后再 merge
- 这是 §11 现有 forward-slash 规则 (§11.1) 的扩展, 不冲突


## 12. 本机已知 Trick（Local Workarounds）

适用范围：当前 Windows 主机（本地 HTTP 代理监听 127.0.0.1:10808，例如 Clash / v2rayN）。
适用于 git / curl / 其它不读 WinHTTP 系统代理的命令行工具。

### 12.1 Git push 需要显式 -c 代理参数（v10.1 沉淀，2026-07-25 实测）

症状：git push / ls-remote 卡 21 秒后报 Failed to connect to github.com port 443: Timed out；同时 python -c "import urllib.request; urllib.request.urlopen('https://github.com').read()" 3 秒成功。

根因：Python urllib 默认走 Windows WinHTTP 系统代理，自动套 http://127.0.0.1:10808；但 git 的 HTTPS 传输走 SChannel，不读 WinHTTP 代理设置。所以 git 直连 GitHub IP 失败，Python 走代理成功。

<!-- F-RuleLifecycleMgmt: superseded_by = null ; supersedes = null ; effective_since = v10.7.6 -->

**前置检查（v10.7.6 沉淀，F-V2RayNCheck, 2026-07-28）**: 应用 `-c` 代理参数**前**，必须先确认本机代理是否真在跑——避免「代理没起 + 加 -c」反而让 git 等 21s timeout，把"没网"误诊成"代理缺失"：

```powershell
# 步骤 0a: 进程检查（用户原话"先看有没有 v2rayN.exe 在运行"）
Get-Process v2rayN -ErrorAction SilentlyContinue
# 有输出 → v2rayN 在跑，继续步骤 0b
# 无输出 → v2rayN 没在跑，但**不**代表代理就一定死了——继续步骤 0b 二次确认（可能是 Clash / v2ray-core / SSR 等其他客户端在监听 10808）

# 步骤 0b: 端口检查（10808 是否在监听，跨代理客户端通用，比进程名更可靠）
Test-NetConnection 127.0.0.1 -Port 10808 -InformationLevel Quiet
# True  → 代理可用，走下方修法
# False → 代理不可用，**不要**加 -c，让 git 直连尝试（直连失败说明本机根本没网，不是代理问题）
```

判定矩阵（按 §0b.4 防 debug-spree，任一命中 False 都不进步骤 1）：

| v2rayN 进程 | 10808 端口 | 处置 |
|---|---|---|
| 在跑 | True | 加 `-c http(s).proxy=http://127.0.0.1:10808`（按下方修法） |
| 在跑 | False | 异常态：v2rayN 启动了但端口没起来（系统代理配置错位或防火墙拦截），跳过 -c，让 git 直连 |
| 不在跑 | True | 用了别的代理客户端（Clash / v2ray-core / SSR ...），加 `-c` 仍可用（端口才是事实之源） |
| 不在跑 | False | **代理不可用**，跳过 -c，让 git 直连 |

修法（零持久化）：命令行临时注入代理参数：

git -c http.proxy=http://127.0.0.1:10808 \\
    -c https.proxy=http://127.0.0.1:10808 \\
    push origin main

为何不用 git config --global http.proxy ...：全局 config 跨项目污染（按 §7 全局 mutate-state 边界）。-c 注入 = 0 持久化影响，最稳。

诊断流程（按 §0b.4 防 debug-spree）：
0. **前置检查（v10.7.6 新增）**：v2rayN 进程 + 10808 端口（按上方判定矩阵）—— 任一指示代理可用才进步骤 1；任一指示代理不可用 → 跳过 `-c`、直接进步骤 3 的"git 直连"尝试，不要先入"代理缺失"假设
1. python -c "import urllib.request; print(urllib.request.getproxies())" 看 Python 看到的代理
2. git config --get http.proxy / git config --get https.proxy 确认 git 没配
3. 临时加 -c http.proxy=... 试一次 git ls-remote origin HEAD，5 秒内通 = 确认是代理缺失

实测基线（2026-07-25）：6 个 commits ~50KB 从 21s timeout → 5.4s 成功。GIT_TRACE=1 trace 卡在 Trying 20.205.243.166:443... 21 秒。

复用模式：任何 git 网络失败 + Python 同时段能通 的现象先按本节排查。

（v10.7.6 patch：F-V2RayNCheck §12.1 — 沉淀"git 失败先看代理是否真在跑"前置检查，避免「代理没起 + 加 -c = 21s timeout 误诊」反例；参考 2026-07-28 v10.7.5→v10.7.6 用户拍板）

## 13. chrome-relay fork 维护策略

已搬到项目级:`D:\Documents\VibeCoding\chrome-relay\AGENTS.md` (v10.7.5 起的项目级规则,不再在全局 AGENTS.md 重复维护)。
适用范围 fork 仓库 (`zamelee/chrome-relay`,上游 `kiluazen/chrome-relay`) 的所有 commit / PR / cherry-pick / rebase 决策。
## 14. CodeX 自测与真测习惯 (F-SelfVerify, v10.13, effective_since = 2026-08-18)

<!-- F-RuleLifecycleMgmt: superseded_by = null ; supersedes = null ; effective_since = v10.13 -->

适用于所有写代码 / 改配置 / 调 UI / 修 bug 类任务 (前端 .tsx/.ts + 后端 Python + 工具 launcher.py 等)。沉淀自 2026-08 多次事故与重复纠错。

### 14.1 核心原则

改完之后必须自己测——不能把测试推给用户。两层:
1. 代码层模拟 (unit-level mock): 用 Python/Node 脚本造 fixture, 跑关键路径, 验逻辑 / 边界 / 异常分支。
2. 真实环境端到端: 重启服务 → curl API / 浏览器跑一遍 → 截图 + F12 console 验证。

两层都通过才报告完成。任何一层失败 → 回到修改, 不要用"用户测一下试试"应付。

### 14.2 代码层模拟 (mock fixture)

- mock fixture 优先: 写一个临时脚本 (tmp/_test_<feature>.py 或 .mjs), 不要为了测一两个 API 反复开关 launcher / backend / frontend。
- 覆盖三类输入: 正常 / 边界 / 异常 (空值 / 超长 / 特殊字符 / 并发)。
- TypeScript 项目: 改完跑 tsc --noEmit 验证零错误, 改动的文件零错误才合格 (历史遗留错误不算, 但不要新增)。
- Python 项目: 改完跑关键 import / 函数路径, 不要"看起来能跑就行"。

### 14.3 真实环境端到端 (真测)

- 重启依赖链: 改了 launcher.py → 重启 launcher; 改了 backend/ → 重启 backend; 改了 src/ → vite HMR 通常会自动, 但关键路径最好硬刷一次。
- 直接 API 测: python -c "import urllib.request; ..." 或 curl 测端点, 不依赖浏览器。
- 浏览器测 (前端改动):
  - 用 chrome-devtools-mcp 打开页面 → take_snapshot 看渲染 → list_console_messages 看错误 → list_network_requests 看请求 (找 ERR_ABORTED, 5xx)。
  - 截图保留证据 (take_screenshot), 引用在回复里。
- TK/launcher 类桌面应用: 用 launcher CLI debug 灌入 fixture (如 SEND ... ts=...), SCREENSHOT 看 UI, 截图保留。

### 14.3.5 验收门槛 (Definition of Done)

修改后的所有改动, 必须满足全部:

| 门槛 | 说明 |
|---|---|
| tsc --noEmit 干净 | TypeScript 改动必须无错误 (改动的文件零错误, 历史遗留忽略) |
| API curl OK | 直接 curl 后端端点, 不依赖浏览器 |
| 浏览器渲染 OK | chrome-devtools-mcp take_snapshot 无 console error, 截图引用在回复 |
| 端到端流程 OK | 改动涉及的 UI 流程, 真实跑一遍 (包括报错路径) |
| 截图保留 | 关键状态截图保存到 tmp/_verify_*.png 等, 回复里引用 |

### 14.4 反例 (踩过的坑)

- 改完直接告诉用户"你试试": 用户承担测试工作, 反馈链路 1+ 天。改完必须自己测。
- 只测 happy path: 异常路径 (timeout / abort / 404 / 空值) 经常暴露 bug, 必须覆盖。
- 看到 F12 console error 不报告: 必须捕获并报告, 否则下次又踩同一个坑。
- TypeScript 改完不跑 tsc --noEmit: 编译错误到运行时才暴露, 浪费一轮往返。
- 截图发完没保存: 截图是证据, 必须保存到 tmp/_verify_*.png 等, 后续排查可复用。
- 只跑 mock 不真测: mock 通过不等于真实环境通过 (vite proxy / DB / 浏览器特有 bug)。
- 只真测不跑 mock: mock 比真测快 10x, 边界 case 跑全靠 mock。

### 14.5 沉淀触发条件 (when to append rule)

每次用户说"自己测"、"要测的"、"要全面高效模拟"、"你 F12 试"等类似话 → 强化本节, 不要新增 — 用具体例子补充 §14.4 反例。

每次用户说"加到 agent.md" → 在本节加反例或门槛, 不要改 §0-§13 既有内容。

(append-only 模式, 按 §0b.6 红线约束)

---

## §15. 中英文并列规范(双向沟通原则)

适用范围: Codex 输出的所有**人机沟通**文本(报告/讨论/总结/诊断),不是代码本身.

### 15.1 何时使用并列

| 场景 | 处理方式 |
|---|---|
| **专业术语首次引入** | 英文 + 中文翻译 同行 |
| **跨语言资料引用** (chatgpt / Copilot / Gemini 答复) | 保留英文原词 + 中文翻译 |
| **代码命名**(类名/函数名/变量名) | 保留英文 + 给中文翻译 |
| **业务沟通关键概念** | 半通俗类比辅助理解(短) |
| **已经解释过的术语**(第二次出现) | 可省略翻译, 直接用 |

### 15.2 翻译方式 (按场景选)

- **直译**: 字面意思清晰的(如 
elation-extractor → 关系提取器)
- **专业语言**: 技术行业有标准译法的(如 hallucination → 幻觉, RAG → 检索增强生成)
- **项目语言**: 项目里已有特定命名的(如 Anchor / Canon / inspiration-draft)
- **半通俗类比**: 辅助理解, **不超过 1-2 句**, **不喧宾夺主**

### 15.3 长度控制

- 每个概念 1 行翻译 (20-50 中文字)
- 半通俗类比 ≤ 1-2 句 (防止概念散开)
- 概念第二次出现, 可只保留中文 (或英文)
- 同一条消息里同一个英文, **只翻译一次**, 后续出现用其中一种

### 15.4 正反例

**正例**:
- ✓ "**Anchors** (锚点: 单一事实的 pending/locked/superseded/rejected 状态)" — 直译 + 项目语言
- ✓ "**RAG** (Retrieval-Augmented Generation, 检索增强生成)" — 标准专业译法
- ✓ "**hallucination** (LLM 编造不存在的内容, 33% 幻觉率 = 关系提取中虚构实体占比)" — 半通俗 + 数据量化
- ✓ "**Canon** (项目里已被实体化的事实集合, 跟 Anchor 互为表里)" — 项目语言 + 关系

**反例**:
- ✗ "Configuration 配置设置系统管理参数选项控制" — 重复啰嗦, 翻译超过原文
- ✗ "这是一个用来处理文本数据的强大工具, 它能够处理各种文本, 为您的工作带来便利" — 半通俗太多, 概念散开
- ✗ "Anchors 是用来..." — 全英文无翻译
- ✗ 同一条消息里 "Anchors (锚点)" 出现 5 次 — 第一次翻译, 后续省略

### 15.5 何时**不**需要并列

- 用户已经熟悉的术语 (自己日常说的高频词: anchor / RAG / hallucination) — 直用英文
- 官方文档引用 (GitHub README / API 文档 / Stack Overflow) — 保留英文原版
- 错误信息原样 (console output / stack trace) — 不翻译
- 代码片段本身 — 代码就是英文, 不需要翻译
- 用户用中文提问时的代码变量名 — 可保留英文

### 15.6 反模式 (F-TranslationSpam)

- ❌ 翻译超过原文长度 — 喧宾夺主
- ❌ 半通俗类比超过 2 句 — 概念散开
- ❌ 同一英文每条消息都重翻 — 冗余
- ❌ 给错误信息加中文 — 失去精确性
- ❌ 给短变量名 (x i 
) 翻译 — 浪费 token

### 15.7 沉淀触发 (when to refine)

- 用户说"翻译太多" / "概念太散" / "直接英文就行" → 收紧 §15.3 / §15.4 反例
- 用户说"加到 agent.md" → 在 §15.4 加正例, §15.6 加反例
- (append-only 模式, 按 §0b.6 红线约束)


---

# §16 Markdown Authoring — Block-Structure Integrity (DRAFT v2)

> 适用范围: Codex 生成 / 总结 / 引用其他 AI 回复时输出 markdown.
> 设计原则 (per chatgpt 2026-08-23 review): 不追求"Markdown 语法百科", 而追求"二次改写过程中**不被破坏**的最小 block 结构集合".

## 核心原则

引用或改写其他模型的 Markdown 时, **保持原有块级结构和内联语义**; 修改内容时同步维护对应的 Markdown delimiters, **不要先删结构再补回来**.

---

## §16.1 Inline code / inline delimiters

**核心约束**: inline code 必须是成对 delimiter, opening 与 closing 长度匹配 (允许 1 个或 2 个反引号成对); inline code 不跨越 block boundary (不跨行, 不跨 fenced code 边界).

**反例**:
- `This is story content`` ← 单反引号残留 (corpus 2026-06 月 recurring)
- ``foo` ← 双反引号未配对
- `**bold \`code**` ← emphasis 内嵌 inline code 未配对

**正例**:
- `foo`
- ``code with ` inside`` (双反引号包围, 内部单反引号)

**不要硬约束**: 前后空格隔开 / 中文紧贴时的空格 — **不是 Markdown 语法要求**.

---

## §16.2 Fenced code blocks

**核心约束**: 三反引号 (\`\`\`) 必须成对 (opening + closing 长度一致); **语言标记 (\\\`\\\`\\\`ts) 优先, 但非必须**; 切勿把 prose / callout / blockquote 误包成 code block.

**反例** (用 prose 描述, 不演示字面 fence 字符避免配对歧义):
- 写了 opening 三反引号 + 语言标记 + 内容, 但**漏 closing 三反引号** → 后续所有段落被吃进 code block, 直到下一个 closing 三反引号
- 普通 prose 误包成 code block (在 prose 中误加 opening 三反引号)

**正例** (同上, 用 prose 描述):
- opening 三反引号 + typescript + 内容 + closing 三反引号 → 标准 fenced code block
- opening 三反引号 (无语言标记) + 内容 + closing 三反引号 → 合法 (语言标记可选)

**检测维度**: `codeblock_unpaired` — 必须 block-aware (lex fenced code first, 内部不参与 inline delimiter 计数).

---

## §16.3 Tables

<!-- F-RuleLifecycleMgmt: superseded_by = null ; supersedes = null ; effective_since = v10.15 -->

**核心约束**: §16.3 检测拆成 **4 个明确 predicate** (per chatgpt 评审 2026-08-26 + corpus v6/v7 实测, conversation 019f3cc1):

| predicate | 职责 | 来源 |
|---|---|---|
| `TABLE_PARSE` | parser 是否识别为合法 GFM table | parser structural |
| `TABLE_STRUCTURE` | parser-derived row/cell 结构 | parser structural |
| `TABLE_PIPE_STYLE` | project-specific source invariant (mixed-pipe 等) | §16 source invariant |
| `TABLE_COLUMN_DRIFT` | parser+source-derived 行宽 mismatch | parser + source hybrid |

**反例** (每个对应一个 predicate):
- separator 缺失 → TABLE_PARSE fail
- `| A | B | / | 1 | 2 | / | 3 | 4 |` ← separator 缺失
- `| A | B | C | / |---|---|---| / | 1 | 2 |` ← 第三行列数漂移 → TABLE_COLUMN_DRIFT
- 单元格含 literal `|` 未转义 → TABLE_STRUCTURE 多算 cell
- **混合 pipe style** (`已经锁定的方向| 维度 | 决策 |` + `|---|---|`) → TABLE_PIPE_STYLE fail (NEW per corpus 2026-08-26 conversation 019f3cc1, mixed pipe GFM-valid but Codex Desktop renderer 不兼容)

**正例**:
- `| A | B | C | / |---|---|---| / | 1 | 2 | 3 |` (separator + 列数对齐 + pipe style 一致)
- `| path | desc / |---|--- / | C:\\Users\\foo | 描述 |` (literal `\\` 转义)

**style 选项** (GFM spec 允许, Codex Desktop renderer 不一定接受):
- 每行前后 `|` 是 GFM **可选风格**, 不是语法硬约束
- 但 §16 推荐一律 strict (leading+trailing `|`), 因为 Codex Desktop renderer 对 mixed pipe style 不兼容
- `A | B / ---|--- / 1 | 2` 也是 GFM 合法, 但 §16 policy 不接受 mixed pipe

**GFM spec 关键引用**: leading/trailing pipe 是 optional, GFM 本身允许 mixed pipe. 但 Codex Desktop renderer 比 GFM spec 更严, 所以 §16.3 policy 比 GFM 更严格. **不要把 detector 标成 parser failure, 标成 source invariant violation**.

**检测维度** (4 个 predicate 分别对应):
- `TABLE_PARSE`: marked.js Lexer 识别 (v1.1.x 替换 regex)
- `TABLE_STRUCTURE`: parser token cells + raw 回 source 做 invariant
- `TABLE_PIPE_STYLE`: 比对每行 leading/trailing pipe 状态, 一致性 violation
- `TABLE_COLUMN_DRIFT`: parser cells.length vs source split (corpus msg#22 `\|\|` 已知 FP 风险)
- 必须 fenced-code / mermaid awareness (mermaid `-->|label|` 不应误识为 table pipe)

### 已知 limitation (corpus v6 + 019f3cc1 FN case)

**FP** (`table_col_drift` 旧 regex, 已知 corpus v3):
- corpus v3 报 2 个 hits (`019fa6c8 msg#22`, `01a023b9 msg#6`) 都是 false positive:
  - msg#22: cell 内 literal `\|\|`, detector 把 `\|\|` 误当 2 个 cell delimiter
  - msg#6: split('|') 边界错位, 多算 1 个 cell
- **§16.3 规则本身有效**: GFM spec 要求列数一致, 仍要遵守; detector 改进方向 (v1.1.x) 是换 marked.js tokenizer 而不是 regex split

**FN** (新发现 per 2026-08-26 conversation 019f3cc1):
- mixed pipe style (`已经锁定的方向| 维度 | 决策 |` 头行 loose + `|---|---|` separator strict) — 旧 regex `split('|')` 数 cell 与 separator 对齐 → 报 OK, 但 Codex Desktop renderer 拒渲染
- 这是 corpus 里**第一个纯 FN 案例** (之前 corpus v3 仅 FP, 无 FN)
- 修法: 不要标 parser failure, 标 TABLE_PIPE_STYLE invariant violation

**detector 改进方向** (v1.1.x, marked.js migration per chatgpt 评审 2026-08-26):
- 用 marked Lexer 做 TABLE_PARSE + TABLE_STRUCTURE
- token.raw 配合 regex 做 TABLE_PIPE_STYLE + TABLE_COLUMN_DRIFT
- 旧 regex 不能完全删, 走 "shadow regression oracle" (不参与 production decision, 仅做 cross-validation)
- **differential matrix**: old regex vs marked structural vs marked+§16 三路对比 (Gate A-D ship gate)

**shadow vs fallback 关键修正** (per chatgpt 评审):
- 之前提议 `marked primary + regex fallback + 2 minor 后删`
- chatgpt 修正: `marked primary + regex shadow` — fallback 会出现 union/intersection 语义冲突, shadow 只跑不决策
- ship gate 不该是时间维度 ("2 minor 后删"), 应该是质量维度 (Gate A-D)

## §16.4 Lists

**核心约束**: 同级 list item 缩进一致; nested list 缩进按 2 空格或 4 空格 (但要统一); marker (ordered `1.` / unordered `- * +`) 是**风格选择**, 不限制.

**反例**:
- `- A / - A1 /   - A2` ← 父与子同级 (缩进丢失, nesting 降级为 flat)
- `1. 一 / 2 二 / 3. 三` ← 同一列表混合 `1.` 和 `1` 风格
- `\
-禁` ← 虽然没空格, 但前一行是 paragraph + 下行以 `-` 开头, **不构成 list corruption** (这是 corpus FP)

**正例**:
- `- A /   - A1 /     - A2` (consistent indent)
- `1. 一 / 2. 二 / 3. 三` (consistent marker style)

**不要硬约束**: ordered 必须 `数字 + .` / unordered 必须 `- `. `*` `+` `1)` 都是合法 Markdown.

---

## §16.5 Emphasis + Blockquotes

### Emphasis

**核心约束**: `**bold**` / `*italic*` / `~~strikethrough~~` 必须成对; 嵌套时 delimiter 长度匹配 (`**bold \`code\`**` 之类要小心).

**反例**:
- `**bold only opening` ← 单 `**` 残留 (corpus 2026-07-13 msg23 `model_provider**` 即此类)
- `**bold \`code**` ← inline code 内 `` 被 emphasis 边界吞掉

**正例**:
- `**bold**` `*italic*` `~~strike~~`

### Blockquote

**核心约束**: 连续多行 `>` 表示同一引用块; 中间断行 `>` 缺失会导致引用块"分段"或降级为普通段落 (视觉上明显).

**反例**:
- `> line 1 / line 2 / > line 3` ← 中间断 `>` 丢失, line 2 退出引用块

**正例**:
- `> line 1 / > line 2 / > line 3` (全 `>` 连续)

**不要硬约束**: callout 必须用 `>`. 但**禁止**把本应是 blockquote 的内容误包成 fenced code.

**检测维度**: `emphasis_unpaired` — 必须 fenced-code + inline-code awareness; `blockquote_continuation_lost` — 新 detector.

### 已知 limitation (corpus v3 实证)

`emphasis_unpaired` detector 当前不是 100% 精确 (corpus 4 个 candidates 里 3 真 TP + 1 内部 protocol FP):

- **3 真 TP** (`019eb19c msg#59`, `019eb4e8 msg#5`, `01a00ed1 msg#43`): Codex 在 prose 中确实把 `**` 写残 (嵌套混乱 / opening 与 closing 失衡), 这些是真 markdown corruption, §16.5 规则有效
- **1 FP** (`019f5fbf msg#64`): Codex 内部 `apply_patch` 工具调用的 protocol 字符 (`*** Begin Patch` / `*** End Patch`) 泄漏到 assistant content 字段, 这是 **Codex 上游 tool_call 序列化 bug**, 不是 markdown 写残. detector 不应跳过这类内容 (协议格式不稳定, 维护成本高); 正确修复路径是 Codex 把 `apply_patch` 输出移到 `tool_use` block 而不是 `text` block

detector 改进方向 (v1.1.x, 不在本轮范围): parser/token-aware 替代 regex, 需要 import marked tokenizer. 当前 v8 regex-based detector 已减少 FP 63% (corpus 41 → 15), 实用性足够

---

## §16.6 Mermaid — safe authoring subset

**核心约束**: 引用 §11.8 safe label 规则; **额外**避免以下经验性 failure pattern (corpus M1-M7 实测):

1. **Statement packing**: 多条 edge / classDef 写在同一行
   - 反: `W --> CONF O --> M O --> CONF classDef ...` (M6 真因)
   - 正: 每条 edge / declaration 单独一行

2. **`end` 与 edge 同行**: `end C --> G` ← parser 不报错但 render 异常
   - 正: `end\nC --> G`

3. **Inline declaration**: `flowchart TD <node>` 在一行定义节点, 易触发 plaintext fallback
   - 正: `flowchart TD\nA[Label]\n...` 多行

4. **Subgraph + 特殊 label 组合**: subgraph 内节点 label 含 `{...}:` / `ConflictReport[]` 等

**Mermaid lint**: 走 ~/.codex/tools/lint-mermaid.mjs (L1-L9 规则). 引用 §11.8 / §11.9 的 recovery 流程.

**检测维度** (per corpus v6 + chatgpt 评审 2026-08-26 重定位):

- **删除** `mermaid_block_present` corruption 语义: "存在 Mermaid block" 本身不是 corruption
  - corpus 实测: 270/87 个 Mermaid block 中只有 4 个 plaintext fallback (96% 正常)
  - 把"有 Mermaid" 当 anomaly ≈ "文件里出现合法语法结构"

- **新分类** (corpus taxonomy 升级):
  - `mermaid_present` → informational, 不属于 §16 corruption detector
  - `mermaid_risky` → heuristic warning
  - `mermaid_parse_failed` → actual structural failure
  - `mermaid_render_failed` → renderer compatibility failure

- `mermaid_risky_label` → 独立 renderer-compatibility detector (不属于 GFM detector)
- 保留 `mermaid_unparseable` / `mermaid_render_error` / `mermaid_high_risk_pattern` 拆分

---

## §16.7 Final structural self-check

<!-- F-RuleLifecycleMgmt: superseded_by = null ; supersedes = null ; effective_since = v10.15 -->

**Rule 0 (code-fence boundary discipline)**: 每个 ``` 代码块的开闭合 ``` 之间的“距离”不能超过 **两段 prose**(heading + 解释 + 列表各自独立)。如果 opening ``` 后面跟的不是 regex / const / function / import / return / class / let / var / for / while / if / 等“直接代码行”，**先关 ``` 再加文字**——不要让 prose 被吞进 code block。

适用范围:Codex 写给用户读的所有 Markdown(prose + report + handoff)。本规则跟 §16.7 既有 8 项 checklist 互为补充——Rule 0 是结构层硬约束(开 ``` 位置)，8 项是字符层(配对 / pipe / escape 等)。

反例 (corpus 实测):
- 开 ``` 后接解释文字 + 关 ``` 在另一段，中间 prose 被吞 → table / link 全坏
- 开 ``` 后接“以下是代码:” + 关 ```，文字部分未被识别为 prose
- opening ``` 后立即空行 + 解释段，renderer 行为不稳定 (有的 renderer 把空行当 prose boundary，有的吞掉)

正例 (corpus 实测):
- 开 ``` → 第一行就是 const/function/regex 等直接代码 → 关 ```
- 多段独立 code block，每段自己开/关
- 开 ``` → 空行 → 解释(用 blockquote `>` 包)→ 关 ```(这种情况 blockquote 不算 prose 吞并，但要保证关 ``` 紧贴解释)

(v1.3.1 patch, effective_since = v10.16, supersedes = null — 沉淀 corpus v7 HB-I 系列 + 6B + HB-Q 反例，根本原因是 §16.7 旧规则没约束开 ``` 后第一行内容类型)
发送 Markdown 前, 按顺序逐项确认:

```
1. 所有 code fence 成对 (closing 与 opening 长度一致)?
2. 所有 inline delimiter (` / ** / * / ~~) 成对? (code block 内不参与)
3. 所有 table 有 header + separator + 各行列数一致? (TABLE_PARSE / TABLE_STRUCTURE / TABLE_COLUMN_DRIFT)
4. 所有 table 内 pipe 风格一致 (leading/trailing pipe 一致性, TABLE_PIPE_STYLE)? **NEW per 019f3cc1**
5. 所有 list / blockquote 没有跨 block 错位?
6. 所有 link / image delimiter (`[text](url)` / `![alt](path)`) 完整?
7. 所有 escape (\\\\ / \\| / \\* / \\_ / \\#) 保留?
8. Mermaid 块单独执行 §11.8 safe subset 检查?
```

任一项不通过 → 重写, 不要"差不多就行".

### corpus v7 differential matrix 验证方法 (NEW 2026-08-26)

发送前的 markdown 必须先经过 differential corpus 验证 (per chatgpt 评审):

```
                old regex    marked       marked+§16
------------------------------------------------------
real corruption      ?           ?             ?
real clean           ?           ?             ?
FN-001 mixed-pipe   MISS        MISS          HIT
Mermaid-pipe FP     HIT         MISS          MISS
escaped-\\| FP       HIT         MISS          MISS
mixed-pipe FN       MISS        MISS          HIT
```

- **Gate A**: 100% corpus 无 unexplained parser/regex disagreement, **parser FN = 0**
- **Gate B**: 持续从真实 conversation 加新 case, 不只靠人工构造
- **Gate C**: 连续 2 个 release marked detector 无 regression / 无新 FP/FN
- **Gate D**: 所有 disagreement 都有解释 (regex FP expected, regex FN expected, etc.)

## 与既有规则的关系

- **§11** 路径 forward-slash + 文件链接约束 → §16 不重复, 引用 §11
- **§11.8 / §11.9** Mermaid safe label + recovery → §16.6 引用
- **§14.1** 自测习惯 → §16.7 是 markdown 维度专项自检
- **§15** 中英对照 → §16 不冲突 (§15 约束人话翻译, §16 约束 markdown 字符层)

## 附录 — corpus v7 differential corpus mapping (per 019f3cc1)

<!-- F-RuleLifecycleMgmt: superseded_by = null ; supersedes = null ; effective_since = v10.15 -->

**重要修正** (per chatgpt 评审 2026-08-26): corpus v3 的 "41 candidates" 是 detector 命中集合, **不是 ground truth**. 直接当 TP / FP / FN 会严重高估 precision (TN 永远偏小). corpus v7 必须用 differential matrix 标 TP / FP / ambiguous.

**FN-001 golden test** (per 019f3cc1):
- input: `已经锁定的方向\| 维度 \| 决策 \|` + `\|\|-\|-\-\|`
- expected: parser=table, pipeStyle=mixed, §16=violation (TABLE_PIPE_STYLE)
- 这是 corpus 里**第一个纯 FN 案例**

| type | corpus v6 实测 TP / FP / mixed | §16 节 | 新定位 |
|---|---|---|---|
| inline_code_unpaired | 11 candidates, 混合以 TP 为主 (有 corpus 证据) | §16.1 | 保留, **新 lexical/inline rule on marked token stream** |
| codeblock_unpaired | 2 TP (有 snippet 证据) | §16.2 | 保留, **parser-assisted** |
| emphasis_unpaired | 8 candidates, count-based, **FP 比例可能高** | §16.5 | 保留, **必须脱离 count delimiter 依赖**, 走 marked inline tokenizer |
| bullet_misalignment | 4 candidates, **全部 FP** (`\n-禁` 等启发式) | §16.4 | 保留为 **source-style rule** (`LIST_MARKER_SPACE`), 不期待 parser 替你判 |
| heading_no_space | 1 TP | §16 (新) | 保留为 **source-style rule** (`HEADING_HASH_SPACE`) |
| table_corrupt | **3 FP + 1 TP** (corpus 实测, mixed-pipe 是 FN 不是 TP) | §16.3 | **拆成 4 predicate**: TABLE_PARSE / TABLE_STRUCTURE / TABLE_PIPE_STYLE / TABLE_COLUMN_DRIFT |
| mermaid_block_present | 14 candidates, **绝大部分 FP** ("有 Mermaid" ≠ corruption) | §16.6 | **删除 corruption 语义**, 改 informational (mermaid_present / mermaid_risky / mermaid_parse_failed / mermaid_render_failed) |
| mermaid_risky_label | 7 (M1-M7 plaintext fallback) | §11.8 / §11.9 | 独立 renderer-compatibility detector, 不属于 GFM detector |
