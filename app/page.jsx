"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Ban,
  BellRing,
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
  Map as MapIcon,
  MapPin,
  Minus,
  MousePointerClick,
  Move,
  Navigation,
  Plus,
  Radio,
  RotateCcw,
  RotateCw,
  Satellite,
  Save,
  Send,
  SquareTerminal,
  Trash2,
  X,
} from "lucide-react";
import * as maplibregl from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-csp-worker.js?url";
import proj4 from "proj4";
import {
  DEFAULT_TRANSFORM,
  ROBOT_EXTENT,
  ROBOT_OBSTACLES,
  axisGeoJSON,
  buildInfiniteGridGeoJSON,
  forbiddenGeoJSON,
  headingGeoJSON,
  lngLatToLocal,
  localToLngLat,
  obstacleGeoJSON,
  planAStar,
  pointGeoJSON,
  poseGeoJSON,
  routeGeoJSON,
} from "./robot-map";

maplibregl.setWorkerUrl(maplibreWorkerUrl);

const INITIAL_POSE = { x: -22.4, y: -8.8, yaw: 32 };
const ALIGNMENT_STORAGE_KEY = "seooreung-map-alignment-v1";
const GENERAL_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
const ROBOT_EVENTS = [
  { id: "battery-check", point: [-68, 24], severity: "info" },
  { id: "surface-alert", point: [42, -30], severity: "warning" },
  { id: "inspection", point: [82, 48], severity: "info" },
];
const EMPTY_COLLECTION = { type: "FeatureCollection", features: [] };
const EPSG_5179 =
  "+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs";
const EPSG_4326 = "+proj=longlat +datum=WGS84 +no_defs";

function aerialLevelForZoom(levels, zoom) {
  const desiredMatrix = zoom < 16.5 ? 15 : zoom < 17.5 ? 16 : zoom < 18.5 ? 17 : 18;
  return levels.find(({ matrix }) => matrix === desiredMatrix) ?? levels[0];
}

function projectedTileCoordinates(aerial, level, row, column) {
  const span = aerial.tileSize * level.resolutionMetersPerPixel;
  const minX = aerial.origin[0] + column * span;
  const maxX = minX + span;
  const maxY = aerial.origin[1] - row * span;
  const minY = maxY - span;
  return [
    proj4(EPSG_5179, EPSG_4326, [minX, maxY]),
    proj4(EPSG_5179, EPSG_4326, [maxX, maxY]),
    proj4(EPSG_5179, EPSG_4326, [maxX, minY]),
    proj4(EPSG_5179, EPSG_4326, [minX, minY]),
  ];
}

function visibleAerialTiles(map, aerial) {
  const level = aerialLevelForZoom(aerial.levels, map.getZoom());
  const span = aerial.tileSize * level.resolutionMetersPerPixel;
  const bounds = map.getBounds();
  const projected = [
    [bounds.getWest(), bounds.getNorth()],
    [bounds.getEast(), bounds.getNorth()],
    [bounds.getEast(), bounds.getSouth()],
    [bounds.getWest(), bounds.getSouth()],
  ].map((point) => proj4(EPSG_4326, EPSG_5179, point));
  const xs = projected.map(([x]) => x);
  const ys = projected.map(([, y]) => y);
  const range = level.tileRange;
  const columnStart = Math.max(
    range.columnStart,
    Math.floor((Math.min(...xs) - aerial.origin[0]) / span) - 1,
  );
  const columnEnd = Math.min(
    range.columnEnd,
    Math.floor((Math.max(...xs) - aerial.origin[0]) / span) + 1,
  );
  const rowStart = Math.max(
    range.rowStart,
    Math.floor((aerial.origin[1] - Math.max(...ys)) / span) - 1,
  );
  const rowEnd = Math.min(
    range.rowEnd,
    Math.floor((aerial.origin[1] - Math.min(...ys)) / span) + 1,
  );
  const tiles = [];
  for (let row = rowStart; row <= rowEnd; row += 1) {
    for (let column = columnStart; column <= columnEnd; column += 1) {
      tiles.push({ level, row, column });
    }
  }
  return { level, tiles };
}

function setSourceData(map, id, data) {
  map.getSource(id)?.setData(data);
}

function addGeoJSONSource(map, id, data = EMPTY_COLLECTION) {
  map.addSource(id, { type: "geojson", data });
}

function draftPointsGeoJSON(points, transform) {
  return {
    type: "FeatureCollection",
    features: points.map((point, index) => ({
      type: "Feature",
      properties: { index: index + 1 },
      geometry: { type: "Point", coordinates: localToLngLat(point, transform) },
    })),
  };
}

function eventGeoJSON(transform) {
  return {
    type: "FeatureCollection",
    features: ROBOT_EVENTS.map((event) => ({
      type: "Feature",
      properties: { id: event.id, severity: event.severity },
      geometry: {
        type: "Point",
        coordinates: localToLngLat(event.point, transform),
      },
    })),
  };
}

function LayerControl({
  baseMap,
  setBaseMap,
  layerVisibility,
  toggleLayer,
}) {
  const [open, setOpen] = useState(false);
  const layers = [
    { id: "forbidden", label: "금지구역", icon: Ban },
    { id: "robotPose", label: "로봇 포즈", icon: Bot },
    { id: "events", label: "이벤트", icon: BellRing },
  ];
  return (
    <div className={`layer-control ${open ? "open" : ""}`}>
      <button
        className="layer-control-trigger"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <Layers3 size={17} />레이어
      </button>
      {open && (
        <div className="layer-control-panel">
          <div className="layer-panel-heading">
            <span>BASE MAP</span><small>지도 유형</small>
          </div>
          <div className="base-map-options">
            <button
              className={baseMap === "satellite" ? "active" : ""}
              onClick={() => setBaseMap("satellite")}
            >
              <Satellite size={16} />위성
            </button>
            <button
              className={baseMap === "general" ? "active" : ""}
              onClick={() => setBaseMap("general")}
            >
              <MapIcon size={16} />일반
            </button>
          </div>
          <div className="layer-panel-heading overlays">
            <span>OVERLAYS</span><small>표시 레이어</small>
          </div>
          <div className="layer-switches">
            {layers.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                role="switch"
                aria-checked={layerVisibility[id]}
                onClick={() => toggleLayer(id)}
              >
                <span><Icon size={15} />{label}</span>
                <i className={layerVisibility[id] ? "active" : ""} />
              </button>
            ))}
          </div>
          <p>일반 지도: OpenFreeMap · OpenStreetMap 데이터</p>
        </div>
      )}
    </div>
  );
}

