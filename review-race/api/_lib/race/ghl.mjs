// GoHighLevel: the CRM and the calendar. API v2 with a Private Integration token (Settings > Private Integrations),
// endpoints and fields as in HighLevel's official SDK (@gohighlevel/api-client 3.1.1):
//   POST /contacts/upsert                     the lead, with tags        (contacts.write)
//   POST /contacts/{id}/notes                 the race summary as a note (contacts.write)
//   POST /contacts/{id}/tags                  race-booked, race-unsubscribed
//   GET  /contacts/{id}                       its tags, to stop the follow-ups for customers (contacts.readonly)
//   GET  /calendars/{calendarId}/free-slots   the open times              (calendars.readonly)
//   POST /calendars/events/appointments       the booking                 (calendars/events.write)
// The Version header is 2021-07-28 (contacts) and 2021-04-15 (calendars) unless GHL_API_VERSION or
// GHL_CALENDAR_API_VERSION say otherwise.
import { fetchJson } from "./http.mjs";

const BASE = "https://services.leadconnectorhq.com";

function api(g) {
  return async (path, { method = "GET", body, version = g.version } = {}) => {
    const r = await fetchJson(`${BASE}${path}`, { method, body, headers: { authorization: `Bearer ${g.token}`, version }, timeoutMs: 12000 });
    if (!r.ok) {
      const m = r.data && typeof r.data === "object" ? [].concat(r.data.message || r.data.error || []).join("; ") : String(r.data || "").slice(0, 200);
      throw Object.assign(new Error(`GoHighLevel answered HTTP ${r.status}${m ? `: ${m}` : ""}`), { code: "ghl", status: 502 });
    }
    return r.data || {};
  };
}

export async function upsertContact(g, { firstName, email, phone, companyName, city, tags = [] }) {
  const data = await api(g)("/contacts/upsert", {
    method: "POST",
    body: {
      locationId: g.locationId,
      ...(firstName ? { firstName } : {}),
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      ...(companyName ? { companyName } : {}),
      ...(city ? { city } : {}),
      tags,
      source: "Review Race"
    }
  });
  const contact = data.contact || {};
  return { id: contact.id || data.id || null, isNew: Boolean(data.new) };
}

export const addNote = (g, contactId, body) => api(g)(`/contacts/${encodeURIComponent(contactId)}/notes`, { method: "POST", body: { body: String(body).slice(0, 5000) } });
export const addTags = (g, contactId, tags) => api(g)(`/contacts/${encodeURIComponent(contactId)}/tags`, { method: "POST", body: { tags } });

export async function contactTags(g, contactId) {
  const data = await api(g)(`/contacts/${encodeURIComponent(contactId)}`);
  const c = data.contact || data;
  return Array.isArray(c.tags) ? c.tags.map((t) => String(t).toLowerCase()) : [];
}

// Open times for the next `days` days, in the visitor's time zone: [{ date: "2026-11-12", slots: ["2026-11-12T09:00:00-06:00", ...] }]
export async function freeSlots(g, { timezone, from = Date.now(), days = 7 }) {
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const qs = new URLSearchParams({ startDate: String(start.getTime() + 86400000), endDate: String(start.getTime() + (days + 1) * 86400000), ...(timezone ? { timezone } : {}) });
  const data = await api(g)(`/calendars/${encodeURIComponent(g.calendarId)}/free-slots?${qs}`, { version: g.calendarVersion });
  return Object.entries(data)
    .filter(([k, v]) => /^\d{4}-\d{2}-\d{2}$/.test(k) && v && Array.isArray(v.slots) && v.slots.length)
    .map(([date, v]) => ({ date, slots: v.slots.filter((s) => typeof s === "string") }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function book(g, { contactId, startTime, title }) {
  const data = await api(g)("/calendars/events/appointments", {
    method: "POST",
    version: g.calendarVersion,
    body: { calendarId: g.calendarId, locationId: g.locationId, contactId, startTime, title, appointmentStatus: "confirmed", toNotify: true }
  });
  return { id: data.id || (data.appointment && data.appointment.id) || null };
}
