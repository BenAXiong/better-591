import { extractContactPhoneFromHtml, fetchListingDetail } from "./listing-detail.mjs";

export async function fetchListingContact(sourceUrl) {
  const detail = await fetchListingDetail(sourceUrl);
  return {
    contactPhone: detail.contactPhone || "",
  };
}

export { extractContactPhoneFromHtml };