function MapCanvas({
  toolMode,
  pose,
  transform,
  publishing,
  baseMap,
  setBaseMap,
  layerVisibility,
  toggleLayer,
  sidebarCollapsed,
  interactionMode,
  onCoordinateClick,
  path,
  goal,
  forbiddenZones,
  draftZone,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const nationalDataRef = useRef(null);
  const aerialTileIdsRef = useRef(new Set());
  const satelliteCameraRef = useRef(null);
  const stateRef = useRef({
    interactionMode,
    onCoordinateClick,
    transform,
    baseMap,
  });
  const [mapReady, setMapReady] = useState(false);
  const [dataError, setDataError] = useState("");
  const [dataInfo, setDataInfo] = useState(null);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [zoom, setZoom] = useState(14.8);
  const [aerialLevel, setAerialLevel] = useState(null);
  const [generalFeatureCount, setGeneralFeatureCount] = useState(0);

  stateRef.current = {
    interactionMode,
    onCoordinateClick,
    transform,
    baseMap,
  };

  const refreshGrid = useCallback(() => {
    const map = mapRef.current;
    if (!map?.getSource("robot-grid")) return;
    setSourceData(
      map,
      "robot-grid",
      buildInfiniteGridGeoJSON(map.getBounds(), stateRef.current.transform, map.getZoom()),
    );
  }, []);

  const refreshAerialTiles = useCallback(() => {
    const map = mapRef.current;
    const aerial = nationalDataRef.current?.aerial;
    if (!map || !aerial || !map.getStyle()) return;
    const { level, tiles } = visibleAerialTiles(map, aerial);
    const nextIds = new Set();
    for (const { row, column } of tiles) {
      const id = `ngii-${level.matrix}-${row}-${column}`;
      nextIds.add(id);
      if (map.getSource(id)) continue;
      const url = aerial.pathTemplate
        .replace("{matrix}", level.matrix)
        .replace("{row}", row)
        .replace("{column}", column);
      map.addSource(id, {
        type: "image",
        url,
        coordinates: projectedTileCoordinates(aerial, level, row, column),
      });
      map.addLayer(
        {
          id,
          type: "raster",
          source: id,
          layout: {
            visibility:
              stateRef.current.baseMap === "satellite" ? "visible" : "none",
          },
          paint: {
            "raster-opacity": 1,
            "raster-brightness-min": 0.04,
            "raster-brightness-max": 0.82,
            "raster-contrast": 0.1,
            "raster-saturation": -0.12,
            "raster-fade-duration": 120,
            "raster-resampling": "linear",
          },
        },
        map.getLayer("heritage-boundary-fill") ? "heritage-boundary-fill" : undefined,
      );
    }
    for (const id of aerialTileIdsRef.current) {
      if (nextIds.has(id)) continue;
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
    }
    aerialTileIdsRef.current = nextIds;
    setAerialLevel(level);
  }, []);

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
          style: GENERAL_STYLE_URL,
          center: metadata.heritage.center,
          zoom: 14.8,
          bearing: 0,
          pitch: 0,
          attributionControl: false,
          maxZoom: 20,
        });
        mapRef.current = map;

        map.on("load", () => {
          map.addSource("heritage-boundary", { type: "geojson", data: heritage });
          map.addLayer({
            id: "heritage-boundary-fill",
            type: "fill",
            source: "heritage-boundary",
            paint: { "fill-color": "#00d6a6", "fill-opacity": 0.055 },
          });
          map.addLayer({
            id: "heritage-boundary-line",
            type: "line",
            source: "heritage-boundary",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": "#8cf6dd",
              "line-width": 2,
              "line-opacity": 0.82,
              "line-dasharray": [2, 1.5],
            },
          });

          addGeoJSONSource(map, "robot-events");
          map.addLayer({
            id: "robot-events-halo",
            type: "circle",
            source: "robot-events",
            layout: { visibility: "none" },
            paint: {
              "circle-radius": 12,
              "circle-color": [
                "match",
                ["get", "severity"],
                "warning",
                "rgba(255, 142, 91, .2)",
                "rgba(79, 169, 255, .18)",
              ],
              "circle-stroke-width": 1,
              "circle-stroke-color": [
                "match",
                ["get", "severity"],
                "warning",
                "#ff8e5b",
                "#56aaff",
              ],
            },
          });
          map.addLayer({
            id: "robot-events-dot",
            type: "circle",
            source: "robot-events",
            layout: { visibility: "none" },
            paint: {
              "circle-radius": 4,
              "circle-color": [
                "match",
                ["get", "severity"],
                "warning",
                "#ff8e5b",
                "#56aaff",
              ],
              "circle-stroke-width": 2,
              "circle-stroke-color": "#071016",
            },
          });

          addGeoJSONSource(map, "robot-grid");
          map.addLayer({
            id: "robot-grid-line",
            type: "line",
            source: "robot-grid",
            layout: { visibility: "none" },
            paint: {
              "line-color": [
                "case",
                ["get", "axis"],
                "#ffda6a",
                ["get", "major"],
                "#8debd7",
                "#b9d7d1",
              ],
              "line-width": ["case", ["get", "axis"], 1.8, ["get", "major"], 1.1, 0.65],
              "line-opacity": ["case", ["get", "axis"], 0.92, ["get", "major"], 0.52, 0.24],
            },
          });

          addGeoJSONSource(map, "robot-obstacles");
          map.addLayer({
            id: "robot-obstacles-fill",
            type: "fill",
            source: "robot-obstacles",
            layout: { visibility: "none" },
            paint: {
              "fill-color": "#91aeb8",
              "fill-opacity": 0.18,
            },
          });
          map.addLayer({
            id: "robot-obstacles-line",
            type: "line",
            source: "robot-obstacles",
            layout: { visibility: "none" },
            paint: {
              "line-color": "#e2eef1",
              "line-width": 2,
              "line-opacity": 0.88,
            },
          });

          addGeoJSONSource(map, "robot-axes");
          map.addLayer({
            id: "robot-axes-line",
            type: "line",
            source: "robot-axes",
            layout: { visibility: "none" },
            paint: {
              "line-color": ["match", ["get", "axis"], "x", "#ff6b70", "#50a9ff"],
              "line-width": 3,
              "line-opacity": 0.95,
            },
          });

          addGeoJSONSource(map, "forbidden-zones");
          map.addLayer({
            id: "forbidden-fill",
            type: "fill",
            source: "forbidden-zones",
            layout: { visibility: "none" },
            paint: {
              "fill-color": "#ff625b",
              "fill-opacity": ["case", ["get", "draft"], 0.12, 0.24],
            },
          });
          map.addLayer({
            id: "forbidden-line",
            type: "line",
            source: "forbidden-zones",
            layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": "#ff7c76",
              "line-width": 2.5,
              "line-dasharray": [2, 1.5],
            },
          });

          addGeoJSONSource(map, "draft-points");
          map.addLayer({
            id: "draft-points-dot",
            type: "circle",
            source: "draft-points",
            layout: { visibility: "none" },
            paint: {
              "circle-radius": 5,
              "circle-color": "#ff625b",
              "circle-stroke-color": "#fff",
              "circle-stroke-width": 2,
            },
          });

          addGeoJSONSource(map, "planned-route");
          map.addLayer({
            id: "planned-route-halo",
            type: "line",
            source: "planned-route",
            layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#071a15", "line-width": 8, "line-opacity": 0.85 },
          });
          map.addLayer({
            id: "planned-route-line",
            type: "line",
            source: "planned-route",
            layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#00f0bb", "line-width": 4, "line-opacity": 0.98 },
          });

          addGeoJSONSource(map, "goal-point");
          map.addLayer({
            id: "goal-halo",
            type: "circle",
            source: "goal-point",
            layout: { visibility: "none" },
            paint: {
              "circle-radius": 13,
              "circle-color": "rgba(79,169,255,.18)",
              "circle-stroke-color": "#56aaff",
              "circle-stroke-width": 2,
            },
          });
          map.addLayer({
            id: "goal-dot",
            type: "circle",
            source: "goal-point",
            layout: { visibility: "none" },
            paint: { "circle-radius": 4, "circle-color": "#d7ecff" },
          });

          addGeoJSONSource(map, "robot-heading");
          map.addLayer({
            id: "robot-heading-line",
            type: "line",
            source: "robot-heading",
            layout: { visibility: "none", "line-cap": "round" },
            paint: { "line-color": "#fff", "line-width": 4, "line-opacity": 0.95 },
          });
          addGeoJSONSource(map, "robot-pose");
          map.addLayer({
            id: "robot-pose-halo",
            type: "circle",
            source: "robot-pose",
            layout: { visibility: "none" },
            paint: {
              "circle-radius": 16,
              "circle-color": "rgba(0,214,166,.16)",
              "circle-stroke-width": 1,
              "circle-stroke-color": "rgba(0,214,166,.55)",
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
            [
              [metadata.heritage.boundsWgs84.minX, metadata.heritage.boundsWgs84.minY],
              [metadata.heritage.boundsWgs84.maxX, metadata.heritage.boundsWgs84.maxY],
            ],
            { padding: 34, duration: 0 },
          );
          refreshAerialTiles();
          refreshGrid();
          setZoom(map.getZoom());
          map.once("idle", () => {
            if (!cancelled) setMapReady(true);
          });
        });

        map.on("zoom", () => setZoom(map.getZoom()));
        map.on("moveend", () => {
          refreshGrid();
          refreshAerialTiles();
        });
        map.on("zoomend", () => {
          refreshGrid();
          refreshAerialTiles();
        });
        map.on("idle", () => {
          setGeneralFeatureCount(
            stateRef.current.baseMap === "general" && map.getSource("openmaptiles")
              ? map.queryRenderedFeatures().filter(
                  (feature) => feature.source === "openmaptiles",
                ).length
              : 0,
          );
        });
        map.on("click", (event) => {
          const current = stateRef.current;
          if (!current.interactionMode) return;
          current.onCoordinateClick(
            lngLatToLocal([event.lngLat.lng, event.lngLat.lat], current.transform),
          );
        });
        map.on("error", ({ error }) => {
          if (!cancelled && error?.message) setDataError(error.message);
        });
      } catch (error) {
        if (!cancelled) setDataError(error.message || "국가 공간정보 초기화에 실패했습니다.");
      }
    };

    initializeMap();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      nationalDataRef.current = null;
    };
  }, [refreshAerialTiles, refreshGrid]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    refreshAerialTiles();
    const align = toolMode === "align" && overlayVisible ? "visible" : "none";
    const poseVisible =
      publishing && layerVisibility.robotPose ? "visible" : "none";
    const forbiddenVisible = layerVisibility.forbidden ? "visible" : "none";
    const eventsVisible = layerVisibility.events ? "visible" : "none";
    const mission = toolMode === "mission" ? "visible" : "none";
    ["robot-grid-line", "robot-obstacles-fill", "robot-obstacles-line", "robot-axes-line"].forEach(
      (id) => map.setLayoutProperty(id, "visibility", align),
    );
    [
      "robot-heading-line",
      "robot-pose-halo",
      "robot-pose-dot",
    ].forEach((id) => map.setLayoutProperty(id, "visibility", poseVisible));
    ["forbidden-fill", "forbidden-line"].forEach((id) =>
      map.setLayoutProperty(id, "visibility", forbiddenVisible),
    );
    ["planned-route-halo", "planned-route-line", "goal-halo", "goal-dot"].forEach(
      (id) => map.setLayoutProperty(id, "visibility", mission),
    );
    ["robot-events-halo", "robot-events-dot"].forEach((id) =>
      map.setLayoutProperty(id, "visibility", eventsVisible),
    );
    map.setLayoutProperty(
      "draft-points-dot",
      "visibility",
      toolMode === "mission" &&
        interactionMode === "forbidden" &&
        layerVisibility.forbidden
        ? "visible"
        : "none",
    );
    for (const id of aerialTileIdsRef.current) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(
          id,
          "visibility",
          baseMap === "satellite" ? "visible" : "none",
        );
      }
    }
    setGeneralFeatureCount(
      baseMap === "general" && map.getSource("openmaptiles")
        ? map.queryRenderedFeatures().filter(
            (feature) => feature.source === "openmaptiles",
          ).length
        : 0,
    );

    if (toolMode === "align") {
      const sw = localToLngLat([ROBOT_EXTENT.minX, ROBOT_EXTENT.minY], transform);
      const ne = localToLngLat([ROBOT_EXTENT.maxX, ROBOT_EXTENT.maxY], transform);
      map.fitBounds([sw, ne], {
        padding: {
          top: 112,
          right: !sidebarCollapsed ? 396 : 72,
          bottom: 72,
          left: 72,
        },
        bearing: 0,
        duration: 650,
      });
    }
    refreshGrid();
  }, [
    baseMap,
    interactionMode,
    layerVisibility,
    mapReady,
    overlayVisible,
    publishing,
    refreshAerialTiles,
    refreshGrid,
    sidebarCollapsed,
    toolMode,
    transform,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    setSourceData(map, "robot-obstacles", obstacleGeoJSON(transform));
    setSourceData(map, "robot-axes", axisGeoJSON(transform));
    setSourceData(map, "robot-pose", poseGeoJSON(pose, transform));
    setSourceData(map, "robot-heading", headingGeoJSON(pose, transform));
    setSourceData(map, "robot-events", eventGeoJSON(transform));
    setSourceData(map, "planned-route", routeGeoJSON(path, transform));
    setSourceData(map, "goal-point", pointGeoJSON(goal, transform));
    setSourceData(map, "forbidden-zones", forbiddenGeoJSON(forbiddenZones, transform, draftZone));
    setSourceData(map, "draft-points", draftPointsGeoJSON(draftZone, transform));
    refreshGrid();
  }, [draftZone, forbiddenZones, goal, mapReady, path, pose, refreshGrid, transform]);

  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.getCanvas().style.cursor = interactionMode ? "crosshair" : "";
  }, [interactionMode]);

  const zoomBy = (amount) => {
    const map = mapRef.current;
    if (!map) return;
    const maximumZoom = baseMap === "general" ? 16 : 20;
    map.easeTo({
      zoom: Math.min(maximumZoom, Math.max(12, map.getZoom() + amount)),
      duration: 220,
    });
    window.setTimeout(refreshAerialTiles, 260);
  };

  const changeBaseMap = (nextBaseMap) => {
    const map = mapRef.current;
    if (!map || nextBaseMap === baseMap) return;
    if (nextBaseMap === "general") {
      satelliteCameraRef.current = {
        center: map.getCenter().toArray(),
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      };
      if (map.getZoom() > 15) map.easeTo({ zoom: 15, duration: 420 });
    } else if (satelliteCameraRef.current) {
      map.easeTo({ ...satelliteCameraRef.current, duration: 420 });
    }
    setBaseMap(nextBaseMap);
  };

  const resetView = () => {
    const map = mapRef.current;
    if (!map) return;
    if (toolMode !== "align") {
      const bounds = nationalDataRef.current?.heritage.boundsWgs84;
      if (bounds) {
        map.fitBounds(
          [[bounds.minX, bounds.minY], [bounds.maxX, bounds.maxY]],
          { padding: { top: 72, right: sidebarCollapsed ? 72 : 396, bottom: 118, left: 72 }, duration: 650 },
        );
      }
      return;
    }
    const sw = localToLngLat([ROBOT_EXTENT.minX, ROBOT_EXTENT.minY], transform);
    const ne = localToLngLat([ROBOT_EXTENT.maxX, ROBOT_EXTENT.maxY], transform);
    map.fitBounds([sw, ne], { padding: 90, duration: 650 });
  };

  return (
    <section
      className="map-viewport"
      aria-label="서오릉 지도"
      data-aerial-matrix={aerialLevel?.matrix ?? ""}
      data-aerial-resolution={aerialLevel?.resolutionMetersPerPixel ?? ""}
      data-tool-mode={toolMode}
      data-base-map={baseMap}
      data-pose-published={publishing && layerVisibility.robotPose ? "visible" : "hidden"}
      data-general-features={generalFeatureCount}
    >
      <div ref={containerRef} className="map-container" data-interaction-mode={interactionMode || "idle"} />

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

      <LayerControl
        baseMap={baseMap}
        setBaseMap={changeBaseMap}
        layerVisibility={layerVisibility}
        toggleLayer={toggleLayer}
      />

      {toolMode === "align" && (
        <button
          className={`overlay-toggle ${overlayVisible ? "active" : ""}`}
          onClick={() => setOverlayVisible((visible) => !visible)}
        >
          {overlayVisible ? <Eye size={16} /> : <EyeOff size={16} />}
          INFINITE GRID
        </button>
      )}

      {interactionMode && (
        <div className="interaction-banner">
          {interactionMode === "goal" ? <Navigation size={17} /> : <Ban size={17} />}
          <span>
            <b>{interactionMode === "goal" ? "목표 지점을 클릭하세요" : "금지구역 꼭짓점을 클릭하세요"}</b>
            <small>지도 좌표가 로봇 map 프레임으로 역변환됩니다</small>
          </span>
        </div>
      )}

      <div className={`map-controls ${!sidebarCollapsed ? "with-sidebar" : ""}`}>
        <button onClick={() => zoomBy(1)} aria-label="지도 확대"><Plus size={19} /></button>
        <span>{zoom.toFixed(1)}</span>
        <button onClick={() => zoomBy(-1)} aria-label="지도 축소"><Minus size={19} /></button>
        <button onClick={resetView} aria-label="서오릉 중심으로 이동"><LocateFixed size={18} /></button>
      </div>

      <div className="map-state-label">
        <span className="green-dot" />
        {toolMode === "align"
          ? "INFINITE MAP FRAME"
          : toolMode === "pose"
            ? publishing
              ? "POSE STREAM · 10 HZ"
              : "POSE STREAM · STANDBY"
            : "A* MISSION EDITOR"}
      </div>

      <div className="national-attribution">
        {baseMap === "satellite" ? (
          <span>
            영상 © 국토지리정보원 · 2024 항공사진 ·
            {" "}{aerialLevel ? `${aerialLevel.resolutionMetersPerPixel.toFixed(3)} m/px` : "loading"}
          </span>
        ) : (
          <span>일반지도 © OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors</span>
        )}
        <i />
        <span>경계 © 국가유산청 · 지정유산 SHP</span>
      </div>
    </section>
  );
}

