import { api, checkOrigin, readJson } from '@/lib/studio-server';
import { dropboxConfig, dropboxStatus, readDropboxWorkspace, requireDropboxService, saveDropboxSnapshot, validateDropboxSnapshot } from '@/lib/dropbox-sync';
import type { StudioState } from '@/app/studio-model';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return api(async () => {
    await requireDropboxService(request);
    const config = dropboxConfig();
    const row = await readDropboxWorkspace();
    const state = row ? JSON.parse(row.state_json) as StudioState : { courses: [] };
    return Response.json({ ...dropboxStatus(state, config), revision: row?.revision ?? null }, { headers: { 'Cache-Control': 'private, no-store' } });
  });
}

export async function POST(request: Request) {
  return api(async () => {
    checkOrigin(request);
    await requireDropboxService(request);
    const config = dropboxConfig();
    const snapshot = validateDropboxSnapshot(await readJson(request), config);
    return Response.json(await saveDropboxSnapshot(snapshot, config), { headers: { 'Cache-Control': 'private, no-store' } });
  });
}
