import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = { window: {} };
for (const file of ['case-data.js', 'prompt.js']) {
  vm.runInNewContext(fs.readFileSync(path.join(root, 'apps/extension/src/data', file), 'utf8'), sandbox, { filename: file });
}
const data = sandbox.window.BT_CASE;
data.facts = data.facts.filter(f => f.k !== '入院信息');
const output = {
  title: data.systemTitle,
  patient: data.patient,
  facts: data.facts.filter(f => f.k !== '入院信息'),
  unknowns: data.unknowns,
  knowledge: data.knowledge,
  days: Object.entries(data.postopDays).map(([day, value]) => ({ day: Number(day), ...value })),
  scenarios: data.scenarios.map(scene => ({
    ...scene,
    systems: (scene.phase === 'postop' ? [1, 2, 3, 7] : [0]).map(day => ({ day,
      system: sandbox.window.BT_PROMPT.buildSystemPrompt({
      scenarioId: scene.id, phase: scene.phase, client: 'godot-rebuild', mode: 'study'
      , postopDay: day || undefined
      })
    }))
  }))
};
const destination = path.resolve(root, '../godot-rebuild/data/CourseContent.json');
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, JSON.stringify(output, null, 2));
console.log(`Course content: ${output.scenarios.length} scenarios, ${output.facts.length} facts, ${output.knowledge.length} lessons`);
