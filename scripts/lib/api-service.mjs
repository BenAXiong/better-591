import { buildAppData } from "./pipeline.mjs";
import { fetchListingDetail, isAllowed591ListingUrl } from "./listing-detail.mjs";
import { importListingsFromSearch, mergeAppData } from "./live-import.mjs";
import {
  getRuntimeStorageSummary,
  readRuntimeAppData,
  writeRuntimeAppData,
} from "./runtime-store.mjs";

const rootDir = process.cwd();

export async function getViewerData() {
  const runtimeData = await readRuntimeAppData();
  if (runtimeData) {
    return {
      ok: true,
      status: 200,
      payload: {
        appData: runtimeData,
        source: "runtime",
        storage: getRuntimeStorageSummary(),
      },
    };
  }

  const builtData = await buildAppData(rootDir);
  return {
    ok: true,
    status: 200,
    payload: {
      appData: builtData,
      source: "local-build",
      storage: getRuntimeStorageSummary(),
    },
  };
}

export async function importViewerData(body) {
  const searchUrl = String(body?.searchUrl || "").trim();
  const importAllPages = Boolean(body?.importAllPages);
  const includePhotos = body?.includePhotos !== false;

  if (!searchUrl) {
    return failure(400, "searchUrl is required.");
  }

  if (!isAllowed591Url(searchUrl)) {
    return failure(400, "Only https://rent.591.com.tw/list URLs are allowed.");
  }

  const imported = await importListingsFromSearch({
    searchUrl,
    importAllPages,
    includePhotos,
  });

  const existing = (await readRuntimeAppData()) || (await buildAppData(rootDir));
  const merged = mergeAppData(existing, imported);
  const stored = await writeRuntimeAppData(merged);

  return {
    ok: true,
    status: 200,
    payload: {
      appData: merged,
      importedCount: imported.listingCount,
      storage: stored,
    },
  };
}

export async function fetchViewerListingDetail(body) {
  const sourceUrl = String(body?.sourceUrl || "").trim();
  const appListingId = String(body?.appListingId || "").trim();

  if (!sourceUrl) {
    return failure(400, "sourceUrl is required.");
  }

  if (!isAllowed591ListingUrl(sourceUrl)) {
    return failure(400, "Only https://rent.591.com.tw/<id> listing URLs are allowed.");
  }

  const detail = await fetchListingDetail(sourceUrl);
  const detailFetchedAt = new Date().toISOString();
  const baseData = (await readRuntimeAppData()) || (await buildAppData(rootDir));
  const merged = mergeListingDetailIntoAppData(baseData, appListingId, sourceUrl, {
    ...detail,
    detailFetchedAt,
  });
  const storage = merged.changed ? await writeRuntimeAppData(merged.appData) : getRuntimeStorageSummary();

  return {
    ok: true,
    status: 200,
    payload: {
      ...detail,
      detailFetchedAt,
      appData: merged.changed ? merged.appData : null,
      storage,
    },
  };
}

function failure(status, error) {
  return {
    ok: false,
    status,
    payload: {
      error,
    },
  };
}

function isAllowed591Url(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === "https://rent.591.com.tw" && parsed.pathname === "/list";
  } catch {
    return false;
  }
}

function mergeListingDetailIntoAppData(appData, appListingId, sourceUrl, detail) {
  let changed = false;
  const listings = Array.isArray(appData?.listings) ? appData.listings : [];
  const nextListings = listings.map((listing) => {
    const matchesId = appListingId && String(listing.id) === appListingId;
    const matchesUrl = sourceUrl && String(listing.sourceUrl || "").trim() === sourceUrl;

    if (!matchesId && !matchesUrl) {
      return listing;
    }

    const nextListing = {
      ...listing,
      exactAddress: detail.exactAddress || listing.exactAddress || "",
      latitude: detail.latitude ?? listing.latitude ?? null,
      longitude: detail.longitude ?? listing.longitude ?? null,
      facilities: Array.isArray(detail.facilities) ? detail.facilities : listing.facilities || [],
      serviceNotes: Array.isArray(detail.serviceNotes) ? detail.serviceNotes : listing.serviceNotes || [],
      ownerRemark: detail.ownerRemark || listing.ownerRemark || "",
      contactPhone: detail.contactPhone || listing.contactPhone || "",
      detailFetchedAt: detail.detailFetchedAt || listing.detailFetchedAt || null,
    };

    if (JSON.stringify(nextListing) !== JSON.stringify(listing)) {
      changed = true;
    }

    return nextListing;
  });

  return {
    changed,
    appData: changed
      ? {
          ...appData,
          generatedAt: new Date().toISOString(),
          listings: nextListings,
        }
      : appData,
  };
}
