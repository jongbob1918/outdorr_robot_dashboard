export const ROBOT_EXTENT = {
  minX: -105,
  maxX: 105,
  minY: -76,
  maxY: 76,
};

export const DEFAULT_TRANSFORM = {
  originLng: 126.89915272336265,
  originLat: 37.63141097498908,
  rotationDeg: 0,
};

export const ROBOT_OBSTACLES = [
  { id: "west-north", minX: -94, maxX: -58, minY: 43, maxY: 66 },
  { id: "north-center", minX: -45, maxX: -12, minY: 27, maxY: 42 },
  { id: "center", minX: -6, maxX: 27, minY: -5, maxY: 11 },
  { id: "east-north", minX: 56, maxX: 94, minY: 42, maxY: 65 },
  { id: "west-south", minX: -94, maxX: -55, minY: -64, maxY: -41 },
  { id: "east-south", minX: 62, maxX: 94, minY: -63, maxY: -40 },
];

const METERS_PER_LAT = 110_540;
const toRadians = (degrees) => (degrees * Math.PI) / 180;

export function metersPerLng(latitude) {
  return 111_320 * Math.cos(toRadians(latitude));
}

export function localToLngLat(point, transform = DEFAULT_TRANSFORM) {
  const [x, y] = point;
  const radians = toRadians(transform.rotationDeg);
  const east = x * Math.cos(radians) - y * Math.sin(radians);
  const north = x * Math.sin(radians) + y * Math.cos(radians);
  return [
    transform.originLng + east / metersPerLng(transform.originLat),
    transform.originLat + north / METERS_PER_LAT,
  ];
}

export function lngLatToLocal(point, transform = DEFAULT_TRANSFORM) {
  const [lng, lat] = point;
  const east = (lng - transform.originLng) * metersPerLng(transform.originLat);
  const north = (lat - transform.originLat) * METERS_PER_LAT;
  const radians = toRadians(transform.rotationDeg);
  return [
    east * Math.cos(radians) + north * Math.sin(radians),
    -east * Math.sin(radians) + north * Math.cos(radians),
  ];
}

function featureCollection(features) {
  return { type: "FeatureCollection", features };
}

export function pointGeoJSON(point, transform, properties = {}) {
  if (!point) return featureCollection([]);
  return featureCollection([
    {
      type: "Feature",
      properties,
      geometry: {
        type: "Point",
        coordinates: localToLngLat(point, transform),
      },
    },
  ]);
}

export function poseGeoJSON(pose, transform) {
  return pointGeoJSON([pose.x, pose.y], transform, {
    yaw: pose.yaw + transform.rotationDeg,
  });
}

export function headingGeoJSON(pose, transform) {
  const radians = toRadians(pose.yaw);
  const end = [
    pose.x + Math.sin(radians) * 9,
    pose.y + Math.cos(radians) * 9,
  ];
  return featureCollection([
    {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: [
          localToLngLat([pose.x, pose.y], transform),
          localToLngLat(end, transform),
        ],
      },
    },
  ]);
}

export function routeGeoJSON(path, transform) {
  if (!path || path.length < 2) return featureCollection([]);
  return featureCollection([
    {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: path.map((point) => localToLngLat(point, transform)),
      },
    },
  ]);
}

export function obstacleGeoJSON(transform) {
  return featureCollection(
    ROBOT_OBSTACLES.map((obstacle) => ({
      type: "Feature",
      properties: { id: obstacle.id },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [obstacle.minX, obstacle.minY],
          [obstacle.maxX, obstacle.minY],
          [obstacle.maxX, obstacle.maxY],
          [obstacle.minX, obstacle.maxY],
          [obstacle.minX, obstacle.minY],
        ].map((point) => localToLngLat(point, transform))],
      },
    })),
  );
}

export function axisGeoJSON(transform, length = 70) {
  return featureCollection([
    {
      type: "Feature",
      properties: { axis: "x" },
      geometry: {
        type: "LineString",
        coordinates: [
          localToLngLat([0, 0], transform),
          localToLngLat([length, 0], transform),
        ],
      },
    },
    {
      type: "Feature",
      properties: { axis: "y" },
      geometry: {
        type: "LineString",
        coordinates: [
          localToLngLat([0, 0], transform),
          localToLngLat([0, length], transform),
        ],
      },
    },
  ]);
}

