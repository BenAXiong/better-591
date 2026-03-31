import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { load } from "cheerio";
import { extractListingDetailFromHtml } from "./listing-detail.mjs";
import { extractPhotoUrlsFromHtml } from "./pipeline.mjs";

const execFileAsync = promisify(execFile);
const FETCH_RETRIES = 3;
const MAX_PAGES = 50;

export async function importListingsFromSearch({
  searchUrl,
  importAllPages = false,
  includePhotos = false,
}) {
  const pages = importAllPages
    ? await collectAllPages(searchUrl)
    : [await collectSinglePage(searchUrl)].filter(Boolean);

  if (pages.length === 0) {
    throw new Error("No 591 result pages could be fetched.");
  }

  const rawListings = pages.flatMap((page) => parseListingsFromSearchHtml(page));
  const deduped = dedupeListings(rawListings);

  let listings = deduped;
  if (includePhotos) {
    listings = await attachPhotoUrls(deduped);
  }

  return {
    generatedAt: new Date().toISOString(),
    listingCount: listings.length,
    rawFileCount: 0,
    importMeta: {
      source: "live-591",
      searchUrl,
      importedAt: new Date().toISOString(),
      pageCount: pages.length,
      includePhotos,
    },
    listings,
  };
}

export function mergeAppData(existingAppData, importedAppData) {
  const currentListings = Array.isArray(existingAppData?.listings) ? existingAppData.listings : [];
  const incomingListings = Array.isArray(importedAppData?.listings) ? importedAppData.listings : [];

  const latestByPropertyKey = new Map();

  for (const listing of currentListings) {
    latestByPropertyKey.set(getDuplicateSignature(listing) || listing.propertyKey || listing.id, listing);
  }

  for (const listing of incomingListings) {
    const key = getDuplicateSignature(listing) || listing.propertyKey || listing.id;
    const existing = latestByPropertyKey.get(key);
    if (!existing) {
      latestByPropertyKey.set(key, listing);
      continue;
    }

    if (shouldReplaceListing(existing, listing)) {
      latestByPropertyKey.set(key, mergeListingMetadata(listing, existing));
      continue;
    }

    latestByPropertyKey.set(key, mergeListingMetadata(existing, listing));
  }

  const mergedListings = [...latestByPropertyKey.values()];

  return {
    generatedAt: importedAppData?.generatedAt || new Date().toISOString(),
    listingCount: mergedListings.length,
    rawFileCount: existingAppData?.rawFileCount || 0,
    importMeta: importedAppData?.importMeta || existingAppData?.importMeta || null,
    listings: mergedListings,
  };
}

async function collectSinglePage(searchUrl) {
  try {
    const html = await downloadText(searchUrl);
    return {
      url: searchUrl,
      html,
    };
  } catch (error) {
    console.warn(`Failed to fetch search page: ${searchUrl} (${error.message})`);
    return null;
  }
}

async function collectAllPages(searchUrl) {
  const runs = [];
  const baseUrl = new URL(searchUrl);
  baseUrl.searchParams.delete("page");

  const seenItemIds = new Set();

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const pageUrl = new URL(baseUrl);
    pageUrl.searchParams.set("page", String(page));
    const run = await collectSinglePage(pageUrl.href);

    if (!run) {
      break;
    }

    const itemIds = extractListingIdsFromHtml(run.html);
    const newItemCount = itemIds.filter((id) => !seenItemIds.has(id)).length;

    if (itemIds.length === 0 || newItemCount === 0) {
      break;
    }

    runs.push(run);

    for (const itemId of itemIds) {
      seenItemIds.add(itemId);
    }
  }

  return runs;
}

