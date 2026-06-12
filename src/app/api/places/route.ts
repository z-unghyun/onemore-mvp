import { NextRequest, NextResponse } from 'next/server';

// Server-side proxy so the API key is never exposed in client bundles.
// Usage: GET /api/places?url=<encoded-google-maps-url>
export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get('url');
  if (!target) return NextResponse.json({ error: 'missing url' }, { status: 400 });

  try {
    const res = await fetch(decodeURIComponent(target));
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'upstream error' }, { status: 502 });
  }
}
