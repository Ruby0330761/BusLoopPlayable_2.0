#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { writeFile } from "node:fs/promises";

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const name = value.slice(2);
    if (name === "disable-webgl") {
      result[name] = true;
      continue;
    }
    result[name] = argv[index + 1];
    index += 1;
  }
  return result;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForTarget(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
        if (page) return page;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Chrome DevTools target unavailable: ${lastError || "timeout"}`);
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", () => reject(new Error("CDP websocket failed")), { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result || {});
        return;
      }
      const listeners = this.events.get(message.method) || [];
      listeners.forEach((listener) => listener(message.params || {}));
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  once(method, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timeout`)), timeoutMs);
      const listener = (params) => {
        clearTimeout(timer);
        const listeners = this.events.get(method) || [];
        this.events.set(method, listeners.filter((item) => item !== listener));
        resolve(params);
      };
      this.events.set(method, [...(this.events.get(method) || []), listener]);
    });
  }

  close() {
    if (this.socket && this.socket.readyState <= 1) this.socket.close();
  }
}

async function evaluate(client, expression) {
  const response = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text || "Runtime.evaluate failed");
  }
  return response.result ? response.result.value : undefined;
}

function targetExpression(explicitSelector) {
  return `(() => {
    const probe = window.__PLAYABLE_RUNTIME_PROBE__;
    const explicit = ${JSON.stringify(explicitSelector || null)};
    const visible = (node) => {
      if (!node || typeof node.getBoundingClientRect !== "function") return false;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return rect.width >= 4 && rect.height >= 4 && style.display !== "none" &&
        style.visibility !== "hidden" && style.pointerEvents !== "none" &&
        !node.disabled && node.getAttribute("aria-disabled") !== "true";
    };
    const candidates = [];
    let selectorError = null;
    if (explicit) {
      try { candidates.push(...document.querySelectorAll(explicit)); }
      catch (error) { selectorError = String(error && error.message || error); }
    } else {
      const preferred = ["[data-cta]", "[data-action='cta']", "[data-testid*='cta' i]", "#cta", ".cta"];
      preferred.forEach((selector) => {
        try { candidates.push(...document.querySelectorAll(selector)); } catch (_) {}
      });
      const textPattern = /install|download|get|play now|shop now|learn more|continue|安装|下载|立即|试玩|继续/i;
      document.querySelectorAll("button,a,[role='button']").forEach((node) => {
        if (textPattern.test(String(node.innerText || node.textContent || node.getAttribute("aria-label") || ""))) {
          candidates.push(node);
        }
      });
    }
    const node = candidates.find(visible) || null;
    if (!node) {
      if (probe) probe.ctaTarget = { found: false, selector: explicit, selectorSource: explicit ? "explicit" : "auto", selectorError };
      return { found: false, selector: explicit, selectorSource: explicit ? "explicit" : "auto", selectorError };
    }
    node.scrollIntoView({ block: "center", inline: "center" });
    const rect = node.getBoundingClientRect();
    const stageNode = node.closest("[data-stage]");
    const stage = node.getAttribute("data-stage") || (stageNode && stageNode.getAttribute("data-stage")) ||
      window.__PLAYABLE_STAGE__ || document.body?.getAttribute("data-stage") || location.hash || "cta-visible";
    const target = {
      found: true,
      selector: explicit,
      selectorSource: explicit ? "explicit" : "auto",
      tagName: node.tagName,
      id: node.id || null,
      className: typeof node.className === "string" ? node.className.slice(0, 160) : "",
      text: String(node.innerText || node.textContent || node.getAttribute("aria-label") || "").trim().slice(0, 160),
      stage: String(stage),
      actionable: true,
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
    if (probe) {
      probe.ctaSelectorFound = true;
      probe.ctaTarget = target;
      probe.ctaDispatch = { inputMethod: "cdp-mouse", x: target.x, y: target.y };
    }
    return target;
  })()`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const required of ["chrome", "url", "profile", "output"]) {
    if (!args[required]) throw new Error(`Missing --${required}`);
  }
  const timeoutMs = Number(args["timeout-ms"] || 15000);
  const port = await freePort();
  const chromeArgs = [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-sync",
    "--hide-scrollbars",
    "--mute-audio",
    "--no-default-browser-check",
    "--no-first-run",
    "--window-size=390,844",
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${args.profile}`,
  ];
  if (args["disable-webgl"]) chromeArgs.push("--disable-3d-apis");
  chromeArgs.push("about:blank");
  const chrome = spawn(args.chrome, chromeArgs, { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  chrome.stderr.setEncoding("utf8");
  chrome.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-8000); });
  let client = null;
  const output = { ok: false, probe: null, ctaDispatch: null, browser: { stderrTail: "" } };
  try {
    const target = await waitForTarget(port, Math.min(timeoutMs, 6000));
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    const loaded = client.once("Page.loadEventFired", Math.min(timeoutMs, 8000)).catch(() => null);
    await client.send("Page.navigate", { url: args.url });
    await loaded;
    await delay(2300);
    const ctaTarget = await evaluate(client, targetExpression(args["cta-selector"]));
    output.ctaDispatch = ctaTarget;
    if (ctaTarget && ctaTarget.found) {
      await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: ctaTarget.x, y: ctaTarget.y });
      await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: ctaTarget.x, y: ctaTarget.y, button: "left", clickCount: 1 });
      await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: ctaTarget.x, y: ctaTarget.y, button: "left", clickCount: 1 });
    }
    await delay(2600);
    output.probe = await evaluate(client, "window.__PLAYABLE_RUNTIME_PROBE__ || null");
    output.ok = Boolean(output.probe);
  } finally {
    output.browser.stderrTail = stderr.slice(-4000);
    if (client) client.close();
    if (!chrome.killed) chrome.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => chrome.once("exit", resolve)),
      delay(1000).then(() => { if (!chrome.killed) chrome.kill("SIGKILL"); }),
    ]);
    await writeFile(args.output, JSON.stringify(output), "utf8");
  }
}

main().catch(async (error) => {
  const args = parseArgs(process.argv.slice(2));
  if (args.output) {
    await writeFile(args.output, JSON.stringify({ ok: false, error: String(error && error.stack || error) }), "utf8");
  }
  process.stderr.write(String(error && error.stack || error) + "\n");
  process.exitCode = 1;
});
