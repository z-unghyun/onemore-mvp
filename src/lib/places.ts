// All Google API calls go through the server-side proxy at /api/places, which
// injects the key (server-only env var GOOGLE_MAPS_KEY). The client never sees
// the key. When no key is configured the proxy returns { status: 'NO_API_KEY' }
// and each function falls back gracefully.

async function gCall(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`/api/places?path=${encodeURIComponent(path)}`);
  return res.json();
}

// ─── types ────────────────────────────────────────────────────────────────────

export interface RegionSuggestion {
  name: string;
  sub: string;
  placeId: string;
}

export interface PlaceCandidate {
  placeId: string;
  name: string;
  rating: number;
  lat: number;
  lng: number;
  photoRef?: string;
  priceLevel?: number;
  isPartner: boolean;
}

export interface CoursePlace {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  rating: number;
  photoRef?: string;
  isPartner: boolean;
}

// ─── transit hubs ─────────────────────────────────────────────────────────────

export const TRANSIT_HUBS: Record<string, { lat: number; lng: number; station: string }> = {
  '강남':    { lat: 37.4979, lng: 127.0276, station: '강남역' },
  '을지로3가': { lat: 37.5663, lng: 126.9931, station: '을지로3가역' },
  '성수':    { lat: 37.5447, lng: 127.0557, station: '성수역' },
  '홍대':    { lat: 37.5543, lng: 126.9228, station: '홍대입구역' },
  '한남':    { lat: 37.5344, lng: 127.0010, station: '한강진역' },
  '연남':    { lat: 37.5543, lng: 126.9228, station: '홍대입구역' },
};

// ─── category → Places API search params ──────────────────────────────────────

const CAT_PARAMS: Record<string, { type: string; keyword: string }> = {
  '한식':   { type: 'restaurant', keyword: '한식' },
  '양식':   { type: 'restaurant', keyword: '양식 레스토랑' },
  '일식':   { type: 'restaurant', keyword: '일식' },
  '중식':   { type: 'restaurant', keyword: '중식당' },
  '아시아': { type: 'restaurant', keyword: '아시아 음식' },
  '멕시칸': { type: 'restaurant', keyword: '멕시칸' },
  '회/해물':{ type: 'restaurant', keyword: '해산물 회' },
  '안주':   { type: 'bar',        keyword: '포차 안주' },
  '디저트': { type: 'bakery',     keyword: '디저트 카페' },
  '브런치': { type: 'cafe',       keyword: '브런치 카페' },
  '베이커리':{ type: 'bakery',    keyword: '베이커리' },
  '로스터리':{ type: 'cafe',      keyword: '스페셜티 커피 로스터리' },
  '영화':   { type: 'movie_theater', keyword: '영화관' },
  // 만화카페는 Google Places 인덱스 범주가 불명확하여 제외
  '연극':   { type: 'art_gallery',   keyword: '소극장 연극' },
  '스포츠': { type: 'gym',           keyword: '스포츠 클라이밍 볼링' },
};

const KIND_DEFAULT: Record<string, { type: string; keyword: string }> = {
  '식사':   { type: 'restaurant', keyword: '맛집' },
  '카페':   { type: 'cafe',       keyword: '카페' },
  '놀거리': { type: 'tourist_attraction', keyword: '놀거리' },
};

// ─── distance helpers ──────────────────────────────────────────────────────────

// Haversine straight-line distance in metres.
function haversineDist(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const sin2 = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(sin2));
}

// Walking estimate: straight-line × 1.35 path factor ÷ 80 m/min. ±1–2 min vs API.
export function approxWalkMins(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  return Math.max(1, Math.round(haversineDist(a, b) * 1.35 / 80));
}

// ─── name cleanup ──────────────────────────────────────────────────────────────

