import { NextRequest, NextResponse } from 'next/server';

// Server-side proxy. The Google API key lives ONLY on the server (never in the
// client bundle) and is injected here.
//
// Client usage: GET /api/places?path=<encoded-google-api-path>
//   e.g. path = "/place/nearbysearch/json?location=37.5,127.0&rankby=distance&type=restaurant&language=ko"
//
// Configure the key as a server-only env var:  GOOGLE_MAPS_KEY=...
// (NEXT_PUBLIC_GOOGLE_MAPS_KEY is still accepted as a fallback for convenience.)

const BASE = 'https://maps.googleapis.com/maps/api';
const KEY = process.env.GOOGLE_MAPS_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || '';

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get('path');
  if (!path) return NextResponse.json({ error: 'missing path' }, { status: 400 });

  if (!KEY) {
    // No key configured — tell the client explicitly so it can fall back to mock.
    return NextResponse.json({ status: 'NO_API_KEY', results: [] }, { status: 200 });
  }

  const decoded = decodeURIComponent(path);
  const sep = decoded.includes('?') ? '&' : '?';
  const target = `${BASE}${decoded}${sep}key=${KEY}`;

  try {
    const res = await fetch(target);
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'upstream error' }, { status: 502 });
  }
}
