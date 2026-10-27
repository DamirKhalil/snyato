import { api, bucket, checkOrigin, requireStudio, StudioError } from '@/lib/studio-server';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

function validId(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new StudioError(404, 'Файл не найден.');
}

export async function GET(request: Request, context: RouteContext) {
  return api(async () => {
    await requireStudio();
    const { id } = await context.params;
    validId(id);
    const store = bucket();
    const range = request.headers.get('range');
    let offset = 0;
    let length: number | null = null;
    let total: number | null = null;
    if (range) {
      const metadata = await store.head(id);
      if (!metadata) throw new StudioError(404, 'Файл не найден.');
      total = metadata.size;
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      const invalid = () => new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${metadata.size}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store' } });
      if (!match || (!match[1] && !match[2])) return invalid();
      if (!match[1]) {
        const suffix = Number(match[2]);
        if (!Number.isSafeInteger(suffix) || suffix < 1) return invalid();
        offset = Math.max(0, metadata.size - suffix);
        length = metadata.size - offset;
      } else {
        offset = Number(match[1]);
        const end = match[2] ? Math.min(Number(match[2]), metadata.size - 1) : metadata.size - 1;
        if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset >= metadata.size || end < offset) return invalid();
        length = end - offset + 1;
      }
    }
    const object = await store.get(id, length !== null ? { range: { offset, length } } : undefined);
    if (!object) throw new StudioError(404, 'Файл не найден.');
    const name = object.customMetadata?.name || encodeURIComponent('Файл');
    const type = object.httpMetadata?.contentType || 'application/octet-stream';
    const safeInline = /^(video\/(mp4|webm|quicktime)|audio\/(mpeg|mp4|ogg|wav|webm))$/i.test(type);
    const headers = new Headers({
      'Content-Type': type,
      'Content-Length': String(length ?? object.size),
      'Accept-Ranges': 'bytes',
      'Content-Disposition': `${safeInline ? 'inline' : 'attachment'}; filename="download"; filename*=UTF-8''${name}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store',
      'ETag': object.httpEtag,
    });
    if (length !== null) headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${total}`);
    return new Response(object.body, { status: length !== null ? 206 : 200, headers });
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  return api(async () => {
    checkOrigin(request);
    const session = await requireStudio();
    if (session.user.role !== 'owner') throw new StudioError(403, 'Удалить файл может только владелец студии.');
    const { id } = await context.params;
    validId(id);
    await bucket().delete(id);
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
  });
}
