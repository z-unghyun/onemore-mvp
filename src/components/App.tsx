'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  HOURH, START, HOURS, ENDM, DATES,
  CAT, KIND, PRICE, INITIAL_ITEMS, COUPLE_NAME, REGIONS, REGION_COORDS,
} from '@/lib/constants';
import type { TimelineItem } from '@/lib/types';
import { autocompleteRegion, nearbySearch, recommendCourse, getWalkingTimes, approxWalkMins } from '@/lib/places';
import type { RegionSuggestion, PlaceCandidate } from '@/lib/places';

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmt(m: number) {
  m = Math.round(m);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}
function won(n: number) { return n.toLocaleString('ko-KR') + '원'; }
function rateFor(cnt: number) { return Math.min(30, 5 * cnt); }

function placeName(it: TimelineItem) {
  return it.placeName ?? it.category ?? it.kind;
}
function isPartner(it: TimelineItem) {
  return it.isPartner ?? false;
}

// Mock non-partner entries per kind — shown at the bottom of the swap sheet to
// demonstrate the flow where selecting a non-partner removes the discount.
const MOCK_NON_PARTNER: Record<string, Array<{ name: string; rating: number }>> = {
  '식사':   [{ name: '동네 한식당', rating: 4.1 }, { name: '오늘의 식탁', rating: 3.9 }],
  '카페':   [{ name: '동네 카페', rating: 4.0 }, { name: '커피 한 잔', rating: 3.9 }],
  '놀거리': [{ name: '근처 놀거리', rating: 4.0 }, { name: '주변 즐길거리', rating: 3.9 }],
};
function firstFreeSlot(items: TimelineItem[]) {
  const dur = 90;
  const sorted = [...items].sort((a, b) => a.start - b.start);
  let s = START;
  for (const it of sorted) { if (s < it.end && s + dur > it.start) s = it.end; }
  return Math.min(ENDM - dur, s);
}