function parseListingsFromSearchHtml({ html, url }) {
  const $ = load(html);
  const queryMeta = getQueryMeta(url);
  const captureDate = getTaipeiDate();
  const listings = [];

  $(".item[data-id]").each((_, element) => {
    const node = $(element);
    const titleLink = node.find(".item-info-title a").first();
    const title = cleanInlineText(titleLink.attr("title") || titleLink.text());
    const sourceUrl = absoluteUrl(titleLink.attr("href"));

    if (!title || !sourceUrl) {
      return;
    }

    const listingId = String(node.attr("data-id") || extractListingIdFromUrl(sourceUrl) || "");
    const cardLabels = node
      .find(".item-info-title .tag")
      .map((__, tag) => cleanInlineText($(tag).text()))
      .get()
      .filter(Boolean);
    const tags = node
      .find(".item-info-tag .tag")
      .map((__, tag) => cleanInlineText($(tag).text()))
      .get()
      .filter(Boolean);

    const infoBlocks = node.find(".item-info-left .item-info-txt");
    const specParts = infoBlocks
      .eq(0)
      .find("span")
      .map((__, part) => cleanInlineText($(part).text()))
      .get()
      .filter(Boolean);

    const locationText = cleanInlineText(infoBlocks.eq(1).text());
    const distanceParts = infoBlocks
      .eq(2)
      .find("span,strong")
      .map((__, part) => cleanInlineText($(part).text()))
      .get()
      .filter(Boolean);

    const ownerParts = node
      .find(".item-info-txt.role-name span")
      .map((__, part) => cleanInlineText($(part).text()))
      .get()
      .filter(Boolean);

    const previewImages = node
      .find(".item-img img")
      .map((__, image) => absoluteUrl($(image).attr("data-src") || $(image).attr("src")))
      .get()
      .filter((value) => value && !value.startsWith("data:image"))
      .filter(uniqueOnly)
      .map((src, index) => buildImageRecord(listingId || title, src, index));

    const priceNumber = cleanInlineText(node.find(".item-info-price strong").first().text());
    const priceText = priceNumber ? `${priceNumber}元/月` : "";
    const spec = parseSpecFromParts(specParts);
    const ownerInfo = parseOwnerParts(ownerParts);
    const distanceInfo = parseDistanceParts(distanceParts);
    const locationGroup = inferLocationGroup(locationText, queryMeta.captureCity);
    const propertyKey = createPropertyKey({
      title,
      type: spec.type,
      sizePing: spec.sizePing,
      floorText: spec.floorText,
      locationText,
    });

    listings.push({
      id: propertyKey,
      propertyKey,
      sourceKey: `${captureDate} | ${queryMeta.captureCity || "live"} | ${title} | ${priceText} | ${locationText}`,
      sourceFile: "live-import",
      captureDate,
      captureCity: queryMeta.captureCity || locationGroup,
      locationGroup,
      orderInFile: listings.length,
      title,
      cardLabels,
      tagLine: tags.join(""),
      tags,
      type: spec.type,
      sizePing: spec.sizePing,
      floorText: spec.floorText,
      locationText,
      distanceText: distanceInfo.distanceText,
      distanceMeters: distanceInfo.distanceMeters,
      nearbyLabel: distanceInfo.nearbyLabel,
      ownerText: ownerParts.join(" "),
      contactRole: ownerInfo.contactRole,
      contactName: ownerInfo.contactName,
      updateText: ownerInfo.updateText,
      viewsText: ownerInfo.viewsText,
      priceText,
      priceMonthly: parsePriceLine(priceText),
      isOwnerDirect: ownerInfo.contactRole === "屋主" || tags.includes("屋主直租"),
      isShortRent: tags.includes("可短租"),
      canCook: tags.includes("可開伙"),
      sourceUrl,
      listingId: listingId || null,
      images: previewImages,
      hasPhotos: previewImages.length > 0,
      photoCount: previewImages.length,
      lastPhotoFetchAt: null,
    });
  });

  return listings;
}

async function attachPhotoUrls(listings) {
  const hydrated = [];

  for (const listing of listings) {
    if (!listing.sourceUrl) {
      hydrated.push(listing);
      continue;
    }

    try {
      const html = await downloadText(listing.sourceUrl);
      const photoUrls = extractPhotoUrlsFromHtml(html);
      const detail = extractListingDetailFromHtml(html);
      const detailedListing = mergeListingDetail(listing, detail);

      if (photoUrls.length === 0) {
        hydrated.push(detailedListing);
        continue;
      }

      hydrated.push({
        ...detailedListing,
        images: photoUrls.map((src, index) => buildImageRecord(listing.listingId || listing.id, src, index)),
        hasPhotos: true,
        photoCount: photoUrls.length,
        lastPhotoFetchAt: new Date().toISOString(),
      });
    } catch (error) {
      console.warn(`Failed to fetch photos for ${listing.title}: ${error.message}`);
      hydrated.push(listing);
    }
  }

  return hydrated;
}

