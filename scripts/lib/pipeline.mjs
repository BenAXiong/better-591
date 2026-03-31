import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const COUNT_MARKER = /^已為你找到\d+間房屋$/;
const PRICE_LINE = /^\d{1,3}(?:,\d{3})*元\/月$/;
const STOP_MARKERS = [
  /^上一頁$/,
  /^下一頁$/,
  /^刊登出租$/,
  /^金牌專家$/,
  /^想出現在這裡$/,
  /^社區專家頭像$/,
];

const KNOWN_TAGS = [
  "屋主直租",
  "拎包入住",
  "隨時可遷入",
  "可短租",
  "可開伙",
  "押一付一",
  "有車位",
  "近商圈",
  "有電梯",
  "新上架",
  "免服務費",
  "可養寵物",
  "社會住宅",
  "可入籍",
  "影片賞屋",
  "有陽台",
  "近捷運",
];

export function getPaths(rootDir = process.cwd()) {
  return {
    rawDir: path.join(rootDir, "data", "raw"),
    enrichmentFile: path.join(rootDir, "data", "enrichment.json"),
    photoTargetsFile: path.join(rootDir, "data", "photo-targets.txt"),
    generatedJsonFile: path.join(rootDir, "data", "listings.generated.json"),
    appDataFile: path.join(rootDir, "web", "app-data.js"),
    rootIndexFile: path.join(rootDir, "index.html"),
    webDir: path.join(rootDir, "web"),
    photoDir: path.join(rootDir, "web", "photos"),
    publicDir: path.join(rootDir, "public"),
    publicIndexFile: path.join(rootDir, "public", "index.html"),
    publicWebDir: path.join(rootDir, "public", "web"),
    publicAppDataFile: path.join(rootDir, "public", "web", "app-data.js"),
    publicAppFile: path.join(rootDir, "public", "web", "app.js"),
    publicStylesFile: path.join(rootDir, "public", "web", "styles.css"),
  };
}

export async function buildAppData(rootDir = process.cwd()) {
  const rawListings = await loadRawListings(rootDir);
  const listings = dedupeListings(rawListings);
  const enrichment = buildEnrichmentIndex(rawListings, await loadEnrichment(rootDir));

  const mergedListings = listings.map((listing) => {
    const extra = enrichment[listing.propertyKey] ?? enrichment[listing.sourceKey] ?? {};
    const gallery = Array.isArray(extra.images)
      ? extra.images.map((image, index) => ({
          id: `${listing.id}-img-${index + 1}`,
          src: image.localPath || image.remoteUrl,
          localPath: image.localPath || null,
          remoteUrl: image.remoteUrl || null,
        }))
      : [];

    return {
      ...listing,
      sourceUrl: extra.sourceUrl ?? null,
      listingId: extra.listingId ?? null,
      images: gallery,
      hasPhotos: gallery.length > 0,
      photoCount: gallery.length,
      lastPhotoFetchAt: extra.lastFetchedAt ?? null,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    listingCount: mergedListings.length,
    rawFileCount: new Set(rawListings.map((listing) => listing.sourceFile)).size,
    listings: mergedListings,
  };
}

export async function writeBuildOutputs(rootDir, appData) {
  const {
    generatedJsonFile,
    appDataFile,
    publicDir,
    publicIndexFile,
    publicAppDataFile,
    publicAppFile,
    publicStylesFile,
    rootIndexFile,
    webDir,
  } = getPaths(rootDir);
  await fs.mkdir(path.dirname(generatedJsonFile), { recursive: true });
  await fs.mkdir(path.dirname(appDataFile), { recursive: true });
  await fs.writeFile(generatedJsonFile, `${JSON.stringify(appData, null, 2)}\n`, "utf8");
  await fs.writeFile(
    appDataFile,
    `window.__APP_DATA__ = ${JSON.stringify(appData, null, 2)};\n`,
    "utf8",
  );

  await fs.rm(publicDir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(publicAppDataFile), { recursive: true });
  await fs.copyFile(rootIndexFile, publicIndexFile);
  await fs.copyFile(path.join(webDir, "app.js"), publicAppFile);
  await fs.copyFile(path.join(webDir, "styles.css"), publicStylesFile);
  await fs.writeFile(
    publicAppDataFile,
    `window.__APP_DATA__ = ${JSON.stringify(appData, null, 2)};\n`,
    "utf8",
  );
}

export async function loadRawListings(rootDir = process.cwd()) {
  const { rawDir } = getPaths(rootDir);
  const entries = await safeReadDir(rawDir);
  const txtFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".txt"))
    .map((entry) => entry.name)
    .sort();

  const allListings = [];

  for (const fileName of txtFiles) {
    const filePath = path.join(rawDir, fileName);
    const sourceText = await fs.readFile(filePath, "utf8");
    const fileMeta = parseSourceFileName(fileName);
    const parsed = parsePasteText(sourceText, fileMeta);
    allListings.push(...parsed);
  }

  return allListings;
}

