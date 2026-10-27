import { api, bucket, checkOrigin, MAX_FILE_BYTES, readLimited, requireStudio, StudioError } from '@/lib/studio-server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return api(async () => {
    checkOrigin(request);
    await requireStudio();
    const params = new URL(request.url).searchParams;
    const name = (params.get('name') || 'Файл').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 1000);
    const mime = (params.get('mime') || request.headers.get('content-type') || 'application/octet-stream').slice(0, 200);
    if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(mime)) throw new StudioError(400, 'Неподдерживаемый тип файла.');
    const bytes = await readLimited(request, MAX_FILE_BYTES);
    if (!bytes.byteLength) throw new StudioError(400, 'Файл пуст.');
    const id = crypto.randomUUID();
    await bucket().put(id, bytes, { httpMetadata: { contentType: mime }, customMetadata: { name: encodeURIComponent(name) } });
    return Response.json({ id, url: '/api/assets/' + id, name, size: bytes.byteLength, mime }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
  });
}
