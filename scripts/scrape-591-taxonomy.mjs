#!/usr/bin/env node
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import vm from "node:vm";

const rootDir = process.cwd();
const execFileAsync = promisify(execFile);
const FETCH_RETRIES = 3;
const defaultOutputFile = path.join(rootDir, "data", "591-taxonomy.generated.json");

const { outputFile, searchUrl } = parseArgs(process.argv.slice(2));

if (!searchUrl) {
  console.error(
    "Usage: node scripts/scrape-591-taxonomy.mjs [--out <file>] <591 list url>",
  );
  process.exit(1);
}

const html = await downloadText(searchUrl);
const bundleUrl = extractBundleUrl(html, searchUrl);
const bundle = await downloadText(bundleUrl);

const regionGroupsRaw = evaluateArrayLiteral(extractAssignedArray(bundle, "wM"));
const sectionsRaw = evaluateArrayLiteral(extractAssignedArray(bundle, "M1"));
const circlesRaw = evaluateArrayLiteral(extractAssignedArray(bundle, "_M"));

const regions = normalizeRegions(regionGroupsRaw);
const kinds = extractRentKinds(html);
const sections = normalizeSections(sectionsRaw, regions);
const circles = normalizeCircles(circlesRaw, regions);

const taxonomy = {
  generatedAt: new Date().toISOString(),
  sourceUrl: searchUrl,
  bundleUrl,
  counts: {
    regions: regions.length,
    kinds: kinds.length,
    sections: sections.length,
    circles: circles.length,
  },
  selected: resolveSelectedQuery(searchUrl, { regions, kinds, sections, circles }),
  kinds,
  regions,
  sections,
  circles,
};

await fs.mkdir(path.dirname(outputFile), { recursive: true });
await fs.writeFile(outputFile, `${JSON.stringify(taxonomy, null, 2)}\n`, "utf8");

console.log(`Wrote taxonomy to ${path.relative(rootDir, outputFile)}`);
console.log(
  `Regions: ${regions.length}, kinds: ${kinds.length}, sections: ${sections.length}, circles: ${circles.length}`,
);

if (Object.keys(taxonomy.selected).length > 0) {
  console.log("Resolved current query:");

  for (const [field, values] of Object.entries(taxonomy.selected)) {
    const summary = values.map((item) => `${item.id}=${item.name}`).join(", ");
    console.log(`- ${field}: ${summary}`);
  }
}

function parseArgs(args) {
  let outputFile = defaultOutputFile;
  const rest = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--out") {
      const next = args[index + 1];
      if (!next) {
        throw new Error("Missing value after --out");
      }
      outputFile = path.resolve(rootDir, next);
      index += 1;
      continue;
    }
    rest.push(arg);
  }

  return {
    outputFile,
    searchUrl: rest[0] || null,
  };
}

async function downloadText(url) {
  let lastError = null;

  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt += 1) {
    try {
      const { stdout } = await execFileAsync(
        "curl.exe",
        [
          "-L",
          "-A",
          "Mozilla/5.0",
          "-H",
          "Accept-Language: zh-TW,zh;q=0.9,en;q=0.8",
          url,
        ],
        {
          cwd: rootDir,
          encoding: "utf8",
          maxBuffer: 20 * 1024 * 1024,
          windowsHide: true,
        },
      );

      return stdout;
    } catch (error) {
      lastError = error;
      if (attempt < FETCH_RETRIES) {
        await sleep(1000 * attempt);
      }
    }
  }

  throw new Error(`Failed to fetch ${url}: ${lastError?.message || "unknown error"}`);
}

function extractBundleUrl(html, pageUrl) {
  const match = html.match(
    /<script[^>]+type="module"[^>]+src="([^"]*\/house\/[^"]+\.js)"[^>]*><\/script>/i,
  );

  if (!match) {
    throw new Error("Could not find the 591 house bundle URL in the page HTML.");
  }

  return new URL(decodeHtmlEntities(match[1]), pageUrl).href;
}

