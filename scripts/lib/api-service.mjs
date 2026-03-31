import { buildAppData } from "./pipeline.mjs";
import { fetchListingDetail, isAllowed591ListingUrl } from "./listing-detail.mjs";
import { importListingsFromSearch } from "./live-import.mjs";

const rootDir = process.cwd();

export async function getViewerData() {
  const builtData = await buildAppData(rootDir);
  return {
    ok: true,
    status: 200,
    payload: {
      appData: builtData,
      source: "local-build",
      storage: {
        mode: "static-build",
        target: "embedded/public build output",
      },
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

  return {
    ok: true,
    status: 200,
    payload: {
      importedAppData: imported,
      importedCount: imported.listingCount,
      storage: {
        mode: "browser-local",
        target: "window.localStorage",
      },
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

  return {
    ok: true,
    status: 200,
    payload: {
      ...detail,
      detailFetchedAt,
      appListingId,
      storage: {
        mode: "browser-local",
        target: "window.localStorage",
      },
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
