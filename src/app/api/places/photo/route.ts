import { NextRequest, NextResponse } from 'next/server';

// Server-side proxy for Place Photos. Streams the image back so the key stays
// server-only. Client usage: GET /api/places/photo?ref=<photo_reference>&w=400
const KEY = process.env.GOOGLE_MAPS_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || '';

export async function GET(req: NextRequest) {
  const ref = req.nextUrl.searchParams.get('ref');
  const w = req.nextUrl.searchParams.get('w') || '400';
  if (!ref || !KEY) return new NextResponse(null, { status: 404 });

  const target = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${w}&photo_reference=${encodeURIComponent(ref)}&key=${KEY}`;

  try {
    const res = await fetch(target);
    return new NextResponse(res.body, {
      status: res.status,
      headers: {
        'Content-Type': res.headers.get('Content-Type') || 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
