import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const block = html.match(/\/\* @engine-start \*\/([\s\S]*?)\/\* @engine-end \*\//);
if (!block) throw new Error('engine block missing');

const engine = new Function(`${block[1]}\nreturn {
  parseDocument,
  analyzeRounds,
  layoutOf,
  chartOptions,
  renderSvgDocument,
  renderChartContent,
  TEMPLATES,
  ERROR_SAMPLE,
};`)();

let passed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
}

function produces(text, mode = 'auto') {
  const doc = engine.parseDocument(text, mode);
  assert(doc.ok, `expected ok: ${text}\n${doc.errors.map((item) => item.message).join('\n')}`);
  return engine.analyzeRounds(doc.rounds).map((row) => row.produce);
}

function layoutTemplate(id, opt) {
  const template = engine.TEMPLATES.find((item) => item.id === id);
  const doc = engine.parseDocument(template.text, 'auto');
  assert(doc.ok, `${id} failed: ${doc.errors.map((item) => item.message).join(' | ')}`);
  const layout = engine.layoutOf(doc, engine.chartOptions(opt));
  return { doc, layout, template };
}

const ball = layoutTemplate('ball');
assert(ball.doc.mode === 'round', 'ball is round');
assert(JSON.stringify(engine.analyzeRounds(ball.doc.rounds).map((row) => row.produce)) === JSON.stringify([6, 12, 18, 24, 30, 36, 42, 42]), 'ball counts');
assert(ball.layout.warnings.length === 0, 'ball warnings');
assert(ball.layout.symbols.length === 210, `ball symbols ${ball.layout.symbols.length}`);
assert(ball.layout.center === true, 'ball has center ring');

const round2 = ball.layout.symbols.filter((symbol) => symbol.roundIndex === 1);
assert(round2.length === 12, 'round 2 visual stitches');
const round2Steps = [];
for (let index = 1; index < round2.length; index += 1) {
  let delta = round2[index].angle - round2[index - 1].angle;
  if (delta < 0) delta += Math.PI * 2;
  round2Steps.push(delta);
}
assert(Math.max(...round2Steps) < 1.05, `round 2 still has a spoke ${Math.max(...round2Steps)}`);
assert(Math.min(...round2Steps) > 0.2, `round 2 stitches collide ${Math.min(...round2Steps)}`);
const round2Stems = ball.layout.stems.filter((stem) => stem.roundIndex === 1);
assert(round2Stems.length === 12, 'round 2 stems');
for (let index = 0; index < 12; index += 2) {
  const shared = Math.hypot(round2Stems[index].x1 - round2Stems[index + 1].x1, round2Stems[index].y1 - round2Stems[index + 1].y1);
  assert(shared < 0.6, 'increase pair grows from one stitch');
}
const radii = [0, 1, 2, 3, 4, 5, 6, 7].map((roundIndex) => {
  const symbol = ball.layout.symbols.find((item) => item.roundIndex === roundIndex);
  return Math.hypot(symbol.x, symbol.y);
});
for (let index = 1; index < radii.length; index += 1) {
  assert(radii[index] > radii[index - 1] + 10, 'rounds move outward');
}

const head = layoutTemplate('head');
assert(JSON.stringify(engine.analyzeRounds(head.doc.rounds).map((row) => row.produce)) === JSON.stringify([6, 12, 18, 24, 30, 30, 30, 24, 18, 12, 6]), 'head counts');
assert(head.layout.warnings.length === 0, 'head warnings');
assert(head.layout.symbols.filter((symbol) => symbol.roundIndex === 10 && symbol.role === 'dec').length === 6, 'head closes with 6 decreases');

const coaster = layoutTemplate('coaster');
assert(JSON.stringify(engine.analyzeRounds(coaster.doc.rounds).map((row) => row.produce)) === JSON.stringify([8, 16, 24, 32, 40, 40]), 'coaster counts');
assert(coaster.layout.warnings.length === 0, 'coaster warnings');
assert(coaster.layout.symbols.filter((symbol) => symbol.role === 'sl').length === 40, 'slip stitch border');

