// ─── config ──────────────────────────────────────────────────────────────────

// All Google API calls go through the server-side proxy at /api/places, which
// injects the key (server-only env var GOOGLE_MAPS_KEY). The client never sees
// the key. When no key is configured the proxy returns { status: 'NO_API_KEY' }
// and each function falls back to its mock/default behaviour.

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

// ─── transit hubs ────────────────────────────────────────────────────────────
// 지역별 거점역 좌표 (Nearby Search 출발점)

export const TRANSIT_HUBS: Record<string, { lat: number; lng: number; station: string }> = {
  '강남':    { lat: 37.4979, lng: 127.0276, station: '강남역' },
  '을지로3가': { lat: 37.5663, lng: 126.9931, station: '을지로3가역' },
  '성수':    { lat: 37.5447, lng: 127.0557, station: '성수역' },
  '홍대':    { lat: 37.5543, lng: 126.9228, station: '홍대입구역' },
  '한남':    { lat: 37.5344, lng: 127.0010, station: '한강진역' },
  '연남':    { lat: 37.5543, lng: 126.9228, station: '홍대입구역' },
};

// ─── category → Places API search params ─────────────────────────────────────

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
  '만화':   { type: 'amusement_park',keyword: '만화카페' },
  '연극':   { type: 'art_gallery',   keyword: '소극장 연극' },
  '스포츠': { type: 'gym',           keyword: '스포츠 클라이밍 볼링' },
};

const KIND_DEFAULT: Record<string, { type: string; keyword: string }> = {
  '식사':   { type: 'restaurant', keyword: '맛집' },
  '카페':   { type: 'cafe',       keyword: '카페' },
  '놀거리': { type: 'tourist_attraction', keyword: '놀거리' },
};

// ─── cache ────────────────────────────────────────────────────────────────────
// (placeId_A, placeId_B) → walkMinutes  — persists for lifetime of the page

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

// ─── 2. Find Nearest (거점 기준 가장 가까운 별점 4.0+ 장소) ──────────────────
// rankby=distance → radius 없이 가까운 순으로 반환, 클라이언트에서 rating 필터

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
      geometry: { location: { lat: number; lng: number } };
      photos?: Array<{ photo_reference: string }>;
      business_status?: string;
    }> = data.results || [];

    // 별점 4.0 이상 + 영업 중인 곳 중 가장 가까운 곳 (이미 거리순 정렬)
    const match = results.find(p =>
      (p.rating ?? 0) >= 4.0 &&
      p.business_status !== 'CLOSED_PERMANENTLY'
    );

    if (!match) return null;

    return {
      placeId:  match.place_id,
      name:     match.name,
      lat:      match.geometry.location.lat,
      lng:      match.geometry.location.lng,
      rating:   match.rating ?? 4.0,
      photoRef: match.photos?.[0]?.photo_reference,
      isPartner: false, // 실 DB 없으므로 일단 false; 추후 partner_places 테이블로 join
    };
  } catch { return null; }
}

// ─── 3. Course Recommendation (체인 추천) ────────────────────────────────────
//
// 알고리즘:
//   hub = 거점역 좌표
//   for each item (시간순):
//     place = findNearest(hub, item.category, item.kind)  → 1 API call
//     hub   = place.lat/lng   (다음 탐색 기준점 갱신)
//
// API 호출 수 = items.length (Nearby Search) + 1 (Distance Matrix)

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

// ─── 4. Distance Matrix (도보 시간 일괄 조회) ─────────────────────────────────
//
// N개 장소 → N-1 구간을 Distance Matrix 1회 호출로 처리
// origins    = place[0..N-2]
// destinations = place[1..N-1]
// 응답 matrix[i][i] = i번째 구간 이동 시간

export async function getWalkingTimes(
  places: Array<{ placeId: string; lat: number; lng: number }>,
): Promise<number[]> {
  if (places.length < 2) return [];

  // 캐시 확인 — 모든 구간이 캐시에 있으면 API 호출 생략
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

    return pairs.map((pair, i) => {
      const el = rows[i]?.elements[i];
      if (el?.status === 'OK') {
        const mins = Math.ceil((el.duration?.value ?? 300) / 60);
        walkCache.set(cacheKeys[i], mins); // only cache real results
        return mins;
      }
      return 5; // fallback (no key / no route) — not cached, retried when key present
    });
  } catch {
    return pairs.map(() => 5);
  }
}

// ─── 5. PlaceSwapSheet 용 후보 목록 ──────────────────────────────────────────

export async function nearbySearch(
  lat: number, lng: number,
  category: string, keyword: string,
): Promise<PlaceCandidate[]> {
  try {
    // category 는 한글 분류(예: '디저트')일 수 있으므로 Google type/keyword 로 변환
    const mapped = CAT_PARAMS[category];
    const type = mapped?.type ?? 'restaurant';
    const kw = mapped?.keyword || keyword;
    const kwParam = kw ? `&keyword=${encodeURIComponent(kw)}` : '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await gCall(
      `/place/nearbysearch/json?location=${lat},${lng}&rankby=distance&type=${type}${kwParam}&language=ko`
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data.results || []).slice(0, 5).map((p: any, i: number) => ({
      placeId:    p.place_id,
      name:       p.name,
      rating:     p.rating || 4.0,
      lat:        p.geometry?.location?.lat || lat,
      lng:        p.geometry?.location?.lng || lng,
      photoRef:   p.photos?.[0]?.photo_reference,
      priceLevel: p.price_level,
      isPartner:  i < 2,
    }));
  } catch { return []; }
}

// ─── 6. 단일 도보 시간 (Directions — 직접 호출용, fallback) ──────────────────

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
  // Routed through the server proxy so the key is never exposed client-side.
  return `/api/places/photo?ref=${encodeURIComponent(ref)}&w=${maxWidth}`;
}
