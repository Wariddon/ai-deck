import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySavedModelSettings } from '../src/saved-model-settings.mjs';

test('a delayed task model reply preserves live jobs, completed reports, drafts and the other provider', () => {
  const current = { jobs: [], running: false, connections: { codex: { status: 'ready' } }, workspace: {
    repo: 'project', taskId: 'task', runHistory: [{ id: 'run', finishedAt: 'now' }], savedDraft: { prompt: 'newer draft' },
    agentModels: { codex: { model: 'old' }, claude: { model: 'new peer selection' } },
  } };
  const next = { jobs: [{ key: 'finished-native-job' }], running: true, workspace: { repo: 'project', taskId: 'task',
    runHistory: [{ id: 'run', finishedAt: null }], savedDraft: { prompt: 'old draft' },
    agentModels: { codex: { model: 'selected', effort: 'low', speed: 'fast' }, claude: { model: 'old peer selection' } },
  } };
  const result = applySavedModelSettings(current, next, { agent: 'codex', scope: 'task', repo: 'project', taskId: 'task' });
  assert.deepEqual(result.workspace.agentModels.codex, next.workspace.agentModels.codex);
  assert.strictEqual(result.workspace.agentModels.claude, current.workspace.agentModels.claude);
  for (const key of ['jobs', 'running', 'connections']) assert.strictEqual(result[key], current[key]);
  for (const key of ['runHistory', 'savedDraft']) assert.strictEqual(result.workspace[key], current.workspace[key]);
});

test('late project/default model replies change only that provider and preserve task overrides', () => {
  const current = { agentSettings: { codex: { model: 'old' }, claude: { model: 'peer' } }, workspace: { repo: 'project', taskId: 'newer-task',
    models: { codex: { model: 'project-old' } }, agentModels: { codex: { model: 'task-override' } } }, jobs: [] };
  const next = { agentSettings: { codex: { model: 'default-new' } }, workspace: { repo: 'project', taskId: 'older-task', models: { codex: { model: 'project-new' } } } };
  const project = applySavedModelSettings(current, next, { agent: 'codex', scope: 'project', repo: 'project' });
  assert.equal(project.workspace.models.codex.model, 'project-new'); assert.equal(project.workspace.taskId, 'newer-task');
  assert.strictEqual(project.workspace.agentModels, current.workspace.agentModels);
  const defaults = applySavedModelSettings(project, next, { agent: 'codex', scope: 'default' });
  assert.equal(defaults.agentSettings.codex.model, 'default-new'); assert.equal(defaults.agentSettings.claude.model, 'peer');
  assert.strictEqual(defaults.workspace, project.workspace); assert.strictEqual(defaults.jobs, current.jobs);
});

test('using inherited settings removes only the selected override and rejects a foreign task/project', () => {
  const current = { workspace: { repo: 'project', taskId: 'task', agentModels: { codex: { model: 'old' }, claude: { model: 'peer' } } } };
  const next = { workspace: { repo: 'project', taskId: 'task', agentModels: {} } }, payload = { agent: 'codex', scope: 'task', repo: 'project', taskId: 'task' };
  const result = applySavedModelSettings(current, next, payload);
  assert.deepEqual(result.workspace.agentModels, { claude: { model: 'peer' } });
  for (const changes of [{ repo: 'foreign' }, { taskId: 'other' }]) assert.strictEqual(applySavedModelSettings(current, next, { ...payload, ...changes }), current);
});