function TransformEditor({
  transform,
  onShift,
  onRotate,
  onReset,
  onSave,
  isSaved,
  savedAt,
}) {
  return (
    <section className="transform-editor">
      <div className="transform-heading">
        <span><Move size={18} /></span>
        <div>
          <small>MAP ALIGNMENT</small>
          <strong>로봇 좌표계 정렬</strong>
        </div>
      </div>
      <p>
        투명한 무한 map 그리드를 항공사진 위에서 이동·회전합니다.
        방향키 1m · Shift+방향키 5m
      </p>
      <div className="transform-readout">
        <div><small>ORIGIN LNG</small><b>{transform.originLng.toFixed(6)}</b></div>
        <div><small>ORIGIN LAT</small><b>{transform.originLat.toFixed(6)}</b></div>
        <div><small>ROTATION</small><b>{transform.rotationDeg.toFixed(1)}°</b></div>
      </div>
      <div className="nudge-layout">
        <div className="nudge-pad" aria-label="로봇맵 이동">
          <button onClick={() => onShift(0, 5)} aria-label="북쪽으로 5미터"><ArrowUp size={17} /></button>
          <button onClick={() => onShift(-5, 0)} aria-label="서쪽으로 5미터"><ArrowLeft size={17} /></button>
          <span>5m</span>
          <button onClick={() => onShift(5, 0)} aria-label="동쪽으로 5미터"><ArrowRight size={17} /></button>
          <button onClick={() => onShift(0, -5)} aria-label="남쪽으로 5미터"><ArrowDown size={17} /></button>
        </div>
        <div className="rotate-actions">
          <button onClick={() => onRotate(-5)}><RotateCcw size={16} />-5°</button>
          <button onClick={() => onRotate(5)}><RotateCw size={16} />+5°</button>
          <button className="transform-reset" onClick={onReset}><Crosshair size={16} />초기화</button>
          <button className="alignment-save-button" onClick={onSave}>
            <Save size={16} />{isSaved ? "저장됨" : "정합 저장"}
          </button>
        </div>
      </div>
      <div className={`alignment-save-status ${isSaved ? "saved" : "dirty"}`}>
        <i />
        <span>
          {isSaved
            ? savedAt
              ? `${savedAt} · 새로고침 후 자동 복원`
              : "저장된 정합값"
            : "변경사항이 저장되지 않았습니다"}
        </span>
      </div>
      <div className="transform-legend">
        <span><i className="axis-x" />X축</span>
        <span><i className="axis-y" />Y축</span>
        <span><i className="obstacle-key" />로봇맵 장애물</span>
      </div>
    </section>
  );
}

