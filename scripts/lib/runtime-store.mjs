import fs from "node:fs/promises";
import path from "node:path";
import { list, put } from "@vercel/blob";

const rootDir = process.cwd();
const localRuntimeFile = path.join(rootDir, "data", "runtime-app-data.json");
const blobPathname = "viewer/app-data.json";

export async function readRuntimeAppData() {
  if (hasBlobStorage()) {
    const blob = await findBlobByPathname(blobPathname);
    if (!blob) {
      return null;
    }

    const response = await fetch(blob.url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to read runtime data from Blob: ${response.status}`);
    }

    return response.json();
  }

  if (isHostedEnvironment()) {
    return null;
  }

  try {
    const raw = await fs.readFile(localRuntimeFile, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writeRuntimeAppData(appData) {
  if (hasBlobStorage()) {
    await put(blobPathname, JSON.stringify(appData, null, 2), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
      contentType: "application/json; charset=utf-8",
    });

    return {
      mode: "vercel-blob",
      target: blobPathname,
    };
  }

  if (isHostedEnvironment()) {
    throw new Error(
      "Runtime imports on Vercel require Blob storage. Add a Blob store to the project so BLOB_READ_WRITE_TOKEN is available.",
    );
  }

  await fs.mkdir(path.dirname(localRuntimeFile), { recursive: true });
  await fs.writeFile(localRuntimeFile, `${JSON.stringify(appData, null, 2)}\n`, "utf8");
  return {
    mode: "local-file",
    target: localRuntimeFile,
  };
}

export function getRuntimeStorageSummary() {
  return hasBlobStorage()
    ? {
        mode: "vercel-blob",
        target: blobPathname,
      }
    : isHostedEnvironment()
      ? {
          mode: "vercel-unconfigured",
          target: "BLOB_READ_WRITE_TOKEN missing",
        }
    : {
        mode: "local-file",
        target: localRuntimeFile,
      };
}

function hasBlobStorage() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function isHostedEnvironment() {
  return Boolean(process.env.VERCEL);
}

async function findBlobByPathname(pathname) {
  const result = await list({
    prefix: pathname,
    limit: 10,
  });

  return result.blobs.find((blob) => blob.pathname === pathname) || null;
}