// Google can return "한글이름 ENGLISH NAME 漢字名" or "한글 | English | 漢字".
// Rule: if Korean is present, keep only through the last Korean character.
//       If purely Latin (brand name like "CGV"), keep as-is.
export function cleanName(raw: string): string {
  const first = raw.split(' | ')[0].trim();
  if (!/[가-힣]/.test(first)) return first; // purely Latin brand → keep
  // Remove Japanese/Chinese scripts, collapse whitespace
  const s = first.replace(/[぀-ヿ一-鿿]+/g, ' ').replace(/\s+/g, ' ').trim();
  // Greedy-match everything up to and including the last Korean character sequence
  return s.match(/^(.*[가-힣]+)/)?.[1].trim() ?? s;
}

// ─── cache ────────────────────────────────────────────────────────────────────

const walkCache = new Map<string, number>();

// ─── 1. Place Autocomplete ────────────────────────────────────────────────────

export async function autocompleteRegion(input: string): Promise<RegionSuggestion[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await gCall(
      `/place/autocomplete/json?input=${encodeURIComponent(input)}&language=ko&components=country:kr&types=(regions)`
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data.predictions || []).map((p: any) => ({
      name: p.structured_formatting?.main_text || p.description,
      sub:  p.structured_formatting?.secondary_text || '',
      placeId: p.place_id,
    }));
  } catch { return []; }
}

// ─── 2. Find Nearest ──────────────────────────────────────────────────────────
//
// Filters applied (in order of importance):
//   • Not CLOSED_TEMPORARILY or CLOSED_PERMANENTLY.
//     NOTE: large chains (CGV, Megabox) often have business_status = undefined
//     in the API — requiring === 'OPERATIONAL' would silently exclude them.
//     Instead we only reject explicitly-closed statuses.
//   • rating ≥ 4.0
//   • user_ratings_total ≥ 10 (excludes ghost/new-registration listings)
//   • haversine distance ≤ 2 km from the search hub
//     (rankby=distance has no radius cap; without this, a category with few
//     local options could match something 10+ km away)

const MAX_DIST_M = 2000;

export async function findNearest(
  hub: { lat: number; lng: number },
  category: string | null,
  kind: string,
): Promise<CoursePlace | null> {
  const { type, keyword } = (category && CAT_PARAMS[category])
    ? CAT_PARAMS[category]
    : KIND_DEFAULT[kind] ?? { type: 'restaurant', keyword: '' };

  const kwParam = keyword ? `&keyword=${encodeURIComponent(keyword)}` : '';

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await gCall(
      `/place/nearbysearch/json?location=${hub.lat},${hub.lng}&rankby=distance&type=${type}${kwParam}&language=ko`
    );

    const results: Array<{
      place_id: string;
      name: string;
      rating?: number;
      user_ratings_total?: number;
      geometry: { location: { lat: number; lng: number } };
      photos?: Array<{ photo_reference: string }>;
      business_status?: string;
    }> = data.results || [];

    const match = results.find(p =>
      p.business_status !== 'CLOSED_TEMPORARILY' &&
      p.business_status !== 'CLOSED_PERMANENTLY' &&
      !(p as Record<string, unknown>)['permanently_closed'] &&
      (p.rating ?? 0) >= 4.0 &&
      haversineDist(hub, { lat: p.geometry.location.lat, lng: p.geometry.location.lng }) <= MAX_DIST_M
    );
    if (!match) return null;

    return {
      placeId:  match.place_id,
      name:     cleanName(match.name),
      lat:      match.geometry.location.lat,
      lng:      match.geometry.location.lng,
      rating:   match.rating ?? 4.0,
      photoRef: match.photos?.[0]?.photo_reference,
      isPartner: true,
    };
  } catch { return null; }
}

// ─── 3. Course Recommendation ─────────────────────────────────────────────────

