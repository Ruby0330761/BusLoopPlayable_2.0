#!/usr/bin/env node

/* Fixed external browser collector for Checker observation provenance. */
import crypto from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createPageSession, launchCdpBrowser, navigateAndWait } from "../../playable-web-builder/scripts/cdp_client.mjs";

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    result[value.slice(2)] = argv[index + 1];
    index += 1;
  }
  return result;
}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("observation contains a non-finite number");
    // Python's canonical JSON keeps integral floats as ``100.0`` while
    // JSON.stringify emits ``100``.  Normalize both sides to one wire form.
    if (Object.is(value, -0) || Number.isInteger(value)) return String(value === 0 ? 0 : Math.trunc(value));
  }
  return JSON.stringify(value);
}

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function fail(message) {
  process.stderr.write(`${JSON.stringify({ code: "CHECKER_EXTERNAL_PROVENANCE_NOT_PROVEN", message })}\n`);
  process.exitCode = 1;
}

const args = parseArgs(process.argv.slice(2));
if (!args["checker-url"] || !args.observation || !args.output || !args.screenshot) {
  fail("--checker-url, --observation, --output and --screenshot are required");
} else {
  let browser;
  let page;
  try {
    const observation = JSON.parse(await readFile(args.observation, "utf8"));
    const checkerUrl = String(args["checker-url"]).replace(/\/$/, "");
    if (observation.checkerUrl?.replace(/\/$/, "") !== checkerUrl) {
      throw new Error("observation checkerUrl differs from collector URL");
    }
    browser = await launchCdpBrowser({
      extraArgs: ["--disable-web-security"],
      startupTimeoutMs: 15000,
      requestTimeoutMs: 10000,
    });
    page = await createPageSession(browser.connection, "about:blank");
    const session = page.session;
    await navigateAndWait(session, checkerUrl, { timeoutMs: 15000 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const requestedResultNodes = [
      ...(Array.isArray(observation.staticNodes) ? observation.staticNodes.map((node) => ({group: "static", id: node.id})) : []),
      ...(Array.isArray(observation.runtimeNodes) ? observation.runtimeNodes.map((node) => ({group: "runtime", id: node.id})) : []),
    ];
    const evaluated = await session.request("Runtime.evaluate", {
      expression: `(() => {
        const requested = ${JSON.stringify(requestedResultNodes)};
        const normalize = (value) => String(value || "").trim().replace(/\\s+/g, " ");
        const resultNodes = requested.map(({group, id}) => {
          const wanted = String(id || "");
          const escaped = CSS.escape(wanted);
          const candidates = [];
          for (const selector of [
            \`[data-check-id="\${escaped}"]\`,
            \`[data-node-id="\${escaped}"]\`,
            \`#\${escaped}\`,
          ]) {
            try { candidates.push(...document.querySelectorAll(selector)); } catch (_) {}
          }
          const node = candidates.find((candidate) => candidate && candidate.getClientRects().length > 0);
          if (!node) return {group, id: wanted, error: "not-visible"};
          const status = String(
            node.dataset?.status || node.getAttribute("data-status") ||
            [...node.classList].find((name) => /^(PASS|WARNING|FAIL)$/i.test(name)) || "",
          ).toUpperCase();
          const rect = node.getBoundingClientRect();
          return {
            group, id: wanted, status,
            text: normalize(node.innerText || node.textContent || ""),
            rect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height},
          };
        });
        return {title: document.title, url: location.href, text: document.body?.innerText || "", resultNodes};
      })()`,
      returnByValue: true,
    });
    const pageValue = evaluated?.result?.value || {};
    const text = String(pageValue.text || "");
    const marker = String(observation.pageIdentity?.visibleMarker || "");
    if (!marker || !text.includes(marker)) throw new Error("current browser page lacks observation visible marker");
    if (String(observation.pageIdentity?.title || "") !== String(pageValue.title || "")) {
      throw new Error("current browser page title differs from observation");
    }
    const screenshotBytes = Buffer.from(
      (await session.request("Page.captureScreenshot", { format: "png" })).data,
      "base64",
    );
    const screenshot = {
      path: args.screenshot,
      bytes: screenshotBytes.length,
      sha256: sha256(screenshotBytes),
    };
    await writeFile(args.screenshot, screenshotBytes);
    const observedText = String(observation.visibleText || "").trim().replace(/\s+/g, " ");
    const browserText = text.trim().replace(/\s+/g, " ");
    if (!observedText || !browserText.includes(observedText)) {
      throw new Error("observation visibleText is not a visible browser result from the current page");
    }
    const staticNodes = Array.isArray(observation.staticNodes) ? observation.staticNodes : [];
    const runtimeNodes = Array.isArray(observation.runtimeNodes) ? observation.runtimeNodes : [];
    if (observation.activeTab?.status === "AVAILABLE" && (!staticNodes.length || !runtimeNodes.length)) {
      throw new Error("AVAILABLE observation must declare current static and runtime result nodes");
    }
    const resultNodes = Array.isArray(pageValue.resultNodes) ? pageValue.resultNodes : [];
    if (resultNodes.length !== staticNodes.length + runtimeNodes.length) {
      throw new Error("fixed collector did not return the complete Checker result-node closure");
    }
    for (const item of resultNodes) {
      if (item.error || !["PASS", "WARNING", "FAIL"].includes(item.status)) {
        throw new Error(`current Checker DOM lacks machine-readable result node ${item.id}`);
      }
      const supplied = [...staticNodes, ...runtimeNodes].find((node) => node.id === item.id);
      if (!supplied || supplied.status !== item.status || !item.text.includes(normalizeText(supplied.message))) {
        throw new Error(`observation result node ${item.id} differs from the current Checker DOM`);
      }
    }
    const browserVersion = await browser.connection.request("Browser.getVersion");
    const capture = {
      schemaVersion: "playable-checker-cdp-capture-v1",
      captureId: crypto.randomUUID(),
      capturedAt: new Date().toISOString(),
      checkerUrl,
      platform: observation.platform,
      deliveryKey: observation.deliveryKey,
      attemptId: observation.attemptId,
      artifact: observation.artifact,
      browser: {
        product: String(browserVersion.product || "Chrome"),
        protocolVersion: String(browserVersion.protocolVersion || ""),
        targetId: page.targetId,
        sessionId: page.session.sessionId,
      },
      page: {
        url: String(pageValue.url || ""),
        title: String(pageValue.title || ""),
        visibleTextSha256: sha256(Buffer.from(text, "utf8")),
      },
      resultNodes,
      screenshot,
      runner: {
        version: "checker-browser-cdp-collector@2",
        externalBrowserUsed: true,
        replayNonce: crypto.randomUUID(),
      },
    };
    const provenance = {
      schemaVersion: "playable-checker-external-browser-provenance-v1",
      collectorVersion: "checker-browser-cdp-collector@2",
      status: "verified",
      attemptId: observation.attemptId,
      checkerUrl,
      platform: observation.platform,
      deliveryKey: observation.deliveryKey,
      artifact: observation.artifact,
      observationSha256: sha256(Buffer.from(canonical({ ...observation, screenshot }), "utf8")),
      capture,
    };
    await writeFile(args.output, `${JSON.stringify(provenance, null, 2)}\n`, "utf8");
    process.stdout.write(JSON.stringify(provenance));
  } catch (error) {
    fail(String(error?.message || error));
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}