const POS: [number, number][] = [[24, 30], [58, 42], [44, 66], [76, 68]];
const KIND_ICONS: Record<string, string> = { '식사': '🍴', '카페': '☕', '놀거리': '🎢' };

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  // state mirrors the prototype exactly (tab starts on 'plan')
  const [mapPan, setMapPan] = useState({ x: 0, y: 0 });
  const [tab, setTab] = useState<'home' | 'plan' | 'calendar' | 'mypage'>('plan');
  const [planStage, setPlanStage] = useState<'build' | 'final' | 'checkout' | 'complete'>('build');
  const [region, setRegion] = useState('강남');
  const [dateIdx, setDateIdx] = useState(1);
  const [showSearch, setShowSearch] = useState(false);
  const [catPickerId, setCatPickerId] = useState<number | null>(null);
  const [placePickerId, setPlacePickerId] = useState<number | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [photos, setPhotos] = useState([false, false, false]);
  const [payIdx, setPayIdx] = useState(0);
  const [toast, setToast] = useState('');
  const [items, setItems] = useState<TimelineItem[]>(INITIAL_ITEMS);

  // API state
  const [searchInput, setSearchInput] = useState('');
  const [searchSuggestions, setSearchSuggestions] = useState<RegionSuggestion[]>([]);
  const [swapCandidates, setSwapCandidates] = useState<PlaceCandidate[]>([]);
  const [walkMins, setWalkMins] = useState<number[]>([]);
  const [isRecommending, setIsRecommending] = useState(false);
  const [hasRecommended, setHasRecommended] = useState(false);

  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mapDragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const tlDragRef = useRef<{ id: number; mode: 'move' | 'resize'; startY: number; os: number; oe: number; moved: number } | null>(null);
  const tlScrollRef = useRef<HTMLDivElement>(null);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 1700);
  }, []);

  // autocomplete with 300ms debounce
  useEffect(() => {
    if (!searchInput.trim()) { setSearchSuggestions([]); return; }
    const t = setTimeout(async () => {
      const r = await autocompleteRegion(searchInput);
      setSearchSuggestions(r);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Walk times: set approx immediately from coords, then update with Distance Matrix API.
  // getWalkingTimes returns 0 for missing results; approxWalkMins fills those in.
  useEffect(() => {
    const sorted = [...items].sort((a, b) => a.start - b.start);
    if (sorted.length < 2) { setWalkMins([]); return; }

    // Immediate approx (no API call needed)
    const approx = sorted.slice(1).map((it, i) => {
      const prev = sorted[i];
      if (prev.lat && prev.lng && it.lat && it.lng)
        return approxWalkMins({ lat: prev.lat, lng: prev.lng }, { lat: it.lat, lng: it.lng });
      return 5;
    });
    setWalkMins(approx);

    // Then try Distance Matrix for real times (only when all items have coords)
    if (!sorted.every(it => it.lat && it.lng)) return;
    const places = sorted.map(it => ({ placeId: it.placeId ?? String(it.id), lat: it.lat!, lng: it.lng! }));
    getWalkingTimes(places).then(mins => {
      if (!mins.length) return;
      setWalkMins(mins.map((m, i) => m > 0 ? m : approx[i]));
    });
  }, [items]);

  // Scroll timeline to 15:00 on first open of the plan-build tab
  useEffect(() => {
    if (tab === 'plan' && planStage === 'build' && tlScrollRef.current) {
      // 15:00 = 900 min; offset from START (540) = 360 min; 64px/h → 384px
      tlScrollRef.current.scrollTop = (15 * 60 - START) / 60 * HOURH;
    }
  }, [tab, planStage]);

  // fetch swap candidates from Nearby Search
  useEffect(() => {
    if (!placePickerId) { setSwapCandidates([]); return; }
    const it = items.find(i => i.id === placePickerId);
    if (!it) return;
    const cat = it.category ?? CAT[it.kind][0];
    // Use the current item's own coords as the search hub if available, otherwise region centre
    const coords = (it.lat && it.lng) ? { lat: it.lat, lng: it.lng } : REGION_COORDS[region];
    if (!coords) return;
    nearbySearch(coords.lat, coords.lng, cat).then(r => { if (r.length) setSwapCandidates(r); });
  }, [placePickerId, items, region]);

  // ── map pan ────────────────────────────────────────────────────
  const handleMapDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const LIMIT = 160;
    mapDragRef.current = { sx: e.clientX, sy: e.clientY, ox: mapPan.x, oy: mapPan.y };
    const onMove = (ev: PointerEvent) => {
      if (!mapDragRef.current) return;
      const { sx, sy, ox, oy } = mapDragRef.current;
      setMapPan({
        x: Math.max(-LIMIT, Math.min(LIMIT, ox + ev.clientX - sx)),
        y: Math.max(-LIMIT, Math.min(LIMIT, oy + ev.clientY - sy)),
      });
    };
    const onUp = () => { mapDragRef.current = null; window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [mapPan]);

  // ── timeline drag ──────────────────────────────────────────────
  const startDrag = useCallback((e: React.PointerEvent, id: number, mode: 'move' | 'resize') => {
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
    const it = items.find(i => i.id === id);
    if (!it) return;
    tlDragRef.current = { id, mode, startY: e.clientY, os: it.start, oe: it.end, moved: 0 };
    const onMove = (ev: PointerEvent) => {
      if (!tlDragRef.current) return;
      const d = tlDragRef.current;
      const dy = ev.clientY - d.startY;
      d.moved = Math.max(d.moved, Math.abs(dy));
      const dm = Math.round(dy / HOURH * 60 / 10) * 10;
      setItems(prev => prev.map(i => {
        if (i.id !== d.id) return i;
        if (d.mode === 'move') {
          const dur = d.oe - d.os;
          const ns = Math.max(START, Math.min(ENDM - dur, d.os + dm));
          return { ...i, start: ns, end: ns + dur };
        }
        return { ...i, end: Math.max(d.os + 30, Math.min(ENDM, d.oe + dm)) };
      }));
    };
    const onUp = () => {
      const d = tlDragRef.current; tlDragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (d && d.mode === 'move' && d.moved < 5) setCatPickerId(d.id);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [items]);

  // ── derived ────────────────────────────────────────────────────
  const date = DATES[dateIdx];
  const sorted = [...items].sort((a, b) => a.start - b.start);
  const partnerItems = sorted.filter(isPartner);
  const partnerCount = partnerItems.length;
  const r = rateFor(partnerCount);
  const subtotal = sorted.reduce((a, i) => a + PRICE[i.kind], 0);
  const discountRawN = partnerItems.reduce((a, it) => a + Math.round(PRICE[it.kind] * r / 100), 0);
  const finalN = subtotal - discountRawN;

  const isCheckout = tab === 'plan' && planStage === 'checkout';
  const isComplete = tab === 'plan' && planStage === 'complete';
  const showNav = !isCheckout && !isComplete && !reviewOpen;

  // region display list (autocomplete results or static)
  const displayRegions = searchSuggestions.length
    ? searchSuggestions.map(s => ({ name: s.name, sub: s.sub, selected: region === s.name }))
    : REGIONS.map(r => ({ name: r.name, sub: r.sub, selected: region === r.name }));

  // swap sheet — derive context for the selected item
  const swapItem = placePickerId ? items.find(i => i.id === placePickerId) : null;
  const swapItemSortedIdx = swapItem ? sorted.findIndex(i => i.id === swapItem.id) : -1;
  const swapPrevItem = swapItemSortedIdx > 0 ? sorted[swapItemSortedIdx - 1] : null;
  const swapNextItem = swapItemSortedIdx < sorted.length - 1 ? sorted[swapItemSortedIdx + 1] : null;
  const placePickerCat = swapItem ? (swapItem.category ?? CAT[swapItem.kind][0]) : '';

  const pickRegion = (name: string) => {
    setRegion(name);
    setShowSearch(false);
    setSearchInput('');
    setSearchSuggestions([]);
  };

  // ─────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', width: '100%', background: '#EDE7EC', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32, fontFamily: "Pretendard,-apple-system,sans-serif" }}>
      {/* Outer phone shell — #0E0E0C with 54px radius, 11px padding */}
      <div style={{ position: 'relative', width: 390, height: 844, background: '#0E0E0C', borderRadius: 54, padding: 11, boxShadow: '0 50px 110px -30px rgba(60,20,40,.5), 0 0 0 2px rgba(0,0,0,.2)' }}>
        {/* Inner screen — gradient, 44px radius */}
        <div style={{ position: 'relative', width: '100%', height: '100%', background: 'linear-gradient(180deg,#FFE0EB 0%,#FCE7EC 26%,#F1EDF5 58%,#DCEBFF 100%)', borderRadius: 44, overflow: 'hidden' }}>

          {/* status bar */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 54, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', padding: '0 30px 7px', zIndex: 60, pointerEvents: 'none' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#16170F', letterSpacing: '-.3px' }}>9:41</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 11 }}>
                {[5, 7, 9, 11].map((h, i) => <span key={i} style={{ width: 3, height: h, background: '#16170F', borderRadius: 1, display: 'block' }} />)}
              </div>
              <div style={{ width: 15, height: 11, border: '1.6px solid #16170F', borderRadius: 3, position: 'relative' }}>
                <span style={{ position: 'absolute', inset: 1.5, width: 7, background: '#16170F', borderRadius: 1 }} />
              </div>
            </div>
          </div>
          {/* notch */}
          <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', width: 120, height: 34, background: '#0E0E0C', borderRadius: 20, zIndex: 70 }} />

          {/* ══ HOME ══════════════════════════════════════════════ */}
          {tab === 'home' && (
            <div style={{ position: 'absolute', inset: 0 }}>
              {/* pannable map */}
              <div onPointerDown={handleMapDown} style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#E7E9EE', cursor: 'grab', touchAction: 'none' }}>
                <div style={{ position: 'absolute', inset: 0, transform: `translate(${mapPan.x}px,${mapPan.y}px)`, willChange: 'transform' }}>
                  {/* roads */}
                  <div style={{ position: 'absolute', left: '-10%', top: '50%', width: '120%', height: 30, background: '#FAFBFC', transform: 'rotate(-26deg)' }} />
                  <div style={{ position: 'absolute', left: '-10%', top: '72%', width: '120%', height: 20, background: '#FAFBFC', transform: 'rotate(-26deg)' }} />
                  <div style={{ position: 'absolute', left: '18%', top: '-12%', width: 26, height: '130%', background: '#FAFBFC', transform: 'rotate(18deg)' }} />
                  <div style={{ position: 'absolute', left: '58%', top: '-14%', width: 34, height: '140%', background: '#FAFBFC', transform: 'rotate(14deg)' }} />
                  <div style={{ position: 'absolute', left: '80%', top: '-10%', width: 18, height: '130%', background: '#FAFBFC', transform: 'rotate(16deg)' }} />
                  {/* buildings */}
                  <div style={{ position: 'absolute', left: '5%', top: '14%', width: 120, height: 96, background: '#DDE0E6', borderRadius: 6, transform: 'rotate(-26deg)' }} />
                  <div style={{ position: 'absolute', left: '64%', top: '20%', width: 150, height: 120, background: '#DDE0E6', borderRadius: 6, transform: 'rotate(14deg)' }} />
                  <div style={{ position: 'absolute', left: '30%', top: '60%', width: 120, height: 90, background: '#DDE0E6', borderRadius: 6, transform: 'rotate(-26deg)' }} />
                  <div style={{ position: 'absolute', left: '8%', top: '62%', width: 88, height: 70, background: '#D6E6CE', borderRadius: 10, transform: 'rotate(-26deg)' }} />
                  <div style={{ position: 'absolute', right: '-6%', top: '6%', width: 120, height: 120, background: '#CFE0EC', borderRadius: 14, transform: 'rotate(14deg)' }} />
                  {/* route SVG */}
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
                    <polyline
                      points={sorted.slice(0, 4).map((_, i) => POS[i].join(',')).join(' ')}
                      fill="none" stroke="#FF5C97" strokeWidth="2.4" strokeDasharray="0.5 4"
                      strokeLinecap="round" vectorEffect="non-scaling-stroke"
                      style={{ animation: 'omDash 1.2s linear infinite' }}
                    />
                  </svg>
                  {/* walk-time pills */}
                  {sorted.slice(0, 4).map((_, idx) => idx > 0 && (
                    <div key={idx} style={{ position: 'absolute', left: `${(POS[idx-1][0]+POS[idx][0])/2}%`, top: `${(POS[idx-1][1]+POS[idx][1])/2}%`, transform: 'translate(-50%,-50%)', zIndex: 4 }}>
                      <div style={{ background: '#FF5C97', color: '#fff', fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 9, whiteSpace: 'nowrap', boxShadow: '0 4px 10px -3px rgba(240,86,140,.5)' }}>
                        도보 {walkMins.length > 0 ? walkMins[Math.min(idx-1, walkMins.length-1)] : 5}분
                      </div>
                    </div>
                  ))}
                  {/* pins */}
                  {sorted.slice(0, 4).map((it, idx) => (
                    <div key={it.id} style={{ position: 'absolute', left: `${POS[idx][0]}%`, top: `${POS[idx][1]}%`, transform: 'translate(-50%,-50%)', zIndex: 5 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ position: 'relative', width: 38, height: 38, flexShrink: 0 }}>
                          <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#FF5C97' }} />
                          <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '5px solid #FFC2D8' }} />
                          <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 15 }}>{idx+1}</span>
                        </div>
                        <div style={{ background: '#fff', borderRadius: 11, padding: '6px 10px', boxShadow: '0 8px 16px -8px rgba(0,0,0,.3)', whiteSpace: 'nowrap' }}>
                          <div style={{ fontSize: 12, fontWeight: 800, color: '#16170F', lineHeight: 1.15 }}>{fmt(it.start)}</div>
                          <div style={{ fontSize: 11, color: '#9A96A0', fontWeight: 700 }}>{placeName(it)}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* top date card */}
              <div style={{ position: 'absolute', top: 60, left: 16, right: 16, display: 'flex', alignItems: 'center', gap: 10, zIndex: 20 }}>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 11, background: '#fff', borderRadius: 18, padding: '12px 14px', boxShadow: '0 12px 30px -14px rgba(0,0,0,.28)' }}>
                  <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'linear-gradient(135deg,#FF8FB8,#FF5C97)', flexShrink: 0, boxShadow: '0 0 0 4px #FFE2EC', display: 'block' }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#16170F', lineHeight: 1.1 }}>{region} 데이트</div>
                    <div style={{ fontSize: 12, color: '#9A96A0', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{date}</div>
                  </div>
                </div>
                <button onClick={() => setShowSearch(true)} style={{ width: 48, height: 48, borderRadius: 16, background: '#FF5C97', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, boxShadow: '0 12px 24px -10px rgba(240,86,140,.6)' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>
                </button>
              </div>

              {confirmed && (
                <div style={{ position: 'absolute', top: 122, left: 16, right: 16, zIndex: 21, display: 'flex', justifyContent: 'center' }}>
                  <div style={{ background: '#16170F', color: '#fff', fontWeight: 800, fontSize: 12.5, padding: '9px 16px', borderRadius: 13, boxShadow: '0 12px 24px -10px rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ color: '#FF8FB8' }}>✓</span> 오늘의 코스가 확정됐어요
                  </div>
                </div>
              )}

              {/* bottom course card */}
              <div style={{ position: 'absolute', left: 14, right: 14, bottom: 100, zIndex: 20, background: '#fff', borderRadius: 26, padding: '16px 18px 0', boxShadow: '0 24px 54px -20px rgba(0,0,0,.4)', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11, flexShrink: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#16170F' }}>오늘의 코스</div>
                  <div style={{ background: 'linear-gradient(135deg,#FF8FB8,#F0568C)', color: '#fff', fontWeight: 800, fontSize: 12.5, padding: '6px 12px', borderRadius: 11, boxShadow: '0 6px 14px -6px rgba(240,86,140,.6)' }}>+{won(discountRawN)} 할인</div>
                </div>
                <div style={{ overflowY: 'auto', maxHeight: 128, flexShrink: 0 }}>
                  {sorted.map((it, idx) => (
                    <div key={it.id}>
                      {idx > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0 2px 13px' }}>
                          <div style={{ width: 1, height: 12, borderLeft: '1.5px dashed #D8D4DE' }} />
                          <span style={{ fontSize: 10, color: '#B5B0BC', fontWeight: 700 }}>도보 {walkMins.length > 0 ? walkMins[Math.min(idx-1, walkMins.length-1)] : 5}분</span>
                        </div>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 0' }}>
                        <div style={{ width: 26, height: 26, borderRadius: 8, background: KIND[it.kind].num, color: KIND[it.kind].numText, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12, flexShrink: 0 }}>{idx+1}</div>
                        <div style={{ fontSize: 12.5, fontWeight: 800, color: '#16170F', width: 40 }}>{fmt(it.start)}</div>
                        <div style={{ fontSize: 13.5, fontWeight: 700, color: '#16170F', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{placeName(it)}</div>
                        <div style={{ fontSize: 11, color: '#B5B0BC', fontWeight: 700, flexShrink: 0 }}>{KIND[it.kind].label}</div>
                      </div>
                    </div>
                  ))}
                </div>
                {confirmed && (
                  <button onClick={() => setReviewOpen(true)} style={{ width: '100%', margin: '11px 0', background: '#FFEAF1', color: '#F0568C', border: 'none', borderRadius: 14, padding: 12, fontWeight: 800, fontSize: 13.5, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, flexShrink: 0 }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#F0568C" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2.6 6.6L22 9.3l-5 4.9 1.2 7-6.2-3.3L5.8 21l1.2-7-5-4.9 7.4-.7Z"/></svg>
                    후기 쓰고 다음 코스 추가 할인 받기
                  </button>
                )}
                <div style={{ height: 14, flexShrink: 0 }} />
              </div>
            </div>
          )}

          {/* ══ PLAN BUILD ════════════════════════════════════════ */}
          {tab === 'plan' && planStage === 'build' && (
            <div style={{ position: 'absolute', inset: 0, paddingTop: 56, display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '6px 20px 12px' }}>
                <div style={{ textAlign: 'center', fontSize: 20, fontWeight: 800, color: '#16170F', letterSpacing: '-.5px', marginBottom: 13 }}>코스 짜기</div>
                {/* date picker */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', borderRadius: 18, padding: '9px 11px', boxShadow: '0 8px 20px -12px rgba(0,0,0,.25)' }}>
                  <button onClick={() => setDateIdx(d => Math.max(0, d-1))} style={{ width: 34, height: 34, border: 'none', background: '#FFE2EC', borderRadius: 11, fontSize: 17, color: '#F0568C', cursor: 'pointer', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
                  <div style={{ flex: 1, textAlign: 'center', fontWeight: 800, fontSize: 16, color: '#16170F' }}>{date}</div>
                  <button onClick={() => setDateIdx(d => Math.min(2, d+1))} style={{ width: 34, height: 34, border: 'none', background: '#FFE2EC', borderRadius: 11, fontSize: 17, color: '#F0568C', cursor: 'pointer', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
                </div>
                {/* region row */}
                <div style={{ display: 'flex', gap: 9, marginTop: 9 }}>
                  <button onClick={() => setShowSearch(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#fff', border: '1px solid rgba(0,0,0,.05)', borderRadius: 15, padding: '12px 15px', fontWeight: 800, fontSize: 13.5, color: '#16170F', cursor: 'pointer', flexShrink: 0, boxShadow: '0 6px 16px -12px rgba(0,0,0,.3)' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#FF5C97" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>
                    장소 선택
                  </button>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid rgba(0,0,0,.05)', borderRadius: 15, padding: '0 15px', fontWeight: 800, fontSize: 14, color: '#16170F', boxShadow: '0 6px 16px -12px rgba(0,0,0,.3)' }}>
                    <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#FF5C97', flexShrink: 0, display: 'block' }} />
                    <span style={{ whiteSpace: 'nowrap' }}>{region}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: '#B5B0BC', fontWeight: 700, flexShrink: 0, whiteSpace: 'nowrap' }}>서울</span>
                  </div>
                </div>
              </div>

              {/* timeline */}
              <div ref={tlScrollRef} style={{ flex: 1, overflowY: 'auto', padding: '6px 18px 10px' }}>
                <div
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault();
                    const kind = (e.dataTransfer.getData('kind') || e.dataTransfer.getData('text/plain')) as '식사'|'카페'|'놀거리';
                    if (!['식사','카페','놀거리'].includes(kind)) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const y = e.clientY - rect.top;
                    const s = Math.round(Math.max(START, Math.min(ENDM-90, START + y/HOURH*60)) / 10) * 10;
                    setItems(prev => [...prev, { id: Date.now(), kind, category: null, start: s, end: s+90, placeIdx: 0 }]);
                  }}
                  style={{ position: 'relative', height: HOURS * HOURH }}
                >
                  {/* hour grid */}
                  {Array.from({ length: HOURS + 1 }, (_, i) => (
                    <div key={i}>
                      <div style={{ position: 'absolute', left: 52, right: 0, top: i * HOURH, height: 1, background: 'rgba(0,0,0,.06)' }} />
                      <div style={{ position: 'absolute', left: 0, top: i * HOURH - 7, width: 44, textAlign: 'right', fontSize: 11, color: '#B5B0BC', fontWeight: 700 }}>{9+i}:00</div>
                    </div>
                  ))}
                  {/* empty state */}
                  {items.length === 0 && (
                    <div style={{ position: 'absolute', left: 58, right: 8, top: 120, border: '2px dashed #E4B9CC', borderRadius: 18, padding: '28px 16px', textAlign: 'center', background: 'rgba(255,255,255,.5)' }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: '#D584A6' }}>여기로 끌어다 놓으세요</div>
                      <div style={{ fontSize: 11.5, color: '#C7A4B6', fontWeight: 700, marginTop: 5 }}>아래에서 식사·카페·놀거리를 드래그</div>
                    </div>
                  )}
                  {/* blocks */}
                  {items.map(it => {
                    const k = KIND[it.kind];
                    const top = (it.start - START) / 60 * HOURH;
                    const h = Math.max(64, (it.end - it.start) / 60 * HOURH);
                    return (
                      <div key={it.id} onPointerDown={e => startDrag(e, it.id, 'move')} style={{ position: 'absolute', left: 58, right: 8, top, height: h, background: '#fff', borderRadius: 18, boxShadow: '0 12px 26px -14px rgba(0,0,0,.22)', overflow: 'hidden', cursor: 'grab', touchAction: 'none', userSelect: 'none' }}>
                        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, background: k.bar }} />
                        <div style={{ padding: '11px 12px 11px 18px', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 5, pointerEvents: 'none' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                            <span style={{ fontSize: 14.5, fontWeight: 800, color: '#16170F' }}>{k.label}</span>
                            <span style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap', flexShrink: 0, padding: '3px 9px', borderRadius: 8, fontSize: 11, fontWeight: 800, background: it.category ? k.tint : '#F1EFF4', color: it.category ? k.numText : '#A7A2B0', border: it.category ? 'none' : '1px dashed #D6D1DC' }}>{it.category ?? '종류 선택 ›'}</span>
                          </div>
                          <div style={{ fontSize: 12, color: '#9A96A0', fontWeight: 700 }}>{fmt(it.start)} - {fmt(it.end)}</div>
                        </div>
                        <button onPointerDown={e => e.stopPropagation()} onClick={() => setItems(prev => prev.filter(i => i.id !== it.id))} style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', right: 12, width: 30, height: 30, borderRadius: '50%', border: 'none', background: '#EFEDF2', color: '#9A96A0', fontSize: 15, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                        <div onPointerDown={e => startDrag(e, it.id, 'resize')} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 14, cursor: 'ns-resize', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <div style={{ width: 34, height: 4, borderRadius: 2, background: 'rgba(0,0,0,.1)' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* toolbar */}
              <div style={{ padding: '10px 18px 0', background: 'linear-gradient(to top,#EAEAF4 72%,rgba(234,234,244,0))' }}>
                <div style={{ textAlign: 'center', fontSize: 11.5, color: '#A7A2B0', fontWeight: 700, marginBottom: 9 }}>드래그 앤 드롭으로 추가</div>
                <div style={{ display: 'flex', gap: 9, marginBottom: 11 }}>
                  {(['식사','카페','놀거리'] as const).map(kind => {
                    const k = KIND[kind];
                    return (
                      <div key={kind} draggable onDragStart={e => { e.dataTransfer.setData('text/plain', kind); e.dataTransfer.setData('kind', kind); e.dataTransfer.effectAllowed = 'copy'; }} onClick={() => setItems(prev => { const s = firstFreeSlot(prev); return [...prev, { id: Date.now(), kind, category: null, start: s, end: s+90, placeIdx: 0 }]; })} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '14px 8px', background: '#fff', borderRadius: 16, boxShadow: '0 6px 16px -10px rgba(0,0,0,.28)', cursor: 'grab', fontWeight: 800, fontSize: 14, color: '#16170F', userSelect: 'none' }}>
                        <span style={{ width: 24, height: 24, borderRadius: 8, background: k.tint, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>{KIND_ICONS[kind]}</span>
                        {kind}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div style={{ padding: '0 18px 92px' }}>
                <button
                  disabled={isRecommending}
                  onClick={async () => {
                    if (items.length === 0) { setShowSearch(true); return; }
                    setIsRecommending(true);
                    try {
                      const courseItems = [...items].sort((a, b) => a.start - b.start).map(it => ({ id: it.id, kind: it.kind, category: it.category }));
                      const placeMap = await recommendCourse(courseItems, region);
                      if (placeMap.size > 0) {
                        setItems(prev => prev.map(it => {
                          const p = placeMap.get(it.id);
                          if (!p) return it;
                          return { ...it, placeId: p.placeId, placeName: p.name, lat: p.lat, lng: p.lng, placeRating: p.rating, photoRef: p.photoRef, isPartner: p.isPartner };
                        }));
                      }
                    } finally {
                      setIsRecommending(false);
                      setHasRecommended(true);
                      setPlanStage('final');
                    }
                  }}
                  style={{ width: '100%', background: isRecommending ? '#F4A6C0' : '#FF5C97', color: '#fff', border: 'none', borderRadius: 18, padding: 17, fontWeight: 800, fontSize: 16, cursor: isRecommending ? 'default' : 'pointer', boxShadow: '0 14px 30px -12px rgba(240,86,140,.65)', transition: 'background .2s' }}
                >{isRecommending ? '코스 추천 중…' : '계획 짜기'}</button>
              </div>
            </div>
          )}

          {/* ══ PLAN FINAL ════════════════════════════════════════ */}
          {tab === 'plan' && planStage === 'final' && (
            <div style={{ position: 'absolute', inset: 0, paddingTop: 56 }}>
              <div style={{ padding: '6px 18px 8px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <button onClick={() => setPlanStage('build')} style={{ width: 42, height: 42, borderRadius: 14, border: 'none', background: '#fff', boxShadow: '0 6px 16px -10px rgba(0,0,0,.3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16170F" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7"/></svg>
                </button>
                <div style={{ textAlign: 'center', flex: 1 }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#16170F', letterSpacing: '-.5px', lineHeight: 1.1 }}>추천 코스</div>
                  <div style={{ fontSize: 12.5, color: '#9A96A0', fontWeight: 700 }}>{region} · {date}</div>
                </div>
                <div style={{ width: 42, flexShrink: 0 }} />
              </div>

              <div style={{ position: 'absolute', top: 108, bottom: 178, left: 0, right: 0, overflowY: 'auto', padding: '6px 16px 20px' }}>
                {/* tier bar */}
                <div style={{ display: 'flex', background: '#fff', borderRadius: 16, padding: 4, marginBottom: 16, boxShadow: '0 8px 20px -14px rgba(0,0,0,.25)' }}>
                  {[1,2,3,4].map(n => {
                    const active = partnerCount >= n;
                    const current = partnerCount === n;
                    return (
                      <div key={n} style={{ flex: 1, textAlign: 'center', padding: '10px 4px', borderRadius: 13, color: active ? '#fff' : '#B5B0BC', background: active ? 'linear-gradient(135deg,#FF8FB8,#F0568C)' : 'transparent', boxShadow: current ? '0 6px 14px -6px rgba(240,86,140,.6)' : 'none', transition: 'all .2s' }}>
                        <div style={{ fontSize: 11, fontWeight: 800 }}>{n}곳</div>
                        <div style={{ fontSize: 14, fontWeight: 800 }}>{5*n}%</div>
                      </div>
                    );
                  })}
                </div>
                {/* cards */}
                {sorted.map((it, idx) => {
                  const k = KIND[it.kind];
                  const partner = isPartner(it);
                  const notFound = hasRecommended && !it.placeName;
                  return (
                    <div key={it.id}>
                      {idx > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0 8px 38px', color: '#B5B0BC', fontSize: 12, fontWeight: 700 }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#B5B0BC" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="13" cy="4" r="1.6"/><path d="M11 8l-2 4 3 2 1 5M9 12l-3 1M14 14l3 1 1 4"/></svg>
                          {idx - 1 < walkMins.length ? `도보 ${walkMins[idx-1]}분` : '도보 ?분'}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 13, background: notFound ? '#FAF8FA' : '#fff', borderRadius: 20, padding: 15, boxShadow: '0 12px 28px -16px rgba(0,0,0,.28)', marginBottom: 2, border: notFound ? '1.5px dashed #E2DCE5' : 'none' }}>
                        <div style={{ width: 32, height: 32, borderRadius: 11, background: notFound ? '#F1EFF4' : k.num, color: notFound ? '#B5B0BC' : k.numText, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 15, flexShrink: 0 }}>{idx+1}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                            <span style={{ fontSize: 12, fontWeight: 800, color: notFound ? '#B5B0BC' : '#16170F' }}>{fmt(it.start)}</span>
                            <span style={{ fontSize: 11.5, color: '#B5B0BC', fontWeight: 700, whiteSpace: 'nowrap' }}>{k.label} · {it.category ?? CAT[it.kind][0]}</span>
                            {!notFound && <span style={{ marginLeft: 'auto', flexShrink: 0, fontSize: 12, fontWeight: 800, padding: '4px 9px', borderRadius: 9, whiteSpace: 'nowrap', ...(partner ? { background: 'linear-gradient(135deg,#FF8FB8,#F0568C)', color: '#fff' } : { background: '#F1EFF4', color: '#A7A2B0' }) }}>{partner ? `−${r}%` : '비제휴'}</span>}
                          </div>
                          {notFound ? (
                            <div style={{ fontSize: 14, color: '#B5B0BC', fontWeight: 700, marginTop: 5 }}>근처 2km 내 추천 장소 없음</div>
                          ) : (
                            <div style={{ fontSize: 17, fontWeight: 800, color: '#16170F', marginTop: 5 }}>{placeName(it)}</div>
                          )}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6 }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#B5B0BC" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>
                            <span style={{ fontSize: 12, color: '#9A96A0', fontWeight: 700 }}>{region}</span>
                            <button onClick={() => { setSwapCandidates([]); setPlacePickerId(it.id); }} style={{ marginLeft: 'auto', background: notFound ? '#FF5C97' : '#F4F2F7', color: notFound ? '#fff' : '#16170F', border: 'none', borderRadius: 11, padding: '7px 13px', fontSize: 12, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>{notFound ? '직접 선택하기' : '다른 곳 선택'}</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* bottom bar */}
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 84, padding: '14px 16px 12px', zIndex: 57, background: 'linear-gradient(to top,#DEEBFF 66%,rgba(222,235,255,0))' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff', borderRadius: 22, padding: '16px 18px', boxShadow: '0 16px 36px -16px rgba(0,0,0,.3)' }}>
                  <div>
                    <div style={{ color: '#9A96A0', fontSize: 11.5, fontWeight: 800 }}>누적 번들 할인 · 제휴 {partnerCount}곳</div>
                    <div style={{ color: '#F0568C', fontSize: 25, fontWeight: 800, letterSpacing: '-.5px' }}>{won(discountRawN)}</div>
                  </div>
                  <button onClick={() => setPlanStage('checkout')} style={{ background: '#FF5C97', color: '#fff', border: 'none', borderRadius: 15, padding: '15px 22px', fontWeight: 800, fontSize: 15, cursor: 'pointer', boxShadow: '0 12px 24px -10px rgba(240,86,140,.6)' }}>계획 확정</button>
                </div>
              </div>
            </div>
          )}

          {/* ══ CHECKOUT ══════════════════════════════════════════ */}
          {isCheckout && (
            <div style={{ position: 'absolute', inset: 0, paddingTop: 56 }}>
              <div style={{ padding: '6px 18px 10px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <button onClick={() => setPlanStage('final')} style={{ width: 42, height: 42, borderRadius: 14, border: 'none', background: '#fff', boxShadow: '0 6px 16px -10px rgba(0,0,0,.3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16170F" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7"/></svg>
                </button>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#16170F', letterSpacing: '-.5px' }}>결제 · 예약</div>
              </div>
              <div style={{ position: 'absolute', top: 108, bottom: 108, left: 0, right: 0, overflowY: 'auto', padding: '4px 16px 20px' }}>
                {/* course items */}
                <div style={{ background: '#fff', borderRadius: 22, padding: 18, boxShadow: '0 12px 28px -18px rgba(0,0,0,.25)', marginBottom: 14 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#16170F', marginBottom: 14 }}>{region} 데이트 코스 · {date}</div>
                  {sorted.map((it, idx) => {
                    const k = KIND[it.kind];
                    const partner = isPartner(it);
                    return (
                      <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 0', borderBottom: '1px solid #F2F0F5' }}>
                        <div style={{ width: 30, height: 30, borderRadius: 9, background: k.num, color: k.numText, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13, flexShrink: 0 }}>{idx+1}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 14, fontWeight: 800, color: '#16170F' }}>{placeName(it)}</span>
                            <span style={{ fontSize: 10, fontWeight: 800, ...(partner ? { color: '#fff', background: '#FF5C97', padding: '2px 6px', borderRadius: 6 } : { color: '#A7A2B0', background: '#EFEDF2', padding: '2px 6px', borderRadius: 6 }) }}>{partner ? '제휴' : '비제휴'}</span>
                          </div>
                          <div style={{ fontSize: 11.5, color: '#9A96A0', fontWeight: 700 }}>{fmt(it.start)} · {k.label} · {it.category ?? CAT[it.kind][0]}</div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 800, color: '#16170F' }}>{won(PRICE[it.kind])}</div>
                          {partner && <div style={{ fontSize: 11, color: '#F0568C', fontWeight: 800 }}>−{won(Math.round(PRICE[it.kind]*r/100))}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {/* price summary */}
                <div style={{ background: '#fff', borderRadius: 22, padding: '16px 18px', boxShadow: '0 12px 28px -18px rgba(0,0,0,.25)', marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 13, color: '#9A96A0', fontWeight: 700 }}><span>원가 합계</span><span style={{ textDecoration: 'line-through' }}>{won(subtotal)}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 13, color: '#F0568C', fontWeight: 800 }}><span>번들 할인 (제휴 {partnerCount}곳 · {r}%)</span><span>−{won(discountRawN)}</span></div>
                  <div style={{ height: 1, background: '#F2F0F5', margin: '9px 0' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 15, fontWeight: 800, color: '#16170F' }}>최종 결제 금액</span>
                    <span style={{ fontSize: 22, fontWeight: 800, color: '#16170F', letterSpacing: '-.5px' }}>{won(finalN)}</span>
                  </div>
                </div>
                {/* payment method */}
                <div style={{ background: '#fff', borderRadius: 22, padding: '16px 18px', boxShadow: '0 12px 28px -18px rgba(0,0,0,.25)' }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#16170F', marginBottom: 12 }}>결제 수단</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {['카카오페이','네이버페이','신용/체크카드'].map((label, i) => (
                      <div key={i} onClick={() => setPayIdx(i)} style={{ flex: 1, textAlign: 'center', padding: '13px 4px', borderRadius: 13, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', background: payIdx === i ? '#16170F' : '#F4F2F7', color: payIdx === i ? '#fff' : '#9A96A0', transition: 'all .15s' }}>{label}</div>
                    ))}
                  </div>
                </div>
              </div>
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '14px 16px 26px', background: 'linear-gradient(to top,#DEEBFF 70%,rgba(222,235,255,0))' }}>
                <button onClick={() => { setPlanStage('complete'); setConfirmed(true); }} style={{ width: '100%', background: '#FF5C97', color: '#fff', border: 'none', borderRadius: 18, padding: 17, fontWeight: 800, fontSize: 16, cursor: 'pointer', boxShadow: '0 14px 30px -12px rgba(240,86,140,.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>{won(finalN)} 결제하고 예약</button>
              </div>
            </div>
          )}

          {/* ══ COMPLETE ══════════════════════════════════════════ */}
          {isComplete && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 26px', textAlign: 'center' }}>
              <div style={{ position: 'relative', width: 96, height: 96, marginBottom: 24 }}>
                <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#FF8FB8', animation: 'omRing 1.6s ease-out infinite' }} />
                <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#FF5C97', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 16px 34px -10px rgba(240,86,140,.6)', animation: 'omPop .4s ease-out' }}>
                  <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 6"/></svg>
                </span>
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#16170F', letterSpacing: '-.5px' }}>예약이 확정됐어요</div>
              <div style={{ fontSize: 14, color: '#9A96A0', fontWeight: 700, marginTop: 8, lineHeight: 1.5 }}>{region} 데이트 코스 {partnerCount}곳이<br/>{date} 일정으로 저장됐어요</div>
              <div style={{ width: '100%', background: '#fff', borderRadius: 22, padding: '16px 18px', boxShadow: '0 16px 36px -20px rgba(0,0,0,.3)', marginTop: 26 }}>
                {sorted.map((it, idx) => (
                  <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '6px 0' }}>
                    <div style={{ width: 26, height: 26, borderRadius: 8, background: KIND[it.kind].num, color: KIND[it.kind].numText, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12, flexShrink: 0 }}>{idx+1}</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#16170F', width: 42, textAlign: 'left' }}>{fmt(it.start)}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#16170F', flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{placeName(it)}</div>
                  </div>
                ))}
              </div>
              <button onClick={() => setReviewOpen(true)} style={{ width: '100%', marginTop: 18, background: '#FF5C97', color: '#fff', border: 'none', borderRadius: 16, padding: 16, fontWeight: 800, fontSize: 15, cursor: 'pointer', boxShadow: '0 12px 26px -12px rgba(240,86,140,.6)' }}>후기 쓰고 5% 추가 할인 받기</button>
              <button onClick={() => { setTab('home'); setPlanStage('build'); }} style={{ width: '100%', marginTop: 10, background: 'none', color: '#9A96A0', border: 'none', padding: 10, fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>홈으로 돌아가기</button>
            </div>
          )}

          {/* ══ CALENDAR ══════════════════════════════════════════ */}
          {tab === 'calendar' && (
            <div style={{ position: 'absolute', inset: 0, padding: '58px 18px 96px', overflowY: 'auto' }}>
              <div style={{ textAlign: 'center', fontSize: 20, fontWeight: 800, color: '#16170F', letterSpacing: '-.5px', marginBottom: 16 }}>캘린더</div>
              <div style={{ background: '#fff', borderRadius: 24, padding: '18px 16px', boxShadow: '0 14px 32px -20px rgba(0,0,0,.25)', marginBottom: 18 }}>
                <div style={{ textAlign: 'center', fontWeight: 800, fontSize: 16, color: '#16170F', marginBottom: 14 }}>2026년 6월</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', marginBottom: 6 }}>
                  {['일','월','화','수','목','금','토'].map((d, i) => (
                    <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: i === 0 ? 800 : 700, color: i === 0 ? '#E5728F' : i === 6 ? '#7E96C4' : '#B5B0BC' }}>{d}</div>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', rowGap: 4 }}>
                  {(() => {
                    const first = new Date(2026, 5, 1).getDay();
                    const cells = [];
                    for (let i = 0; i < first; i++) cells.push(<div key={`e${i}`} />);
                    for (let d = 1; d <= 30; d++) {
                      const isToday = d === 14;
                      cells.push(<div key={d} style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto', borderRadius: 11, fontSize: 14, fontWeight: isToday ? 800 : 600, background: isToday ? '#FF5C97' : 'transparent', color: isToday ? '#fff' : '#16170F' }}>{d}</div>);
                    }
                    return cells;
                  })()}
                </div>
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#16170F', marginBottom: 11 }}>예정된 데이트</div>
              <div onClick={() => { setTab('plan'); setPlanStage('final'); }} style={{ display: 'flex', alignItems: 'center', gap: 13, background: '#fff', borderRadius: 18, padding: 15, boxShadow: '0 10px 26px -18px rgba(0,0,0,.25)', cursor: 'pointer' }}>
                <div style={{ width: 48, height: 48, borderRadius: 14, background: '#FF5C97', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <div style={{ fontSize: 9, fontWeight: 800, color: '#fff', opacity: .85 }}>JUN</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#fff', lineHeight: 1 }}>14</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 800, color: '#16170F' }}>{region} {partnerCount}곳 코스</div>
                  <div style={{ fontSize: 12, color: '#9A96A0', fontWeight: 700 }}>18:00 시작 · {won(discountRawN)} 할인</div>
                </div>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#CFC9D6" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6"/></svg>
              </div>
            </div>
          )}

          {/* ══ MYPAGE ════════════════════════════════════════════ */}
          {tab === 'mypage' && (
            <div style={{ position: 'absolute', inset: 0, padding: '58px 18px 96px', overflowY: 'auto' }}>
              <div style={{ textAlign: 'center', fontSize: 20, fontWeight: 800, color: '#16170F', letterSpacing: '-.5px', marginBottom: 16 }}>마이페이지</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, background: '#fff', borderRadius: 24, padding: 18, boxShadow: '0 14px 32px -20px rgba(0,0,0,.25)', marginBottom: 14 }}>
                <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'linear-gradient(135deg,#FF8FB8,#FF5C97)', flexShrink: 0, boxShadow: '0 0 0 5px #FFE2EC' }} />
                <div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: '#16170F' }}>{COUPLE_NAME}</div>
                  <div style={{ fontSize: 12.5, color: '#9A96A0', fontWeight: 700 }}>D+412 · 함께한 지 1년 1개월</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 11, marginBottom: 16 }}>
                <div style={{ flex: 1, background: '#fff', borderRadius: 20, padding: 16, boxShadow: '0 10px 26px -20px rgba(0,0,0,.22)' }}>
                  <div style={{ color: '#9A96A0', fontSize: 11.5, fontWeight: 800 }}>함께한 코스</div>
                  <div style={{ color: '#16170F', fontSize: 25, fontWeight: 800 }}>12</div>
                </div>
                <div style={{ flex: 1, background: 'linear-gradient(135deg,#FF8FB8,#F0568C)', borderRadius: 20, padding: 16, boxShadow: '0 10px 26px -16px rgba(240,86,140,.5)' }}>
                  <div style={{ color: '#fff', opacity: .9, fontSize: 11.5, fontWeight: 800 }}>번들로 아낀 금액</div>
                  <div style={{ color: '#fff', fontSize: 23, fontWeight: 800, letterSpacing: '-.5px' }}>82,000원</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, background: '#16170F', borderRadius: 18, padding: '15px 16px', marginBottom: 16 }}>
                <span style={{ width: 38, height: 38, borderRadius: 12, background: 'rgba(255,143,184,.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#FF8FB8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2.6 6.6L22 9.3l-5 4.9 1.2 7-6.2-3.3L5.8 21l1.2-7-5-4.9 7.4-.7Z"/></svg>
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: '#fff' }}>원모어 크루</div>
                  <div style={{ fontSize: 11.5, color: '#9A96A0', fontWeight: 700 }}>코스 후기 작성하고 추가 할인 받기</div>
                </div>
                <span style={{ background: '#FF8FB8', color: '#16170F', fontSize: 11, fontWeight: 800, padding: '5px 10px', borderRadius: 9 }}>+5%</span>
              </div>
              <div style={{ background: '#fff', borderRadius: 20, overflow: 'hidden', boxShadow: '0 10px 26px -20px rgba(0,0,0,.2)' }}>
                {[{label:'저장한 코스',dot:'#8E97F2'},{label:'결제수단 · 번들 혜택',dot:'#5FC98C'},{label:'후기 · 크루 활동',dot:'#F4A65C'},{label:'알림 설정',dot:'#B5B0BC'}].map((m, i, arr) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 16, borderBottom: i < arr.length-1 ? '1px solid #F4F2F7' : 'none' }}>
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: m.dot, display: 'block' }} />
                    <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: '#16170F' }}>{m.label}</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#CFC9D6" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6"/></svg>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ══ BOTTOM NAV ════════════════════════════════════════ */}
          {showNav && (
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 84, background: 'rgba(255,255,255,.92)', backdropFilter: 'blur(14px)', borderTop: '1px solid rgba(0,0,0,.04)', display: 'flex', alignItems: 'flex-start', padding: '10px 14px 0', zIndex: 55 }}>
              {(['home','plan','calendar','mypage'] as const).map(key => {
                const active = tab === key;
                const c = active ? '#F0568C' : '#BBB6C2';
                const bg = active ? '#FFD9E6' : 'transparent';
                const labels: Record<string, string> = { home:'홈', plan:'계획', calendar:'캘린더', mypage:'마이' };
                return (
                  <button key={key} onClick={() => setTab(key)} style={{ flex: 1, background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: 'pointer', padding: 0 }}>
                    <div style={{ width: 46, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 12, background: bg }}>
                      {key === 'home'     && <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>}
                      {key === 'plan'     && <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h11M8 12h11M8 18h11"/><circle cx="4" cy="6" r="1.4"/><circle cx="4" cy="12" r="1.4"/><circle cx="4" cy="18" r="1.4"/></svg>}
                      {key === 'calendar' && <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="5" width="17" height="16" rx="2.5"/><path d="M3.5 9.5h17M8 3.5v3M16 3.5v3"/></svg>}
                      {key === 'mypage'   && <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="3.6"/><path d="M5 20c1.5-4 12.5-4 14 0"/></svg>}
                    </div>
                    <span style={{ fontSize: 10.5, fontWeight: 800, color: c }}>{labels[key]}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* home indicator */}
          <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', width: 130, height: 5, borderRadius: 3, background: '#16170F', opacity: .85, zIndex: 56 }} />

          {/* ══ PLACE SEARCH SHEET ════════════════════════════════ */}
          {showSearch && (
            <>
              <div onClick={() => { setShowSearch(false); setSearchInput(''); setSearchSuggestions([]); }} style={{ position: 'absolute', inset: 0, background: 'rgba(30,14,22,.42)', zIndex: 80 }} />
              <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: '#FBF7F9', borderRadius: '30px 30px 0 0', zIndex: 81, padding: '12px 18px 26px', maxHeight: '74%', display: 'flex', flexDirection: 'column', animation: 'omUp .28s ease' }}>
                <div style={{ width: 42, height: 5, borderRadius: 3, background: '#E2DCE5', margin: '2px auto 16px' }} />
                <div style={{ fontSize: 19, fontWeight: 800, color: '#16170F', marginBottom: 13 }}>어디서 만날까요?</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: '#fff', borderRadius: 15, padding: '13px 14px', marginBottom: 14, border: '1px solid rgba(0,0,0,.05)' }}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#B5B0BC" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>
                  <input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="지역 검색 (예: 강남, 을지로3가)" style={{ flex: 1, border: 'none', outline: 'none', fontSize: 14, color: '#16170F', fontWeight: 700, background: 'transparent' }} />
                </div>
                <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {displayRegions.map(reg => (
                    <div key={reg.name} onClick={() => pickRegion(reg.name)} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff', borderRadius: 16, padding: '14px 15px', cursor: 'pointer', border: reg.selected ? '1.5px solid #FF5C97' : '1px solid rgba(0,0,0,.04)' }}>
                      <div style={{ width: 40, height: 40, borderRadius: 13, background: reg.selected ? '#FF5C97' : '#F1EFF4', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={reg.selected ? '#fff' : '#B5B0BC'} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 15, fontWeight: 800, color: '#16170F' }}>{reg.name}</div>
                        <div style={{ fontSize: 12, color: '#9A96A0', fontWeight: 700 }}>{reg.sub}</div>
                      </div>
                      {reg.selected && (
                        <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#FF5C97', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 6"/></svg>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ══ CATEGORY PICKER SHEET ═════════════════════════════ */}
          {catPickerId && (() => {
            const it = items.find(i => i.id === catPickerId);
            if (!it) return null;
            const k = KIND[it.kind];
            return (
              <>
                <div onClick={() => setCatPickerId(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(30,14,22,.42)', zIndex: 82 }} />
                <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: k.sheet, borderRadius: '30px 30px 0 0', zIndex: 83, padding: '12px 18px 30px', animation: 'omUp .28s ease' }}>
                  <div style={{ width: 42, height: 5, borderRadius: 3, background: '#E2DCE5', margin: '2px auto 16px' }} />
                  <div style={{ fontSize: 19, fontWeight: 800, color: '#16170F', marginBottom: 4 }}>종류 선택</div>
                  <div style={{ fontSize: 12.5, color: '#9A96A0', fontWeight: 700, marginBottom: 18 }}>{k.label} — 어떤 분위기로 갈까요?</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {CAT[it.kind].map(cat => {
                      const selected = it.category === cat;
                      return (
                        <div key={cat} onClick={() => { setItems(prev => prev.map(i => i.id === catPickerId ? { ...i, category: cat, placeIdx: 0 } : i)); setCatPickerId(null); }} style={{ padding: '13px 20px', borderRadius: 30, fontSize: 15, fontWeight: 800, cursor: 'pointer', background: selected ? '#16170F' : '#fff', color: selected ? '#fff' : '#16170F', boxShadow: '0 8px 18px -12px rgba(0,0,0,.25)' }}>
                          {cat}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            );
          })()}

          {/* ══ PLACE SWAP SHEET ══════════════════════════════════ */}
          {placePickerId && swapItem && (() => {
            const discountPct = rateFor(Math.max(1, partnerCount));

            const walkLabel = (lat?: number, lng?: number) => {
              if (!lat || !lng) return null;
              const coord = { lat, lng };
              const toPrev = (swapPrevItem?.lat && swapPrevItem?.lng)
                ? approxWalkMins({ lat: swapPrevItem.lat, lng: swapPrevItem.lng }, coord) : null;
              const toNext = (swapNextItem?.lat && swapNextItem?.lng)
                ? approxWalkMins(coord, { lat: swapNextItem.lat, lng: swapNextItem.lng }) : null;
              if (toPrev !== null && toNext !== null) return `도보 ${toPrev}분 · ${toNext}분`;
              if (toPrev !== null) return `이전 도보 ${toPrev}분`;
              if (toNext !== null) return `다음 도보 ${toNext}분`;
              return null;
            };

            const apiAlts = swapCandidates.filter(c =>
              c.placeId !== swapItem.placeId && c.name !== swapItem.placeName
            );
            const mockAlts = MOCK_NON_PARTNER[swapItem.kind] ?? [];

            const selectPlace = (opts: Partial<TimelineItem>) => {
              setItems(prev => prev.map(i => i.id === placePickerId ? { ...i, ...opts } : i));
              setPlacePickerId(null);
            };

            const SwapCard = ({ name, partner, rating, lat, lng, placeId, selected, onSelect }: {
              name: string; partner: boolean; rating: number;
              lat?: number; lng?: number; placeId?: string;
              selected: boolean; onSelect: () => void;
            }) => {
              const wl = walkLabel(lat, lng);
              return (
                <div onClick={onSelect} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff', borderRadius: 16, padding: '13px 15px', cursor: 'pointer', border: selected ? '1.5px solid #FF5C97' : '1px solid rgba(0,0,0,.05)', boxShadow: selected ? '0 8px 24px -12px rgba(240,86,140,.25)' : '0 4px 14px -10px rgba(0,0,0,.18)', marginBottom: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ fontSize: 15, fontWeight: 800, color: '#16170F', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                      <span style={{ fontSize: 10.5, fontWeight: 800, flexShrink: 0, padding: '2px 7px', borderRadius: 7, ...(partner ? { color: '#fff', background: '#FF5C97' } : { color: '#A7A2B0', background: '#EFEDF2' }) }}>{partner ? '제휴' : '비제휴'}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
                      <span style={{ color: '#FFB02E', fontSize: 11 }}>★</span>
                      <span style={{ fontSize: 11.5, color: '#9A96A0', fontWeight: 700 }}>{rating.toFixed(1)} · {region}</span>
                      {wl && <><span style={{ color: '#DDD8E3', fontSize: 10 }}>·</span><span style={{ fontSize: 11, color: '#B5B0BC', fontWeight: 700 }}>{wl}</span></>}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 56 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: partner ? '#F0568C' : '#B5B0BC' }}>{partner ? `−${discountPct}%` : '할인 없음'}</div>
                    {selected && <div style={{ fontSize: 10.5, color: '#F0568C', fontWeight: 800, marginTop: 2 }}>선택됨</div>}
                  </div>
                </div>
              );
            };

            return (
              <>
                <div onClick={() => setPlacePickerId(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(30,14,22,.42)', zIndex: 84 }} />
                <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: '#FBF7F9', borderRadius: '30px 30px 0 0', zIndex: 85, padding: '12px 18px 30px', maxHeight: '80%', display: 'flex', flexDirection: 'column', animation: 'omUp .28s ease' }}>
                  <div style={{ width: 42, height: 5, borderRadius: 3, background: '#E2DCE5', margin: '2px auto 16px' }} />
                  <div style={{ fontSize: 19, fontWeight: 800, color: '#16170F', marginBottom: 3 }}>{placePickerCat} 다른 곳</div>
                  <div style={{ fontSize: 12.5, color: '#9A96A0', fontWeight: 700, marginBottom: 10 }}>제휴 매장을 고르면 번들 할인이 유지돼요</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#FFF0F5', borderRadius: 13, padding: '10px 13px', marginBottom: 14, flexShrink: 0 }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#F0568C" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v5M12 16h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>
                    <span style={{ fontSize: 11.5, color: '#C44E7E', fontWeight: 700 }}>비제휴 매장을 고르면 그 장소는 할인에서 빠져요</span>
                  </div>
                  <div style={{ overflowY: 'auto', flex: 1 }}>
                    {/* 현재 선택 — 상단 고정 */}
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#B5B0BC', marginBottom: 6, letterSpacing: '.3px' }}>현재 선택</div>
                    <SwapCard
                      name={placeName(swapItem)} partner={isPartner(swapItem)}
                      rating={swapItem.placeRating ?? 4.0}
                      lat={swapItem.lat} lng={swapItem.lng} placeId={swapItem.placeId}
                      selected={true} onSelect={() => setPlacePickerId(null)}
                    />
                    {/* 근처 제휴 매장 */}
                    {apiAlts.length > 0 && <div style={{ fontSize: 11, fontWeight: 800, color: '#B5B0BC', margin: '10px 0 6px', letterSpacing: '.3px' }}>근처 제휴 매장</div>}
                    {apiAlts.map(c => (
                      <SwapCard key={c.placeId} name={c.name} partner={true} rating={c.rating}
                        lat={c.lat} lng={c.lng} placeId={c.placeId} selected={false}
                        onSelect={() => selectPlace({ placeName: c.name, placeId: c.placeId, lat: c.lat, lng: c.lng, placeRating: c.rating, isPartner: true })}
                      />
                    ))}
                    {/* 비제휴 목업 */}
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#B5B0BC', margin: '10px 0 6px', letterSpacing: '.3px' }}>비제휴 매장 (할인 제외)</div>
                    {mockAlts.map(m => (
                      <SwapCard key={m.name} name={m.name} partner={false} rating={m.rating}
                        selected={swapItem.placeName === m.name && swapItem.isPartner === false}
                        onSelect={() => selectPlace({ placeName: m.name, placeId: undefined, lat: undefined, lng: undefined, placeRating: m.rating, isPartner: false })}
                      />
                    ))}
                  </div>
                </div>
              </>
            );
          })()}

          {/* ══ REVIEW SCREEN ═════════════════════════════════════ */}
          {reviewOpen && (
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,#FFE6EF 0%,#F4EEF6 50%,#E4EDFA 100%)', zIndex: 90, display: 'flex', flexDirection: 'column', paddingTop: 56 }}>
              <div style={{ padding: '6px 18px 10px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <button onClick={() => setReviewOpen(false)} style={{ width: 42, height: 42, borderRadius: 14, border: 'none', background: '#fff', boxShadow: '0 6px 16px -10px rgba(0,0,0,.3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16170F" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
                </button>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#16170F', letterSpacing: '-.5px' }}>코스 후기</div>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '6px 18px 26px' }}>
                <div style={{ background: '#fff', borderRadius: 20, padding: '16px 18px', boxShadow: '0 12px 28px -18px rgba(0,0,0,.25)', marginBottom: 16 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#16170F' }}>{region} 데이트 코스</div>
                  <div style={{ fontSize: 12.5, color: '#9A96A0', fontWeight: 700, marginTop: 3 }}>{sorted.map(it => placeName(it)).join(' → ')}</div>
                </div>
                <div style={{ textAlign: 'center', marginBottom: 18 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#16170F', marginBottom: 10 }}>이번 코스는 어땠나요?</div>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
                    {[1,2,3,4,5].map(i => (
                      <button key={i} onClick={() => setRating(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 36, lineHeight: 1, color: i <= rating ? '#FFB02E' : '#E6DEE6' }}>★</button>
                    ))}
                  </div>
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: '#16170F', marginBottom: 9 }}>사진 추가</div>
                <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
                  {photos.map((filled, i) => (
                    <div key={i} onClick={() => setPhotos(prev => { const p = [...prev]; p[i] = !p[i]; return p; })} style={{ width: 72, height: 72, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: filled ? 'linear-gradient(135deg,#FF8FB8,#F0568C)' : '#fff', border: filled ? 'none' : '1.5px dashed #E4B9CC', boxShadow: '0 8px 18px -16px rgba(0,0,0,.2)' }}>
                      {!filled
                        ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#C7A4B6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                        : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="8.5" cy="7.5" r="1.8"/></svg>
                      }
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: '#16170F', marginBottom: 9 }}>한마디</div>
                <textarea placeholder="우리만의 코스를 자랑해 주세요! '성수 비 오는 날 실내 데이트' 처럼 적으면 다른 커플에게 도움이 돼요." style={{ width: '100%', height: 96, border: '1px solid rgba(0,0,0,.07)', borderRadius: 16, padding: 14, fontSize: 13.5, fontFamily: 'inherit', fontWeight: 600, color: '#16170F', background: '#fff', resize: 'none', outline: 'none', lineHeight: 1.5, boxShadow: '0 8px 20px -16px rgba(0,0,0,.2)' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 11, background: '#16170F', borderRadius: 16, padding: '14px 16px', marginTop: 16 }}>
                  <span style={{ width: 38, height: 38, borderRadius: 12, background: 'rgba(255,143,184,.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#FF8FB8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2.6 6.6L22 9.3l-5 4.9 1.2 7-6.2-3.3L5.8 21l1.2-7-5-4.9 7.4-.7Z"/></svg>
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 800, color: '#fff' }}>후기 작성 혜택</div>
                    <div style={{ fontSize: 11.5, color: '#9A96A0', fontWeight: 700 }}>SNS에 공유하면 다음 코스 5% 추가 할인</div>
                  </div>
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: '#16170F', margin: '18px 0 9px' }}>함께 공유하기</div>
                <div style={{ display: 'flex', gap: 9 }}>
                  {[['인스타','IG','linear-gradient(135deg,#F58529,#DD2A7B,#8134AF)','#fff'],['블로그','B','#03C75A','#fff'],['플레이스','N','#03C75A','#fff'],['카카오','K','#FEE500','#3C1E1E']].map(([label, icon, bg, fg]) => (
                    <div key={label} onClick={() => flash(`${label}에 공유했어요`)} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, background: '#fff', borderRadius: 16, padding: '13px 6px', boxShadow: '0 8px 20px -16px rgba(0,0,0,.2)', cursor: 'pointer', border: '1px solid rgba(0,0,0,.04)' }}>
                      <span style={{ width: 34, height: 34, borderRadius: 11, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 800, color: fg }}>{icon}</span>
                      <span style={{ fontSize: 11, fontWeight: 800, color: '#16170F' }}>{label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ padding: '12px 18px 26px', background: 'linear-gradient(to top,#E4EDFA 70%,rgba(228,237,250,0))' }}>
                <button onClick={() => { setReviewOpen(false); setTab('home'); setPlanStage('build'); flash('후기가 등록됐어요 · 다음 코스 5% 할인'); }} style={{ width: '100%', background: '#FF5C97', color: '#fff', border: 'none', borderRadius: 18, padding: 17, fontWeight: 800, fontSize: 16, cursor: 'pointer', boxShadow: '0 14px 30px -12px rgba(240,86,140,.65)' }}>후기 등록하고 혜택 받기</button>
              </div>
            </div>
          )}

          {/* ══ TOAST ═════════════════════════════════════════════ */}
          {toast && (
            <div style={{ position: 'absolute', left: '50%', bottom: 108, transform: 'translateX(-50%)', background: '#16170F', color: '#fff', fontSize: 13, fontWeight: 800, padding: '11px 18px', borderRadius: 14, zIndex: 95, whiteSpace: 'nowrap', boxShadow: '0 14px 30px -12px rgba(0,0,0,.5)', animation: 'omUp .25s ease' }}>{toast}</div>
          )}

        </div>
      </div>
    </div>
  );
}
