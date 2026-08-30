/**
 * Captures the desktop and mobile proof screenshots through CDP.
 *
 * NOT via `--window-size --screenshot`: that flag sizes the browser
 * window, and the page's layout viewport does not necessarily follow it,
 * so the PNG came out as a narrow CROP of a wider render — the card
 * looked clipped in a layout that was actually fine. Device-metrics
 * emulation sets the layout viewport itself, and captureBeyondViewport
 * takes the full document height in one shot.
 *
 * Run: node --experimental-websocket shots.mjs   (or node >= 22)
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const FILLED = resolve(join(ROOT, "preview", "filled"));
const OUT = resolve(join(ROOT, "preview", "screenshots"));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9412;

const LOCALES = ["en", "ko", "ru", "uz"];
const TEMPLATES = ["account_created", "subscription_activated", "subscription_expiring"];
const VIEWS = [
  { label: "desktop", width: 680, mobile: false },
  { label: "mobile", width: 390, mobile: true },
];

mkdirSync(OUT, { recursive: true });

const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  "--disable-gpu",
  "--no-first-run",
  "--hide-scrollbars",
  "--user-data-dir=/tmp/hrc-email-shots",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function endpoint() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      return (await res.json()).webSocketDebuggerUrl;
    } catch {
      await sleep(250);
    }
  }
  throw new Error("Chrome did not expose a debugging endpoint");
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const waiter = this.pending.get(message.id);
      if (waiter) {
        this.pending.delete(message.id);
        message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
}

const socket = new WebSocket(await endpoint());
await new Promise((r) => socket.addEventListener("open", r, { once: true }));
const cdp = new Cdp(socket);

const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
await cdp.send("Page.enable", {}, sessionId);
await cdp.send("Runtime.enable", {}, sessionId);

let count = 0;
for (const view of VIEWS) {
  for (const name of TEMPLATES) {
    for (const lang of LOCALES) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: view.width, height: 900, deviceScaleFactor: 2, mobile: view.mobile,
      }, sessionId);
      await cdp.send("Page.navigate", { url: `file://${join(FILLED, `${name}.${lang}.html`)}` }, sessionId);
      await sleep(200);

      // Full document height, so nothing is cropped.
      const { result } = await cdp.send("Runtime.evaluate", {
        expression: "document.documentElement.scrollHeight", returnByValue: true,
      }, sessionId);
      const height = Math.min(Math.ceil(result.value), 4000);

      const { data } = await cdp.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: view.width, height, scale: 1 },
      }, sessionId);

      writeFileSync(join(OUT, `${name}.${lang}.${view.label}.png`), Buffer.from(data, "base64"));
      count += 1;
      console.log(`  ${name}.${lang}.${view.label}.png  ${view.width}x${height}`);
    }
  }
}

socket.close();
chrome.kill();
console.log(`\ncaptured ${count} screenshots`);
