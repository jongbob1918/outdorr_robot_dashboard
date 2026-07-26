"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Crosshair,
  Database,
  Eye,
  EyeOff,
  Gauge,
  Layers3,
  LocateFixed,
  MapPin,
  Minus,
  Plus,
  Radio,
  RotateCcw,
  Satellite,
  Send,
  SquareTerminal,
} from "lucide-react";
import * as maplibregl from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-csp-worker.js?url";

maplibregl.setWorkerUrl(maplibreWorkerUrl);

const MAP_ORIGIN = {
  lng: 126.89915272336265,
  lat: 37.63141097498908,
};

const INITIAL_POSE = {
  x: -22.4,
  y: -8.8,
  yaw: 32,
};

const STEPS = [
  { id: 1, number: "01", label: "BASE MAP", title: "서오릉 지도" },
  { id: 2, number: "02", label: "OVERLAY", title: "로봇맵 중첩" },
  { id: 3, number: "03", label: "SIMULATOR", title: "포즈 발행" },
];

const MAP_STYLE = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#070b0e" },
    },
  ],
};
const METERS_PER_LAT = 110_540;

function metersToLngLat(x, y) {
  const metersPerLng = 111_320 * Math.cos((MAP_ORIGIN.lat * Math.PI) / 180);
  return [
    MAP_ORIGIN.lng + x / metersPerLng,
    MAP_ORIGIN.lat + y / METERS_PER_LAT,
  ];
}

function slamBounds() {
  return {
    nw: metersToLngLat(-105, 76),
    ne: metersToLngLat(105, 76),
    se: metersToLngLat(105, -76),
    sw: metersToLngLat(-105, -76),
  };
}

function createRobotMapImage() {
  const canvas = document.createElement("canvas");
  canvas.width = 1260;
  canvas.height = 900;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "rgba(5, 10, 14, .86)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "rgba(130, 157, 172, .13)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= canvas.width; x += 45) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= canvas.height; y += 45) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(79, 111, 128, .18)";
  [
    [74, 84, 212, 165],
    [920, 68, 268, 172],
    [78, 642, 240, 178],
    [952, 648, 230, 164],
    [482, 320, 238, 112],
  ].forEach(([x, y, w, h]) => ctx.fillRect(x, y, w, h));

  ctx.strokeStyle = "rgba(226, 237, 241, .82)";
  ctx.lineWidth = 15;
  ctx.lineCap = "square";
  ctx.lineJoin = "miter";

  const walls = [
    [[72, 615], [72, 82], [348, 82]],
    [[308, 82], [308, 245], [490, 245]],
    [[460, 245], [460, 476], [620, 476]],
    [[620, 476], [620, 260], [840, 260]],
    [[820, 260], [820, 82], [1190, 82], [1190, 378]],
    [[1190, 344], [1030, 344], [1030, 596]],
    [[1030, 566], [824, 566], [824, 812]],
    [[824, 812], [510, 812], [510, 660]],
    [[510, 660], [300, 660], [300, 812], [72, 812], [72, 612]],
  ];

  walls.forEach((points) => {
    ctx.beginPath();
    points.forEach(([x, y], index) => {
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });

  ctx.strokeStyle = "rgba(0, 214, 166, .62)";
  ctx.lineWidth = 5;
  ctx.setLineDash([16, 14]);
  ctx.beginPath();
  ctx.moveTo(172, 720);
  ctx.bezierCurveTo(252, 546, 388, 566, 480, 510);
  ctx.bezierCurveTo(614, 424, 708, 548, 844, 463);
  ctx.bezierCurveTo(932, 409, 992, 294, 1085, 220);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "rgba(0, 214, 166, .8)";
  ctx.font = "600 22px monospace";
  ctx.fillText("SLAM / MAP FRAME", 96, 856);
  ctx.fillStyle = "rgba(207, 221, 227, .5)";
  ctx.font = "18px monospace";
  ctx.fillText("0.05 m/px · 210 × 152 m", 870, 856);

  return canvas.toDataURL("image/png");
}

function robotGeoJSON(pose) {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Point",
          coordinates: metersToLngLat(pose.x, pose.y),
        },
      },
    ],
  };
}

