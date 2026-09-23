<!-- F-RuleLifecycleMgmt: superseded_by = null ; supersedes = null ; effective_since = v10.20 -->

# fork release notes (zamelee/chrome-devtools-mcp)

fork 自维护的 release notes — 累积 fork 在 upstream 之外的衍生改动。上游 release notes 见 [`../CHANGELOG.md`](../CHANGELOG.md)(release-please bot 自动生成)。

> **Tag policy**:fork 自家 tag 用 `chrome-devtools-mcp-vX.Y.Z+fork-N` 命名,base 是 upstream 同步 tag + fork 累积 commit 数。当前最新 tag:
> - [`chrome-devtools-mcp-v1.7.1`](../../tmp/code-backups/phase2a-handoff.md)(基于 upstream v1.7.0 + Tier 1 cherry-picks)

---

## v1.7.1(2026-09-23)— Tier 1 cherry-pick from upstream v1.7.0..v1.9.0

### 落地 commits

```
d94f061 merge: cherry-pick upstream #2792 + puppeteer 25.11.0 upgrade
6032407 chore(deps): bump puppeteer 25.5.0 to 25.11.0 (prerequisite for #2792 TimeoutError import)
022f353 fix: preserve underlying error message in input tool actions (#2792)
7c0e523 merge: cherry-pick upstream #2773 ConsoleCollector retention bound
c3dbf82 fix: bound ConsoleCollector retention per navigation (#2773)
9146489 docs(mcp): 玄学问题(INPUT tool namespace collision)+ fork MCP server config reference
```

### Cherry-picks landed

#### Tier 1 bug fix:ConsoleCollector retention bound(`#2773` upstream commit `e98a3ca`)
- **What**:`src/collectors/PageCollector.ts`(`ConsoleCollector` 现在继承自 `PageCollector`,加 `MAX_MESSAGES_PER_NAVIGATION = 1_000` bound)
- **Why**:长 session / SPA 不 navigate 时,console messages 在单 navigation bucket 无界累积。NetworkCollector 已有这个 bound(`MAX_REQUESTS_PER_NAVIGATION = 1_000`),ConsoleCollector 现在一致。
- **Tests**:`tests/PageCollector.test.ts` 新增 bound 验证

#### Tier 1 bug fix:preserve underlying error message(`#2792` upstream commit `6e47dbb`)
- **What**:`handleActionError` 在 `error instanceof TimeoutError` 为真时才报 "element did not become interactive",否则 surface 真实 error message
- **Why**:之前所有 `click` / `hover` / `fill` / `fill_form` 失败都报同一个 "did not become interactive",掩盖真实原因(如 `Could not find option with text "..."`)
- **Side effect**:`src/third_party/index.ts` 重新 export `TimeoutError`(之前 fork 没这个 export)
- **Prerequisite**:puppeteer 25.5.0 → 25.11.0(`TimeoutError` 是 puppeteer 25.10+ 才有的 export)

### Prerequisite dep upgrade

- `puppeteer`: `25.5.0` → `25.11.0`(对齐 upstream HEAD)
- 同步 `pnpm-lock.yaml` via `pnpm add -D puppeteer@25.11.0`(不用 `pnpm install --ignore-scripts`,会导致 lockfile mixed state)
- 同步 `puppeteer-core` via `pnpm overrides`

### Cherry-picks skipped

#### `#2772` WaitForHelper timeout — 等价重构冲突
- **Why skipped**:fork HEAD 已有 `waitForNavigationStarted()` helper method 实现同 navigation tracking。upstream #2772 是 inline 重构 + 加 `navigationAbortController`。两者**功能等价**,cherry-pick 收益 = 0,merge 冲突代价 = 大(改 caller 抽象层)。
- **Skip 记录**:`tmp/code-backups/tier1-sync-handoff.md`

#### `#2794` dialogs during input — input.ts 大改丢 fork fillSafe
- **Why skipped**:upstream #2794 改了 `src/tools/input.ts` 262 lines。`git checkout --theirs src/tools/input.ts` 会用 upstream 版本替换 fork 的 1117 行 input.ts,**丢掉 fork 核心特性**:
  - `fillSafe`(React 18 controlled input,§0a.x.17)— 8 引用
  - `type_text` Shift+Enter hybrid injection(§0a.x.2.x)— 多行 prompt 段落保留
  - Tier 3 chatgpt v2 fallback(§0b.7.10)— 14 引用
- **Reset**:commit `2bfb4bd` 创建后立刻 `git reset --hard 022f353` 恢复 fork input.ts。
- **Manual merge recipe**:`tmp/code-backups/phase2a-handoff.md` § "Recovery strategy if #2794 dialog-handling is wanted later" — 需要 1-2 小时人工 cherry-pick `McpPage.ts + WaitForHelper.ts + ToolDefinition.ts + third_party/index.ts` 部分,手动移植 dialog-detection logic 到 fork `input.ts`。

### Fork 自家文档(本 v1.7.1 之前)

- `docs/mcp-server-config.md`(新建,~12 KB)— 3 个 MCP server 调试过参数 + 全局 `mcp_optional_startup_grace_ms = 5000` 详解
- `docs/troubleshooting.md`(append ~6 KB)— §玄学问题(INPUT tool namespace collision)
  - Layer 1/2/3/4 filter 模型
  - Computer Use plugin namespace dedup 根因
  - 修法:Settings → Plugins → Computer Use toggle off + 重启 Codex Desktop
  - 8 个常见误区('What does not fix' 反例清单)

### Verification

| 维度 | baseline(9146489)| v1.7.1(本 release)|
|---|---|---|
| `src/tools/input.ts` | 1117 lines + fillSafe + Tier 3 | 1117 lines + fillSafe + Tier 3 + TimeoutError(#2792)|
| `src/PageCollector.ts` | 0 bound | `MAX_MESSAGES_PER_NAVIGATION = 1_000`(#2773)|
| `src/third_party/index.ts` | 无 `TimeoutError` export | `TimeoutError` + `ScreenRecorder` exports |
| `puppeteer` | 25.5.0 | 25.11.0 |
| tsc errors | 63 | 71(8 来自 upstream imports,**无 fork-side regressions**)|
| `build/src/bin/chrome-devtools-mcp.js` | 9/1 旧 | 9/23 rebuild |

### Tier 1 整体进度

| # | upstream commit | fork merge | status |
|---|---|---|---|
| #2773 ConsoleCollector bound | `e98a3ca` | `c3dbf82` / `7c0e523` | ✅ |
| #2792 preserve input error | `6e47dbb` | `022f353` / `d94f061` | ✅ |
| #2772 WaitForHelper timeout | `dc1d055` | — | ❌ skipped(等价重构)|
| #2794 dialogs during input | `266112b` | — | ❌ aborted(manual merge TBD)|

### Not for upstream PR

按 fork policy,本 release **不**给 upstream ChromeDevTools/chrome-devtools-mcp 开 PR。fork 自己用。