export function forbiddenGeoJSON(zones, transform, draft = []) {
  const polygons = [...zones];
  if (draft.length >= 2) polygons.push(draft);
  return featureCollection(
    polygons.map((zone, index) => {
      const ring = zone.length >= 3 ? [...zone, zone[0]] : zone;
      return {
        type: "Feature",
        properties: {
          draft: index === polygons.length - 1 && draft.length >= 2,
        },
        geometry: {
          type: zone.length >= 3 ? "Polygon" : "LineString",
          coordinates:
            zone.length >= 3
              ? [ring.map((point) => localToLngLat(point, transform))]
              : ring.map((point) => localToLngLat(point, transform)),
        },
      };
    }),
  );
}

export function buildInfiniteGridGeoJSON(mapBounds, transform, zoom = 16) {
  if (!mapBounds) return featureCollection([]);
  const corners = [
    [mapBounds.getWest(), mapBounds.getNorth()],
    [mapBounds.getEast(), mapBounds.getNorth()],
    [mapBounds.getEast(), mapBounds.getSouth()],
    [mapBounds.getWest(), mapBounds.getSouth()],
  ].map((point) => lngLatToLocal(point, transform));
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const spacing = zoom >= 18 ? 2 : zoom >= 16 ? 5 : zoom >= 14 ? 10 : 25;
  const margin = spacing * 2;
  const minX = Math.floor((Math.min(...xs) - margin) / spacing) * spacing;
  const maxX = Math.ceil((Math.max(...xs) + margin) / spacing) * spacing;
  const minY = Math.floor((Math.min(...ys) - margin) / spacing) * spacing;
  const maxY = Math.ceil((Math.max(...ys) + margin) / spacing) * spacing;
  const features = [];
  const maxLines = 400;

  for (let x = minX, count = 0; x <= maxX && count < maxLines; x += spacing, count += 1) {
    features.push({
      type: "Feature",
      properties: { major: Math.abs(x % (spacing * 5)) < 0.001, axis: Math.abs(x) < 0.001 },
      geometry: {
        type: "LineString",
        coordinates: [
          localToLngLat([x, minY], transform),
          localToLngLat([x, maxY], transform),
        ],
      },
    });
  }
  for (let y = minY, count = 0; y <= maxY && count < maxLines; y += spacing, count += 1) {
    features.push({
      type: "Feature",
      properties: { major: Math.abs(y % (spacing * 5)) < 0.001, axis: Math.abs(y) < 0.001 },
      geometry: {
        type: "LineString",
        coordinates: [
          localToLngLat([minX, y], transform),
          localToLngLat([maxX, y], transform),
        ],
      },
    });
  }
  return featureCollection(features);
}

export function pointInPolygon(point, polygon) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInObstacle([x, y], padding = 1.3) {
  return ROBOT_OBSTACLES.some(
    (obstacle) =>
      x >= obstacle.minX - padding &&
      x <= obstacle.maxX + padding &&
      y >= obstacle.minY - padding &&
      y <= obstacle.maxY + padding,
  );
}

export function isBlocked(point, forbiddenZones = []) {
  return (
    pointInObstacle(point) ||
    forbiddenZones.some((zone) => pointInPolygon(point, zone))
  );
}

function keyOf(x, y) {
  return `${x},${y}`;
}

function simplifyPath(path) {
  if (path.length < 3) return path;
  const result = [path[0]];
  let previousDirection = null;
  for (let i = 1; i < path.length; i += 1) {
    const direction = [
      Math.sign(path[i][0] - path[i - 1][0]),
      Math.sign(path[i][1] - path[i - 1][1]),
    ].join(",");
    if (previousDirection && direction !== previousDirection) result.push(path[i - 1]);
    previousDirection = direction;
  }
  result.push(path[path.length - 1]);
  return result;
}

