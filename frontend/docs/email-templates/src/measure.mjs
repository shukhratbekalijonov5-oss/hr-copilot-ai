/**
 * Measures every rendered template for horizontal overflow, at the two
 * widths that matter: a narrow phone (320px, the floor email design aims
 * at) and a typical phone (390px).
 *
 * "No horizontal overflow" is a claim that has to be measured, not
 * eyeballed — a value column can sit two pixels past the card edge and
 * look fine in a screenshot while a real client shows a scrollbar. This
 * compares documentElement.scrollWidth against the viewport and names the
 * widest offending element when they disagree.
 *
 * Run: node --experimental-websocket measure.mjs   (or node >= 22)
 */
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FILLED = resolve(join(HERE, "..", "preview", "filled"));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9411;
const WIDTHS = [320, 390];

const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  "--disable-gpu",
  "--no-first-run",
  "--user-data-dir=/tmp/hrc-email-measure",
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

const url = await endpoint();
const socket = new WebSocket(url);
await new Promise((r) => socket.addEventListener("open", r, { once: true }));
const cdp = new Cdp(socket);

const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
await cdp.send("Page.enable", {}, sessionId);
await cdp.send("Runtime.enable", {}, sessionId);

/**
 * Compares against the width we ASKED for, not window.innerWidth.
 *
 * Under mobile emulation Chrome shrink-to-fits: when content overflows,
 * the layout viewport expands to the content width and innerWidth grows
 * to match, so `scrollWidth > innerWidth` is never true and the check
 * silently passes everything. A 900px canary proved exactly that. The
 * configured width is the only stable reference.
 */
const probeFor = (width) => `(() => {
  const target = ${width};
  const scroll = document.documentElement.scrollWidth;
  let worst = null;
  if (scroll > target) {
    for (const el of document.querySelectorAll("*")) {
      const right = el.getBoundingClientRect().right;
      if (right > target + 0.5 && (!worst || right > worst.right)) {
        worst = { right: Math.round(right), tag: el.tagName,
                  text: (el.textContent || "").trim().slice(0, 40) };
      }
    }
  }
  return JSON.stringify({ target, inner: window.innerWidth, scroll, worst });
})()`;

const files = readdirSync(FILLED).filter((f) => f.endsWith(".html")).sort();
let failures = 0;

for (const width of WIDTHS) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width, height: 900, deviceScaleFactor: 1, mobile: true,
  }, sessionId);

  for (const file of files) {
    await cdp.send("Page.navigate", { url: `file://${join(FILLED, file)}` }, sessionId);
    await sleep(180);
    const { result } = await cdp.send("Runtime.evaluate", {
      expression: probeFor(width), returnByValue: true,
    }, sessionId);
    const { scroll, worst } = JSON.parse(result.value);
    const overflow = scroll - width;
    if (overflow > 0) {
      failures += 1;
      console.log(`  OVERFLOW  ${width}px  ${file}  +${overflow}px  <${worst?.tag}> "${worst?.text}"`);
    } else {
      console.log(`  ok        ${width}px  ${file}  scrollWidth=${scroll}`);
    }
  }
}

socket.close();
chrome.kill();
console.log(failures === 0
  ? `\nNO HORIZONTAL OVERFLOW — ${files.length * WIDTHS.length} renders clean`
  : `\n${failures} OVERFLOWING RENDER(S)`);
process.exitCode = failures === 0 ? 0 : 1;