async function downloadText(url) {
  let lastError = null;

  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "accept-language": "zh-TW,zh;q=0.9,en;q=0.8",
          "user-agent": "Mozilla/5.0",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.text();
    } catch (error) {
      lastError = error;

      const curlText = await tryCurlDownload(url);
      if (curlText) {
        return curlText;
      }

      if (attempt < FETCH_RETRIES) {
        await sleep(600 * attempt);
      }
    }
  }

  throw new Error(lastError?.message || "fetch failed");
}

async function tryCurlDownload(url) {
  if (process.platform !== "win32") {
    return null;
  }

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
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
      },
    );

    return stdout;
  } catch {
    return null;
  }
}

function extractListingIdsFromHtml(html) {
  const ids = html.match(/data-id="(\d+)"/g) || [];
  return ids
    .map((entry) => entry.match(/"(\d+)"/)?.[1])
    .filter(Boolean);
}

function getQueryMeta(url) {
  const parsed = new URL(url);
  const sectionId = parsed.searchParams.get("section");
  const regionId = parsed.searchParams.get("region");
  return {
    sectionId,
    regionId,
    captureCity: null,
  };
}

function parseSpecFromParts(parts) {
  const [type = "", sizeText = "", floorText = ""] = parts;
  const sizeMatch = sizeText.match(/(\d+(?:\.\d+)?)/);
  return {
    type,
    sizePing: sizeMatch ? Number(sizeMatch[1]) : null,
    floorText,
  };
}

function parseOwnerParts(parts) {
  const [head = "", updateText = "", viewsText = ""] = parts;
  const match = head.match(/^(屋主|代理人|仲介|經紀人)(.+)$/);
  return {
    contactRole: match ? match[1] : "",
    contactName: match ? match[2] : head,
    updateText,
    viewsText,
  };
}

function parseDistanceParts(parts) {
  const [nearbyLabel = "", distanceValue = ""] = parts;
  return {
    nearbyLabel: nearbyLabel.replace(/^距/, ""),
    distanceMeters: distanceValue ? Number(distanceValue.replace(/[^\d]/g, "")) : null,
    distanceText: [nearbyLabel, distanceValue].filter(Boolean).join(" "),
  };
}

function parsePriceLine(line) {
  const number = String(line || "").replace(/[^\d]/g, "");
  return number ? Number(number) : null;
}

function inferLocationGroup(locationText, fallbackCity) {
  const head = (locationText.split("-")[0] || "").trim();
  const matches = [...head.matchAll(/[\u4e00-\u9fffA-Za-z0-9]+(?:市|區|鄉|鎮)/g)];
  return matches.at(-1)?.[0] || fallbackCity || head || "未分類";
}

function dedupeListings(listings) {
  const latestByPropertyKey = new Map();

  for (const listing of listings) {
    const key = getDuplicateSignature(listing) || listing.propertyKey;
    const existing = latestByPropertyKey.get(key);
    if (!existing || shouldReplaceListing(existing, listing)) {
      latestByPropertyKey.set(key, listing);
    }
  }

  return [...latestByPropertyKey.values()];
}

function shouldReplaceListing(existing, candidate) {
  if ((candidate.images?.length || 0) !== (existing.images?.length || 0)) {
    return (candidate.images?.length || 0) > (existing.images?.length || 0);
  }

  if ((candidate.tags?.length || 0) !== (existing.tags?.length || 0)) {
    return (candidate.tags?.length || 0) > (existing.tags?.length || 0);
  }

  return (candidate.orderInFile || 0) > (existing.orderInFile || 0);
}

function createPropertyKey({ title, type, sizePing, floorText, locationText }) {
  const stableText = [title, type, sizePing ?? "", floorText, locationText]
    .map((value) => String(value || "").trim())
    .join(" | ");

  return createHash("sha1").update(stableText).digest("hex").slice(0, 12);
}

