/**
 * Local smoke test for findNearest filter logic — no API key needed.
 * Run: node scripts/test-filter.mjs
 */

// ── copy of helpers from places.ts ────────────────────────────────────────────
function haversineDist(a, b) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const sin2 = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(sin2));
}
function approxWalkMins(a, b) {
  return Math.max(1, Math.round(haversineDist(a, b) * 1.35 / 80));
}

const MAX_DIST_M = 2000;
function applyFilter(hub, results) {
  return results.find(p =>
    p.business_status !== 'CLOSED_TEMPORARILY' &&
    p.business_status !== 'CLOSED_PERMANENTLY' &&
    (p.rating ?? 0) >= 4.0 &&
    (p.user_ratings_total ?? 0) >= 10 &&
    haversineDist(hub, { lat: p.geometry.location.lat, lng: p.geometry.location.lng }) <= MAX_DIST_M
  ) ?? null;
}

// ── test helpers ──────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function expect(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (!ok) console.log(`  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
  ok ? passed++ : failed++;
}

// ── fixtures ──────────────────────────────────────────────────────────────────
const GANGNAM = { lat: 37.4979, lng: 127.0276 };
const NEAR_CGV = { lat: 37.5018, lng: 127.0256 };   // ~500m from Gangnam station
const FAR_MAEBONG = { lat: 37.4820, lng: 127.0456 }; // ~3km away

function makePlace(overrides) {
  return {
    place_id: 'test_id',
    name: 'Test Cinema',
    rating: 4.5,
    user_ratings_total: 100,
    business_status: 'OPERATIONAL',
    geometry: { location: NEAR_CGV },
    ...overrides,
  };
}

// ── filter tests ──────────────────────────────────────────────────────────────
console.log('\n── findNearest filter tests ──\n');

expect('returns OPERATIONAL place within 2km',
  applyFilter(GANGNAM, [makePlace()])?.name, 'Test Cinema');

expect('excludes CLOSED_TEMPORARILY',
  applyFilter(GANGNAM, [makePlace({ business_status: 'CLOSED_TEMPORARILY' })]), null);

expect('excludes CLOSED_PERMANENTLY',
  applyFilter(GANGNAM, [makePlace({ business_status: 'CLOSED_PERMANENTLY' })]), null);

// KEY FIX: undefined business_status (large chains like CGV) should pass
expect('allows undefined business_status (chains like CGV/Megabox)',
  applyFilter(GANGNAM, [makePlace({ business_status: undefined })])?.name, 'Test Cinema');

expect('excludes rating < 4.0',
  applyFilter(GANGNAM, [makePlace({ rating: 3.8 })]), null);

expect('excludes ghost listing (user_ratings_total = 0)',
  applyFilter(GANGNAM, [makePlace({ user_ratings_total: 0, rating: 4.9 })]), null);

// THE MAEBONG BUG CASE
const farPlace = makePlace({ geometry: { location: FAR_MAEBONG }, name: '매봉 영화관' });
const distToFar = Math.round(haversineDist(GANGNAM, FAR_MAEBONG));
console.log(`\n  (매봉 영화관 straight-line distance: ~${distToFar}m)`);
expect('excludes place > 2km (the Maebong bug case)',
  applyFilter(GANGNAM, [farPlace]), null);

expect('skips far first result, picks nearer second',
  applyFilter(GANGNAM, [farPlace, makePlace({ name: '강남 영화관' })])?.name, '강남 영화관');

// ── cleanName tests ───────────────────────────────────────────────────────────
function cleanName(raw) {
  const first = raw.split(' | ')[0].trim();
  if (!/[가-힣]/.test(first)) return first;
  const s = first.replace(/[぀-ヿ一-鿿]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s.match(/^(.*[가-힣]+)/)?.[1].trim() ?? s;
}

console.log('\n── cleanName tests ──\n');
expect('pipe-separated: Korean first',
  cleanName('한글이름 | English | 日本語'), '한글이름');
expect('inline multilingual: Korean + trailing CAPS',
  cleanName('까치화방 카페 강남점 CACHI CAFE GANGNAM 江南駅カフェ 江南站咖啡厅'), '까치화방 카페 강남점');
expect('pure English brand (CGV)',
  cleanName('CGV 강남'), 'CGV 강남');
expect('Korean only',
  cleanName('올지다락 강남역 레스토랑'), '올지다락 강남역 레스토랑');
expect('Korean name with English prefix',
  cleanName('더 스머프 매직 포레스트 강남점'), '더 스머프 매직 포레스트 강남점');
expect('purely English stays as-is',
  cleanName('Megabox COEX'), 'Megabox COEX');

// ── approxWalkMins spot checks ────────────────────────────────────────────────
console.log('\n── approxWalkMins spot checks ──\n');
console.log(`  강남역 → CGV강남(~500m):   ~${approxWalkMins(GANGNAM, NEAR_CGV)}분`);
console.log(`  강남역 → 코엑스(~2.5km):  ~${approxWalkMins(GANGNAM, { lat: 37.5115, lng: 127.0595 })}분`);
console.log(`  강남역 → 매봉역(~3km):    ~${approxWalkMins(GANGNAM, FAR_MAEBONG)}분`);

// ── summary ───────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
