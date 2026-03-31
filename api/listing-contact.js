import { fetchListingContact } from "../scripts/lib/listing-contact.mjs";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  const sourceUrl = String(request.body?.sourceUrl || "").trim();
  if (!sourceUrl) {
    response.status(400).json({ error: "sourceUrl is required." });
    return;
  }

  try {
    const result = await fetchListingContact(sourceUrl);
    response.status(200).json(result);
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Unexpected server error.",
    });
  }
}