function headingGeoJSON(pose) {
  const radians = (pose.yaw * Math.PI) / 180;
  const length = 9;
  const endX = pose.x + Math.sin(radians) * length;
  const endY = pose.y + Math.cos(radians) * length;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: [
            metersToLngLat(pose.x, pose.y),
            metersToLngLat(endX, endY),
          ],
        },
      },
    ],
  };
}

function routeGeoJSON() {
  const points = [
    [-72, -46],
    [-56, -12],
    [-31, -16],
    [-8, -4],
    [18, -16],
    [38, 4],
    [58, 20],
    [74, 48],
  ];
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: points.map(([x, y]) => metersToLngLat(x, y)),
        },
      },
    ],
  };
}

function MapCanvas({ step, pose, sidebarCollapsed }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const nationalDataRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [dataError, setDataError] = useState("");
  const [dataInfo, setDataInfo] = useState(null);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [zoom, setZoom] = useState(14.8);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;
    let cancelled = false;

    const initializeMap = async () => {
      try {
        const [metadataResponse, heritageResponse] = await Promise.all([
          fetch("/data/seooreung-national-data.json"),
          fetch("/data/seooreung-national-heritage.geojson"),
        ]);
        if (!metadataResponse.ok || !heritageResponse.ok) {
          throw new Error("국가 공간정보 파일을 불러오지 못했습니다.");
        }
        const metadata = await metadataResponse.json();
        const heritage = await heritageResponse.json();
        if (cancelled || !containerRef.current) return;

        nationalDataRef.current = metadata;
        setDataInfo(metadata);

        const map = new maplibregl.Map({
          container: containerRef.current,
          style: MAP_STYLE,
          center: metadata.heritage.center,
          zoom: 14.8,
          bearing: 0,
          pitch: 0,
          attributionControl: false,
          maxZoom: 20,
        });
        mapRef.current = map;

        map.on("load", () => {
          map.addSource("ngii-aerial", {
            type: "image",
            url: metadata.image.path,
            coordinates: metadata.image.coordinates,
          });
          map.addLayer({
            id: "ngii-aerial-image",
            type: "raster",
            source: "ngii-aerial",
            paint: {
              "raster-opacity": 0.92,
              "raster-brightness-min": 0.05,
              "raster-brightness-max": 0.72,
              "raster-contrast": 0.16,
              "raster-saturation": -0.2,
              "raster-fade-duration": 0,
            },
          });

          map.addSource("heritage-boundary", {
            type: "geojson",
            data: heritage,
          });
          map.addLayer({
            id: "heritage-boundary-fill",
            type: "fill",
            source: "heritage-boundary",
            paint: {
              "fill-color": "#00d6a6",
              "fill-opacity": 0.055,
            },
          });
          map.addLayer({
            id: "heritage-boundary-line",
            type: "line",
            source: "heritage-boundary",
            layout: {
              "line-cap": "round",
              "line-join": "round",
            },
            paint: {
              "line-color": "#8cf6dd",
              "line-width": 2,
              "line-opacity": 0.86,
              "line-dasharray": [2, 1.5],
            },
          });

          const bounds = slamBounds();
          map.addSource("robot-map", {
            type: "image",
            url: createRobotMapImage(),
            coordinates: [bounds.nw, bounds.ne, bounds.se, bounds.sw],
          });
          map.addLayer({
            id: "robot-map-image",
            type: "raster",
            source: "robot-map",
            layout: { visibility: "none" },
            paint: {
              "raster-opacity": 0.82,
              "raster-fade-duration": 0,
              "raster-resampling": "linear",
            },
          });

          map.addSource("robot-route", {
            type: "geojson",
            data: routeGeoJSON(),
          });
          map.addLayer({
            id: "robot-route-line",
            type: "line",
            source: "robot-route",
            layout: {
              visibility: "none",
              "line-cap": "round",
              "line-join": "round",
            },
            paint: {
              "line-color": "#00d6a6",
              "line-width": 3,
              "line-opacity": 0.9,
              "line-dasharray": [2, 2],
            },
          });

          map.addSource("robot-heading", {
            type: "geojson",
            data: headingGeoJSON(INITIAL_POSE),
          });
          map.addLayer({
            id: "robot-heading-line",
            type: "line",
            source: "robot-heading",
            layout: { visibility: "none", "line-cap": "round" },
            paint: {
              "line-color": "#ffffff",
              "line-width": 4,
              "line-opacity": 0.95,
            },
          });

          map.addSource("robot-pose", {
            type: "geojson",
            data: robotGeoJSON(INITIAL_POSE),
          });
          map.addLayer({
            id: "robot-pose-halo",
            type: "circle",
            source: "robot-pose",
            layout: { visibility: "none" },
            paint: {
              "circle-radius": 16,
              "circle-color": "rgba(0, 214, 166, .16)",
              "circle-stroke-width": 1,
              "circle-stroke-color": "rgba(0, 214, 166, .55)",
            },
          });
          map.addLayer({
            id: "robot-pose-dot",
            type: "circle",
            source: "robot-pose",
            layout: { visibility: "none" },
            paint: {
              "circle-radius": 7,
              "circle-color": "#00d6a6",
              "circle-stroke-width": 3,
              "circle-stroke-color": "#06100d",
            },
          });

          map.fitBounds(
            [metadata.image.coordinates[3], metadata.image.coordinates[1]],
            { padding: 34, duration: 0 },
          );
          setZoom(map.getZoom());
          map.once("idle", () => {
            if (!cancelled) setMapReady(true);
          });
        });

        map.on("zoom", () => setZoom(map.getZoom()));
        map.on("error", ({ error }) => {
          if (!cancelled && error?.message) setDataError(error.message);
        });
      } catch (error) {
        if (!cancelled) {
          setDataError(error.message || "국가 공간정보 초기화에 실패했습니다.");
        }
      }
    };

    initializeMap();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      nationalDataRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const overlay = step >= 2 && overlayVisible ? "visible" : "none";
    const robot = step >= 3 ? "visible" : "none";

    map.setLayoutProperty("robot-map-image", "visibility", overlay);
    map.setLayoutProperty("robot-route-line", "visibility", overlay);
    map.setLayoutProperty("robot-heading-line", "visibility", robot);
    map.setLayoutProperty("robot-pose-halo", "visibility", robot);
    map.setLayoutProperty("robot-pose-dot", "visibility", robot);

    if (step === 1) {
      const coordinates = nationalDataRef.current?.image.coordinates;
      if (coordinates) {
        map.fitBounds([coordinates[3], coordinates[1]], {
          padding: 34,
          bearing: 0,
          duration: 750,
        });
      }
    } else {
      const bounds = slamBounds();
      map.fitBounds([bounds.sw, bounds.ne], {
        padding: {
          top: 108,
          right: step === 3 && !sidebarCollapsed ? 388 : 72,
          bottom: step === 3 ? 136 : 70,
          left: 72,
        },
        bearing: 0,
        duration: 750,
      });
    }
  }, [mapReady, overlayVisible, sidebarCollapsed, step]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    map.getSource("robot-pose")?.setData(robotGeoJSON(pose));
    map.getSource("robot-heading")?.setData(headingGeoJSON(pose));
  }, [mapReady, pose]);

  const zoomBy = (amount) => {
    mapRef.current?.easeTo({
      zoom: Math.min(20, Math.max(12, mapRef.current.getZoom() + amount)),
      duration: 220,
    });
  };

  const resetView = () => {
    const map = mapRef.current;
    if (!map) return;
    if (step === 1) {
      const coordinates = nationalDataRef.current?.image.coordinates;
      if (coordinates) {
        map.fitBounds([coordinates[3], coordinates[1]], {
          padding: 34,
          bearing: 0,
          duration: 650,
        });
      }
      return;
    }
    const bounds = slamBounds();
    map.fitBounds([bounds.sw, bounds.ne], {
      padding: 90,
      bearing: 0,
      duration: 650,
    });
  };

  return (
    <section className="map-viewport" aria-label="서오릉 지도">
      <div ref={containerRef} className="map-container" />

      {!mapReady && !dataError && (
        <div className="map-loading">
          <span className="loader-ring" />
          <b>NATIONAL GEODATA LOADING</b>
          <small>NGII aerial + National Heritage SHP</small>
        </div>
      )}

      {dataError && (
        <div className="map-data-error" role="alert">
          <strong>국가 공간정보 로드 실패</strong>
          <small>{dataError}</small>
        </div>
      )}

      <div className="map-context-card">
        <span className="context-icon"><MapPin size={17} /></span>
        <span>
          <small>국가지정유산 · 사적 · {dataInfo?.heritage.center.map((value) => value.toFixed(5)).join(" / ")}</small>
          <strong>고양 서오릉</strong>
        </span>
        <span className="source-tag">EPSG:5179</span>
      </div>

      {step >= 2 && (
        <button
          className={`overlay-toggle ${overlayVisible ? "active" : ""}`}
          onClick={() => setOverlayVisible((visible) => !visible)}
        >
          {overlayVisible ? <Eye size={16} /> : <EyeOff size={16} />}
          ROBOT MAP
        </button>
      )}

      <div
        className={`map-controls ${step === 3 && !sidebarCollapsed ? "with-sidebar" : ""}`}
      >
        <button onClick={() => zoomBy(1)} aria-label="지도 확대">
          <Plus size={19} />
        </button>
        <span>{zoom.toFixed(1)}</span>
        <button onClick={() => zoomBy(-1)} aria-label="지도 축소">
          <Minus size={19} />
        </button>
        <button onClick={resetView} aria-label="서오릉 중심으로 이동">
          <LocateFixed size={18} />
        </button>
      </div>

      <div className="map-state-label">
        <span className={step === 1 ? "white-dot" : "green-dot"} />
        {step === 1 ? "2 NATIONAL SOURCES" : step === 2 ? "SLAM MAP ALIGNED" : "POSE SIMULATION"}
      </div>

      <div className="national-attribution">
        <span>영상 © 국토지리정보원 · 2024 항공사진</span>
        <i />
        <span>경계 © 국가유산청 · 지정유산 SHP</span>
      </div>
    </section>
  );
}

