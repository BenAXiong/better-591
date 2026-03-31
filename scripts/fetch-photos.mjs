#!/usr/bin/env node
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  buildAppData,
  buildPhotoRecord,
  extractListingIdFromUrl,
  extractPhotoUrlsFromHtml,
  findListingByMatch,
  getDownloadExtension,
  getPaths,
  loadEnrichment,
  localFilesExist,
  readPhotoTargets,
  saveEnrichment,
  writeBuildOutputs,
} from "./lib/pipeline.mjs";

const execFileAsync = promisify(execFile);
const rootDir = process.cwd();
const force = process.argv.includes("--force");
const paths = getPaths(rootDir);
const appData = await buildAppData(rootDir);
const enrichment = await loadEnrichment(rootDir);
const targets = await readPhotoTargets(rootDir);

if (targets.length === 0) {
  await writeBuildOutputs(rootDir, appData);
  console.log("No photo targets found. Skipped photo enrichment.");
  process.exit(0);
}

let updatedCount = 0;

for (const target of targets) {
  const listing = findListingByMatch(appData.listings, target.match);
  if (!listing) {
    console.warn(`No listing matched target: ${target.match}`);
    continue;
  }

  const existing = enrichment[listing.propertyKey] ?? enrichment[listing.sourceKey];
  if (
    !force &&
    existing?.sourceUrl === target.url &&
    Array.isArray(existing.images) &&
    (await localFilesExist(rootDir, existing.images))
  ) {
    console.log(`Photos already cached for: ${listing.title}`);
    continue;
  }

  let html = "";
  try {
    html = await downloadText(target.url);
  } catch (error) {
    console.warn(`Failed to fetch listing page: ${target.url} (${error.message})`);
    continue;
  }
  const photoUrls = extractPhotoUrlsFromHtml(html);

  if (photoUrls.length === 0) {
    console.warn(`No photo URLs found in listing page: ${target.url}`);
    continue;
  }

  const listingId = extractListingIdFromUrl(target.url) || listing.id;
  const targetDir = path.join(paths.photoDir, listingId);
  await fs.mkdir(targetDir, { recursive: true });

  const images = [];
  for (let index = 0; index < photoUrls.length; index += 1) {
    const remoteUrl = photoUrls[index];
    const fileName = `${String(index + 1).padStart(2, "0")}${getDownloadExtension(remoteUrl)}`;
    const absoluteFilePath = path.join(targetDir, fileName);
    try {
      await downloadFile(remoteUrl, absoluteFilePath, target.url);
      images.push(buildPhotoRecord(remoteUrl, absoluteFilePath, rootDir));
    } catch (error) {
      console.warn(`Failed to download photo: ${remoteUrl} (${error.message})`);
    }
  }

  enrichment[listing.propertyKey] = {
    sourceUrl: target.url,
    listingId,
    images,
    lastFetchedAt: new Date().toISOString(),
  };

  updatedCount += 1;
  console.log(`Cached ${images.length} photos for: ${listing.title}`);
}

await saveEnrichment(rootDir, enrichment);
const rebuilt = await buildAppData(rootDir);
await writeBuildOutputs(rootDir, rebuilt);

console.log(`Photo enrichment updated ${updatedCount} listing(s).`);

async function downloadText(url) {
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
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    },
  );

  return stdout;
}

async function downloadFile(url, targetFile, referer) {
  await fs.mkdir(path.dirname(targetFile), { recursive: true });
  await execFileAsync(
    "curl.exe",
    [
      "-L",
      "-A",
      "Mozilla/5.0",
      "-e",
      referer,
      url,
      "-o",
      targetFile,
    ],
    {
      cwd: rootDir,
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    },
  );
}
