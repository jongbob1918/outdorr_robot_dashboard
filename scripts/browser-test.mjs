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

async function clickSelector(selector) {
  const clicked = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    element.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Element not found: ${selector}`);
  await new Promise((resolve) => setTimeout(resolve, 300));
}

async function mouseClick(x, y) {
  await command("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 250));
}

async function pressKey(key, { shift = false } = {}) {
  const modifiers = shift ? 8 : 0;
  await command("Input.dispatchKeyEvent", { type: "keyDown", key, modifiers });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key, modifiers });
  await new Promise((resolve) => setTimeout(resolve, 180));
}

await command("Runtime.enable");
await command("Page.enable");
await command("Page.navigate", { url: "http://localhost:4175" });
await waitFor("document.readyState === 'complete'");
await evaluate("localStorage.clear()");
await command("Page.reload", { ignoreCache: true });
await waitFor("document.readyState === 'complete'");
await waitFor("!document.querySelector('.map-loading')");
await waitFor("document.querySelector('.map-viewport')?.dataset.aerialMatrix === '15'");

const initial = await evaluate(`({
  tabs: [...document.querySelectorAll('.sidebar-tool-tabs button')].map((button) => button.textContent.trim()),
  preview: Boolean(document.querySelector('[data-testid="sidebar-robot-map"]')),
  topStages: document.querySelectorAll('.stage-navigation').length,
  matrix: document.querySelector('.map-viewport').dataset.aerialMatrix,
  resolution: document.querySelector('.map-viewport').dataset.aerialResolution,
  visibleTileCount: Number(document.querySelector('.map-viewport').dataset.aerialTileCount),
  contained: document.querySelector('.map-viewport').dataset.aerialContained,
  posePublished: document.querySelector('.map-viewport').dataset.posePublished,
  manualInsideSidebar: Boolean(document.querySelector('.simulator-panel .sidebar-control-dock')),
  previewObstacles: document.querySelectorAll('.preview-obstacle').length,
  generalMapOpacity: document.querySelector('.map-viewport').dataset.generalMapOpacity,
  lowZoomAerial: {
    opacity: getComputedStyle(document.querySelector('.low-zoom-aerial')).opacity,
    naturalWidth: document.querySelector('.low-zoom-aerial').naturalWidth,
  },
  headerCenterRemoved:
    !document.body.innerText.includes('MULTI-RESOLUTION AERIAL') &&
    !document.body.innerText.includes('서오릉 통합 로봇 관제'),
})`);
if (
  initial.topStages !== 0 ||
  initial.tabs.length !== 4 ||
  !initial.preview ||
  initial.posePublished !== "visible" ||
  !initial.manualInsideSidebar ||
  initial.previewObstacles !== 0 ||
  initial.generalMapOpacity !== "0" ||
  initial.lowZoomAerial.opacity !== "1" ||
  initial.lowZoomAerial.naturalWidth !== 1280 ||
  !initial.headerCenterRemoved
) {
  throw new Error(`Unified sidebar failed: ${JSON.stringify(initial)}`);
}

await clickText("지도 화면 설정");
await waitFor("Boolean(document.querySelector('.map-view-settings'))");
const mapViewBefore = await evaluate("document.querySelector('.map-camera-readout').innerText");
await clickText("+5°");
await waitFor(
  "!document.querySelector('.map-view-save-state')?.classList.contains('saved')",
);
await waitFor(
  "Math.abs(Number.parseFloat(document.querySelector('.map-camera-readout span:nth-child(3) b')?.textContent) - 5) < 0.1",
);
await clickText("현재 화면 저장");
await waitFor("document.querySelector('.map-view-save-state')?.classList.contains('saved')");
const storedMapView = await evaluate("localStorage.getItem('seooreung-map-view-v1')");
if (!storedMapView) throw new Error("Map view was not persisted");
const savedMapViewReadout = await evaluate("document.querySelector('.map-camera-readout').innerText");
if (savedMapViewReadout === mapViewBefore) throw new Error("Map view rotation did not update");
await evaluate(`(() => {
  const stored = JSON.parse(localStorage.getItem('seooreung-map-view-v1'));
  stored.pitch = null;
  localStorage.setItem('seooreung-map-view-v1', JSON.stringify(stored));
})()`);
await new Promise((resolve) => setTimeout(resolve, 1_500));
const settingsScreenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
writeFileSync("/tmp/seooreung-map-settings.png", Buffer.from(settingsScreenshot.data, "base64"));
await command("Page.reload", { ignoreCache: true });
await waitFor("document.readyState === 'complete'");
await waitFor("!document.querySelector('.map-loading')");
await clickText("지도 화면 설정");
await waitFor("document.querySelector('.map-view-save-state')?.classList.contains('saved')");
const restoredMapViewReadout = await evaluate("document.querySelector('.map-camera-readout').innerText");
if (restoredMapViewReadout !== savedMapViewReadout) {
  throw new Error("Saved map view did not survive reload");
}
const migratedMapView = JSON.parse(
  await evaluate("localStorage.getItem('seooreung-map-view-v1')"),
);
if (migratedMapView.pitch !== 0) {
  throw new Error(`Legacy null camera value was not normalized: ${JSON.stringify(migratedMapView)}`);
}
await clickSelector(".map-view-settings-heading > button");

await clickText("좌표 정렬");
await waitFor("document.querySelector('.map-viewport')?.dataset.toolMode === 'align'");
const transformBefore = await evaluate("document.querySelector('.transform-readout').innerText");
await pressKey("ArrowRight");
await pressKey("ArrowUp", { shift: true });
await clickText("+5°");
const transformAfter = await evaluate("document.querySelector('.transform-readout').innerText");
if (transformBefore === transformAfter || !transformAfter.includes("5.0°")) {
  throw new Error("Map transform controls did not update");
}
await clickText("지도 화면 설정");
await new Promise((resolve) => setTimeout(resolve, 500));
const cameraAfterAlignment = await evaluate("document.querySelector('.map-camera-readout').innerText");
if (cameraAfterAlignment !== restoredMapViewReadout) {
  throw new Error(`Alignment reset the map camera: ${cameraAfterAlignment}`);
}
await clickSelector(".map-view-settings-heading > button");
await clickText("정합 저장");
await waitFor("document.querySelector('.alignment-save-status')?.classList.contains('saved')");
const storedAlignment = await evaluate("localStorage.getItem('seooreung-map-alignment-v1')");
if (!storedAlignment) throw new Error("Alignment was not persisted");
await command("Page.reload", { ignoreCache: true });
await waitFor("document.readyState === 'complete'");
await waitFor("!document.querySelector('.map-loading')");
await clickText("좌표 정렬");
await waitFor("document.querySelector('.alignment-save-status')?.textContent.includes('자동 복원')");
const transformRestored = await evaluate("document.querySelector('.transform-readout').innerText");
if (transformRestored !== transformAfter) throw new Error("Alignment did not survive reload");

await clickText("로봇 포즈");
await waitFor("document.querySelector('.map-viewport')?.dataset.posePublished === 'visible'");
const sequenceBefore = Number(
  (await evaluate("document.querySelector('.section-title small').textContent")).replace(/\D/g, ""),
);
await new Promise((resolve) => setTimeout(resolve, 550));
const sequenceAfter = Number(
  (await evaluate("document.querySelector('.section-title small').textContent")).replace(/\D/g, ""),
);
if (sequenceAfter - sequenceBefore < 3) throw new Error("10 Hz pose publisher did not advance");
const poseScreenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
writeFileSync("/tmp/seooreung-pose-sidebar.png", Buffer.from(poseScreenshot.data, "base64"));
await clickText("발행 중단");
await waitFor("document.querySelector('.map-viewport')?.dataset.posePublished === 'hidden'");
await clickText("포즈 발행");
await waitFor("document.querySelector('.map-viewport')?.dataset.posePublished === 'visible'");

await clickText("이벤트 테스트");
await waitFor("document.querySelector('[data-testid=\"event-count\"]')?.textContent === '0'");
await clickText("랜덤 발생 시작");
await waitFor("Number(document.querySelector('[data-testid=\"event-count\"]')?.textContent) >= 2");
const eventCountWhileRunning = Number(
  await evaluate("document.querySelector('[data-testid=\"event-count\"]').textContent"),
);
if (
  Number(await evaluate("document.querySelector('.map-viewport').dataset.eventCount")) !==
  eventCountWhileRunning
) {
  throw new Error("Random events were not published to the map");
}
await clickText("발생 종료");
await new Promise((resolve) => setTimeout(resolve, 1_100));
const eventCountAfterStop = Number(
  await evaluate("document.querySelector('[data-testid=\"event-count\"]').textContent"),
);
if (eventCountAfterStop !== eventCountWhileRunning) {
  throw new Error("Event generator did not stop");
}
const eventScreenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
writeFileSync("/tmp/seooreung-event-generator.png", Buffer.from(eventScreenshot.data, "base64"));

await clickText("레이어");
await clickText("일반");
await waitFor("document.querySelector('.map-viewport')?.dataset.baseMap === 'general'");
await clickText("지도 확대");
await clickText("지도 확대");
await waitFor("Number(document.querySelector('.map-controls span')?.textContent) >= 17");
await waitFor("Number(document.querySelector('.map-viewport')?.dataset.generalFeatures) > 0", 20_000);
const generalMap = await evaluate(`({
  baseMap: document.querySelector('.map-viewport').dataset.baseMap,
  zoom: Number(document.querySelector('.map-controls span').textContent),
  featureCount: Number(document.querySelector('.map-viewport').dataset.generalFeatures),
  externalRequests: performance.getEntriesByType('resource')
    .filter((entry) => entry.name.includes('tiles.openfreemap.org')).length,
  checkedLayers: [...document.querySelectorAll('.layer-switches [role="switch"]')]
    .filter((button) => button.getAttribute('aria-checked') === 'true').length,
  generalMapOpacity: document.querySelector('.map-viewport').dataset.generalMapOpacity,
})`);
if (
  generalMap.externalRequests < 1 ||
  generalMap.featureCount < 1 ||
  generalMap.zoom < 17 ||
  generalMap.checkedLayers !== 3 ||
  generalMap.generalMapOpacity !== "1"
) {
  throw new Error(`General map or layer controls failed: ${JSON.stringify(generalMap)}`);
}
const generalScreenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
writeFileSync("/tmp/seooreung-general-map.png", Buffer.from(generalScreenshot.data, "base64"));
await clickText("지도 축소");
await clickText("지도 축소");
await clickSelector(".layer-switches [role='switch']:nth-child(2)");
await waitFor(
  "[...document.querySelectorAll('.layer-switches [role=\"switch\"]')].find((button) => button.textContent.includes('로봇 포즈'))?.getAttribute('aria-checked') === 'false'",
);
await waitFor("document.querySelector('.map-viewport')?.dataset.posePublished === 'hidden'");
await clickSelector(".base-map-options button:first-child");
await waitFor("document.querySelector('.map-viewport')?.dataset.baseMap === 'satellite'");
await new Promise((resolve) => setTimeout(resolve, 500));
await clickSelector(".layer-control-trigger");
for (let index = 0; index < 10; index += 1) await clickText("지도 축소");
await waitFor("document.querySelector('.map-viewport')?.dataset.aerialContained === 'true'");
const satelliteBoundary = await evaluate(`({
  zoom: Number(document.querySelector('.map-controls span').textContent),
  minimumZoom: Number(document.querySelector('.map-viewport').dataset.satelliteMinZoom),
  contained: document.querySelector('.map-viewport').dataset.aerialContained,
  generalMapOpacity: document.querySelector('.map-viewport').dataset.generalMapOpacity,
  lowZoomAerialOpacity: getComputedStyle(document.querySelector('.low-zoom-aerial')).opacity,
})`);
if (
  satelliteBoundary.contained !== "true" ||
  satelliteBoundary.zoom > 15.5 ||
  satelliteBoundary.zoom + 0.1 < satelliteBoundary.minimumZoom ||
  satelliteBoundary.generalMapOpacity !== "0" ||
  satelliteBoundary.lowZoomAerialOpacity !== "1"
) {
  throw new Error(`Satellite boundary failed: ${JSON.stringify(satelliteBoundary)}`);
}
const boundaryScreenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
writeFileSync("/tmp/seooreung-satellite-boundary.png", Buffer.from(boundaryScreenshot.data, "base64"));

await clickText("임무 편집");
await clickText("목표 지정");
const poseBeforeMission = await evaluate(`({
  x: Number(document.querySelector('.map-viewport').dataset.poseX),
  y: Number(document.querySelector('.map-viewport').dataset.poseY),
})`);
await mouseClick(520, 420);
await waitFor("document.querySelector('[data-testid=\"path-status\"]')?.textContent.includes('WAYPOINTS')");
await waitFor("Number(document.querySelector('.map-viewport')?.dataset.trailCount) >= 2");
await waitFor(`(() => {
  const viewport = document.querySelector('.map-viewport');
  return Math.hypot(
    Number(viewport.dataset.poseX) - ${poseBeforeMission.x},
    Number(viewport.dataset.poseY) - ${poseBeforeMission.y}
  ) > 0.5;
})()`);
const autonomousMotion = await evaluate(`({
  status: document.querySelector('.map-viewport').dataset.missionStatus,
  poseX: Number(document.querySelector('.map-viewport').dataset.poseX),
  poseY: Number(document.querySelector('.map-viewport').dataset.poseY),
  trailCount: Number(document.querySelector('.map-viewport').dataset.trailCount),
  trailStyle: document.querySelector('.map-viewport').dataset.trailStyle,
  trailScale: document.querySelector('.map-viewport').dataset.trailScale,
  oldestOpacity: Number(document.querySelector('.map-viewport').dataset.trailOldestOpacity),
})`);
await new Promise((resolve) => setTimeout(resolve, 1_100));
const fadedTrailOpacity = Number(
  await evaluate("document.querySelector('.map-viewport').dataset.trailOldestOpacity"),
);
if (
  !["moving", "arrived"].includes(autonomousMotion.status) ||
  autonomousMotion.trailStyle !== "dashed-time-fade" ||
  autonomousMotion.trailScale !== "low" ||
  autonomousMotion.trailCount < 2 ||
  fadedTrailOpacity >= autonomousMotion.oldestOpacity
) {
  throw new Error(
    `Autonomous motion or time-faded trail failed: ${JSON.stringify({ autonomousMotion, fadedTrailOpacity })}`,
  );
}
const motionScreenshot = await command("Page.captureScreenshot", {
  format: "png",
  captureBeyondViewport: false,
});
writeFileSync(
  "/tmp/seooreung-autonomous-motion.png",
  Buffer.from(motionScreenshot.data, "base64"),
);

await clickText("금지구역");
await mouseClick(712, 488);
await mouseClick(728, 488);
await mouseClick(728, 504);
await mouseClick(712, 504);
await clickText("완료");
await waitFor("document.querySelector('[data-testid=\"zone-count\"]')?.textContent.trim() === '1'");
const storedForbiddenZones = JSON.parse(
  await evaluate("localStorage.getItem('seooreung-forbidden-zones-v1')"),
);
if (
  !Array.isArray(storedForbiddenZones?.zones) ||
  storedForbiddenZones.zones.length !== 1
) {
  throw new Error(`Forbidden zones were not persisted: ${JSON.stringify(storedForbiddenZones)}`);
}
await clickText("임무 종료");
await waitFor("document.querySelector('[data-testid=\"path-status\"]')?.textContent.trim() === 'READY'");
const missionEnded = await evaluate(`({
  path: document.querySelector('[data-testid="path-status"]').textContent.trim(),
  status: document.querySelector('.map-viewport').dataset.missionStatus,
  previewRoute: Boolean(document.querySelector('.preview-route')),
  previewGoal: Boolean(document.querySelector('.preview-goal')),
  endButton: [...document.querySelectorAll('button')].some((button) => button.textContent.includes('임무 종료')),
})`);
if (
  missionEnded.status !== "idle" ||
  missionEnded.previewRoute ||
  missionEnded.previewGoal ||
  missionEnded.endButton
) {
  throw new Error(`Mission did not clear: ${JSON.stringify(missionEnded)}`);
}
await command("Page.reload", { ignoreCache: true });
await waitFor("document.readyState === 'complete'");
await waitFor("!document.querySelector('.map-loading')");
await clickText("임무 편집");
await waitFor("document.querySelector('[data-testid=\"zone-count\"]')?.textContent.trim() === '1'");
const restoredForbiddenZones = await evaluate(`({
  count: document.querySelector('[data-testid="zone-count"]').textContent.trim(),
  saveState: document.querySelector('.forbidden-save-state').textContent.trim(),
})`);
if (!restoredForbiddenZones.saveState.includes("새로고침 후 복원")) {
  throw new Error(`Forbidden zone restore status missing: ${JSON.stringify(restoredForbiddenZones)}`);
}

for (let index = 0; index < 10; index += 1) await clickText("지도 확대");
await waitFor("document.querySelector('.map-viewport')?.dataset.aerialMatrix === '18'");
const highResolution = await evaluate(`({
  matrix: document.querySelector('.map-viewport').dataset.aerialMatrix,
  resolution: document.querySelector('.map-viewport').dataset.aerialResolution,
  visibleTileCount: Number(document.querySelector('.map-viewport').dataset.aerialTileCount),
  contained: document.querySelector('.map-viewport').dataset.aerialContained,
  tileRequests: performance.getEntriesByType('resource')
    .filter((entry) => entry.name.includes('/ngii-air-2024/18/')).length,
  trailScale: document.querySelector('.map-viewport').dataset.trailScale,
  path: document.querySelector('[data-testid="path-status"]').textContent.trim(),
  zones: document.querySelector('[data-testid="zone-count"]').textContent.trim(),
})`);
const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
writeFileSync("/tmp/seooreung-dashboard.png", Buffer.from(screenshot.data, "base64"));
if (
  highResolution.visibleTileCount < 1 ||
  highResolution.contained !== "true" ||
  highResolution.trailScale !== "high"
) {
  throw new Error(`High-resolution matrix 18 tiles failed: ${JSON.stringify(highResolution)}`);
}

if (runtimeErrors.length) throw new Error(`Runtime errors: ${runtimeErrors.join("; ")}`);
console.log(JSON.stringify({
  initial,
  transformAfter,
  transformRestored,
  savedMapViewReadout,
  restoredMapViewReadout,
  sequenceDelta: sequenceAfter - sequenceBefore,
  generalMap,
  satelliteBoundary,
  autonomousMotion,
  fadedTrailOpacity,
  missionEnded,
  restoredForbiddenZones,
  highResolution,
}, null, 2));
socket.close();