function RobotMapPreview({ pose, path, goal, forbiddenZones }) {
  const headingLength = 12;
  const radians = (pose.yaw * Math.PI) / 180;
  const heading = [
    pose.x + Math.sin(radians) * headingLength,
    pose.y + Math.cos(radians) * headingLength,
  ];
  const visiblePoints = [
    [pose.x, pose.y],
    ...(goal ? [goal] : []),
    ...path,
    ...forbiddenZones.flat(),
  ];
  const xs = visiblePoints.map(([x]) => x);
  const ys = visiblePoints.map(([, y]) => y);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  let viewWidth = Math.max(210, Math.max(...xs) - Math.min(...xs) + 40);
  let viewHeight = Math.max(152, Math.max(...ys) - Math.min(...ys) + 40);
  const previewAspect = 210 / 152;
  if (viewWidth / viewHeight > previewAspect) viewHeight = viewWidth / previewAspect;
  else viewWidth = viewHeight * previewAspect;
  const viewX = centerX - viewWidth / 2;
  const viewY = centerY - viewHeight / 2;
  return (
    <section className="robot-map-preview" data-testid="sidebar-robot-map">
      <div className="preview-title">
        <span><Layers3 size={14} />ROBOT MAP / LOCAL FRAME</span>
        <small>INFINITE · AUTO FIT</small>
      </div>
      <svg
        viewBox={`${viewX} ${-(centerY + viewHeight / 2)} ${viewWidth} ${viewHeight}`}
        role="img"
        aria-label="사이드바 무한 로봇 좌표 지도"
      >
        <defs>
          <pattern id="local-grid" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#92aca8" strokeWidth=".35" opacity=".3" />
          </pattern>
        </defs>
        <g transform="scale(1,-1)">
          <rect x={viewX} y={viewY} width={viewWidth} height={viewHeight} fill="url(#local-grid)" />
          <line x1={viewX} y1="0" x2={viewX + viewWidth} y2="0" stroke="#ff6b70" strokeWidth=".8" opacity=".72" />
          <line x1="0" y1={viewY} x2="0" y2={viewY + viewHeight} stroke="#50a9ff" strokeWidth=".8" opacity=".72" />
          {ROBOT_OBSTACLES.map((item) => (
            <rect
              key={item.id}
              x={item.minX}
              y={item.minY}
              width={item.maxX - item.minX}
              height={item.maxY - item.minY}
              className="preview-obstacle"
            />
          ))}
          {forbiddenZones.map((zone, index) => (
            <polygon key={index} points={zone.map((point) => point.join(",")).join(" ")} className="preview-forbidden" />
          ))}
          {path.length > 1 && <polyline points={path.map((point) => point.join(",")).join(" ")} className="preview-route" />}
          {goal && <circle cx={goal[0]} cy={goal[1]} r="3.8" className="preview-goal" />}
          <line x1={pose.x} y1={pose.y} x2={heading[0]} y2={heading[1]} className="preview-heading" />
          <circle cx={pose.x} cy={pose.y} r="4.2" className="preview-robot" />
        </g>
      </svg>
      <div className="preview-coordinate">
        <span>X {pose.x.toFixed(1)} m</span>
        <span>Y {pose.y.toFixed(1)} m</span>
        <span>YAW {pose.yaw.toFixed(0)}°</span>
      </div>
    </section>
  );
}