function getDuplicateSignature(listing) {
  const address = normalizeDuplicatePart(listing.exactAddress || listing.locationText);
  const price = normalizeDuplicatePart(listing.priceMonthly);
  const type = normalizeDuplicatePart(listing.type);
  const size = normalizeDuplicatePart(listing.sizePing);
  const floor = normalizeDuplicatePart(listing.floorText);
  const contact = normalizeDuplicatePart(listing.contactPhone || [listing.contactRole, listing.contactName].filter(Boolean).join(" "));

  if (!address || !price || !type || !size || !floor || !contact) {
    return "";
  }

  return [address, type, size, floor, price, contact].join(" | ");
}

function normalizeDuplicatePart(value) {
  return String(value || "").trim().replace(/\s+/g, "").replaceAll("臺", "台");
}

function extractListingIdFromUrl(url) {
  const match = String(url || "").match(/\/(\d+)(?:[/?#]|$)/);
  return match ? match[1] : null;
}

function absoluteUrl(url) {
  if (!url) {
    return "";
  }

  try {
    return new URL(url, "https://rent.591.com.tw").href;
  } catch {
    return "";
  }
}

function cleanInlineText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function buildImageRecord(seed, src, index) {
  return {
    id: `${seed}-img-${index + 1}`,
    src,
    localPath: null,
    remoteUrl: src,
  };
}

function mergeListingDetail(listing, detail) {
  return {
    ...listing,
    exactAddress: detail.exactAddress || listing.exactAddress || "",
    latitude: detail.latitude ?? listing.latitude ?? null,
    longitude: detail.longitude ?? listing.longitude ?? null,
    facilities: Array.isArray(detail.facilities) ? detail.facilities : Array.isArray(listing.facilities) ? listing.facilities : [],
    serviceNotes: Array.isArray(detail.serviceNotes)
      ? detail.serviceNotes
      : Array.isArray(listing.serviceNotes)
        ? listing.serviceNotes
        : [],
    genderPolicy: detail.genderPolicy ?? listing.genderPolicy ?? mapLegacyGenderPolicy(listing.allGendersAllowed),
    ownerRemark: detail.ownerRemark || listing.ownerRemark || "",
    contactPhone: detail.contactPhone || listing.contactPhone || "",
    detailFetchedAt: new Date().toISOString(),
  };
}

function mergeListingMetadata(primary, fallback) {
  const primaryImages = Array.isArray(primary.images) ? primary.images : [];
  const fallbackImages = Array.isArray(fallback?.images) ? fallback.images : [];
  const images = primaryImages.length > 0 ? primaryImages : fallbackImages;

  return {
    ...fallback,
    ...primary,
    sourceUrl: primary.sourceUrl || fallback?.sourceUrl || null,
    listingId: primary.listingId || fallback?.listingId || null,
    exactAddress: primary.exactAddress || fallback?.exactAddress || "",
    latitude: primary.latitude ?? fallback?.latitude ?? null,
    longitude: primary.longitude ?? fallback?.longitude ?? null,
    facilities: Array.isArray(primary.facilities) && primary.facilities.length > 0
      ? primary.facilities
      : Array.isArray(fallback?.facilities)
        ? fallback.facilities
        : [],
    serviceNotes: Array.isArray(primary.serviceNotes) && primary.serviceNotes.length > 0
      ? primary.serviceNotes
      : Array.isArray(fallback?.serviceNotes)
        ? fallback.serviceNotes
        : [],
    genderPolicy: primary.genderPolicy ?? fallback?.genderPolicy ?? mapLegacyGenderPolicy(primary.allGendersAllowed) ?? mapLegacyGenderPolicy(fallback?.allGendersAllowed),
    ownerRemark: primary.ownerRemark || fallback?.ownerRemark || "",
    contactPhone: primary.contactPhone || fallback?.contactPhone || "",
    detailFetchedAt: primary.detailFetchedAt || fallback?.detailFetchedAt || null,
    images,
    hasPhotos: images.length > 0,
    photoCount: images.length,
    lastPhotoFetchAt: primary.lastPhotoFetchAt || fallback?.lastPhotoFetchAt || null,
  };
}

function mapLegacyGenderPolicy(allGendersAllowed) {
  return allGendersAllowed === true ? "any" : null;
}

function getTaipeiDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function uniqueOnly(value, index, array) {
  return array.indexOf(value) === index;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
