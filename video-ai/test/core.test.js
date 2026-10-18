const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = path.join(os.tmpdir(), `gva-test-${process.pid}`);

const { chooseWindow, buildAss, chunkSegment } = require('../src/pipeline');
const { generateTexts, CATEGORIES } = require('../src/captions');
const { toLittleText } = require('../src/platforms/linkedin');
const { chunkPlan } = require('../src/platforms/tiktok');

test('kurze Clips werden auf 15 s geloopt, mittlere bleiben ganz', () => {
  assert.deepStrictEqual(chooseWindow(8), { start: 0, length: 15, loop: true });
  assert.deepStrictEqual(chooseWindow(22), { start: 0, length: 22, loop: false });
});

test('lange Clips: Ausschnitt 15–30 s mit möglichst viel Sprache, ohne angeschnittene Sätze', () => {
  const segs = [
    { start: 40, end: 45, text: 'a' },
    { start: 46, end: 52, text: 'b' },
    { start: 53, end: 60, text: 'c' },
    { start: 70, end: 75, text: 'd' },
  ];
  const w = chooseWindow(120, segs);
  assert.ok(w.length >= 15 && w.length <= 30, `Länge ${w.length}`);
  assert.ok(w.start <= 40 && w.start >= 39, `Start ${w.start}`);
  for (const s of segs) {
    const cutStart = s.start < w.start && s.end > w.start;
    const cutEnd = s.start < w.start + w.length && s.end > w.start + w.length;
    assert.ok(!cutStart && !cutEnd, `Satz ${s.text} angeschnitten`);
  }
});

test('ohne Sprache wird die wacklige Anfangssekunde übersprungen', () => {
  const w = chooseWindow(60);
  assert.ok(w.start >= 1 && w.length === 30);
});

test('Untertitel werden in kurze Häppchen zerlegt und zeitlich verschoben', () => {
  const chunks = chunkSegment({ start: 0, end: 6, text: 'Ich fülle heute den Automaten bei unserem Kunden in Wels auf' });
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((c) => c.text.split(' ').length <= 5));
  assert.strictEqual(chunks.at(-1).end.toFixed(2), '6.00');

  const ass = buildAss({ segments: [{ start: 12, end: 14, text: 'Hallo {Welt}' }], start: 10, length: 20, hook: 'Frisch!' });
  assert.match(ass, /Dialogue: 0,0:00:02.00,0:00:04.00,Sub,,0,0,0,,Hallo Welt/);
  assert.match(ass, /Hook,,0,0,0,,\{\\fad\(200,300\)\}Frisch!/);
});

test('Textvorschläge für alle Plattformen und Kategorien', () => {
  for (const category of Object.keys(CATEGORIES)) {
    const t = generateTexts({ category, note: 'automat in linz befüllt', location: 'Werk Linz' });
    assert.ok(t.instagram.caption.includes('#GREAT'));
    assert.ok(t.instagram.caption.includes('Automat in linz befüllt.'));
    assert.ok(t.facebook.caption.length > 50);
    assert.ok(t.linkedin.caption.includes('#Betriebsverpflegung'));
    assert.ok(t.youtube.title.length <= 100 && t.youtube.title.includes('#Shorts'));
    assert.ok(t.tiktok.caption.length <= 2200);
  }
});

test('LinkedIn: reservierte Zeichen escapen, Hashtags als Markup', () => {
  assert.strictEqual(toLittleText('Frisch (heute) #GREAT'), 'Frisch \\(heute\\) {hashtag|\\#|GREAT}');
});

test('TikTok: Chunk-Plan', () => {
  assert.deepStrictEqual(chunkPlan(20e6), { chunkSize: 20e6, count: 1 });
  const big = 100 * 1024 * 1024 + 123;
  const plan = chunkPlan(big);
  assert.strictEqual(plan.chunkSize, 10 * 1024 * 1024);
  assert.strictEqual(plan.count, 10);
});