function PoseValue({ label, value, unit }) {
  return (
    <div className="pose-value">
      <span>{label}</span><strong>{value}</strong><small>{unit}</small>
    </div>
  );
}

function SimulatorSidebar({
  collapsed,
  setCollapsed,
  toolMode,
  setToolMode,
  pose,
  publishing,
  setPublishing,
  sequence,
  path,
  goal,
  forbiddenZones,
  transform,
  onShift,
  onRotate,
  onTransformReset,
  onSaveAlignment,
  isAlignmentSaved,
  alignmentSavedAt,
  onMove,
  activeKey,
  onResetPose,
  interactionMode,
  setInteractionMode,
  draftZone,
  finishZone,
  cancelMode,
  deleteZone,
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
          <Bot size={19} /><span>TOOLS</span><i className={publishing ? "live" : ""} />
        </div>
      ) : (
        <>
          <div className="simulator-heading">
            <span className="simulator-symbol"><SquareTerminal size={20} /></span>
            <div><small>CONTROL SIDEBAR</small><h2>ROBOT OPERATIONS</h2></div>
            <span className={`publish-state ${publishing ? "live" : ""}`}>
              <i />{publishing ? "PUBLISHING" : "STANDBY"}
            </span>
          </div>

          <nav className="sidebar-tool-tabs" aria-label="관제 도구">
            <button className={toolMode === "align" ? "active" : ""} onClick={() => setToolMode("align")}>
              <Move size={15} /><span>좌표 정렬</span>
            </button>
            <button className={toolMode === "pose" ? "active" : ""} onClick={() => setToolMode("pose")}>
              <Bot size={15} /><span>로봇 포즈</span>
            </button>
            <button className={toolMode === "mission" ? "active" : ""} onClick={() => setToolMode("mission")}>
              <Navigation size={15} /><span>임무 편집</span>
            </button>
          </nav>

          <RobotMapPreview pose={pose} path={path} goal={goal} forbiddenZones={forbiddenZones} />

          {toolMode === "align" && (
            <TransformEditor
              transform={transform}
              onShift={onShift}
              onRotate={onRotate}
              onReset={onTransformReset}
              onSave={onSaveAlignment}
              isSaved={isAlignmentSaved}
              savedAt={alignmentSavedAt}
            />
          )}

          {toolMode === "pose" && (
            <>
              <div className="topic-card">
                <span><Radio size={15} />ROS 2 TOPIC</span><code>/robot_pose</code>
              </div>
              <div className={`pose-map-state ${publishing ? "live" : ""}`}>
                <Eye size={15} />
                <span>
                  <small>MAIN MAP POSE</small>
                  <b>{publishing ? "표시 중 · 10 Hz" : "숨김 · 발행 대기"}</b>
                </span>
              </div>
              <section className="sidebar-section compact">
                <div className="section-title">
                  <span>POSE / MAP FRAME</span><small>SEQ {String(sequence).padStart(5, "0")}</small>
                </div>
                <div className="pose-grid">
                  <PoseValue label="X" value={pose.x.toFixed(2)} unit="m" />
                  <PoseValue label="Y" value={pose.y.toFixed(2)} unit="m" />
                  <PoseValue label="YAW" value={pose.yaw.toFixed(1)} unit="deg" />
                </div>
              </section>
              <ControlDock
                onMove={onMove}
                activeKey={activeKey}
                onReset={onResetPose}
                compact
              />
              <div className="publish-actions">
                <button className="publish-button" onClick={() => setPublishing(true)} disabled={publishing}>
                  <Send size={17} />포즈 발행
                </button>
                <button className="stop-button" onClick={() => setPublishing(false)} disabled={!publishing}>
                  <CircleStop size={17} />발행 중단
                </button>
              </div>
            </>
          )}

          {toolMode === "mission" && (
            <MissionTools
              mode={interactionMode}
              setMode={setInteractionMode}
              path={path}
              goal={goal}
              draftZone={draftZone}
              forbiddenZones={forbiddenZones}
              finishZone={finishZone}
              cancelMode={cancelMode}
              deleteZone={deleteZone}
            />
          )}

          <div className="sidebar-footer">
            <Gauge size={15} />
            <span>
              <small>{toolMode === "align" ? "MAP TRANSFORM" : toolMode === "pose" ? "SIMULATOR CLOCK" : "A* PLANNER"}</small>
              <b>
                {toolMode === "align"
                  ? `${transform.rotationDeg.toFixed(1)}° · LOCAL → WGS84`
                  : toolMode === "pose"
                    ? publishing ? "RUNNING · 10 Hz" : "PAUSED"
                    : path.length > 1 ? "ROUTE READY" : "WAITING TARGET"}
              </b>
            </span>
            <i className={publishing || path.length > 1 ? "live" : ""} />
          </div>
        </>
      )}
    </aside>
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
      {Icon ? <Icon size={16} /> : <b>{label}</b>}<span>{label}</span>
    </button>
  );
}

