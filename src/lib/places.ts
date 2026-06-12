const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || '';
const BASE = 'https://maps.googleapis.com/maps/api';

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

const TYPE_MAP: Record<string, string> = {
  '한식': 'restaurant', '양식': 'restaurant', '일식': 'restaurant',
  '중식': 'restaurant', '아시아': 'restaurant', '멕시칸': 'restaurant',
  '회/해물': 'restaurant', '안주': 'bar',
  '디저트': 'bakery', '브런치': 'cafe', '베이커리': 'bakery', '로스터리': 'cafe',
  '영화': 'movie_theater', '만화': 'amusement_park', '연극': 'art_gallery', '스포츠': 'gym',
};

export async function autocompleteRegion(input: string): Promise<RegionSuggestion[]> {
  if (!API_KEY) return [];
  try {
    const url = `${BASE}/place/autocomplete/json?input=${encodeURIComponent(input)}&language=ko&components=country:kr&types=(regions)&key=${API_KEY}`;
    const res = await fetch(`/api/places?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    return (data.predictions || []).map((p: any) => ({
      name: p.structured_formatting?.main_text || p.description,
      sub: p.structured_formatting?.secondary_text || '',
      placeId: p.place_id,
    }));
  } catch {
    return [];
  }
}

export async function nearbySearch(lat: number, lng: number, type: string, keyword: string): Promise<PlaceCandidate[]> {
  if (!API_KEY) return [];
  try {
    const googleType = TYPE_MAP[keyword] || 'establishment';
    const url = `${BASE}/place/nearbysearch/json?location=${lat},${lng}&radius=1000&type=${googleType}&keyword=${encodeURIComponent(keyword)}&language=ko&key=${API_KEY}`;
    const res = await fetch(`/api/places?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    return (data.results || []).slice(0, 5).map((p: any, i: number) => ({
      placeId: p.place_id,
      name: p.name,
      rating: p.rating || 4.0,
      lat: p.geometry?.location?.lat || lat,
      lng: p.geometry?.location?.lng || lng,
      photoRef: p.photos?.[0]?.photo_reference,
      priceLevel: p.price_level,
      isPartner: i < 2,
    }));
  } catch {
    return [];
  }
}

export async function getWalkingMinutes(origin: {lat:number,lng:number}, destination: {lat:number,lng:number}): Promise<number> {
  if (!API_KEY) return 5;
  try {
    const url = `${BASE}/directions/json?origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&mode=walking&key=${API_KEY}`;
    const res = await fetch(`/api/places?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    const seconds = data.routes?.[0]?.legs?.[0]?.duration?.value || 300;
    return Math.round(seconds / 60);
  } catch {
    return 5;
  }
}

export function photoUrl(ref: string, maxWidth = 400): string {
  return `${BASE}/place/photo?maxwidth=${maxWidth}&photo_reference=${ref}&key=${API_KEY}`;
}
