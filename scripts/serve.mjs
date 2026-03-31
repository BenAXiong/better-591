#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fetchViewerListingDetail, getViewerData, importViewerData } from "./lib/api-service.mjs";
import { fetchListingContact } from "./lib/listing-contact.mjs";

const rootDir = process.cwd();
const webDir = rootDir;
const port = Number(process.env.PORT || 4173);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || "/", `http://localhost:${port}`);

    if (requestUrl.pathname === "/api/data") {
      const result = await getViewerData();
      response.writeHead(result.status, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(result.payload));
      return;
    }

    if (requestUrl.pathname === "/api/import-591") {
      if ((request.method || "GET").toUpperCase() !== "POST") {
        response.writeHead(405, {
          "content-type": "application/json; charset=utf-8",
          allow: "POST",
        });
        response.end(JSON.stringify({ error: "Method not allowed." }));
        return;
      }

      const body = await readJsonBody(request);
      const result = await importViewerData(body);
      response.writeHead(result.status, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(result.payload));
      return;
    }

    if (requestUrl.pathname === "/api/listing-contact") {
      if ((request.method || "GET").toUpperCase() !== "POST") {
        response.writeHead(405, {
          "content-type": "application/json; charset=utf-8",
          allow: "POST",
        });
        response.end(JSON.stringify({ error: "Method not allowed." }));
        return;
      }

      const body = await readJsonBody(request);
      const sourceUrl = String(body?.sourceUrl || "").trim();
      if (!sourceUrl) {
        response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "sourceUrl is required." }));
        return;
      }

      try {
        const result = await fetchListingContact(sourceUrl);
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify(result));
      } catch (error) {
        response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Unexpected server error." }));
      }
      return;
    }

    if (requestUrl.pathname === "/api/listing-detail") {
      if ((request.method || "GET").toUpperCase() !== "POST") {
        response.writeHead(405, {
          "content-type": "application/json; charset=utf-8",
          allow: "POST",
        });
        response.end(JSON.stringify({ error: "Method not allowed." }));
        return;
      }

      const body = await readJsonBody(request);
      const result = await fetchViewerListingDetail(body);
      response.writeHead(result.status, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(result.payload));
      return;
    }

    const requestedPath = decodeURIComponent((request.url || "/").split("?")[0]);
    const safePath = requestedPath === "/" ? "/index.html" : requestedPath;
    const absolutePath = path.join(webDir, safePath);

    if (!absolutePath.startsWith(webDir)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    const contents = await fs.readFile(absolutePath);
    const contentType = mimeTypes[path.extname(absolutePath).toLowerCase()] || "application/octet-stream";
    response.writeHead(200, { "content-type": contentType });
    response.end(contents);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});

server.listen(port, () => {
  console.log(`Viewer available at http://localhost:${port}`);
});

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}