function ControlDock({ onMove, activeKey, onReset, compact = false }) {
  return (
    <div className={`control-dock ${compact ? "sidebar-control-dock" : ""}`}>
      <div className="dock-copy"><small>MANUAL CONTROL</small><strong>로봇 포즈 이동</strong></div>
      <div className="keyboard-cluster">
        <KeyButton label="Q" hint="왼쪽 평행 이동" onTrigger={() => onMove("strafe-left")} active={activeKey === "q"} />
        <KeyButton label="W" icon={ArrowUp} hint="전진" onTrigger={() => onMove("forward")} active={activeKey === "w"} />
        <KeyButton label="E" hint="오른쪽 평행 이동" onTrigger={() => onMove("strafe-right")} active={activeKey === "e"} />
        <KeyButton label="A" icon={ArrowLeft} hint="왼쪽 회전" onTrigger={() => onMove("turn-left")} active={activeKey === "a"} />
        <KeyButton label="S" icon={ArrowDown} hint="후진" onTrigger={() => onMove("backward")} active={activeKey === "s"} />
        <KeyButton label="D" icon={ArrowRight} hint="오른쪽 회전" onTrigger={() => onMove("turn-right")} active={activeKey === "d"} />
      </div>
      <button className="reset-button" onClick={onReset}><RotateCcw size={17} />RESET</button>
    </div>
  );
}

