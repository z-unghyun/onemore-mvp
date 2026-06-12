'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { HOURH, START, HOURS, DATES, WALKS, CAT, NAMES, KIND, PRICE, INITIAL_ITEMS, COUPLE_NAME, REGIONS } from '@/lib/constants';
import type { TimelineItem } from '@/lib/types';
import { autocompleteRegion, nearbySearch } from '@/lib/places';
import type { RegionSuggestion, PlaceCandidate } from '@/lib/places';

// ─── Helpers ────────────────────────────────────────────────────────────────
function fmtTime(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h}:${min.toString().padStart(2, '0')}`;
}

function getPlaceName(item: TimelineItem, region: string): string {
  if (item.placeName) return item.placeName;
  const list = NAMES[item.category || ''];
  if (list) return list[item.placeIdx % 3];
  return '장소';
}

function getAddress(item: TimelineItem, region: string): string {
  return `${region} 어딘가 · 도보 5분`;
}

function discount(n: number): number {
  return [0, 5, 10, 15, 20][Math.min(n, 4)];
}

// ─── Main App ────────────────────────────────────────────────────────────────
export default function App() {
  const [mapPan, setMapPan] = useState({ x: 0, y: 0 });
  const [tab, setTab] = useState<'home' | 'plan' | 'calendar' | 'mypage'>('home');
  const [planStage, setPlanStage] = useState<'build' | 'final' | 'checkout' | 'complete'>('build');
  const [region, setRegion] = useState('강남');
  const [dateIdx, setDateIdx] = useState(0);
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
  const [searchInput, setSearchInput] = useState('');
  const [suggestions, setSuggestions] = useState<RegionSuggestion[]>([]);
  const [candidates, setCandidates] = useState<PlaceCandidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);

  const dragRef = useRef<{ type: 'move' | 'resize'; id: number; startY: number; origStart: number; origEnd: number; moved: number } | null>(null);
  const mapDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const totalOriginal = () => items.reduce((s, i) => s + (PRICE[i.kind] || 0), 0);
  const totalDiscount_ = () => Math.round(totalOriginal() * discount(items.length) / 100);
  const totalFinal = () => totalOriginal() - totalDiscount_();

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2000);
  }, []);

  // ── Map pan handlers ─────────────────────────────────────────────────────
  const onMapPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    mapDragRef.current = { startX: e.clientX, startY: e.clientY, origX: mapPan.x, origY: mapPan.y };
  };
  const onMapPointerMove = (e: React.PointerEvent) => {
    if (!mapDragRef.current) return;
    const dx = e.clientX - mapDragRef.current.startX;
    const dy = e.clientY - mapDragRef.current.startY;
    setMapPan({
      x: Math.max(-160, Math.min(160, mapDragRef.current.origX + dx)),
      y: Math.max(-160, Math.min(160, mapDragRef.current.origY + dy)),
    });
  };
  const onMapPointerUp = () => { mapDragRef.current = null; };

  // ── Timeline drag handlers ───────────────────────────────────────────────
  const onTimelinePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const ref = dragRef.current;
    const dy = e.clientY - ref.startY;
    ref.moved = Math.abs(dy);
    const snap = HOURH / 4; // 15 min
    const deltaMin = Math.round(dy / snap) * 15;
    setItems(prev => prev.map(it => {
      if (it.id !== ref.id) return it;
      if (ref.type === 'move') {
        const dur = ref.origEnd - ref.origStart;
        const newStart = Math.max(START, Math.min(1380, ref.origStart + deltaMin));
        return { ...it, start: newStart, end: newStart + dur };
      } else {
        const newEnd = Math.max(ref.origStart + 30, Math.min(1500, ref.origEnd + deltaMin));
        return { ...it, end: newEnd };
      }
    }));
  };
  const onTimelinePointerUp = () => { dragRef.current = null; };

  // ── Add item ─────────────────────────────────────────────────────────────
  const addItem = (kind: '식사' | '카페' | '놀거리') => {
    const dur = kind === '놀거리' ? 120 : 90;
    let start = START;
    const sorted = [...items].sort((a, b) => a.end - b.end);
    for (const it of sorted) {
      if (it.end + 15 + dur <= 1500) start = it.end + 15;
    }
    const cat = CAT[kind][0];
    setItems(prev => [...prev, {
      id: Date.now(),
      kind,
      category: cat,
      start,
      end: start + dur,
      placeIdx: 0,
    }]);
  };

  const deleteItem = (id: number) => setItems(prev => prev.filter(i => i.id !== id));

  // ── Region search ─────────────────────────────────────────────────────────
  const onSearchChange = (val: string) => {
    setSearchInput(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      if (val.length > 0) {
        const res = await autocompleteRegion(val);
        setSuggestions(res);
      } else {
        setSuggestions([]);
      }
    }, 300);
  };

  // ── Place swap ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (placePickerId !== null) {
      setLoadingCandidates(true);
      setCandidates([]);
      const item = items.find(i => i.id === placePickerId);
      if (item && item.lat && item.lng) {
        nearbySearch(item.lat, item.lng, item.kind, item.category || '').then(res => {
          setCandidates(res);
          setLoadingCandidates(false);
        });
      } else {
        // Fallback to static
        const list = NAMES[item?.category || ''] || [];
        setCandidates(list.map((name, i) => ({
          placeId: `static-${i}`,
          name,
          rating: 4.0 + Math.random() * 0.9,
          lat: 0,
          lng: 0,
          isPartner: i < 2,
        })));
        setLoadingCandidates(false);
      }
    }
  }, [placePickerId]);

  // ── Styles ────────────────────────────────────────────────────────────────
  const phone: React.CSSProperties = {
    position: 'relative', width: 390, height: 844, borderRadius: 40,
    background: 'linear-gradient(180deg, #FFE0EB 0%, #DCEBFF 100%)',
    border: '2px solid #000', overflow: 'hidden',
    boxShadow: '0 32px 64px rgba(0,0,0,0.28)',
  };

  const scrollArea: React.CSSProperties = {
    position: 'absolute', top: 44, left: 0, right: 0, bottom: 72, overflowY: 'auto',
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#EDE7EC' }}>
      <div style={phone}>
        {/* Status Bar */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', zIndex: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>9:41</span>
          <span style={{ fontSize: 12, letterSpacing: 2 }}>●●●</span>
        </div>

        {/* Scrollable Content */}
        <div style={scrollArea}>
          {tab === 'home' && <HomeScreen items={items} region={region} confirmed={confirmed} mapPan={mapPan} onMapPointerDown={onMapPointerDown} onMapPointerMove={onMapPointerMove} onMapPointerUp={onMapPointerUp} onReview={() => setReviewOpen(true)} onPlan={() => { setTab('plan'); setPlanStage('build'); }} dateIdx={dateIdx} />}
          {tab === 'plan' && planStage === 'build' && (
            <PlanBuildScreen
              items={items} region={region} dateIdx={dateIdx}
              onSetDateIdx={setDateIdx}
              onDelete={deleteItem}
              onAdd={addItem}
              onCatPick={setCatPickerId}
              onNext={() => setPlanStage('final')}
              dragRef={dragRef}
              onTimelinePointerMove={onTimelinePointerMove}
              onTimelinePointerUp={onTimelinePointerUp}
              onRegionClick={() => setShowSearch(true)}
            />
          )}
          {tab === 'plan' && planStage === 'final' && (
            <PlanFinalScreen
              items={items} region={region} dateIdx={dateIdx}
              totalOriginal={totalOriginal()} totalDiscount={totalDiscount_()} totalFinal={totalFinal()}
              discountPct={discount(items.length)}
              onBack={() => setPlanStage('build')}
              onPlacePick={setPlacePickerId}
              onConfirm={() => { setConfirmed(true); setTab('home'); showToast('예약이 확정됐어요! 🎉'); }}
              getPlaceName={(i) => getPlaceName(i, region)}
              getAddress={(i) => getAddress(i, region)}
            />
          )}
          {tab === 'plan' && planStage === 'checkout' && (
            <CheckoutScreen
              items={items} payIdx={payIdx} setPayIdx={setPayIdx}
              totalOriginal={totalOriginal()} totalDiscount={totalDiscount_()} totalFinal={totalFinal()}
              discountPct={discount(items.length)}
              onBack={() => setPlanStage('final')}
              onPay={() => { setPlanStage('complete'); setConfirmed(true); }}
              getPlaceName={(i) => getPlaceName(i, region)}
            />
          )}
          {tab === 'plan' && planStage === 'complete' && (
            <CompleteScreen
              items={items}
              onHome={() => { setTab('home'); setPlanStage('build'); }}
              onReview={() => setReviewOpen(true)}
              getPlaceName={(i) => getPlaceName(i, region)}
            />
          )}
          {tab === 'calendar' && <CalendarScreen dateIdx={dateIdx} setDateIdx={setDateIdx} region={region} />}
          {tab === 'mypage' && <MyPageScreen />}
        </div>

        {/* Bottom Nav */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 72, background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(12px)', borderTop: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', zIndex: 20 }}>
          {([['home','홈','🏠'],['plan','계획','📋'],['calendar','캘린더','📅'],['mypage','마이','👤']] as const).map(([t, label, icon]) => (
            <button key={t} onClick={() => setTab(t)} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, background: 'none', border: 'none', cursor: 'pointer', color: tab === t ? '#FF5C97' : '#9A96A0' }}>
              <span style={{ fontSize: 22 }}>{icon}</span>
              <span style={{ fontSize: 12, fontWeight: tab === t ? 600 : 400 }}>{label}</span>
            </button>
          ))}
        </div>

        {/* Home indicator */}
        <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', width: 134, height: 5, background: 'rgba(0,0,0,0.2)', borderRadius: 3 }} />

        {/* Sheets */}
        {showSearch && (
          <PlaceSearchSheet
            input={searchInput} suggestions={suggestions} onInputChange={onSearchChange}
            onSelect={(r) => { setRegion(r); setShowSearch(false); setSearchInput(''); setSuggestions([]); }}
            onClose={() => { setShowSearch(false); setSearchInput(''); setSuggestions([]); }}
          />
        )}
        {catPickerId !== null && (() => {
          const item = items.find(i => i.id === catPickerId);
          if (!item) return null;
          return (
            <CategoryPickerSheet
              item={item}
              onSelect={(cat) => {
                setItems(prev => prev.map(i => i.id === catPickerId ? { ...i, category: cat, placeIdx: 0 } : i));
                setCatPickerId(null);
              }}
              onClose={() => setCatPickerId(null)}
            />
          );
        })()}
        {placePickerId !== null && (() => {
          const item = items.find(i => i.id === placePickerId);
          if (!item) return null;
          return (
            <PlaceSwapSheet
              item={item} candidates={candidates} loading={loadingCandidates}
              onSelect={(c) => {
                setItems(prev => prev.map(i => i.id === placePickerId ? { ...i, placeName: c.name, placeId: c.placeId, lat: c.lat, lng: c.lng, placeRating: c.rating, photoRef: c.photoRef, isPartner: c.isPartner } : i));
                setPlacePickerId(null);
              }}
              onClose={() => setPlacePickerId(null)}
            />
          );
        })()}
        {reviewOpen && (
          <ReviewScreen
            items={items} rating={rating} setRating={setRating} photos={photos} setPhotos={setPhotos}
            onClose={() => setReviewOpen(false)}
            onSubmit={() => { setReviewOpen(false); showToast('후기가 등록됐어요!'); }}
            getPlaceName={(i) => getPlaceName(i, region)}
          />
        )}

        {/* Toast */}
        {toast && (
          <div style={{ position: 'absolute', bottom: 88, left: '50%', transform: 'translateX(-50%)', background: 'rgba(22,23,15,0.85)', color: 'white', padding: '10px 20px', borderRadius: 20, fontSize: 13, whiteSpace: 'nowrap', animation: 'omUp 0.2s ease', zIndex: 100 }}>
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// HomeScreen
// ═══════════════════════════════════════════════════════════════════════════════
interface HomeProps {
  items: TimelineItem[];
  region: string;
  confirmed: boolean;
  mapPan: { x: number; y: number };
  onMapPointerDown: (e: React.PointerEvent) => void;
  onMapPointerMove: (e: React.PointerEvent) => void;
  onMapPointerUp: () => void;
  onReview: () => void;
  onPlan: () => void;
  dateIdx: number;
}

function HomeScreen({ items, region, confirmed, mapPan, onMapPointerDown, onMapPointerMove, onMapPointerUp, onReview, onPlan, dateIdx }: HomeProps) {
  const pins: [number, number][] = [[80, 380], [160, 300], [240, 240], [320, 200], [400, 280]];
  const walkMids: [number, number][] = [[120, 340], [200, 270], [280, 220], [360, 240], [420, 240]];
  const allItems: TimelineItem[] = [
    ...items,
    { id: -1, kind: '식사' as const, category: '한식', start: 0, end: 0, placeIdx: 0 },
    { id: -2, kind: '카페' as const, category: '디저트', start: 0, end: 0, placeIdx: 0 },
  ].slice(0, 5);

  return (
    <div style={{ position: 'relative' }}>
      {/* Map */}
      <div
        style={{ height: 480, background: '#E7E9EE', overflow: 'hidden', position: 'relative', cursor: 'grab', touchAction: 'none' }}
        onPointerDown={onMapPointerDown} onPointerMove={onMapPointerMove} onPointerUp={onMapPointerUp}
      >
        {/* Map grid texture */}
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(0,0,0,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.04) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />

        <div style={{ position: 'absolute', left: '50%', top: '50%', transform: `translate(calc(-50% + ${mapPan.x}px), calc(-50% + ${mapPan.y}px))`, width: 520, height: 480 }}>
          {/* Route SVG */}
          <svg style={{ position: 'absolute', inset: 0, width: 520, height: 480, pointerEvents: 'none' }}>
            <defs>
              <style>{`@keyframes omDash { to { stroke-dashoffset: -16; } }`}</style>
            </defs>
            <polyline
              points="80,380 160,300 240,240 320,200 400,280 440,200"
              stroke="#FF5C97" strokeWidth={3} fill="none" strokeDasharray="8 8"
              style={{ animation: 'omDash 0.6s linear infinite' }}
            />
          </svg>

          {/* Walk time pills */}
          {WALKS.map((w, i) => (
            <div key={i} style={{ position: 'absolute', left: walkMids[i][0], top: walkMids[i][1], transform: 'translate(-50%,-50%)', background: '#FF5C97', color: 'white', fontSize: 10, borderRadius: 10, padding: '2px 6px', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
              도보 {w}분
            </div>
          ))}

          {/* Place pins */}
          {allItems.map((item, i) => {
            if (i >= pins.length) return null;
            const [px, py] = pins[i];
            return (
              <div key={item.id} style={{ position: 'absolute', left: px, top: py, transform: 'translate(-50%,-50%)', zIndex: 2 }}>
                {i === 0 && (
                  <div style={{ position: 'absolute', bottom: 32, left: '50%', transform: 'translateX(-50%)', background: 'white', borderRadius: 12, padding: '8px 12px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 3, whiteSpace: 'nowrap' }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{NAMES[item.category || '']?.[0] || '장소'}</div>
                    <span style={{ fontSize: 10, background: KIND[item.kind].tint, color: KIND[item.kind].numText, padding: '2px 6px', borderRadius: 6 }}>{item.kind}</span>
                  </div>
                )}
                <div style={{ width: 24, height: 24, background: KIND[item.kind].bar, color: 'white', fontSize: 14, fontWeight: 700, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}>
                  {i + 1}
                </div>
              </div>
            );
          })}
        </div>

        {/* Top info card */}
        <div style={{ position: 'absolute', top: 16, left: 16, right: 16, background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(16px)', borderRadius: 20, padding: '12px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#16170F' }}>{region} · {DATES[dateIdx]}</span>
            <button style={{ width: 36, height: 36, background: '#FF5C97', borderRadius: 18, color: 'white', border: 'none', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>📍</button>
          </div>
          {confirmed && (
            <div style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 4, background: '#E6F9F0', color: '#1A9A60', fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 12 }}>
              ✓ 예약 확정
            </div>
          )}
        </div>
      </div>

      {/* Course summary card */}
      <div style={{ position: 'relative', margin: '0 16px', marginTop: -24, background: 'white', borderRadius: 20, padding: 16, boxShadow: '0 4px 20px rgba(0,0,0,0.10)', zIndex: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>오늘의 코스</span>
          {confirmed && (
            <button onClick={onReview} style={{ background: '#FF5C97', color: 'white', border: 'none', borderRadius: 16, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>후기 쓰기</button>
          )}
        </div>

        {items.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#9A96A0', fontSize: 13, padding: '16px 0' }}>
            아직 코스가 없어요.<br />
            <button onClick={onPlan} style={{ marginTop: 8, background: '#FF5C97', color: 'white', border: 'none', borderRadius: 12, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>코스 짜기</button>
          </div>
        ) : (
          <div style={{ maxHeight: 128, overflowY: 'auto' }}>
            {items.map((item, idx) => (
              <div key={item.id}>
                {idx > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0 4px 8px' }}>
                    <span style={{ fontSize: 10, color: '#9A96A0' }}>↓ 도보 {WALKS[idx - 1]}분</span>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                  <div style={{ width: 24, height: 24, background: KIND[item.kind].num, color: KIND[item.kind].numText, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                    {idx + 1}
                  </div>
                  <span style={{ fontSize: 12, color: KIND[item.kind].numText, fontWeight: 600 }}>{item.kind}</span>
                  <span style={{ fontSize: 12, color: '#555', flex: 1 }}>{NAMES[item.category || '']?.[item.placeIdx % 3] || '장소'}</span>
                  <span style={{ fontSize: 11, color: '#9A96A0' }}>{fmtTime(item.start)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <button onClick={onPlan} style={{ width: '100%', marginTop: 12, background: 'linear-gradient(135deg, #FF5C97, #FF8FB8)', color: 'white', border: 'none', borderRadius: 14, height: 44, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
          {confirmed ? '코스 수정하기' : '코스 짜기 →'}
        </button>
      </div>

      {/* Bottom padding */}
      <div style={{ height: 24 }} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PlanBuildScreen
// ═══════════════════════════════════════════════════════════════════════════════
interface PlanBuildProps {
  items: TimelineItem[];
  region: string;
  dateIdx: number;
  onSetDateIdx: (i: number) => void;
  onDelete: (id: number) => void;
  onAdd: (kind: '식사' | '카페' | '놀거리') => void;
  onCatPick: (id: number) => void;
  onNext: () => void;
  dragRef: React.MutableRefObject<{ type: 'move' | 'resize'; id: number; startY: number; origStart: number; origEnd: number; moved: number } | null>;
  onTimelinePointerMove: (e: React.PointerEvent) => void;
  onTimelinePointerUp: () => void;
  onRegionClick: () => void;
}

function PlanBuildScreen({ items, region, dateIdx, onSetDateIdx, onDelete, onAdd, onCatPick, onNext, dragRef, onTimelinePointerMove, onTimelinePointerUp, onRegionClick }: PlanBuildProps) {
  const hours = Array.from({ length: HOURS }, (_, i) => i + 9);

  return (
    <div style={{ background: 'white', minHeight: '100%' }}>
      {/* Header */}
      <div style={{ padding: '16px 16px 0' }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>코스 짜기</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => onSetDateIdx(Math.max(0, dateIdx - 1))} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#9A96A0' }}>‹</button>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{DATES[dateIdx]}</span>
          <button onClick={() => onSetDateIdx(Math.min(DATES.length - 1, dateIdx + 1))} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#9A96A0' }}>›</button>
          <button onClick={onRegionClick} style={{ marginLeft: 8, background: '#FFE2EC', color: '#FF5C97', border: 'none', borderRadius: 12, padding: '4px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            📍 {region}
          </button>
        </div>
      </div>

      {/* Timeline */}
      <div
        style={{ position: 'relative', height: HOURS * HOURH, marginTop: 12, paddingLeft: 48, touchAction: 'none' }}
        onPointerMove={onTimelinePointerMove}
        onPointerUp={onTimelinePointerUp}
      >
        {/* Hour grid */}
        {hours.map((h, i) => (
          <React.Fragment key={h}>
            <div style={{ position: 'absolute', left: 0, width: 40, top: i * HOURH + 2, textAlign: 'right', fontSize: 11, color: '#9A96A0', lineHeight: 1 }}>
              {h > 12 ? h - 12 : h}{h === 12 || h === 24 ? '' : ''}
            </div>
            <div style={{ position: 'absolute', left: 48, right: 0, top: i * HOURH, height: 1, background: 'rgba(0,0,0,0.06)' }} />
          </React.Fragment>
        ))}

        {/* Empty state */}
        {items.length === 0 && (
          <div style={{ position: 'absolute', left: '50%', top: '40%', transform: 'translate(-50%,-50%)', textAlign: 'center', color: '#9A96A0', fontSize: 13, border: '2px dashed #E0E0E0', borderRadius: 16, padding: '24px 32px' }}>
            아래 버튼으로 항목을 추가해보세요
          </div>
        )}

        {/* Timeline blocks */}
        {items.map((item) => {
          const top = (item.start - START) / 60 * HOURH;
          const height = Math.max(32, (item.end - item.start) / 60 * HOURH - 4);
          return (
            <div
              key={item.id}
              style={{ position: 'absolute', top, left: 48 + 8, right: 8, height, background: KIND[item.kind].tint, borderRadius: 12, overflow: 'hidden', cursor: 'grab', touchAction: 'none' }}
              onPointerDown={(e) => {
                (e.currentTarget.closest('[data-timeline]') as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                dragRef.current = { type: 'move', id: item.id, startY: e.clientY, origStart: item.start, origEnd: item.end, moved: 0 };
              }}
              onClick={() => {
                if (!dragRef.current || dragRef.current.moved < 5) onCatPick(item.id);
              }}
            >
              {/* Color bar */}
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: KIND[item.kind].bar }} />
              {/* Content */}
              <div style={{ padding: '4px 8px 4px 12px', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 10, background: KIND[item.kind].num, color: KIND[item.kind].numText, padding: '1px 6px', borderRadius: 6, fontWeight: 600 }}>{item.category}</span>
                    <span style={{ fontSize: 10, color: '#9A96A0' }}>{fmtTime(item.start)}–{fmtTime(item.end)}</span>
                  </div>
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); deleteItem(item.id); }}
                    style={{ background: 'none', border: 'none', color: '#9A96A0', cursor: 'pointer', fontSize: 14, padding: '0 4px' }}
                  >×</button>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#16170F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {NAMES[item.category || '']?.[item.placeIdx % 3] || '장소'}
                </div>
              </div>
              {/* Resize handle */}
              <div
                style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 12, cursor: 'ns-resize', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  dragRef.current = { type: 'resize', id: item.id, startY: e.clientY, origStart: item.start, origEnd: item.end, moved: 0 };
                }}
              >
                <div style={{ width: 32, height: 3, background: 'rgba(0,0,0,0.15)', borderRadius: 2 }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom toolbar */}
      <div style={{ position: 'sticky', bottom: 0, background: 'white', padding: '8px 16px 12px', borderTop: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 -4px 12px rgba(0,0,0,0.04)' }}>
        <div style={{ fontSize: 11, color: '#B5B0BC', textAlign: 'center', marginBottom: 8 }}>항목을 드래그해 시간대를 조정하세요</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          {(['식사', '카페', '놀거리'] as const).map(kind => (
            <button key={kind} onClick={() => onAdd(kind)} style={{ flex: 1, background: KIND[kind].tint, color: KIND[kind].numText, border: 'none', borderRadius: 20, padding: '8px 0', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              + {kind}
            </button>
          ))}
        </div>
        <button onClick={onNext} style={{ width: '100%', background: '#FF5C97', color: 'white', border: 'none', borderRadius: 16, height: 48, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
          계획 짜기 →
        </button>
      </div>
    </div>
  );

  function deleteItem(id: number) { onDelete(id); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PlanFinalScreen
// ═══════════════════════════════════════════════════════════════════════════════
interface PlanFinalProps {
  items: TimelineItem[];
  region: string;
  dateIdx: number;
  totalOriginal: number;
  totalDiscount: number;
  totalFinal: number;
  discountPct: number;
  onBack: () => void;
  onPlacePick: (id: number) => void;
  onConfirm: () => void;
  getPlaceName: (i: TimelineItem) => string;
  getAddress: (i: TimelineItem) => string;
}

function PlanFinalScreen({ items, region, dateIdx, totalOriginal, totalDiscount, totalFinal, discountPct, onBack, onPlacePick, onConfirm, getPlaceName, getAddress }: PlanFinalProps) {
  const tiers = [
    { n: '1곳', pct: 5 },
    { n: '2곳', pct: 10 },
    { n: '3곳', pct: 15 },
    { n: '4곳', pct: 20 },
  ];

  return (
    <div style={{ background: '#F8F8F8', minHeight: '100%', paddingBottom: 120 }}>
      {/* Header */}
      <div style={{ background: 'white', padding: '16px 16px 12px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#333' }}>←</button>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>추천 코스</div>
          <div style={{ fontSize: 12, color: '#9A96A0' }}>{region} · {DATES[dateIdx]}</div>
        </div>
      </div>

      {/* Discount tier bar */}
      <div style={{ margin: '12px 16px', background: 'white', borderRadius: 16, padding: '12px 16px', display: 'flex', gap: 4 }}>
        {tiers.map((t, i) => (
          <div key={i} style={{ flex: 1, textAlign: 'center', padding: '6px 0', borderRadius: 10, background: items.length >= i + 1 ? '#FF5C97' : '#F5F5F5', color: items.length >= i + 1 ? 'white' : '#9A96A0', fontSize: 11, fontWeight: 600, transition: 'all 0.2s' }}>
            <div>{t.n}</div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{t.pct}%</div>
          </div>
        ))}
      </div>

      {/* Course cards */}
      <div style={{ padding: '0 16px' }}>
        {items.map((item, idx) => (
          <div key={item.id}>
            {idx > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px' }}>
                <div style={{ width: 1, height: 16, background: '#E0E0E0' }} />
                <span style={{ fontSize: 11, color: '#9A96A0', background: 'rgba(0,0,0,0.06)', padding: '2px 8px', borderRadius: 8 }}>도보 {WALKS[idx - 1]}분</span>
              </div>
            )}
            <div style={{ background: 'white', borderRadius: 20, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{ width: 24, height: 24, background: KIND[item.kind].bar, color: 'white', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>{idx + 1}</div>
                <span style={{ fontSize: 11, color: '#9A96A0' }}>{fmtTime(item.start)}–{fmtTime(item.end)}</span>
                <span style={{ fontSize: 11, background: KIND[item.kind].tint, color: KIND[item.kind].numText, padding: '2px 8px', borderRadius: 8, fontWeight: 600 }}>{item.kind}</span>
                {item.isPartner ? (
                  <span style={{ fontSize: 10, background: 'linear-gradient(135deg, #FF5C97, #FF8FB8)', color: 'white', padding: '2px 8px', borderRadius: 8, fontWeight: 600 }}>파트너</span>
                ) : (
                  <span style={{ fontSize: 10, background: '#F0F0F0', color: '#9A96A0', padding: '2px 8px', borderRadius: 8 }}>일반</span>
                )}
              </div>
              <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>{getPlaceName(item)}</div>
              <div style={{ fontSize: 12, color: '#9A96A0', marginBottom: 12 }}>{getAddress(item)}</div>
              {item.placeRating && <div style={{ fontSize: 12, color: '#F4A65C', marginBottom: 8 }}>{'★'.repeat(Math.round(item.placeRating))} {item.placeRating.toFixed(1)}</div>}
              <button onClick={() => onPlacePick(item.id)} style={{ background: '#F5F5F5', color: '#555', border: 'none', borderRadius: 10, padding: '8px 14px', fontSize: 12, cursor: 'pointer' }}>
                다른 곳 선택 ›
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Bottom bar */}
      <div style={{ position: 'fixed', bottom: 72, left: '50%', transform: 'translateX(-50%)', width: 388, background: 'white', padding: '12px 16px', borderTop: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 -4px 12px rgba(0,0,0,0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div>
            <span style={{ fontSize: 12, color: '#9A96A0', textDecoration: 'line-through' }}>₩{totalOriginal.toLocaleString()}</span>
            <span style={{ fontSize: 12, color: '#FF5C97', fontWeight: 600, marginLeft: 8 }}>-{discountPct}% 할인</span>
          </div>
          <span style={{ fontSize: 16, fontWeight: 700 }}>₩{totalFinal.toLocaleString()}</span>
        </div>
        <button onClick={onConfirm} style={{ width: '100%', background: 'linear-gradient(135deg, #FF5C97, #FF8FB8)', color: 'white', border: 'none', borderRadius: 16, height: 48, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
          계획 확정 →
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CheckoutScreen
// ═══════════════════════════════════════════════════════════════════════════════
interface CheckoutProps {
  items: TimelineItem[];
  payIdx: number;
  setPayIdx: (i: number) => void;
  totalOriginal: number;
  totalDiscount: number;
  totalFinal: number;
  discountPct: number;
  onBack: () => void;
  onPay: () => void;
  getPlaceName: (i: TimelineItem) => string;
}

function CheckoutScreen({ items, payIdx, setPayIdx, totalOriginal, totalDiscount, totalFinal, discountPct, onBack, onPay, getPlaceName }: CheckoutProps) {
  const payMethods = ['카카오페이', '네이버페이', '신용·체크카드'];

  return (
    <div style={{ background: '#F8F8F8', minHeight: '100%', paddingBottom: 100 }}>
      <div style={{ background: 'white', padding: '16px 16px 12px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>←</button>
        <span style={{ fontSize: 18, fontWeight: 700 }}>결제·예약</span>
      </div>

      <div style={{ margin: '12px 16px', background: '#FBF7F9', borderRadius: 16, padding: 12 }}>
        {items.map((item, idx) => (
          <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
            <div style={{ width: 20, height: 20, background: KIND[item.kind].bar, color: 'white', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{idx + 1}</div>
            <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{getPlaceName(item)}</span>
            <span style={{ fontSize: 11, color: '#9A96A0' }}>{fmtTime(item.start)}</span>
          </div>
        ))}
      </div>

      <div style={{ margin: '0 16px 12px', background: 'white', borderRadius: 20, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 14, color: '#666' }}>정가</span>
          <span style={{ fontSize: 14 }}>₩{totalOriginal.toLocaleString()}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 14, color: '#FF5C97', fontWeight: 600 }}>코스 할인 ({discountPct}%)</span>
          <span style={{ fontSize: 14, color: '#FF5C97', fontWeight: 600 }}>-₩{totalDiscount.toLocaleString()}</span>
        </div>
        <div style={{ height: 1, background: '#F0F0F0', marginBottom: 12 }} />
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>최종 결제</span>
          <span style={{ fontSize: 18, fontWeight: 800, color: '#FF5C97' }}>₩{totalFinal.toLocaleString()}</span>
        </div>
      </div>

      <div style={{ margin: '0 16px 12px' }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#333' }}>결제 수단</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {payMethods.map((m, i) => (
            <button key={i} onClick={() => setPayIdx(i)} style={{ flex: 1, padding: '10px 0', borderRadius: 12, border: 'none', background: payIdx === i ? '#FF5C97' : '#F5F5F5', color: payIdx === i ? 'white' : '#555', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {m}
            </button>
          ))}
        </div>
      </div>

      <div style={{ position: 'fixed', bottom: 72, left: '50%', transform: 'translateX(-50%)', width: 388, padding: '12px 16px', background: 'white', borderTop: '1px solid rgba(0,0,0,0.06)' }}>
        <button onClick={onPay} style={{ width: '100%', background: 'linear-gradient(135deg, #FF5C97, #FF8FB8)', color: 'white', border: 'none', borderRadius: 16, height: 52, fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>
          ₩{totalFinal.toLocaleString()} 결제하고 예약
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CompleteScreen
// ═══════════════════════════════════════════════════════════════════════════════
function CompleteScreen({ items, onHome, onReview, getPlaceName }: { items: TimelineItem[]; onHome: () => void; onReview: () => void; getPlaceName: (i: TimelineItem) => string }) {
  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 16px', background: 'white' }}>
      {/* Animated check */}
      <div style={{ position: 'relative', width: 96, height: 96, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: 48, background: 'rgba(255,92,151,0.15)', animation: 'omRing 1.5s ease-out infinite' }} />
        <div style={{ width: 64, height: 64, background: '#FF5C97', borderRadius: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 24px rgba(255,92,151,0.4)' }}>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <path d="M6 14l6 6 10-12" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 24, textAlign: 'center' }}>예약이 확정됐어요!</div>
      <div style={{ fontSize: 14, color: '#9A96A0', marginTop: 8 }}>결제가 완료되었어요</div>

      <div style={{ width: '100%', background: '#FBF7F9', borderRadius: 16, padding: 12, marginTop: 24 }}>
        {items.map((item, idx) => (
          <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
            <div style={{ width: 22, height: 22, background: KIND[item.kind].bar, color: 'white', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{idx + 1}</div>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{getPlaceName(item)}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 24, width: '100%' }}>
        <button onClick={onReview} style={{ flex: 1, height: 48, background: 'white', border: '2px solid #FF5C97', color: '#FF5C97', borderRadius: 16, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>후기 쓰기</button>
        <button onClick={onHome} style={{ flex: 1, height: 48, background: '#FF5C97', color: 'white', border: 'none', borderRadius: 16, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>홈으로</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CalendarScreen
// ═══════════════════════════════════════════════════════════════════════════════
function CalendarScreen({ dateIdx, setDateIdx, region }: { dateIdx: number; setDateIdx: (i: number) => void; region: string }) {
  const dayHeaders = ['일', '월', '화', '수', '목', '금', '토'];
  // June 2026 starts on Monday (index 1)
  const startOffset = 1;
  const daysInMonth = 30;
  const highlightDays = [18, 19, 20];

  const cells: (number | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 800, padding: '20px 20px 16px' }}>캘린더</div>

      <div style={{ margin: '0 16px', background: 'white', borderRadius: 20, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <button style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#9A96A0' }}>‹</button>
          <span style={{ fontWeight: 700, fontSize: 15 }}>2026년 6월</span>
          <button style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#9A96A0' }}>›</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px 0', textAlign: 'center' }}>
          {dayHeaders.map(d => (
            <div key={d} style={{ fontSize: 11, color: '#9A96A0', fontWeight: 600, padding: '4px 0' }}>{d}</div>
          ))}
          {cells.map((day, i) => (
            <div key={i} style={{ padding: '4px 0', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              {day !== null && (
                <>
                  <div style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 16, background: highlightDays.includes(day) ? '#FF5C97' : 'transparent', color: highlightDays.includes(day) ? 'white' : '#333', fontSize: 13, fontWeight: highlightDays.includes(day) ? 700 : 400, cursor: highlightDays.includes(day) ? 'pointer' : 'default' }}>
                    {day}
                  </div>
                  {highlightDays.includes(day) && <div style={{ width: 4, height: 4, borderRadius: 2, background: '#FF5C97', marginTop: 2 }} />}
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      <div style={{ margin: '12px 16px', background: 'white', borderRadius: 20, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
        <div style={{ fontSize: 12, color: '#9A96A0', marginBottom: 8 }}>다가오는 데이트</div>
        <div style={{ fontSize: 15, fontWeight: 700 }}>{DATES[0]}</div>
        <div style={{ fontSize: 13, color: '#9A96A0', marginTop: 4 }}>📍 {region}</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MyPageScreen
// ═══════════════════════════════════════════════════════════════════════════════
function MyPageScreen() {
  const menuItems = ['내 코스 보기', '커플 설정', '알림 설정', '앱 평가하기'];

  return (
    <div style={{ paddingBottom: 16 }}>
      {/* Profile card */}
      <div style={{ margin: '16px 16px 0', background: 'linear-gradient(135deg, #FF5C97, #FF8FB8)', borderRadius: 24, padding: 20, color: 'white' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ position: 'relative', width: 80, height: 48 }}>
            <div style={{ position: 'absolute', left: 0, width: 48, height: 48, borderRadius: 24, background: 'rgba(255,255,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>👨</div>
            <div style={{ position: 'absolute', left: 28, width: 48, height: 48, borderRadius: 24, background: 'rgba(255,255,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>👩</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{COUPLE_NAME}</div>
            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>함께한 지 D+412일</div>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.25)', borderRadius: 12, padding: '6px 12px', fontSize: 13, fontWeight: 700 }}>D+412</div>
        </div>
      </div>

      {/* Stats */}
      <div style={{ margin: '12px 16px', display: 'flex', gap: 8 }}>
        <div style={{ flex: 1, background: 'white', borderRadius: 16, padding: 16, textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 11, color: '#9A96A0', marginBottom: 4 }}>이용 코스</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>12회</div>
        </div>
        <div style={{ flex: 1, background: 'white', borderRadius: 16, padding: 16, textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 11, color: '#9A96A0', marginBottom: 4 }}>총 절약</div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>87,600원</div>
        </div>
      </div>

      {/* Crew promo */}
      <div style={{ margin: '0 16px 12px', background: '#1A1A2E', borderRadius: 20, padding: 16, color: 'white' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 11, color: '#F4A65C', fontWeight: 600, marginBottom: 4 }}>👑 원모어 크루</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>더 많은 혜택을 누려요</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>월 정기 구독으로 최대 30% 할인</div>
          </div>
          <button style={{ background: '#FF5C97', color: 'white', border: 'none', borderRadius: 12, padding: '8px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', marginLeft: 12, flexShrink: 0 }}>가입하기</button>
        </div>
      </div>

      {/* Menu list */}
      <div style={{ margin: '0 16px', background: 'white', borderRadius: 20, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
        {menuItems.map((m, i) => (
          <button key={m} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', background: 'none', border: 'none', borderBottom: i < menuItems.length - 1 ? '1px solid #F5F5F5' : 'none', cursor: 'pointer', textAlign: 'left' }}>
            <span style={{ fontSize: 14, fontWeight: 500 }}>{m}</span>
            <span style={{ color: '#9A96A0', fontSize: 18 }}>›</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PlaceSearchSheet
// ═══════════════════════════════════════════════════════════════════════════════
function PlaceSearchSheet({ input, suggestions, onInputChange, onSelect, onClose }: {
  input: string;
  suggestions: RegionSuggestion[];
  onInputChange: (v: string) => void;
  onSelect: (r: string) => void;
  onClose: () => void;
}) {
  const displayList = suggestions.length > 0 ? suggestions.map(s => s.name) : REGIONS;

  return (
    <>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 50 }} onClick={onClose} />
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'white', borderRadius: '24px 24px 0 0', padding: '20px 16px', zIndex: 51 }}>
        <div style={{ width: 32, height: 4, background: '#E0E0E0', borderRadius: 2, margin: '0 auto 16px' }} />
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 12 }}>어디로 갈까요?</div>
        <input
          value={input}
          onChange={e => onInputChange(e.target.value)}
          placeholder="지역 검색..."
          style={{ width: '100%', background: '#F5F5F5', borderRadius: 12, padding: '10px 14px', border: 'none', outline: 'none', fontSize: 14 }}
          autoFocus
        />
        <div style={{ marginTop: 12 }}>
          {displayList.map((r, i) => (
            <button key={i} onClick={() => onSelect(typeof r === 'string' ? r : r)} style={{ width: '100%', display: 'block', textAlign: 'left', padding: '12px 4px', background: 'none', border: 'none', borderBottom: '1px solid #F5F5F5', cursor: 'pointer', fontSize: 14 }}>
              {suggestions.length > 0 ? (
                <span>
                  <span style={{ fontWeight: 600 }}>{suggestions[i]?.name}</span>
                  <span style={{ color: '#9A96A0', marginLeft: 8, fontSize: 12 }}>{suggestions[i]?.sub}</span>
                </span>
              ) : r}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CategoryPickerSheet
// ═══════════════════════════════════════════════════════════════════════════════
function CategoryPickerSheet({ item, onSelect, onClose }: { item: TimelineItem; onSelect: (cat: string) => void; onClose: () => void }) {
  const cats = CAT[item.kind] || [];

  return (
    <>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 50 }} onClick={onClose} />
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: KIND[item.kind].sheet, borderRadius: '24px 24px 0 0', padding: '20px 16px', zIndex: 51 }}>
        <div style={{ width: 32, height: 4, background: '#E0E0E0', borderRadius: 2, margin: '0 auto 16px' }} />
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 16 }}>카테고리 선택</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {cats.map(cat => (
            <button key={cat} onClick={() => onSelect(cat)} style={{ padding: '10px 18px', borderRadius: 20, border: 'none', background: item.category === cat ? KIND[item.kind].bar : 'white', color: item.category === cat ? 'white' : '#333', fontSize: 14, fontWeight: item.category === cat ? 700 : 400, cursor: 'pointer', transition: 'all 0.15s' }}>
              {cat}
            </button>
          ))}
        </div>
        <div style={{ height: 24 }} />
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PlaceSwapSheet
// ═══════════════════════════════════════════════════════════════════════════════
function PlaceSwapSheet({ item, candidates, loading, onSelect, onClose }: {
  item: TimelineItem;
  candidates: PlaceCandidate[];
  loading: boolean;
  onSelect: (c: PlaceCandidate) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 50 }} onClick={onClose} />
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'white', borderRadius: '24px 24px 0 0', padding: '20px 16px', maxHeight: '70%', overflowY: 'auto', zIndex: 51 }}>
        <div style={{ width: 32, height: 4, background: '#E0E0E0', borderRadius: 2, margin: '0 auto 16px' }} />
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 16 }}>다른 곳 선택</div>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: '#9A96A0' }}>검색 중...</div>
        ) : candidates.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: '#9A96A0' }}>장소를 찾지 못했어요</div>
        ) : (
          candidates.map((c, i) => (
            <div key={c.placeId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: i < candidates.length - 1 ? '1px solid #F5F5F5' : 'none' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  {c.isPartner && <span style={{ fontSize: 10, background: 'linear-gradient(135deg, #FF5C97, #FF8FB8)', color: 'white', padding: '2px 6px', borderRadius: 6, fontWeight: 600 }}>파트너</span>}
                  <span style={{ fontSize: 12, color: '#F4A65C' }}>{'★'.repeat(Math.round(c.rating))} {c.rating.toFixed(1)}</span>
                </div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{c.name}</div>
              </div>
              <button onClick={() => onSelect(c)} style={{ background: '#FF5C97', color: 'white', border: 'none', borderRadius: 12, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                선택
              </button>
            </div>
          ))
        )}
        <div style={{ height: 16 }} />
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ReviewScreen
// ═══════════════════════════════════════════════════════════════════════════════
function ReviewScreen({ items, rating, setRating, photos, setPhotos, onClose, onSubmit, getPlaceName }: {
  items: TimelineItem[];
  rating: number;
  setRating: (r: number) => void;
  photos: boolean[];
  setPhotos: (p: boolean[]) => void;
  onClose: () => void;
  onSubmit: () => void;
  getPlaceName: (i: TimelineItem) => string;
}) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'white', overflowY: 'auto', zIndex: 90 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 16px 12px', borderBottom: '1px solid #F5F5F5', position: 'sticky', top: 0, background: 'white', zIndex: 1 }}>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>←</button>
        <span style={{ fontSize: 17, fontWeight: 700 }}>후기 쓰기</span>
      </div>

      <div style={{ padding: '16px' }}>
        {/* Course summary */}
        <div style={{ background: '#FBF7F9', borderRadius: 16, padding: 12, marginBottom: 20 }}>
          {items.map((item, idx) => (
            <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
              <div style={{ width: 20, height: 20, background: KIND[item.kind].bar, color: 'white', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{idx + 1}</div>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{getPlaceName(item)}</span>
            </div>
          ))}
        </div>

        {/* Star rating */}
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>데이트는 어떠셨나요?</div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
            {[1, 2, 3, 4, 5].map(s => (
              <button key={s} onClick={() => setRating(s)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 32, color: s <= rating ? '#FF5C97' : '#E0E0E0', transition: 'color 0.15s' }}>★</button>
            ))}
          </div>
        </div>

        {/* Photo slots */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {photos.map((has, i) => (
            <button key={i} onClick={() => setPhotos(photos.map((p, j) => j === i ? !p : p))} style={{ width: 88, height: 88, borderRadius: 12, border: `2px dashed ${has ? '#FF5C97' : '#E0E0E0'}`, background: has ? '#FFE8F2' : '#F9F9F9', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: has ? 28 : 24, color: has ? '#FF5C97' : '#9A96A0' }}>
              {has ? '🖼️' : '+'}
            </button>
          ))}
        </div>

        {/* Textarea */}
        <textarea
          placeholder="데이트는 어떠셨나요? 솔직한 후기를 남겨주세요!"
          style={{ width: '100%', minHeight: 120, padding: '12px 14px', borderRadius: 12, border: '1.5px solid #E0E0E0', outline: 'none', fontSize: 14, resize: 'none', fontFamily: 'inherit', marginBottom: 16 }}
        />

        {/* Crew promo banner */}
        <div style={{ background: '#1A1A2E', borderRadius: 16, padding: 14, color: 'white', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>👑</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>원모어 크루 멤버가 되면</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>후기 작성 시 추가 포인트 적립!</div>
          </div>
          <button style={{ background: '#FF5C97', color: 'white', border: 'none', borderRadius: 10, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>가입</button>
        </div>

        {/* Share row */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {['Instagram', '블로그', '플레이스', '카카오'].map(s => (
            <button key={s} style={{ flex: 1, padding: '8px 0', background: '#F5F5F5', border: 'none', borderRadius: 10, fontSize: 11, color: '#555', cursor: 'pointer' }}>{s}</button>
          ))}
        </div>

        {/* Submit */}
        <button onClick={onSubmit} style={{ width: '100%', background: '#FF5C97', color: 'white', border: 'none', borderRadius: 16, height: 52, fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>
          후기 등록
        </button>
      </div>
    </div>
  );
}
