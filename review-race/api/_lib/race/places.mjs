// The business search box: Google Places API (New) Autocomplete, called from the server so the key never reaches
// the page. Pure service-area businesses are included on purpose: many plumbers and HVAC shops have no public address
// on Google Maps, and Google leaves them out of the suggestions unless asked.
//
// Billing: each call is one autocomplete request (the session is never closed with a Place Details call, because
// SerpApi looks the place up afterwards). Google's free monthly allowance covers a test project's traffic.
import { fetchJson } from "./http.mjs";

const URL_AUTOCOMPLETE = "https://places.googleapis.com/v1/places:autocomplete";
const MASK = "suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.text,suggestions.placePrediction.types";

export async function suggest(key, input, session) {
  const r = await fetchJson(URL_AUTOCOMPLETE, {
    method: "POST",
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": MASK },
    body: {
      input: String(input).slice(0, 120),
      includedRegionCodes: ["us"],
      languageCode: "en",
      regionCode: "us",
      includePureServiceAreaBusinesses: true,
      ...(session ? { sessionToken: session } : {})
    },
    timeoutMs: 8000
  });
  if (!r.ok) {
    const msg = r.data && r.data.error && r.data.error.message;
    throw Object.assign(new Error(`Google Places answered HTTP ${r.status}${msg ? `: ${msg}` : ""}`), { status: 502, code: "places" });
  }
  return ((r.data && r.data.suggestions) || [])
    .map((s) => s.placePrediction)
    .filter((p) => p && p.placeId)
    .map((p) => ({
      id: p.placeId,
      main: (p.structuredFormat && p.structuredFormat.mainText && p.structuredFormat.mainText.text) || (p.text && p.text.text) || "",
      secondary: (p.structuredFormat && p.structuredFormat.secondaryText && p.structuredFormat.secondaryText.text) || "",
      types: Array.isArray(p.types) ? p.types.slice(0, 6) : []
    }))
    .slice(0, 5);
}

// "Springfield, IL, USA" -> "Springfield, IL"; "123 Main St, Springfield, IL, USA" -> "Springfield, IL"
export function cityFrom(secondary) {
  const parts = String(secondary || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length && /^(usa|united states)$/i.test(parts[parts.length - 1])) parts.pop();
  if (parts.length >= 2) {
    const last = parts[parts.length - 1].replace(/\s+\d{5}(-\d{4})?$/, "");
    return `${parts[parts.length - 2]}, ${last}`;
  }
  return parts[0] || "";
}