function MissionTools({
  mode,
  setMode,
  path,
  goal,
  draftZone,
  forbiddenZones,
  finishZone,
  cancelMode,
  deleteZone,
}) {
  return (
    <div className="mission-tools">
      <div className="mission-actions">
        <button className={mode === "goal" ? "active" : ""} onClick={() => setMode(mode === "goal" ? "" : "goal")}>
          <MousePointerClick size={17} />목표 지정
        </button>
        <button className={mode === "forbidden" ? "danger-active" : ""} onClick={() => setMode(mode === "forbidden" ? "" : "forbidden")}>
          <Ban size={17} />금지구역
        </button>
        {mode === "forbidden" && (
          <>
            <button className="finish-zone" onClick={finishZone} disabled={draftZone.length < 3}>
              <Check size={17} />완료
            </button>
            <button onClick={cancelMode}><X size={17} />취소</button>
          </>
        )}
        {!mode && forbiddenZones.length > 0 && (
          <button onClick={deleteZone}><Trash2 size={16} />최근 구역 삭제</button>
        )}
      </div>
      <div className="mission-summary">
        <span><small>A* PATH</small><b data-testid="path-status">{path.length > 1 ? `${path.length} WAYPOINTS` : goal ? "NO PATH" : "READY"}</b></span>
        <span><small>NO-GO ZONES</small><b data-testid="zone-count">{forbiddenZones.length}</b></span>
        {draftZone.length > 0 && <span><small>VERTICES</small><b>{draftZone.length}</b></span>}
      </div>
    </div>
  );
}

