export interface TimelineItem {
  id: number;
  kind: '식사' | '카페' | '놀거리';
  category: string | null;
  start: number; // minutes, 540=9:00
  end: number;
  placeIdx: number;
  placeId?: string;
  placeName?: string;
  lat?: number;
  lng?: number;
  placeRating?: number;
  photoRef?: string;
  isPartner?: boolean;
}

export interface AppState {
  mapPan: { x: number; y: number };
  tab: 'home' | 'plan' | 'calendar' | 'mypage';
  planStage: 'build' | 'final' | 'checkout' | 'complete';
  region: string;
  dateIdx: number;
  showSearch: boolean;
  catPickerId: number | null;
  placePickerId: number | null;
  confirmed: boolean;
  reviewOpen: boolean;
  rating: number;
  photos: boolean[];
  payIdx: number;
  toast: string;
  items: TimelineItem[];
}
