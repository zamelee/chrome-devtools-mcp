#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
_cdp_inspect.py — raw Chrome DevTools Protocol (CDP) debug template

USER-ONLY TOOL (按 ~/.codex/AGENTS.md §0b.2).
  - Codex agent 不得自动调用此脚本;走 raw CDP 是 §0b.2 显式禁止的
    "debug-spree" 反模式。给真人 user 临时调试用。
  - 适用场景: 当 mcp-chrome chrome_javascript 工具不够精细时 (例如需要
    Page.addScriptToEvaluateOnNewDocument 在每个新文档加载前自动注入,
    而不是单次 evaluate_script),user 走 raw CDP 拿这个能力。

ORIGIN:
  storyforge-server 项目调试 /storyforge/workspace/* workspace 时需要 admin
  JWT 注入 localStorage,人手动搓的工具。迁移到这里作为通用 CDP debug
  模板 (脱敏 + 参数化) 复用。

USAGE (Windows):
  pip install websockets
  set STORYFORGE_TOKEN=<your dev JWT>
  set STORYFORGE_TARGET=http://localhost:1111/some/page
  python scripts/_cdp_inspect.py

PARAMETERS (env var, all optional with defaults shown):
  CDP_CHROME          http://127.0.0.1:9222    Chrome DevTools HTTP endpoint
  STORYFORGE_TARGET   http://localhost:1111/storyforge/workspace/<id>
  STORYFORGE_TOKEN    <empty>                  localStorage 'storyforge:auth-token' 注入值
  CDP_OUT_DIR         tempfile.gettempdir()         events.json + workspace.png 输出目录 (默认 = 系统 temp)
  CDP_READY_WAIT      14                       等待 vite/React/lazy chunks 加载的秒数
  CDP_FORCE_NEW_TAB   (unset)                  设 1 强制开新 tab (隔离调试场景, §0d.4)

TAB REUSE (按 AGENTS.md §0d.3 精神):
  - 默认先 GET /json/list, URL 完全匹配 (origin + path, 剥 fragment + query,
    §0d.2) → 复用现有 tab 的 ws_url, 不开新
  - 没匹配 → PUT /json/new 开新 tab
  - 设 CDP_FORCE_NEW_TAB=1 跳过 list 直接开新 (跨会话接手 / 强制隔离场景)
  - 这条逻辑同样适用于 raw CDP / chrome-devtools-mcp / chrome-relay: 不要
    每操作一次就开新 tab, 持久化 tab 选择 (避免 Chrome 标签栏堆积)

WHAT IT DOES:
  1. (按 §0d) 优先复用 URL 匹配的现有 tab;否则 PUT /json/new 开新 tab 到目标 URL
  2. WebSocket 连 CDP (raw, 不经 mcp-chrome / chrome-devtools-mcp)
  3. Page.addScriptToEvaluateOnNewDocument: 注入 JWT 到 localStorage (任何后续 doc 加载都生效)
  4. Page.navigate → 等 ready 秒 → Runtime.evaluate 探测页面状态
  5. Page.captureScreenshot → workspace.png
  6. 收集 Runtime.exceptionThrown + Runtime.consoleAPICalled (error/warning) +
     Log.entryAdded (error/warning) + Network.responseReceived (>=400) +
     Network.loadingFailed → events.json
  7. print 所有 error-class events 摘要到 stdout

OUTPUTS (default paths):
  workspace.png          full-page screenshot
  _cdp_events.json       collected error-class events
  stdout                 human-readable summary
"""

import asyncio
import base64
import json
import os
import sys
import tempfile
import urllib.request

try:
    import websockets
except ImportError:
    sys.stderr.write(
        "missing dep: websockets\n"
        "  pip install websockets\n"
    )
    sys.exit(2)

# ---- Configurable via env (defaults match the original storyforge-server use case) ----
CHROME = os.environ.get("CDP_CHROME", "http://127.0.0.1:9222")
TARGET = os.environ.get("STORYFORGE_TARGET",
                        "http://localhost:1111/storyforge/workspace/")
TOKEN_RAW = os.environ.get("STORYFORGE_TOKEN", "")  # 0 长度 = 跳过 token 注入
OUT_DIR = os.environ.get("CDP_OUT_DIR", tempfile.gettempdir())
READY_WAIT = float(os.environ.get("CDP_READY_WAIT", "14"))
FORCE_NEW_TAB = bool(os.environ.get("CDP_FORCE_NEW_TAB", "").strip())  # §0d.4 强制隔离
OUT_ERR = os.path.join(OUT_DIR, "_cdp_events.json")
OUT_PNG = os.path.join(OUT_DIR, "_cdp_workspace.png")

if not TOKEN_RAW:
    sys.stderr.write(
        "[warn] STORYFORGE_TOKEN is empty; token injection skipped (Page.addScriptToEvaluateOnNewDocument not installed)\n"
    )

_id = [0]


def nid():
    _id[0] += 1
    return _id[0]


def http_new_tab(url):
    """PUT /json/new → open a fresh tab. raw CDP /json/new always opens new (no reuse)."""
    req = urllib.request.Request(
        CHROME + "/json/new", method="PUT",
        data=json.dumps({"url": url}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read().decode("utf-8"))


def http_list_tabs():
    """GET /json/list → return all current tabs. raw CDP analogue of
    mcp-chrome's chrome_get_windows_and_tabs. Each entry has
    id, url, webSocketDebuggerUrl, type. Per §0d.2 the URL field priority
    is origin+path > query > fragment; we normalize by stripping both."""
    req = urllib.request.Request(CHROME + "/json/list", method="GET")
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read().decode("utf-8"))


def find_existing_tab(url):
    """按 AGENTS.md §0d.3 tab 复用: 找 URL 完全匹配的现有 page-type tab.

    Returns the tab dict (has id, url, webSocketDebuggerUrl) or None.
    Match rule (per §0d.2):
      - strip fragment + query from both sides
      - require tab.type == "page" (skip service workers / extensions / etc.)
    """
    target_norm = url.split("?", 1)[0].split("#", 1)[0]
    for tab in http_list_tabs():
        if tab.get("type") != "page":
            continue
        tab_norm = tab.get("url", "").split("?", 1)[0].split("#", 1)[0]
        if tab_norm == target_norm:
            return tab
    return None


async def main():
    events = []

    # ---- Step 0: 按 §0d tab 复用 (default ON, skip via CDP_FORCE_NEW_TAB=1) ----
    new_tab = None
    if not FORCE_NEW_TAB:
        existing = find_existing_tab(TARGET)
        if existing:
            new_tab = existing
            events.append({
                "type": "diag",
                "text": "REUSED existing tab %s (URL match per §0d.3) -> %s"
                         % (existing["id"], TARGET),
            })
            print("[info] reused tab", existing["id"], flush=True)

    if new_tab is None:
        # open target tab directly — skip the /json/new 302 redirect to avoid
        # "evaluate before origin ready" race
        new_tab = http_new_tab(TARGET)
        events.append({
            "type": "diag",
            "text": "no matching existing tab (or CDP_FORCE_NEW_TAB=1), opened NEW tab %s -> %s"
                     % (new_tab["id"], TARGET),
        })
        print("[info] opened new tab", new_tab["id"], flush=True)

    ws_url = new_tab["webSocketDebuggerUrl"]
    tab_id = new_tab["id"]

    pending = {}
    msg_q = asyncio.Queue()

    async with websockets.connect(ws_url, max_size=64 * 1024 * 1024, ping_interval=None) as ws:
        stop = asyncio.Event()

        async def reader():
            while not stop.is_set():
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=0.5)
                except asyncio.TimeoutError:
                    continue
                except websockets.ConnectionClosed:
                    return
                rec = json.loads(raw)
                mid = rec.get("id")
                if mid and mid in pending:
                    pending.pop(mid).set_result(rec)
                else:
                    await msg_q.put(rec)

        reader_task = asyncio.create_task(reader())

        async def call(method, params=None):
            mid = nid()
            fut = asyncio.get_event_loop().create_future()
            pending[mid] = fut
            await ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
            return await asyncio.wait_for(fut, timeout=15)

        async def collect_events():
            while not stop.is_set():
                try:
                    rec = await asyncio.wait_for(msg_q.get(), timeout=0.5)
                except asyncio.TimeoutError:
                    continue
                m = rec.get("method", "")
                p = rec.get("params", {})
                if m == "Runtime.exceptionThrown":
                    ed = p.get("exceptionDetails", {})
                    events.append({
                        "type": "exception",
                        "text": ed.get("text", ""),
                        "desc": ed.get("exception", {}).get("description", ""),
                        "url": ed.get("url", ""),
                        "line": ed.get("lineNumber"),
                        "col": ed.get("columnNumber"),
                    })
                elif m == "Runtime.consoleAPICalled":
                    if p.get("type") in ("error", "warning"):
                        txt = " ".join(str(a.get("value", a.get("description", ""))) for a in p.get("args", []))
                        events.append({"type": "console_" + p["type"], "text": txt[:1000]})
                elif m == "Log.entryAdded":
                    lv = p.get("entry", {}).get("level")
                    if lv in ("error", "warning"):
                        e = p["entry"]
                        events.append({
                            "type": "log_" + lv,
                            "text": e.get("text", "")[:1000],
                            "source": e.get("source"),
                            "url": e.get("url"),
                        })
                elif m == "Network.responseReceived":
                    s = p.get("response", {}).get("status", 0)
                    if s >= 400:
                        events.append({
                            "type": "net_http_err",
                            "status": s,
                            "url": p["response"].get("url", "")[:200],
                        })
                elif m == "Network.loadingFailed":
                    events.append({"type": "net_fail", "text": p.get("errorText", "")})

        collector_task = asyncio.create_task(collect_events())

        for m in ("Runtime.enable", "Page.enable", "Log.enable", "Network.enable"):
            await call(m)

        # optional: install token injector on every new document
        # raw template literal (NOT json.dumps which would wrap in quotes -> invalid Bearer)
        if TOKEN_RAW:
            js_token = "`" + TOKEN_RAW + "`"
            injector = (
                "try {"
                "  localStorage.setItem('storyforge:auth-token', " + js_token + ");"
                "  window.__tokenInjected = true;"
                "} catch(e) { window.__tokenInjectErr = String(e); }"
            )
            r = await call("Page.addScriptToEvaluateOnNewDocument",
                           {"source": injector, "runImmediately": True})
            events.append({"type": "diag",
                           "text": "Page.addScriptToEvaluateOnNewDocument installed: %s"
                                   % json.dumps(r.get("result"))[:200]})
        else:
            events.append({"type": "diag", "text": "token injector SKIPPED (empty STORYFORGE_TOKEN)"})

        # navigate to target
        await call("Page.navigate", {"url": TARGET})
        events.append({"type": "diag", "text": "navigated -> " + TARGET})

        # wait for vite SPA + react bootstrap + lazy chunks
        await asyncio.sleep(READY_WAIT)

        # probe page state
        r = await call(
            "Runtime.evaluate",
            {"expression": (
                "JSON.stringify({"
                "title:document.title,"
                "path:location.pathname,"
                "ready:document.readyState,"
                "origin:location.origin,"
                "tokenLen:(localStorage.getItem('storyforge:auth-token')||'').length,"
                "injectorErr:window.__tokenInjectErr||null,"
                "injectorRan:window.__tokenInjected||false"
                "})"
            ), "returnByValue": True},
        )
        events.append({
            "type": "diag",
            "text": "page: " + str(((r.get("result") or {}).get("result") or {}).get("value")),
        })

        # screenshot
        shot = await call(
            "Page.captureScreenshot",
            {"format": "png", "captureBeyondViewport": True, "fromSurface": True},
        )
        b64 = (shot.get("result") or {}).get("data")
        if b64:
            png = base64.b64decode(b64)
            with open(OUT_PNG, "wb") as f:
                f.write(png)
            events.append({"type": "diag", "text": "screenshot: %s (%d bytes)" % (OUT_PNG, len(png))})
        else:
            events.append({"type": "diag", "text": "screenshot: empty response"})

        await asyncio.sleep(2)
        stop.set()
        for t in (reader_task, collector_task):
            try:
                await asyncio.wait_for(t, timeout=2)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                pass

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT_ERR, "w", encoding="utf-8") as f:
        json.dump(events, f, ensure_ascii=False, indent=2)

    print("[info] events=%d file=%s" % (len(events), OUT_ERR), flush=True)
    errs = [e for e in events
            if e["type"].startswith(("exception", "console_error", "log_error", "net_"))]
    print("[info] error-class events: %d" % len(errs), flush=True)
    for e in errs[:60]:
        extra = ""
        if e["type"] == "net_http_err":
            extra = " %s %s" % (e.get("status"), e.get("url", ""))
        elif e["type"] == "exception":
            extra = " @ %s:%d:%d" % (e.get("url", ""), e.get("line", 0), e.get("col", 0))
        print("  [%s] %s%s" % (e["type"], (e.get("text", "") or "")[:300], extra), flush=True)


if __name__ == "__main__":
    sys.exit(asyncio.run(main()) or 0)