function KeyButton({ label, icon: Icon, hint, onTrigger, active }) {
  return (
    <button
      className={`key-button ${active ? "active" : ""}`}
      onPointerDown={(event) => {
        event.preventDefault();
        onTrigger();
      }}
      aria-label={hint}
    >
      {Icon ? <Icon size={16} /> : <b>{label}</b>}
      <span>{label}</span>
    </button>
  );
}

function ControlDock({ onMove, activeKey, onReset }) {
  return (
    <div className="control-dock">
      <div className="dock-copy">
        <small>MANUAL CONTROL</small>
        <strong>키보드로 로봇 포즈 이동</strong>
      </div>
      <div className="keyboard-cluster">
        <KeyButton label="Q" hint="왼쪽 평행 이동" onTrigger={() => onMove("strafe-left")} active={activeKey === "q"} />
        <KeyButton label="W" icon={ArrowUp} hint="전진" onTrigger={() => onMove("forward")} active={activeKey === "w"} />
        <KeyButton label="E" hint="오른쪽 평행 이동" onTrigger={() => onMove("strafe-right")} active={activeKey === "e"} />
        <KeyButton label="A" icon={ArrowLeft} hint="왼쪽 회전" onTrigger={() => onMove("turn-left")} active={activeKey === "a"} />
        <KeyButton label="S" icon={ArrowDown} hint="후진" onTrigger={() => onMove("backward")} active={activeKey === "s"} />
        <KeyButton label="D" icon={ArrowRight} hint="오른쪽 회전" onTrigger={() => onMove("turn-right")} active={activeKey === "d"} />
      </div>
      <button className="reset-button" onClick={onReset}>
        <RotateCcw size={17} />
        RESET
      </button>
    </div>
  );
}

