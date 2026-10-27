import { api, checkOrigin, database, readJson, requireStudio, stampTransitions, stateUpdateSchema, studioResponse, StudioError, validateLifecycle, validateStateRelations } from '@/lib/studio-server';
import type { StudioState } from '@/app/studio-model';

export const dynamic = 'force-dynamic';

export async function GET() {
  return api(async () => studioResponse(await requireStudio()));
}

export async function PUT(request: Request) {
  return api(async () => {
    checkOrigin(request);
    const session = await requireStudio();
    const { state, revision } = stateUpdateSchema.parse(await readJson(request));
    if (revision !== session.workspace.revision) throw new StudioError(409, 'Курс уже изменён в другом окне или сотрудником. Обнови данные перед сохранением.');
    validateStateRelations(state);
    const previous = JSON.parse(session.workspace.state_json) as StudioState;
    await validateLifecycle(state, previous);
    stampTransitions(state, previous, session.user);
    const result = await database().prepare('UPDATE studio_workspaces SET state_json = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?')
      .bind(JSON.stringify(state), new Date().toISOString(), session.workspace.id, revision).run();
    if (!result.meta.changes) throw new StudioError(409, 'Данные изменились во время сохранения. Обнови страницу.');
    return studioResponse(session, state, revision + 1);
  });
}