class MinPriorityQueue {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(value) {
    this.items.push(value);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.items[parent].f <= value.f) break;
      this.items[index] = this.items[parent];
      index = parent;
    }
    this.items[index] = value;
  }

  pop() {
    if (this.items.length === 1) return this.items.pop();
    const first = this.items[0];
    const last = this.items.pop();
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.items.length) break;
      const smaller =
        right < this.items.length && this.items[right].f < this.items[left].f
          ? right
          : left;
      if (this.items[smaller].f >= last.f) break;
      this.items[index] = this.items[smaller];
      index = smaller;
    }
    this.items[index] = last;
    return first;
  }
}

export function planAStar(start, goal, forbiddenZones = [], resolution = 2) {
  if (!start || !goal || isBlocked(start, forbiddenZones) || isBlocked(goal, forbiddenZones)) {
    return [];
  }
  const snap = ([x, y]) => [
    Math.round(x / resolution),
    Math.round(y / resolution),
  ];
  const from = snap(start);
  const to = snap(goal);
  const blockerCells = [
    ...ROBOT_OBSTACLES.flatMap((obstacle) => [
      [obstacle.minX / resolution, obstacle.minY / resolution],
      [obstacle.maxX / resolution, obstacle.maxY / resolution],
    ]),
    ...forbiddenZones.flatMap((zone) =>
      zone.map(([x, y]) => [x / resolution, y / resolution]),
    ),
  ];
  const envelopePoints = [from, to, ...blockerCells];
  const directDistance = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const margin = Math.max(20, Math.ceil(directDistance * 0.25));
  const searchBounds = {
    minX: Math.floor(Math.min(...envelopePoints.map(([x]) => x)) - margin),
    maxX: Math.ceil(Math.max(...envelopePoints.map(([x]) => x)) + margin),
    minY: Math.floor(Math.min(...envelopePoints.map(([, y]) => y)) - margin),
    maxY: Math.ceil(Math.max(...envelopePoints.map(([, y]) => y)) + margin),
  };
  const maxVisited = Math.min(
    250_000,
    Math.max(30_000, Math.ceil(directDistance * 250)),
  );
  const frontier = new MinPriorityQueue();
  frontier.push({ x: from[0], y: from[1], f: 0 });
  const cameFrom = new Map();
  const gScore = new Map([[keyOf(from[0], from[1]), 0]]);
  const closed = new Set();
  const directions = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, Math.SQRT2],
    [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
    [-1, -1, Math.SQRT2],
  ];
  const heuristic = (x, y) => Math.hypot(to[0] - x, to[1] - y);

  while (frontier.size && closed.size < maxVisited) {
    const current = frontier.pop();
    const currentKey = keyOf(current.x, current.y);
    if (closed.has(currentKey)) continue;
    if (current.x === to[0] && current.y === to[1]) {
      const cells = [[current.x, current.y]];
      let cursor = currentKey;
      while (cameFrom.has(cursor)) {
        const previous = cameFrom.get(cursor);
        cells.push(previous);
        cursor = keyOf(previous[0], previous[1]);
      }
      cells.reverse();
      const path = cells.map(([x, y]) => [x * resolution, y * resolution]);
      path[0] = [...start];
      path[path.length - 1] = [...goal];
      return simplifyPath(path);
    }
    closed.add(currentKey);

    for (const [dx, dy, cost] of directions) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (
        nx < searchBounds.minX ||
        nx > searchBounds.maxX ||
        ny < searchBounds.minY ||
        ny > searchBounds.maxY
      ) {
        continue;
      }
      const point = [nx * resolution, ny * resolution];
      const nextKey = keyOf(nx, ny);
      if (closed.has(nextKey) || isBlocked(point, forbiddenZones)) continue;
      if (
        dx !== 0 &&
        dy !== 0 &&
        (isBlocked([current.x * resolution + dx * resolution, current.y * resolution], forbiddenZones) ||
          isBlocked([current.x * resolution, current.y * resolution + dy * resolution], forbiddenZones))
      ) {
        continue;
      }
      const tentative = (gScore.get(currentKey) ?? Infinity) + cost;
      if (tentative >= (gScore.get(nextKey) ?? Infinity)) continue;
      cameFrom.set(nextKey, [current.x, current.y]);
      gScore.set(nextKey, tentative);
      frontier.push({ x: nx, y: ny, f: tentative + heuristic(nx, ny) });
    }
  }
  return [];
}
