import { buildAppData } from "./pipeline.mjs";
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
