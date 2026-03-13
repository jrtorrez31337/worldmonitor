import type { GetWebcamImageRequest, GetWebcamImageResponse, ServerContext } from '../../../../src/generated/server/worldmonitor/webcam/v1/service_server';
import { getCachedJson, setCachedJson } from '../../../_shared/redis';

const WINDY_BASE = 'https://api.windy.com/webcams/api/v3/webcams';
const CACHE_TTL = 300; // 5 minutes — under Windy's 10-min token expiry

// NOTE: No in-memory cache — Vercel Edge cold-starts per request, Map never survives.
// Redis is the only cross-request store available.

export async function getWebcamImage(_ctx: ServerContext, req: GetWebcamImageRequest): Promise<GetWebcamImageResponse> {
  const { webcamId } = req;
  const windyUrl = `https://www.windy.com/webcams/${webcamId}`;

  if (!webcamId) {
    return { thumbnailUrl: '', playerUrl: '', title: '', windyUrl, lastUpdated: 0, error: 'missing webcam_id' };
  }

  // Check Redis cache
  const cached = await getCachedJson(`webcam:image:${webcamId}`) as GetWebcamImageResponse | null;
  if (cached && !cached.error) return cached;

  const apiKey = process.env.WINDY_API_KEY;
  if (!apiKey) {
    return { thumbnailUrl: '', playerUrl: '', title: '', windyUrl, lastUpdated: 0, error: 'unavailable' };
  }

  try {
    const resp = await fetch(`${WINDY_BASE}/${webcamId}?include=images,urls`, {
      headers: { 'x-windy-api-key': apiKey },
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) {
      return { thumbnailUrl: '', playerUrl: '', title: '', windyUrl, lastUpdated: 0, error: 'unavailable' };
    }

    const data = await resp.json();
    const wc = data.webcams?.[0] ?? data;
    const images = wc.images || wc.image || {};
    const urls = wc.urls || {};

    const result: GetWebcamImageResponse = {
      thumbnailUrl: images.current?.preview || images.current?.thumbnail || '',
      playerUrl: urls.player || '',
      title: wc.title || '',
      windyUrl,
      lastUpdated: wc.lastUpdatedOn ? new Date(wc.lastUpdatedOn).getTime() : 0,
      error: '',
    };

    // Cache in Redis for 5 minutes
    await setCachedJson(`webcam:image:${webcamId}`, result, CACHE_TTL);

    return result;
  } catch (err) {
    console.warn(`[webcam] image fetch failed for ${webcamId}:`, String(err));
    return { thumbnailUrl: '', playerUrl: '', title: '', windyUrl, lastUpdated: 0, error: 'unavailable' };
  }
}
