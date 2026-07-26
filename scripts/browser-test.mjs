import { writeFileSync } from "node:fs";
import WebSocket from "ws";

const pages = await fetch("http://127.0.0.1:9224/json").then((response) => response.json());
const page = pages.find((item) => item.type === "page");
if (!page) throw new Error("Chrome page target not found");

const socket = new WebSocket(page.webSocketDebuggerUrl);
let commandId = 0;
const pending = new Map();
const runtimeErrors = [];

socket.on("message", (raw) => {
  const message = JSON.parse(raw);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  }
  if (message.method === "Runtime.exceptionThrown") {
    runtimeErrors.push(message.params.exceptionDetails.text);
  }
});

await new Promise((resolve) => socket.once("open", resolve));

function command(method, params = {}) {
  commandId += 1;
  socket.send(JSON.stringify({ id: commandId, method, params }));
  return new Promise((resolve, reject) => pending.set(commandId, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await command("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(expression, timeout = 12_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out: ${expression}`);
}

async function clickText(text) {
  const clicked = await evaluate(`(() => {
    const element = [...document.querySelectorAll("button")].find(
      (button) =>
        button.textContent.replace(/\\s+/g, " ").trim().includes(${JSON.stringify(text)}) ||
        button.getAttribute("aria-label")?.includes(${JSON.stringify(text)})
    );
    if (!element) return false;
    element.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Button not found: ${text}`);
  await new Promise((resolve) => setTimeout(resolve, 300));
}

async function mouseClick(x, y) {
  await command("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 250));
}

await command("Runtime.enable");
await command("Page.enable");
await command("Page.navigate", { url: "http://localhost:4175" });
await waitFor("document.readyState === 'complete'");
await waitFor("!document.querySelector('.map-loading')");
await waitFor("document.querySelector('.map-viewport')?.dataset.aerialMatrix === '15'");

const initial = await evaluate(`({
  tabs: [...document.querySelectorAll('.sidebar-tool-tabs button')].map((button) => button.textContent.trim()),
  preview: Boolean(document.querySelector('[data-testid="sidebar-robot-map"]')),
  topStages: document.querySelectorAll('.stage-navigation').length,
  matrix: document.querySelector('.map-viewport').dataset.aerialMatrix,
  resolution: document.querySelector('.map-viewport').dataset.aerialResolution,
})`);
if (initial.topStages !== 0 || initial.tabs.length !== 3 || !initial.preview) {
  throw new Error(`Unified sidebar failed: ${JSON.stringify(initial)}`);
}

await clickText("좌표 정렬");
await waitFor("document.querySelector('.map-viewport')?.dataset.toolMode === 'align'");
const transformBefore = await evaluate("document.querySelector('.transform-readout').innerText");
await clickText("동쪽으로 5미터");
await clickText("+5°");
const transformAfter = await evaluate("document.querySelector('.transform-readout').innerText");
if (transformBefore === transformAfter || !transformAfter.includes("5.0°")) {
  throw new Error("Map transform controls did not update");
}

await clickText("로봇 포즈");
await clickText("포즈 발행");
const sequenceBefore = Number(
  (await evaluate("document.querySelector('.section-title small').textContent")).replace(/\D/g, ""),
);
await new Promise((resolve) => setTimeout(resolve, 550));
const sequenceAfter = Number(
  (await evaluate("document.querySelector('.section-title small').textContent")).replace(/\D/g, ""),
);
if (sequenceAfter - sequenceBefore < 3) throw new Error("10 Hz pose publisher did not advance");
await clickText("발행 중단");

await clickText("임무 편집");
await clickText("목표 지정");
await mouseClick(720, 500);
await waitFor("document.querySelector('[data-testid=\"path-status\"]')?.textContent.includes('WAYPOINTS')");

await clickText("금지구역");
await mouseClick(712, 488);
await mouseClick(728, 488);
await mouseClick(728, 504);
await mouseClick(712, 504);
await clickText("완료");
await waitFor("document.querySelector('[data-testid=\"zone-count\"]')?.textContent.trim() === '1'");

for (let index = 0; index < 5; index += 1) await clickText("지도 확대");
await waitFor("document.querySelector('.map-viewport')?.dataset.aerialMatrix === '18'");
const highResolution = await evaluate(`({
  matrix: document.querySelector('.map-viewport').dataset.aerialMatrix,
  resolution: document.querySelector('.map-viewport').dataset.aerialResolution,
  tileRequests: performance.getEntriesByType('resource')
    .filter((entry) => entry.name.includes('/ngii-air-2024/18/')).length,
  path: document.querySelector('[data-testid="path-status"]').textContent.trim(),
  zones: document.querySelector('[data-testid="zone-count"]').textContent.trim(),
})`);
if (highResolution.tileRequests < 1) throw new Error("High-resolution matrix 18 tiles were not requested");

const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
writeFileSync("/tmp/seooreung-dashboard.png", Buffer.from(screenshot.data, "base64"));

if (runtimeErrors.length) throw new Error(`Runtime errors: ${runtimeErrors.join("; ")}`);
console.log(JSON.stringify({ initial, transformAfter, sequenceDelta: sequenceAfter - sequenceBefore, highResolution }, null, 2));
socket.close();
