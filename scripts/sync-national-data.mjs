import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import process from "node:process";
import proj4 from "proj4";
import * as shapefile from "shapefile";

const projectRoot = resolve(import.meta.dirname, "..");
const sourceArchive = join(
  projectRoot,
  "data/raw/national-heritage/seooreung-designated-heritage.zip",
);
const outputDirectory = join(projectRoot, "public/data");
const workDirectory = mkdtempSync(join(tmpdir(), "seooreung-national-data-"));

const HERITAGE_SOURCE =
  "https://gis-heritage.go.kr/newMain/heritageDownload.do";
const NGII_WMTS = "https://map.ngii.go.kr/airmapprime/map/wmts";
const NGII_LAYER = "mapprime:air_2024";
const MATRIX = 16;
const RESOLUTION = 1.02;
const TILE_SIZE = 256;
const TILE_SPAN = RESOLUTION * TILE_SIZE;
const ORIGIN = [-200000, 4000000];
const PADDING_METERS = 100;

const EPSG_5179 =
  "+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs";
const EPSG_4326 = "+proj=longlat +datum=WGS84 +no_defs";

function walkCoordinates(value, visitor) {
  if (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  ) {
    return visitor(value);
  }
  return value.map((child) => walkCoordinates(child, visitor));
}

function projectedBounds(features) {
  const bounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };

  for (const feature of features) {
    walkCoordinates(feature.geometry.coordinates, ([x, y]) => {
      bounds.minX = Math.min(bounds.minX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.maxY = Math.max(bounds.maxY, y);
      return [x, y];
    });
  }
  return bounds;
}