export async function loadEnrichment(rootDir = process.cwd()) {
  const { enrichmentFile } = getPaths(rootDir);
  try {
    const text = await fs.readFile(enrichmentFile, "utf8");
    const parsed = JSON.parse(text);
    return isObject(parsed) ? parsed : {};
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export async function saveEnrichment(rootDir, enrichment) {
  const { enrichmentFile } = getPaths(rootDir);
  await fs.mkdir(path.dirname(enrichmentFile), { recursive: true });
  await fs.writeFile(enrichmentFile, `${JSON.stringify(enrichment, null, 2)}\n`, "utf8");
}

export async function readPhotoTargets(rootDir = process.cwd()) {
  const { photoTargetsFile } = getPaths(rootDir);

  try {
    const raw = await fs.readFile(photoTargetsFile, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const parts = line.split(/\s*[|｜]\s*/).map((part) => part.trim());
        if (parts.length < 2) {
          return null;
        }

        return {
          match: parts[0],
          url: parts[1],
        };
      })
      .filter(Boolean);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export function findListingByMatch(listings, matchText) {
  const needle = normalizeText(matchText);
  return (
    listings.find((listing) => normalizeText(listing.sourceKey) === needle) ||
    listings.find((listing) => normalizeText(listing.id) === needle) ||
    listings.find((listing) => normalizeText(listing.title).includes(needle))
  );
}

export function extractListingIdFromUrl(url) {
  const match = url.match(/\/(\d+)(?:[/?#]|$)/);
  return match ? match[1] : null;
}

export function extractPhotoUrlsFromHtml(html) {
  const decoded = html.replace(/\\u002F/g, "/");
  const matches = decoded.match(/https?:\/\/img\d+\.591\.com\.tw\/house\/[^"' ]+?!1000x\.water2\.jpg/g) || [];
  return [...new Set(matches)];
}

export function buildPhotoRecord(remoteUrl, absoluteFilePath, rootDir = process.cwd()) {
  const relativeToWeb = path.relative(path.join(rootDir, "web"), absoluteFilePath);
  return {
    remoteUrl,
    localPath: relativeToWeb.split(path.sep).join("/"),
  };
}

export async function localFilesExist(rootDir, images = []) {
  const { webDir } = getPaths(rootDir);

  for (const image of images) {
    if (!image.localPath) {
      return false;
    }

    try {
      await fs.access(path.join(webDir, image.localPath));
    } catch {
      return false;
    }
  }

  return images.length > 0;
}

export function getDownloadExtension(url) {
  const cleanUrl = url.split("?")[0];
  const parsedExt = path.extname(cleanUrl);
  return parsedExt || ".jpg";
}

function parsePasteText(sourceText, fileMeta) {
  const lines = sourceText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const blocks = extractListingBlocks(lines);
  const listings = [];
  let orderInFile = 0;

  for (const block of blocks) {
    const segments = splitListingSegments(block);
    for (const segment of segments) {
      const parsed = parseListingSegment(segment, fileMeta, orderInFile);
      if (parsed) {
        listings.push(parsed);
        orderInFile += 1;
      }
    }
  }

  return listings;
}

function extractListingBlocks(lines) {
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    while (index < lines.length && !COUNT_MARKER.test(lines[index])) {
      index += 1;
    }

    if (index >= lines.length) {
      break;
    }

    index += 1;
    const block = [];

    while (index < lines.length) {
      const line = lines[index];
      if (COUNT_MARKER.test(line)) {
        break;
      }

      if (STOP_MARKERS.some((marker) => marker.test(line))) {
        index += 1;
        break;
      }

      block.push(line);
      index += 1;
    }

    if (block.length > 0) {
      blocks.push(block);
    }
  }

  return blocks;
}

function splitListingSegments(listingLines) {
  const segments = [];
  let current = [];

  for (const line of listingLines) {
    current.push(line);
    if (PRICE_LINE.test(line)) {
      segments.push(current);
      current = [];
    }
  }

  return segments;
}

function parseListingSegment(segment, fileMeta, orderInFile) {
  const specIndex = segment.findIndex((line) => /\d+(?:\.\d+)?坪/.test(line));
  if (specIndex < 1) {
    return null;
  }

  let titleIndex = specIndex - 2;
  let tagLine = segment[specIndex - 1] || "";

  if (titleIndex < 0) {
    titleIndex = 0;
    tagLine = "";
  }

  const title = segment[titleIndex] || "";
  const preLabels = segment.slice(0, titleIndex).filter(Boolean);
  const specLine = segment[specIndex] || "";

  let cursor = specIndex + 1;
  const locationText = segment[cursor] || "";
  cursor += 1;

  let distanceText = "";
  if ((segment[cursor] || "").startsWith("距")) {
    distanceText = segment[cursor];
    cursor += 1;
  }

  const ownerText = segment[cursor] || segment[segment.length - 2] || "";
  const priceText = segment[segment.length - 1] || "";

  const spec = parseSpecLine(specLine);
  const ownerInfo = parseOwnerLine(ownerText);
  const distanceInfo = parseDistanceLine(distanceText);
  const tags = extractKnownTags(tagLine, title);
  const propertyKey = createPropertyKey({
    title,
    type: spec.type,
    sizePing: spec.sizePing,
    floorText: spec.floorText,
    locationText,
  });
  const sourceKey = [
    fileMeta.captureDate || "unknown-date",
    fileMeta.captureCity || "unknown-city",
    title,
    priceText,
    locationText,
  ].join(" | ");

  return {
    id: propertyKey,
    propertyKey,
    sourceKey,
    sourceFile: fileMeta.fileName,
    captureDate: fileMeta.captureDate,
    captureCity: fileMeta.captureCity,
    locationGroup: fileMeta.captureCity || inferLocationGroup(locationText, fileMeta.captureCity),
    orderInFile,
    title,
    cardLabels: preLabels,
    tagLine,
    tags,
    type: spec.type,
    sizePing: spec.sizePing,
    floorText: spec.floorText,
    locationText,
    distanceText,
    distanceMeters: distanceInfo.distanceMeters,
    nearbyLabel: distanceInfo.nearbyLabel,
    ownerText,
    contactRole: ownerInfo.contactRole,
    contactName: ownerInfo.contactName,
    updateText: ownerInfo.updateText,
    viewsText: ownerInfo.viewsText,
    priceText,
    priceMonthly: parsePriceLine(priceText),
    isOwnerDirect: ownerInfo.contactRole === "屋主" || tags.includes("屋主直租"),
    isShortRent: tags.includes("可短租"),
    canCook: tags.includes("可開伙"),
  };
}

function parseSourceFileName(fileName) {
  const match = fileName.match(/^(\d{4}-\d{2}-\d{2})_(.+)\.txt$/i);
  return {
    fileName,
    captureDate: match ? match[1] : null,
    captureCity: match ? match[2] : null,
  };
}

function parseSpecLine(line) {
  const compact = line.replace(/\s+/g, "");
  const match = compact.match(/^(.+?)(\d+(?:\.\d+)?)坪(.+)$/);

  if (!match) {
    return {
      type: compact,
      sizePing: null,
      floorText: "",
    };
  }

  return {
    type: match[1].trim(),
    sizePing: Number(match[2]),
    floorText: match[3].trim(),
  };
}

function parseOwnerLine(line) {
  const compact = line.replace(/\s+/g, "");
  const match = compact.match(/^(屋主|代理人|仲介|經紀人)(.+)$/);

  if (!match) {
    return {
      contactRole: "",
      contactName: compact,
      updateText: "",
      viewsText: "",
    };
  }

  const contactRole = match[1];
  let remainder = match[2];
  const viewsText = remainder.match(/昨日\d+人瀏覽/)?.[0] || "";
  if (viewsText) {
    remainder = remainder.replace(viewsText, "");
  }

  const updateMatch = remainder.match(/^(.+?)(\d.+?更新|昨日更新|今日更新|今天更新|剛剛更新)$/);
  const contactName = updateMatch ? updateMatch[1] : remainder;
  const updateText = updateMatch ? updateMatch[2] : "";

  return {
    contactRole,
    contactName,
    updateText,
    viewsText,
  };
}

function parseDistanceLine(line) {
  const compact = line.replace(/\s+/g, "");
  const match = compact.match(/^距(.+?)(\d+(?:,\d+)?)公尺$/);

  if (!match) {
    return {
      nearbyLabel: compact.replace(/^距/, ""),
      distanceMeters: null,
    };
  }

  return {
    nearbyLabel: match[1],
    distanceMeters: Number(match[2].replace(/,/g, "")),
  };
}

function extractKnownTags(tagLine, title) {
  const allText = `${tagLine}${title}`;
  return KNOWN_TAGS.filter((tag) => allText.includes(tag));
}

function inferLocationGroup(locationText, fallbackCity) {
  const head = (locationText.split("-")[0] || "").trim();
  const matches = [...head.matchAll(/[\u4e00-\u9fffA-Za-z0-9]+(?:市|區|鄉|鎮)/g)];
  return matches.at(-1)?.[0] || fallbackCity || head || "未分類";
}

function parsePriceLine(line) {
  const number = line.replace(/[^\d]/g, "");
  return number ? Number(number) : null;
}

function dedupeListings(listings) {
  const latestByPropertyKey = new Map();

  for (const listing of listings) {
    const existing = latestByPropertyKey.get(listing.propertyKey);
    if (!existing || shouldReplaceListing(existing, listing)) {
      latestByPropertyKey.set(listing.propertyKey, listing);
    }
  }

  return [...latestByPropertyKey.values()];
}

function shouldReplaceListing(existing, candidate) {
  const existingDate = existing.captureDate || "";
  const candidateDate = candidate.captureDate || "";

  if (candidateDate !== existingDate) {
    return candidateDate > existingDate;
  }

  if (candidate.sourceFile !== existing.sourceFile) {
    return candidate.sourceFile > existing.sourceFile;
  }

  if ((candidate.tags || []).length !== (existing.tags || []).length) {
    return (candidate.tags || []).length > (existing.tags || []).length;
  }

  return candidate.orderInFile > existing.orderInFile;
}

function buildEnrichmentIndex(listings, enrichment) {
  const index = { ...enrichment };

  for (const listing of listings) {
    if (!index[listing.propertyKey] && index[listing.sourceKey]) {
      index[listing.propertyKey] = index[listing.sourceKey];
    }
  }

  return index;
}

function createPropertyKey({ title, type, sizePing, floorText, locationText }) {
  const stableText = [title, type, sizePing ?? "", floorText, locationText]
    .map((value) => String(value || "").trim())
    .join(" | ");

  return createStableId(stableText);
}

function createStableId(sourceKey) {
  return createHash("sha1").update(sourceKey).digest("hex").slice(0, 12);
}

async function safeReadDir(targetDir) {
  try {
    return await fs.readdir(targetDir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
