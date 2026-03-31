import { getViewerData } from "../scripts/lib/api-service.mjs";

export default async function handler(_request, response) {
  try {
    const result = await getViewerData();
    response.status(result.status).json(result.payload);
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected server error.",
    });
  }
}