function tileUrl(row, column) {
  const url = new URL(NGII_WMTS);
  url.search = new URLSearchParams({
    SERVICE: "WMTS",
    REQUEST: "GetTile",
    VERSION: "1.0.0",
    LAYER: NGII_LAYER,
    STYLE: "",
    FORMAT: "image/jpeg",
    TILEMATRIXSET: "NGIS_AIR",
    TILEMATRIX: String(MATRIX),
    TILEROW: String(row),
    TILECOL: String(column),
  });
  return url;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function main() {
  mkdirSync(outputDirectory, { recursive: true });
  execFileSync("unzip", [
    "-O",
    "CP949",
    "-o",
    sourceArchive,
    "-d",
    workDirectory,
  ]);

  const sourceNames = readdirSync(workDirectory);
  const shpPath = join(
    workDirectory,
    sourceNames.find((name) => name.endsWith(".shp")),
  );
  const dbfPath = join(
    workDirectory,
    sourceNames.find((name) => name.endsWith(".dbf")),
  );

  const collection = await shapefile.read(shpPath, dbfPath, {
    encoding: "euc-kr",
  });
  const bounds = projectedBounds(collection.features);
  const heritage = {
    type: "FeatureCollection",
    name: "고양 서오릉 지정유산 구역",
    crs: {
      type: "name",
      properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" },
    },
    features: collection.features.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        source: "국가유산청 국가유산공간정보서비스",
        sourceCrs: "EPSG:5179",
      },
      geometry: {
        ...feature.geometry,
        coordinates: walkCoordinates(
          feature.geometry.coordinates,
          (coordinate) => proj4(EPSG_5179, EPSG_4326, coordinate),
        ),
      },
    })),
  };
  const heritageBoundsWgs84 = projectedBounds(heritage.features);
  const heritageCenter = [
    (heritageBoundsWgs84.minX + heritageBoundsWgs84.maxX) / 2,
    (heritageBoundsWgs84.minY + heritageBoundsWgs84.maxY) / 2,
  ];

  const padded = {
    minX: bounds.minX - PADDING_METERS,
    minY: bounds.minY - PADDING_METERS,
    maxX: bounds.maxX + PADDING_METERS,
    maxY: bounds.maxY + PADDING_METERS,
  };
  const columnStart = Math.floor((padded.minX - ORIGIN[0]) / TILE_SPAN);
  const columnEnd = Math.floor((padded.maxX - ORIGIN[0]) / TILE_SPAN);
  const rowStart = Math.floor((ORIGIN[1] - padded.maxY) / TILE_SPAN);
  const rowEnd = Math.floor((ORIGIN[1] - padded.minY) / TILE_SPAN);
  const columnCount = columnEnd - columnStart + 1;
  const rowCount = rowEnd - rowStart + 1;
  const tilePaths = [];

  for (let row = rowStart; row <= rowEnd; row += 1) {
    for (let column = columnStart; column <= columnEnd; column += 1) {
      const outputPath = join(
        workDirectory,
        `tile-${String(row).padStart(6, "0")}-${String(column).padStart(6, "0")}.jpg`,
      );
      const response = await fetch(tileUrl(row, column), {
        headers: {
          "User-Agent": "seooreung-robot-dashboard/0.1 data prototype",
        },
      });
      if (!response.ok) {
        throw new Error(
          `NGII tile download failed: ${response.status} row=${row} col=${column}`,
        );
      }
      writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
      tilePaths.push(outputPath);
    }
  }

  const imagePath = join(outputDirectory, "seooreung-ngii-air-2024.jpg");
  execFileSync("montage", [
    ...tilePaths,
    "-tile",
    `${columnCount}x${rowCount}`,
    "-geometry",
    "+0+0",
    "-quality",
    "88",
    imagePath,
  ]);

  const projectedImageBounds = {
    minX: ORIGIN[0] + columnStart * TILE_SPAN,
    maxX: ORIGIN[0] + (columnEnd + 1) * TILE_SPAN,
    maxY: ORIGIN[1] - rowStart * TILE_SPAN,
    minY: ORIGIN[1] - (rowEnd + 1) * TILE_SPAN,
  };
  const imageCorners = {
    nw: proj4(EPSG_5179, EPSG_4326, [
      projectedImageBounds.minX,
      projectedImageBounds.maxY,
    ]),
    ne: proj4(EPSG_5179, EPSG_4326, [
      projectedImageBounds.maxX,
      projectedImageBounds.maxY,
    ]),
    se: proj4(EPSG_5179, EPSG_4326, [
      projectedImageBounds.maxX,
      projectedImageBounds.minY,
    ]),
    sw: proj4(EPSG_5179, EPSG_4326, [
      projectedImageBounds.minX,
      projectedImageBounds.minY,
    ]),
  };

  const heritagePath = join(
    outputDirectory,
    "seooreung-national-heritage.geojson",
  );
  writeFileSync(heritagePath, `${JSON.stringify(heritage, null, 2)}\n`);

  const metadataPath = join(
    outputDirectory,
    "seooreung-national-data.json",
  );
  const metadata = {
    generatedAt: new Date().toISOString(),
    location: "고양 서오릉",
    sources: [
      {
        organization: "국토교통부 국토지리정보원",
        dataset: "항공사진 영상지도",
        year: 2024,
        url: NGII_WMTS,
        layer: NGII_LAYER,
        matrixSet: "NGIS_AIR",
        matrix: MATRIX,
        resolutionMetersPerPixel: RESOLUTION,
        tileRange: {
          rowStart,
          rowEnd,
          columnStart,
          columnEnd,
          count: tilePaths.length,
        },
      },
      {
        organization: "국가유산청",
        dataset: "지정유산 공간정보",
        url: HERITAGE_SOURCE,
        originalFile: basename(sourceArchive),
        originalCrs: "EPSG:5179",
        featureCount: heritage.features.length,
      },
    ],
    image: {
      path: "/data/seooreung-ngii-air-2024.jpg",
      width: columnCount * TILE_SIZE,
      height: rowCount * TILE_SIZE,
      coordinates: [
        imageCorners.nw,
        imageCorners.ne,
        imageCorners.se,
        imageCorners.sw,
      ],
      sha256: sha256(imagePath),
    },
    heritage: {
      path: "/data/seooreung-national-heritage.geojson",
      boundsEpsg5179: bounds,
      boundsWgs84: heritageBoundsWgs84,
      center: heritageCenter,
      sha256: sha256(heritagePath),
    },
  };
  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

  console.log(
    JSON.stringify(
      {
        image: `${columnCount * TILE_SIZE}x${rowCount * TILE_SIZE}`,
        tiles: tilePaths.length,
        features: heritage.features.length,
        outputs: [imagePath, heritagePath, metadataPath],
      },
      null,
      2,
    ),
  );
}

try {
  await main();
} finally {
  rmSync(workDirectory, { recursive: true, force: true });
}