function extractAssignedArray(code, variableName) {
  const marker = `${variableName}=`;
  const startIndex = code.indexOf(marker);

  if (startIndex < 0) {
    throw new Error(`Could not find ${variableName} in the 591 bundle.`);
  }

  const arrayStart = code.indexOf("[", startIndex + marker.length);
  if (arrayStart < 0) {
    throw new Error(`Could not find the array start for ${variableName}.`);
  }

  let depth = 0;
  let inString = false;
  let stringQuote = "";
  let escapeNext = false;

  for (let index = arrayStart; index < code.length; index += 1) {
    const char = code[index];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (inString) {
      if (char === "\\") {
        escapeNext = true;
      } else if (char === stringQuote) {
        inString = false;
        stringQuote = "";
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      inString = true;
      stringQuote = char;
      continue;
    }

    if (char === "[") {
      depth += 1;
      continue;
    }

    if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return code.slice(arrayStart, index + 1);
      }
    }
  }

  throw new Error(`Could not parse the array literal for ${variableName}.`);
}

function evaluateArrayLiteral(literal) {
  const sandbox = Object.create(null);
  return vm.runInNewContext(`(${literal})`, sandbox, { timeout: 5000 });
}

function normalizeRegions(regionGroupsRaw) {
  return regionGroupsRaw.flatMap((group) =>
    (group.child || []).map((region) => ({
      id: Number(region.id),
      name: String(region.name || ""),
      group: String(group.name || ""),
      lat: toNumberOrNull(region.lat),
      lng: toNumberOrNull(region.lng),
    })),
  );
}

function normalizeSections(sectionsRaw, regions) {
  const regionById = new Map(regions.map((region) => [region.id, region]));

  return sectionsRaw
    .flatMap((regionEntry) =>
      (regionEntry.child || []).map((section) => {
        const region = regionById.get(Number(regionEntry.id));
        return {
          id: Number(section.id),
          name: String(section.name || ""),
          regionId: Number(regionEntry.id),
          regionName: region?.name || "",
          regionGroup: region?.group || "",
          lat: toNumberOrNull(section.lat),
          lng: toNumberOrNull(section.lng),
        };
      }),
    )
    .sort((left, right) => left.regionId - right.regionId || left.id - right.id);
}

function normalizeCircles(circlesRaw, regions) {
  const regionById = new Map(regions.map((region) => [region.id, region]));

  return circlesRaw
    .flatMap((regionEntry) =>
      (regionEntry.circles || []).map((circle) => {
        const region = regionById.get(Number(regionEntry.regionId));
        return {
          id: Number(circle.id),
          name: String(circle.name || ""),
          regionId: Number(regionEntry.regionId),
          regionName: region?.name || String(regionEntry.regionName || ""),
          regionGroup: region?.group || "",
        };
      }),
    )
    .sort((left, right) => left.regionId - right.regionId || left.id - right.id);
}

function extractRentKinds(html) {
  const kindsById = new Map();
  const pattern = /href="([^"]*rent\.591\.com\.tw\/list\?[^"]*)"[^>]*>([^<]+)</g;

  for (const match of html.matchAll(pattern)) {
    const href = decodeHtmlEntities(match[1]);
    const label = decodeHtmlEntities(match[2]).trim();
    const resolved = new URL(href, "https://rent.591.com.tw");
    const kindId = Number(resolved.searchParams.get("kind"));

    if (!Number.isFinite(kindId) || kindId <= 0 || !label || looksLikeLocationLabel(label)) {
      continue;
    }

    if (!kindsById.has(kindId)) {
      kindsById.set(kindId, {
        id: kindId,
        name: label,
      });
    }
  }

  return [...kindsById.values()].sort((left, right) => left.id - right.id);
}

function looksLikeLocationLabel(value) {
  return /(?:市|縣|區|鄉|鎮)$/.test(value);
}

function resolveSelectedQuery(searchUrl, indexes) {
  const url = new URL(searchUrl);
  const regionById = new Map(indexes.regions.map((item) => [item.id, item]));
  const kindById = new Map(indexes.kinds.map((item) => [item.id, item]));
  const sectionById = new Map(indexes.sections.map((item) => [item.id, item]));
  const circleById = new Map(indexes.circles.map((item) => [item.id, item]));

  return compactObject({
    region: mapQueryValues(url.searchParams.get("region"), regionById),
    kind: mapQueryValues(url.searchParams.get("kind"), kindById),
    section: mapQueryValues(url.searchParams.get("section"), sectionById),
    circle: mapQueryValues(url.searchParams.get("circle"), circleById),
  });
}

function mapQueryValues(rawValue, indexById) {
  if (!rawValue) {
    return undefined;
  }

  const values = rawValue
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value))
    .map((value) => indexById.get(value))
    .filter(Boolean);

  return values.length > 0 ? values : undefined;
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined),
  );
}

function toNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
