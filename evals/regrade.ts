/**
 * Grade the last run again, without spending anything.
 *
 * A full run costs real money, and most of what a run measures is not the
 * model: it is the cases and the grader. Both change often — an expectation
 * written before applySettings could carry a filter, a rule about which extra
 * calls count. Re-grading the saved calls answers "did that change help?" for
 * free, and only a change to what the model DOES needs the money again.
 *
 *   npm run eval:regrade
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { grade } from './grade';
import type { CaseResult, EvalCase } from './types';

const RESULTS = 'evals/results';

const files = readdirSync(RESULTS).filter((f) => f.endsWith('.json')).sort();
if (files.length === 0) {
  console.error('No saved runs in evals/results — run `npm run eval` first.');
  process.exit(1);
}
const latest = files[files.length - 1];
const report = JSON.parse(readFileSync(join(RESULTS, latest), 'utf8')) as {
  results: CaseResult[];
};
const { cases } = JSON.parse(readFileSync('evals/cases.json', 'utf8')) as { cases: EvalCase[] };
const byId = new Map(cases.map((c) => [c.id, c]));

let before = 0;
let after = 0;
const fixed: string[] = [];
const broken: string[] = [];
const failing: { id: string; reason: string }[] = [];

for (const result of report.results) {
  const testCase = byId.get(result.id);
  if (!testCase) continue;
  // A provider error is not something re-grading can second-guess.
  const errored = result.error && result.actual.length === 0 ? result.error : undefined;
  const verdict = grade(testCase, result.actual, errored);
  if (result.pass) before += 1;
  if (verdict.pass) after += 1;
  if (!result.pass && verdict.pass) fixed.push(result.id);
  if (result.pass && !verdict.pass) broken.push(result.id);
  if (!verdict.pass) failing.push({ id: result.id, reason: verdict.reason });
}

const total = report.results.length;
console.log(`Re-graded ${latest}\n`);
console.log(`  ${before}/${total} → ${after}/${total}\n`);
if (fixed.length) console.log(`Now passing (${fixed.length}):\n  ${fixed.join('\n  ')}\n`);
if (broken.length) console.log(`NOW FAILING (${broken.length}):\n  ${broken.join('\n  ')}\n`);
console.log(`Still failing (${failing.length}):`);
for (const f of failing) console.log(`  ${f.id.padEnd(30)} ${f.reason}`);
console.log(
  '\nThis only re-scores calls the model already made. A change to the prompt,\n' +
    'the tools, or the harness needs a real run to measure.'
);
