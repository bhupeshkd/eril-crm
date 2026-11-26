import { ImageResponse } from 'next/og';
import { brandingForHost, requestHost, shade } from '@/lib/host-branding';

/**
 * App icon as a PNG: the brand initial on the brand colour, per request host (white-label).
 * /app-icon/512, or /app-icon/512?maskable=1 for a full-bleed icon with the mark inside the safe zone.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'edge'; // next/og's bundled font fails to load on the Node runtime on Windows
const SIZES = new Set([96, 180, 192, 512]);

export async function GET(req: Request, { params }: { params: { size: string } }) {
  const size = Number(params.size);
  if (!SIZES.has(size)) return new Response('Unknown size', { status: 404 });
  const maskable = new URL(req.url).searchParams.has('maskable');
  const b = await brandingForHost(requestHost(req));
  const letter = b.appName.trim().charAt(0).toUpperCase() || 'E';
  // Maskable icons get cropped to a circle or squircle: fill the whole square and keep the letter in the middle 60%.
  const radius = maskable || size === 180 ? 0 : Math.round(size * 0.22);
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: 'transparent' }}>
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radius,
            background: `linear-gradient(135deg, ${b.primaryColor}, ${shade(b.primaryColor)})`,
            color: 'white',
            fontSize: Math.round(size * (maskable ? 0.42 : 0.52)),
            fontWeight: 700,
          }}
        >
          {letter}
        </div>
      </div>
    ),
    { width: size, height: size, headers: { 'cache-control': 'public, max-age=3600' } },
  );
}