function PoseValue({ label, value, unit }) {
  return (
    <div className="pose-value">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{unit}</small>
    </div>
  );
}

function SimulatorSidebar({
  collapsed,
  setCollapsed,
  pose,
  publishing,
  setPublishing,
  sequence,
}) {
  return (
    <aside className={`simulator-panel ${collapsed ? "collapsed" : ""}`}>
      <button
        className="collapse-button"
        onClick={() => setCollapsed((value) => !value)}
        aria-label={collapsed ? "시뮬레이터 펼치기" : "시뮬레이터 접기"}
      >
        {collapsed ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
      </button>

      {collapsed ? (
        <div className="collapsed-rail">
          <Bot size={19} />
          <span>SIM</span>
          <i className={publishing ? "live" : ""} />
        </div>
      ) : (
        <>
          <div className="simulator-heading">
            <span className="simulator-symbol"><SquareTerminal size={20} /></span>
            <div>
              <small>TEST SIDEBAR</small>
              <h2>POSE SIMULATOR</h2>
            </div>
            <span className={`publish-state ${publishing ? "live" : ""}`}>
              <i />
              {publishing ? "PUBLISHING" : "STANDBY"}
            </span>
          </div>

          <div className="topic-card">
            <span><Radio size={15} />ROS 2 TOPIC</span>
            <code>/robot_pose</code>
          </div>

          <section className="sidebar-section">
            <div className="section-title">
              <span>POSE / MAP FRAME</span>
              <small>SEQ {String(sequence).padStart(5, "0")}</small>
            </div>
            <div className="pose-grid">
              <PoseValue label="X" value={pose.x.toFixed(2)} unit="m" />
              <PoseValue label="Y" value={pose.y.toFixed(2)} unit="m" />
              <PoseValue label="YAW" value={pose.yaw.toFixed(1)} unit="deg" />
            </div>
          </section>

          <section className="sidebar-section">
            <div className="section-title">
              <span>PUBLISH CONFIG</span>
            </div>
            <div className="config-list">
              <div><span>Frame ID</span><code>map</code></div>
              <div><span>Child frame</span><code>base_link</code></div>
              <div><span>Publish rate</span><b>10 Hz</b></div>
              <div><span>Step distance</span><b>0.5 m</b></div>
            </div>
          </section>

          <div className="publish-actions">
            <button
              className="publish-button"
              onClick={() => setPublishing(true)}
              disabled={publishing}
            >
              <Send size={17} />
              포즈 발행
            </button>
            <button
              className="stop-button"
              onClick={() => setPublishing(false)}
              disabled={!publishing}
            >
              <CircleStop size={17} />
              발행 중단
            </button>
          </div>

          <div className="sidebar-footer">
            <Gauge size={15} />
            <span>
              <small>SIMULATOR CLOCK</small>
              <b>{publishing ? "RUNNING · 10 Hz" : "PAUSED"}</b>
            </span>
            <i className={publishing ? "live" : ""} />
          </div>
        </>
      )}
    </aside>
  );
}

function StageNavigation({ step, setStep }) {
  return (
    <nav className="stage-navigation" aria-label="개발 테스트 단계">
      {STEPS.map((item, index) => (
        <div className="stage-item-wrap" key={item.id}>
          <button
            className={`stage-item ${step === item.id ? "active" : ""} ${step > item.id ? "complete" : ""}`}
            onClick={() => setStep(item.id)}
          >
            <span>{step > item.id ? <Check size={14} /> : item.number}</span>
            <div>
              <small>{item.label}</small>
              <strong>{item.title}</strong>
            </div>
          </button>
          {index < STEPS.length - 1 && <i className={step > item.id ? "complete" : ""} />}
        </div>
      ))}
    </nav>
  );
}

export default function App() {
  const [step, setStep] = useState(1);
  const [pose, setPose] = useState(INITIAL_POSE);
  const [publishing, setPublishing] = useState(false);
  const [sequence, setSequence] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeKey, setActiveKey] = useState("");

  useEffect(() => {
    const requestedStep = Number(
      new URLSearchParams(window.location.search).get("stage"),
    );
    if (STEPS.some(({ id }) => id === requestedStep)) {
      setStep(requestedStep);
    }
  }, []);

  const moveRobot = useCallback((action) => {
    setPose((current) => {
      const radians = (current.yaw * Math.PI) / 180;
      const stepDistance = 0.5;
      let next = { ...current };

      if (action === "forward") {
        next.x += Math.sin(radians) * stepDistance;
        next.y += Math.cos(radians) * stepDistance;
      }
      if (action === "backward") {
        next.x -= Math.sin(radians) * stepDistance;
        next.y -= Math.cos(radians) * stepDistance;
      }
      if (action === "strafe-left") {
        next.x -= Math.cos(radians) * stepDistance;
        next.y += Math.sin(radians) * stepDistance;
      }
      if (action === "strafe-right") {
        next.x += Math.cos(radians) * stepDistance;
        next.y -= Math.sin(radians) * stepDistance;
      }
      if (action === "turn-left") next.yaw -= 5;
      if (action === "turn-right") next.yaw += 5;

      next.x = Math.max(-96, Math.min(96, next.x));
      next.y = Math.max(-68, Math.min(68, next.y));
      next.yaw = ((next.yaw + 180) % 360 + 360) % 360 - 180;
      return next;
    });
  }, []);

  const keyActions = useMemo(
    () => ({
      w: "forward",
      s: "backward",
      a: "turn-left",
      d: "turn-right",
      q: "strafe-left",
      e: "strafe-right",
    }),
    [],
  );

  useEffect(() => {
    if (!publishing) return undefined;
    const timer = window.setInterval(() => {
      setSequence((value) => value + 1);
    }, 100);
    return () => window.clearInterval(timer);
  }, [publishing]);

  useEffect(() => {
    if (step !== 3) return undefined;
    const handleKeyDown = (event) => {
      const key = event.key.toLowerCase();
      if (!keyActions[key] || event.target instanceof HTMLInputElement) return;
      event.preventDefault();
      setActiveKey(key);
      moveRobot(keyActions[key]);
    };
    const handleKeyUp = (event) => {
      const key = event.key.toLowerCase();
      if (keyActions[key]) setActiveKey("");
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [keyActions, moveRobot, step]);

  const resetPose = () => {
    setPose(INITIAL_POSE);
    setSequence(0);
  };

  return (
    <main className="app">
      <header className="command-header">
        <a className="brand" href="#" aria-label="서오릉 로봇맵 랩 홈">
          <span className="brand-icon"><Crosshair size={22} /></span>
          <span>
            <b>SEOOREUNG</b>
            <small>ROBOT MAP LAB</small>
          </span>
        </a>

        <StageNavigation step={step} setStep={setStep} />

        <div className="header-meta">
          <span className="dataset-status">
            <Database size={15} />
            <span><small>GEODATA</small><b>2 GOV SOURCES</b></span>
          </span>
          <span className="system-status"><i />ONLINE</span>
        </div>
      </header>

      <div className="workspace">
        <MapCanvas
          step={step}
          pose={pose}
          sidebarCollapsed={sidebarCollapsed}
        />

        {step === 3 && (
          <>
            <SimulatorSidebar
              collapsed={sidebarCollapsed}
              setCollapsed={setSidebarCollapsed}
              pose={pose}
              publishing={publishing}
              setPublishing={setPublishing}
              sequence={sequence}
            />
            <ControlDock
              onMove={moveRobot}
              activeKey={activeKey}
              onReset={resetPose}
            />
          </>
        )}
      </div>

      <div className="corner-brand">
        <Satellite size={14} />
        <span>NGII + HERITAGE VERIFIED</span>
        <Layers3 size={14} />
      </div>
    </main>
  );
}
