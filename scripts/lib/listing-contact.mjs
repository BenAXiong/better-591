const FETCH_RETRIES = 3;

export async function fetchListingContact(sourceUrl) {
  if (!isAllowed591ListingUrl(sourceUrl)) {
    throw new Error("Only https://rent.591.com.tw/<id> listing URLs are allowed.");
  }

  const html = await downloadText(sourceUrl);
  return {
    contactPhone: extractContactPhoneFromHtml(html),
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

function isAllowed591ListingUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === "https://rent.591.com.tw" && /^\/\d+(?:[/?#]|$)/.test(parsed.pathname);
  } catch {
    return false;
  }
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
