import { fetchViewerListingDetail } from "../scripts/lib/api-service.mjs";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const result = await fetchViewerListingDetail(request.body || {});
    response.status(result.status).json(result.payload);
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected server error.",
    });
  }
}