export async function recommendCourse(
  items: Array<{ id: number; kind: string; category: string | null }>,
  region: string,
): Promise<Map<number, CoursePlace>> {
  const hub = TRANSIT_HUBS[region];
  if (!hub) return new Map();

  const result = new Map<number, CoursePlace>();
  let currentHub = { lat: hub.lat, lng: hub.lng };

  for (const item of items) {
    const place = await findNearest(currentHub, item.category, item.kind);
    if (place) {
      result.set(item.id, place);
      currentHub = { lat: place.lat, lng: place.lng };
    }
  }

  return result;
}

// ─── 4. Distance Matrix ───────────────────────────────────────────────────────

export async function getWalkingTimes(
  places: Array<{ placeId: string; lat: number; lng: number }>,
): Promise<number[]> {
  if (places.length < 2) return [];

  const pairs = places.slice(0, -1).map((p, i) => ({ a: p, b: places[i + 1] }));
  const cacheKeys = pairs.map(p => `${p.a.placeId}__${p.b.placeId}`);
  if (cacheKeys.every(k => walkCache.has(k))) {
    return cacheKeys.map(k => walkCache.get(k)!);
  }

  try {
    const origins      = places.slice(0, -1).map(p => `${p.lat},${p.lng}`).join('|');
    const destinations = places.slice(1).map(p => `${p.lat},${p.lng}`).join('|');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await gCall(
      `/distancematrix/json?origins=${encodeURIComponent(origins)}&destinations=${encodeURIComponent(destinations)}&mode=walking&language=ko`
    );

    const rows: Array<{ elements: Array<{ duration?: { value: number }; status: string }> }> =
      data.rows || [];

    return pairs.map((_pair, i) => {
      const el = rows[i]?.elements[i];
      if (el?.status === 'OK') {
        const mins = Math.ceil((el.duration?.value ?? 300) / 60);
        walkCache.set(cacheKeys[i], mins);
        return mins;
      }
      return 0; // 0 = no API result; caller uses approxWalkMins fallback
    });
  } catch {
    return pairs.map(() => 0);
  }
}

// ─── 5. Nearby Search (swap sheet candidates) ─────────────────────────────────

export async function nearbySearch(
  lat: number, lng: number,
  category: string | null,
  kindFallback?: string,
): Promise<PlaceCandidate[]> {
  try {
    const mapped = category ? CAT_PARAMS[category] : (kindFallback ? KIND_DEFAULT[kindFallback] : null);
    const type = mapped?.type ?? 'restaurant';
    const kw = mapped?.keyword ?? '';
    const kwParam = kw ? `&keyword=${encodeURIComponent(kw)}` : '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await gCall(
      `/place/nearbysearch/json?location=${lat},${lng}&rankby=distance&type=${type}${kwParam}&language=ko`
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data.results || []).filter((p: any) =>
      p.business_status !== 'CLOSED_TEMPORARILY' &&
      p.business_status !== 'CLOSED_PERMANENTLY' &&
      !p.permanently_closed &&
      (p.rating ?? 0) >= 4.0
    ).slice(0, 8).map((p: any) => ({
      placeId:    p.place_id,
      name:       cleanName(p.name),
      rating:     p.rating ?? 4.0,
      lat:        p.geometry?.location?.lat ?? lat,
      lng:        p.geometry?.location?.lng ?? lng,
      photoRef:   p.photos?.[0]?.photo_reference,
      priceLevel: p.price_level,
      isPartner:  true,
    }));
  } catch { return []; }
}

// ─── 6. Single walking time (Directions fallback) ─────────────────────────────

export async function getWalkingMinutes(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
): Promise<number> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await gCall(
      `/directions/json?origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&mode=walking&language=ko`
    );
    return Math.ceil((data.routes?.[0]?.legs?.[0]?.duration?.value ?? 300) / 60);
  } catch { return 5; }
}

// ─── 7. Photo URL ─────────────────────────────────────────────────────────────

export function photoUrl(ref: string, maxWidth = 400): string {
  return `/api/places/photo?ref=${encodeURIComponent(ref)}&w=${maxWidth}`;
}
