import { z } from 'zod';
import { api, bucket, checkOrigin, readJson, readLimited, requireStudio, StudioError } from '@/lib/studio-server';

export const dynamic = 'force-dynamic';

const MAX_VIDEO_BYTES = 10 * 1024 * 1024 * 1024;
const PART_SIZE = 8 * 1024 * 1024;
const MAX_PART_BYTES = 10 * 1024 * 1024;
const MAX_PARTS = 2000;
const objectId = z.string().uuid();
const uploadToken = z.string().min(1).max(2000).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
const common = z.object({ id: objectId, uploadId: uploadToken });
const createSchema = z.object({
  action: z.literal('create'), name: z.string().min(1).max(1000),
  mime: z.string().min(3).max(200), size: z.number().int().min(1).max(MAX_VIDEO_BYTES),
});
const partSchema = common.extend({ partNumber: z.number().int().min(1).max(MAX_PARTS) });
const finishSchema = common.extend({
  action: z.literal('complete'),
  parts: z.array(z.object({ partNumber: z.number().int().min(1).max(MAX_PARTS), etag: z.string().min(1).max(1000).refine(value => !/[\u0000-\u001f\u007f]/.test(value)) })).min(1).max(MAX_PARTS),
});
const abortSchema = common.extend({ action: z.literal('abort') });
const response = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });

export async function POST(request: Request) {
  return api(async () => {
    checkOrigin(request);
    await requireStudio();
    const store = bucket();
    const query = new URL(request.url).searchParams;
    if (query.get('action') === 'part') {
      const params = partSchema.parse({ id: query.get('id'), uploadId: query.get('uploadId'), partNumber: Number(query.get('partNumber')) });
      const bytes = await readLimited(request, MAX_PART_BYTES);
      if (!bytes.byteLength) throw new StudioError(400, 'Часть файла пустая.');
      const part = await store.resumeMultipartUpload(params.id, params.uploadId).uploadPart(params.partNumber, bytes);
      return response({ partNumber: part.partNumber, etag: part.etag });
    }
    const body = await readJson(request);
    const action = typeof body === 'object' && body !== null && 'action' in body ? body.action : null;
    if (action === 'create') {
      const data = createSchema.parse(body);
      const name = data.name.replace(/[\u0000-\u001f\u007f]/g, '').trim();
      if (!name) throw new StudioError(400, 'Укажи название файла.');
      if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(data.mime)) throw new StudioError(400, 'Неподдерживаемый тип файла.');
      const id = crypto.randomUUID();
      const upload = await store.createMultipartUpload(id, {
        httpMetadata: { contentType: data.mime },
        customMetadata: { name: encodeURIComponent(name), declaredSize: String(data.size) },
      });
      return response({ id, uploadId: upload.uploadId, partSize: PART_SIZE }, 201);
    }
    if (action === 'abort') {
      const data = abortSchema.parse(body);
      await store.resumeMultipartUpload(data.id, data.uploadId).abort();
      return response({ ok: true });
    }
    if (action === 'complete') {
      const data = finishSchema.parse(body);
      for (let index = 0; index < data.parts.length; index++) {
        if (data.parts[index].partNumber !== index + 1) throw new StudioError(400, 'Части файла должны идти по порядку, без пропусков и повторений.');
      }
      let file: R2Object | null;
      try {
        await store.resumeMultipartUpload(data.id, data.uploadId).complete(data.parts);
        file = await store.head(data.id);
      } catch (error) {
        // Completion can succeed even when its response is lost; retry safely.
        file = await store.head(data.id);
        if (!file?.customMetadata?.declaredSize) throw error;
      }
      if (!file) throw new StudioError(503, 'Файл ещё не появился в хранилище. Повтори проверку загрузки.');
      const declared = Number(file.customMetadata?.declaredSize);
      if (file.size > MAX_VIDEO_BYTES || !Number.isSafeInteger(declared) || declared < 1 || declared !== file.size) {
        await store.delete(data.id);
        throw new StudioError(400, 'Размер загруженного видео не совпал с исходным. Повтори загрузку файла.');
      }
      let name = 'Видео';
      try { name = decodeURIComponent(file.customMetadata?.name || 'Видео'); } catch { /* Safe fallback for unexpected metadata. */ }
      return response({ id: data.id, url: '/api/assets/' + data.id, name, size: file.size, mime: file.httpMetadata?.contentType || 'application/octet-stream' }, 201);
    }
    throw new StudioError(400, 'Неизвестное действие загрузки.');
  });
}
