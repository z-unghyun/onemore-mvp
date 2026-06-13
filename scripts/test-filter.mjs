/**
 * Local smoke test for findNearest filter logic — no API key needed.
 * Run: node --experimental-vm-modules scripts/test-filter.mjs
 *
 * Simulates what the Google Nearby Search API might return and verifies
 * that the OPERATIONAL / rating / reviews / distance filters work correctly.
 */

// ── copy of approxWalkMins from places.ts ──────────────────────────────────
function approxWalkMins(a, b) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const sin2 = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  const dist = 2 * R * Math.asin(Math.sqrt(sin2));
  return Math.max(1, Math.round(dist * 1.35 / 80));
}

// ── simulate findNearest filter (mirrors places.ts logic) ─────────────────
const MAX_DIST_M = 2000;

function applyFilter(hub, results) {
  return results.find(p =>
    p.business_status === 'OPERATIONAL' &&
    (p.rating ?? 0) >= 4.0 &&
    (p.user_ratings_total ?? 0) >= 10 &&
    approxWalkMins(hub, { lat: p.geometry.location.lat, lng: p.geometry.location.lng }) * 80 <= MAX_DIST_M
  ) ?? null;
}

// ── test helpers ──────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function expect(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (!ok) console.log(`  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
  ok ? passed++ : failed++;
}

// ── fixtures ──────────────────────────────────────────────────────────────
const GANGNAM = { lat: 37.4979, lng: 127.0276 }; // 강남역

// Place roughly 500m from Gangnam station (near CGV Gangnam)
const NEAR_CGV = { lat: 37.5018, lng: 127.0256 };
// Place roughly 3km from Gangnam station (near Maebong)
const FAR_MAEBONG = { lat: 37.4820, lng: 127.0456 };

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

// ── tests ─────────────────────────────────────────────────────────────────
console.log('\n── findNearest filter tests ──\n');

// 1. Normal case: should return the nearby operational cinema
expect(
  'returns OPERATIONAL place within 2km',
  applyFilter(GANGNAM, [makePlace()])?.name,
  'Test Cinema'
);

// 2. CLOSED_TEMPORARILY should be excluded
expect(
  'excludes CLOSED_TEMPORARILY',
  applyFilter(GANGNAM, [makePlace({ business_status: 'CLOSED_TEMPORARILY' })]),
  null
);

// 3. CLOSED_PERMANENTLY should be excluded
expect(
  'excludes CLOSED_PERMANENTLY',
  applyFilter(GANGNAM, [makePlace({ business_status: 'CLOSED_PERMANENTLY' })]),
  null
);

// 4. Low rating excluded
expect(
  'excludes rating < 4.0',
  applyFilter(GANGNAM, [makePlace({ rating: 3.8 })]),
  null
);

// 5. Ghost listing (no reviews) excluded
expect(
  'excludes ghost listing (user_ratings_total = 0)',
  applyFilter(GANGNAM, [makePlace({ user_ratings_total: 0, rating: 4.9 })]),
  null
);

// 6. THE BUG CASE: far-away place should be excluded even if it meets other criteria
const farPlace = makePlace({ geometry: { location: FAR_MAEBONG }, name: '매봉 영화관' });
const walkToFar = approxWalkMins(GANGNAM, FAR_MAEBONG);
const distM = walkToFar * 80;
console.log(`\n  (매봉 영화관 estimated distance: ~${distM}m / ~${walkToFar}min walk)`);
expect(
  'excludes place > 2km away (the Maebong bug case)',
  applyFilter(GANGNAM, [farPlace]),
  null
);

// 7. Far place should NOT be returned even if it's first in list (before a nearby one)
expect(
  'skips far first result and picks nearer second result',
  applyFilter(GANGNAM, [farPlace, makePlace({ name: '강남 영화관' })])?.name,
  '강남 영화관'
);

// 8. All results far → return null (graceful no-result)
expect(
  'returns null when no place within 2km passes',
  applyFilter(GANGNAM, [farPlace]),
  null
);

// ── approxWalkMins accuracy spot-check ────────────────────────────────────
console.log('\n── approxWalkMins spot checks ──\n');
const gangnamToCoex = approxWalkMins(GANGNAM, { lat: 37.5115, lng: 127.0595 }); // ~2.5km
console.log(`  강남역 → 코엑스: ~${gangnamToCoex}분 (실제 도보 약 35-40분)`);
const gangnamToCGV = approxWalkMins(GANGNAM, NEAR_CGV);
console.log(`  강남역 → CGV강남: ~${gangnamToCGV}분 (실제 도보 약 5-8분)`);

// ── summary ───────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
