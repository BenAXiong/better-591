#!/usr/bin/env node
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  buildAppData,
  findListingByMatch,
  getPaths,
  readPhotoTargets,
} from "./lib/pipeline.mjs";

const rootDir = process.cwd();
const execFileAsync = promisify(execFile);
const args = process.argv.slice(2);
const importAllPages = args.includes("--all-pages");
const searchUrls = args.filter((arg) => arg && arg !== "--all-pages");
const MAX_PAGES = 50;
const FETCH_RETRIES = 3;

if (searchUrls.length === 0) {
  console.error(
    "Usage: node scripts/import-photo-targets.mjs [--all-pages] <591 search url> [more urls]",
  );
  process.exit(1);
}

const { photoTargetsFile } = getPaths(rootDir);
const appData = await buildAppData(rootDir);
const existingTargets = await readPhotoTargets(rootDir);
const existingUrls = new Set(existingTargets.map((target) => target.url));
const existingListingIds = new Set(
  existingTargets
    .map((target) => findListingByMatch(appData.listings, target.match)?.id)
    .filter(Boolean),
);

const linesToAppend = [];
let addedCount = 0;

for (const searchUrl of searchUrls) {
  const pageRuns = importAllPages
    ? await collectAllPages(searchUrl)
    : [await collectSinglePage(searchUrl)];

  for (const pageRun of pageRuns) {
    if (!pageRun) {
      continue;
    }

    console.log(`Found ${pageRun.items.length} item link(s) in ${pageRun.url}`);

    for (const item of pageRun.items) {
      const matches = findListingCandidates(appData.listings, item.title);

      if (matches.length === 0) {
        console.warn(`No local listing matched: ${item.title}`);
        continue;
      }

      if (matches.length > 1) {
        console.warn(
          `Ambiguous local listing match: ${item.title} (${matches.length} candidates)`,
        );
        continue;
      }

      const listing = matches[0];

      if (existingUrls.has(item.url) || existingListingIds.has(listing.id) || listing.sourceUrl) {
        console.log(`Already linked: ${listing.title}`);
        continue;
      }

      linesToAppend.push(`${listing.id} | ${item.url}`);
      existingUrls.add(item.url);
      existingListingIds.add(listing.id);
      addedCount += 1;
      console.log(`Added target: ${listing.title}`);
    }
  }
}

if (linesToAppend.length > 0) {
  await ensureTargetFileHeader(photoTargetsFile);
  await fs.appendFile(photoTargetsFile, `${linesToAppend.join("\n")}\n`, "utf8");
}

console.log(`Added ${addedCount} photo target(s).`);

async function downloadSearchPage(url) {
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
          maxBuffer: 12 * 1024 * 1024,
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

  throw lastError;
}

async function collectSinglePage(url) {
  try {
    const html = await downloadSearchPage(url);
    return {
      url,
      items: extractListingLinksFromSearchHtml(html),
    };
  } catch (error) {
    console.warn(`Failed to fetch search page: ${url} (${error.message})`);
    return null;
  }
}

async function collectAllPages(searchUrl) {
  const runs = [];
  const baseUrl = new URL(searchUrl);
  baseUrl.searchParams.delete("page");

  const seenSignatures = new Set();
  const seenUrls = new Set();

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const pageUrl = new URL(baseUrl);
    pageUrl.searchParams.set("page", String(page));
    const run = await collectSinglePage(pageUrl.href);

    if (!run) {
      break;
    }

    const signature = run.items.map((item) => item.url).join("|");
    const newItemCount = run.items.filter((item) => !seenUrls.has(item.url)).length;

    if (run.items.length === 0 || seenSignatures.has(signature) || newItemCount === 0) {
      break;
    }

    runs.push(run);
    seenSignatures.add(signature);
    for (const item of run.items) {
      seenUrls.add(item.url);
    }
  }

  return runs;
}

function extractListingLinksFromSearchHtml(html) {
  const seenUrls = new Set();
  const items = [];
  const pattern =
    /<a[^>]+href="((?:https:\/\/rent\.591\.com\.tw)?\/\d{7,})"[^>]+title="([^"]+)"[^>]*>/g;

  for (const match of html.matchAll(pattern)) {
    const href = match[1];
    const title = decodeHtmlEntities(match[2]).trim();
    const url = new URL(href, "https://rent.591.com.tw").href;

    if (!title || seenUrls.has(url)) {
      continue;
    }

    seenUrls.add(url);
    items.push({ title, url });
  }

  return items;
}

function findListingCandidates(listings, title) {
  const needle = normalizeTitle(title);

  return listings.filter((listing) => {
    const candidate = normalizeTitle(listing.title);
    return candidate === needle || candidate.includes(needle) || needle.includes(candidate);
  });
}

function normalizeTitle(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/優選好屋/g, "")
    .replace(/591租屋/g, "")
    .replace(/[「」『』【】]/g, "")
    .toLowerCase();
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function ensureTargetFileHeader(filePath) {
  try {
    const current = await fs.readFile(filePath, "utf8");
    if (current.length === 0) {
      await fs.writeFile(filePath, "# title substring or listing id | 591 item URL\n", "utf8");
      return;
    }

    if (!current.endsWith("\n")) {
      await fs.writeFile(filePath, `${current}\n`, "utf8");
    }
  } catch (error) {
    if (error && error.code === "ENOENT") {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, "# title substring or listing id | 591 item URL\n", "utf8");
      return;
    }

    throw error;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