const scarf = layoutTemplate('scarf');
assert(scarf.doc.mode === 'flat', 'scarf is flat');
assert(scarf.layout.warnings.length === 0, `scarf warnings ${scarf.layout.warnings.map((item) => item.message).join('; ')}`);
assert(scarf.layout.symbols.length === 96, `scarf symbols ${scarf.layout.symbols.length}`);
assert(scarf.layout.center === false, 'flat has no ring');

function averageX(layout, roundIndex, role) {
  const values = layout.symbols.filter((symbol) => symbol.roundIndex === roundIndex && symbol.role === role).map((symbol) => symbol.x);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

assert(averageX(scarf.layout, 2, 'sc') < averageX(scarf.layout, 2, 'dc'), 'row 2 starts on the left');
assert(averageX(scarf.layout, 3, 'sc') > averageX(scarf.layout, 3, 'dc'), 'row 3 turns back');

const tube = layoutTemplate('tube');
assert(tube.doc.rounds.length === 30, 'tube rounds');
assert(tube.layout.warnings.length === 0, 'tube warnings');
assert(engine.analyzeRounds(tube.doc.rounds).at(-1).produce === 30, 'tube stays at 30');

const mismatch = engine.parseDocument('环形起针\nR1: 6x\nR2: 5x', 'auto');
assert(mismatch.ok, 'mismatch still parses');
const mismatchLayout = engine.layoutOf(mismatch, engine.chartOptions());
assert(mismatchLayout.warnings.length === 1, 'mismatch warns');
assert(mismatchLayout.symbols.length === 11, 'mismatch still draws');

const chinese = engine.parseDocument('环形起针\n第1圈：6短针\n第2圈：6加针\n第3圈：（短针，加针）×6', 'auto');
assert(chinese.ok, `chinese failed ${chinese.errors.map((item) => item.message).join(' | ')}`);
assert(chinese.mode === 'round', 'chinese round');
assert(JSON.stringify(engine.analyzeRounds(chinese.rounds).map((row) => row.produce)) === JSON.stringify([6, 12, 18]), `chinese counts ${engine.analyzeRounds(chinese.rounds).map((row) => row.produce)}`);

const broken = engine.parseDocument(engine.ERROR_SAMPLE, 'auto');
assert(!broken.ok, 'error sample fails');
assert(broken.errors.length === 2, `expected 2 errors, got ${broken.errors.length}`);
assert(broken.errors[0].message.includes('括号'), broken.errors[0].message);
assert(broken.errors[1].message.includes('k'), broken.errors[1].message);

const future = engine.parseDocument('R1: 6hdc', 'auto');
assert(!future.ok && future.errors[0].message.includes('中长针'), future.errors[0] && future.errors[0].message);

const hidden = engine.layoutOf(ball.doc, engine.chartOptions({ title: '经典圆球', hiddenLabels: [0] }));
assert(hidden.title.text === '经典圆球', 'title attached');
assert(!hidden.labels.some((label) => label.text === 'R1'), 'hidden label');
assert(hidden.labels.some((label) => label.text === 'R2'), 'other labels stay');

const svg = engine.renderSvgDocument(hidden, engine.chartOptions({ bg: 'white' }));
assert(svg.includes('xmlns="http://www.w3.org/2000/svg"'), 'svg namespace');
assert(svg.includes('经典圆球'), 'svg title');
assert(svg.includes('<circle'), 'svg draws rings');

const flatDecrease = engine.parseDocument('往返编织\n起针: 8ch\n行1: 8x\n行2: a*4', 'auto');
assert(flatDecrease.ok, flatDecrease.errors.map((item) => item.message).join(' | '));
const decreaseLayout = engine.layoutOf(flatDecrease, engine.chartOptions());
assert(decreaseLayout.warnings.length === 0, 'flat decrease aligns');
assert(decreaseLayout.symbols.filter((symbol) => symbol.roundIndex === 2 && symbol.role === 'dec').length === 4, 'four decreases');

const forced = engine.parseDocument(scarf.template.text, 'round');
assert(forced.mode === 'round', 'forced round');
assert(engine.layoutOf(forced, engine.chartOptions()).warnings.length === 0, 'scarf can also be drawn in the round');

console.log(`ok ${passed}`);
