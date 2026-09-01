import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('./.github/workflows/verify-evidence.yml', import.meta.url), 'utf8');

function extractLikeWorkflow(body) {
  const beginMarker = '<!-- ALEX-EVIDENCE-BEGIN -->';
  const endMarker = '<!-- ALEX-EVIDENCE-END -->';
  const begin = body.indexOf(beginMarker);
  const end = body.indexOf(endMarker);
  let between = body.slice(begin + beginMarker.length, end).trim();
  const openingFence = '```json';
  const closingFence = '```';
  assert.ok(between.startsWith(openingFence));
  assert.ok(between.endsWith(closingFence));
  return between.slice(openingFence.length, -closingFence.length)
    .replace(/^\r?\n/, '').replace(/\r?\n$/, '');
}

test('Evidence-Extraktor bewahrt Backticks innerhalb signierter JSON-Inhalte', () => {
  const bundle = { controller_evidence: { diff_full: '```bash\nnpm test\n```' } };
  const json = JSON.stringify(bundle, null, 2);
  const comment = `Vorspann\n<!-- ALEX-EVIDENCE-BEGIN -->\n\`\`\`json\n${json}\n\`\`\`\n<!-- ALEX-EVIDENCE-END -->`;
  assert.equal(extractLikeWorkflow(comment), json);
  assert.deepEqual(JSON.parse(extractLikeWorkflow(comment)), bundle);
});

test('Workflow nutzt keine globale Backtick-Entfernung', () => {
  assert.doesNotMatch(workflow, /replace\(\/```\/g/);
  assert.match(workflow, /slice\(openingFence\.length, -closingFence\.length\)/);
});