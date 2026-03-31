import { load } from "cheerio";

const FETCH_RETRIES = 3;

export async function fetchListingDetail(sourceUrl) {
  if (!isAllowed591ListingUrl(sourceUrl)) {
    throw new Error("Only https://rent.591.com.tw/<id> listing URLs are allowed.");
  }

  const html = await downloadText(sourceUrl);
  return extractListingDetailFromHtml(html);
}

export function extractListingDetailFromHtml(html) {
  const text = String(html || "");
  const $ = load(text);
  const shortAddress = cleanInlineText($(".block.surround .address .inline-flex-row").first().text());
  const exactAddress = extractFullAddressFromHtml(text, shortAddress) || shortAddress;
  const coordinates = extractCoordinatesFromHtml(text, shortAddress);
  const facilities = $(".block.service .service-facility dd.text")
    .map((_, element) => cleanInlineText($(element).text()))
    .get()
    .filter(Boolean);
  const serviceNotes = $(".block.service .service-cate")
    .map((_, element) => {
      const label = cleanInlineText($(element).find("p").first().text());
      const value = cleanInlineText($(element).find("span").first().text());
      if (!label) {
        return null;
      }

      return {
        label,
        value,
      };
    })
    .get()
    .filter(Boolean);
  const ownerRemark = cleanInlineText($(".block.house-condition .house-condition-content .article").first().text());

  return {
    exactAddress: exactAddress || "",
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    facilities,
    serviceNotes,
    ownerRemark,
    contactPhone: extractContactPhoneFromHtml(text),
  };
}

export function extractContactPhoneFromHtml(html) {
  const text = String(html || "");
  const targetedPatterns = [
    /house-telephone[\s\S]{0,400}?(09\d{2}-?\d{3}-?\d{3}|0\d{1,2}-\d{6,8})/i,
    /data-gtm-behavior="call"[\s\S]{0,400}?(09\d{2}-?\d{3}-?\d{3}|0\d{1,2}-\d{6,8})/i,
  ];

  for (const pattern of targetedPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  const fallbackMatch = text.match(/(?:\+886[-\s]?)?(09\d{2}-?\d{3}-?\d{3}|0\d{1,2}-\d{6,8})/);
  return fallbackMatch ? fallbackMatch[1] : "";
}

export function isAllowed591ListingUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === "https://rent.591.com.tw" && /^\/\d+(?:[/?#]|$)/.test(parsed.pathname);
  } catch {
    return false;
  }
}

function extractFullAddressFromHtml(html, shortAddress) {
  const compactAddress = compactText(shortAddress);
  if (!compactAddress) {
    return "";
  }

  const escapedAddress = escapeRegex(compactAddress);
  const fullAddressMatch = String(html || "").match(new RegExp(`([\\u4e00-\\u9fff]{2,}(?:縣|市)${escapedAddress})`));
  return fullAddressMatch?.[1] || compactAddress;
}

function extractCoordinatesFromHtml(html, shortAddress) {
  const compactAddress = compactText(shortAddress);
  if (!compactAddress) {
    return {
      latitude: null,
      longitude: null,
    };
  }

  const escapedAddress = escapeRegex(compactAddress);
  const match = String(html || "").match(new RegExp(`"${escapedAddress}","([0-9.]+)","([0-9.]+)"`));
  const latitude = match ? Number(match[1]) : null;
  const longitude = match ? Number(match[2]) : null;

  return {
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
  };
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
      if (attempt < FETCH_RETRIES) {
        await sleep(500 * attempt);
      }
    }
  }

  throw new Error(lastError?.message || "fetch failed");
}

function cleanInlineText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function compactText(value) {
  return cleanInlineText(value).replace(/\s+/g, "");
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