export default function App() {
  const [toolMode, setToolMode] = useState("pose");
  const [pose, setPose] = useState(INITIAL_POSE);
  const [transform, setTransform] = useState(DEFAULT_TRANSFORM);
  const [savedTransform, setSavedTransform] = useState(DEFAULT_TRANSFORM);
  const [alignmentSavedAt, setAlignmentSavedAt] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [sequence, setSequence] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeKey, setActiveKey] = useState("");
  const [interactionMode, setInteractionMode] = useState("");
  const [goal, setGoal] = useState(null);
  const [path, setPath] = useState([]);
  const [forbiddenZones, setForbiddenZones] = useState([]);
  const [draftZone, setDraftZone] = useState([]);
  const [baseMap, setBaseMap] = useState("satellite");
  const [layerVisibility, setLayerVisibility] = useState({
    forbidden: true,
    robotPose: true,
    events: true,
  });

  useEffect(() => {
    try {
      const stored = JSON.parse(
        window.localStorage.getItem(ALIGNMENT_STORAGE_KEY) ?? "null",
      );
      const candidate = stored?.transform;
      if (
        candidate &&
        ["originLng", "originLat", "rotationDeg"].every((key) =>
          Number.isFinite(candidate[key]),
        )
      ) {
        setTransform(candidate);
        setSavedTransform(candidate);
        setAlignmentSavedAt(stored.savedAtLabel ?? "저장값 복원");
      }
    } catch {
      window.localStorage.removeItem(ALIGNMENT_STORAGE_KEY);
    }
  }, []);

  const isAlignmentSaved = useMemo(
    () =>
      ["originLng", "originLat", "rotationDeg"].every(
        (key) => Math.abs(transform[key] - savedTransform[key]) < 1e-10,
      ),
    [savedTransform, transform],
  );

  const moveRobot = useCallback((action) => {
    setPose((current) => {
      const radians = (current.yaw * Math.PI) / 180;
      const distance = 0.5;
      const next = { ...current };
      if (action === "forward") {
        next.x += Math.sin(radians) * distance;
        next.y += Math.cos(radians) * distance;
      }
      if (action === "backward") {
        next.x -= Math.sin(radians) * distance;
        next.y -= Math.cos(radians) * distance;
      }
      if (action === "strafe-left") {
        next.x -= Math.cos(radians) * distance;
        next.y += Math.sin(radians) * distance;
      }
      if (action === "strafe-right") {
        next.x += Math.cos(radians) * distance;
        next.y -= Math.sin(radians) * distance;
      }
      if (action === "turn-left") next.yaw -= 5;
      if (action === "turn-right") next.yaw += 5;
      next.yaw = ((next.yaw + 180) % 360 + 360) % 360 - 180;
      return next;
    });
  }, []);

  const keyActions = useMemo(
    () => ({ w: "forward", s: "backward", a: "turn-left", d: "turn-right", q: "strafe-left", e: "strafe-right" }),
    [],
  );

  useEffect(() => {
    if (!publishing) return undefined;
    const timer = window.setInterval(() => setSequence((value) => value + 1), 100);
    return () => window.clearInterval(timer);
  }, [publishing]);

  useEffect(() => {
    if (toolMode === "align") return undefined;
    const handleKeyDown = (event) => {
      const key = event.key.toLowerCase();
      if (!keyActions[key] || event.target instanceof HTMLInputElement) return;
      event.preventDefault();
      setActiveKey(key);
      moveRobot(keyActions[key]);
    };
    const handleKeyUp = (event) => {
      if (keyActions[event.key.toLowerCase()]) setActiveKey("");
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [keyActions, moveRobot, toolMode]);

  useEffect(() => {
    if (goal) setPath(planAStar([pose.x, pose.y], goal, forbiddenZones));
  }, [forbiddenZones, goal, pose.x, pose.y]);

  const shiftTransform = useCallback((east, north) => {
    setTransform((current) => ({
      ...current,
      originLng: current.originLng + east / (111_320 * Math.cos((current.originLat * Math.PI) / 180)),
      originLat: current.originLat + north / 110_540,
    }));
  }, []);

  useEffect(() => {
    if (toolMode !== "align") return undefined;
    const directions = {
      ArrowUp: [0, 1],
      ArrowDown: [0, -1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    };
    const handleAlignmentKey = (event) => {
      if (!directions[event.key] || event.target instanceof HTMLInputElement) return;
      event.preventDefault();
      const distance = event.shiftKey ? 5 : 1;
      const [east, north] = directions[event.key];
      shiftTransform(east * distance, north * distance);
    };
    window.addEventListener("keydown", handleAlignmentKey);
    return () => window.removeEventListener("keydown", handleAlignmentKey);
  }, [shiftTransform, toolMode]);

  const saveAlignment = () => {
    const savedAtLabel = new Intl.DateTimeFormat("ko-KR", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date());
    window.localStorage.setItem(
      ALIGNMENT_STORAGE_KEY,
      JSON.stringify({ transform, savedAtLabel }),
    );
    setSavedTransform(transform);
    setAlignmentSavedAt(savedAtLabel);
  };

  const toggleLayer = (id) => {
    setLayerVisibility((current) => ({ ...current, [id]: !current[id] }));
  };

  const setMode = (mode) => {
    setInteractionMode(mode);
    setDraftZone([]);
  };

  const changeToolMode = (mode) => {
    setToolMode(mode);
    setInteractionMode("");
    setDraftZone([]);
  };

  const handleCoordinateClick = useCallback((point) => {
    if (interactionMode === "goal") {
      const nextGoal = point.map((value) => Number(value.toFixed(2)));
      setGoal(nextGoal);
      setPath(planAStar([pose.x, pose.y], nextGoal, forbiddenZones));
      setInteractionMode("");
    } else if (interactionMode === "forbidden") {
      setDraftZone((current) => [...current, point.map((value) => Number(value.toFixed(2)))]);
    }
  }, [forbiddenZones, interactionMode, pose.x, pose.y]);

  const finishZone = () => {
    if (draftZone.length < 3) return;
    setForbiddenZones((zones) => [...zones, draftZone]);
    setDraftZone([]);
    setInteractionMode("");
  };

  const resetPose = () => {
    setPose(INITIAL_POSE);
    setSequence(0);
  };

  return (
    <main className="app">
      <header className="command-header">
        <a className="brand" href="#" aria-label="서오릉 로봇맵 랩 홈">
          <span className="brand-icon"><Crosshair size={22} /></span>
          <span><b>SEOOREUNG</b><small>ROBOT MAP LAB</small></span>
        </a>
        <div className="header-map-status">
          <Satellite size={16} />
          <span><small>MULTI-RESOLUTION AERIAL</small><b>서오릉 통합 로봇 관제</b></span>
        </div>
        <div className="header-meta">
          <span className="dataset-status">
            <Database size={15} /><span><small>GEODATA</small><b>2 GOV SOURCES</b></span>
          </span>
          <span className="system-status"><i />ONLINE</span>
        </div>
      </header>

      <div className="workspace">
        <MapCanvas
          toolMode={toolMode}
          pose={pose}
          transform={transform}
          publishing={publishing}
          baseMap={baseMap}
          setBaseMap={setBaseMap}
          layerVisibility={layerVisibility}
          toggleLayer={toggleLayer}
          sidebarCollapsed={sidebarCollapsed}
          interactionMode={interactionMode}
          onCoordinateClick={handleCoordinateClick}
          path={path}
          goal={goal}
          forbiddenZones={forbiddenZones}
          draftZone={draftZone}
        />

        <SimulatorSidebar
          collapsed={sidebarCollapsed}
          setCollapsed={setSidebarCollapsed}
          toolMode={toolMode}
          setToolMode={changeToolMode}
          pose={pose}
          publishing={publishing}
          setPublishing={setPublishing}
          sequence={sequence}
          path={path}
          goal={goal}
          forbiddenZones={forbiddenZones}
          transform={transform}
          onShift={shiftTransform}
          onRotate={(degrees) => setTransform((current) => ({
            ...current,
            rotationDeg: current.rotationDeg + degrees,
          }))}
          onTransformReset={() => setTransform(DEFAULT_TRANSFORM)}
          onSaveAlignment={saveAlignment}
          isAlignmentSaved={isAlignmentSaved}
          alignmentSavedAt={alignmentSavedAt}
          onMove={moveRobot}
          activeKey={activeKey}
          onResetPose={resetPose}
          interactionMode={interactionMode}
          setInteractionMode={setMode}
          draftZone={draftZone}
          finishZone={finishZone}
          cancelMode={() => {
            setDraftZone([]);
            setInteractionMode("");
          }}
          deleteZone={() => setForbiddenZones((zones) => zones.slice(0, -1))}
        />
      </div>

      <div className="corner-brand">
        <Satellite size={14} /><span>NGII + HERITAGE VERIFIED</span><Layers3 size={14} />
      </div>
    </main>
  );
}
