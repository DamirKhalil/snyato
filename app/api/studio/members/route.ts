import { api, checkOrigin, database, memberSchema, readJson, requireStudio, StudioError } from '@/lib/studio-server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return api(async () => {
    checkOrigin(request);
    const session = await requireStudio();
    if (session.user.role !== 'owner') throw new StudioError(403, 'Добавить сотрудника может только владелец студии.');
    const data = memberSchema.parse(await readJson(request));
    const email = data.email.toLowerCase().trim();
    const name = data.name.trim() || email.split('@')[0];
    if (email !== session.workspace.owner_email) {
      await database().prepare('INSERT INTO studio_members (email, name, role, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET name = excluded.name')
        .bind(email, name, 'editor', new Date().toISOString()).run();
    }
    const updated = await requireStudio();
    return Response.json({ members: updated.members, platformAccessRequired: true }, { headers: { 'Cache-Control': 'private, no-store' } });
  });
}
