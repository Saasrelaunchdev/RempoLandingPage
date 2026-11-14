// Which races Meta hears about (the course's "pixel conditioning": tell Meta only about the leads you want more of).
// The race knows one thing about fit: the business's Google category. A home-service trade fits; anything else (a
// restaurant, a dentist) still gets its race, its emails and the call, but the pixel and the Conversions API stay quiet.
// The Gap Check this replaced asked for jobs a week and job software; the race doesn't, so the trade is the filter.
// Start wide, then tighten once there is a quarter of data.
export const TRADE = /plumb|drain|rooter|sewer|septic|water heater|hvac|heating|\bheat\b|air condition|\bair\b|cooling|furnace|boiler|comfort|electric|roof|gutter|garage door|pest|insulation|solar|window|siding|remodel|contractor|handyman|appliance|chimney|fence|paving|concrete|landscap|lawn|tree serv|pool|cleaning|junk|haul|mover|moving|restoration|water damage|locksmith|painter|painting|flooring|foundation|waterproof|irrigation|sprinkler|home services/i;

export const isTrade = (category) => TRADE.test(String(category || ""));
export const fitOf = (category) => (isTrade(category) ? "trade" : "other");
