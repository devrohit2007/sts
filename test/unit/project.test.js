'use strict';
// Project hygiene: catches the mistakes that make a deploy silently run old or missing code.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const pub = path.join(root, 'public');
const read = (p) => fs.readFileSync(p, 'utf8');
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

test('there is exactly one copy of the project (no nested sts-main folder, no stray duplicates)', () => {
  const top = fs.readdirSync(root);
  assert.ok(!top.includes('sts-main'), 'nested sts-main/ folder found: upload the project contents, not the folder');
  assert.ok(!top.some((n) => /\s\./.test(n) || /\(\d+\)/.test(n)), 'file names with spaces or " (1)" copies found: ' + top.join(', '));
});

test('every JavaScript file under public/js is actually loaded by a page (no stray copies)', () => {
  const entries = [];
  for (const html of ['index.html', 'translate.html']) {
    for (const m of read(path.join(pub, html)).matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)) entries.push(path.join(pub, m[1]));
  }
  assert.ok(entries.length >= 2);
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    assert.ok(fs.existsSync(file), 'imported file is missing: ' + path.relative(root, file));
    seen.add(file);
    const src = read(file);
    for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*)'(\.{1,2}\/[^']+)'/g)) visit(path.resolve(path.dirname(file), m[1]));
  };
  entries.forEach(visit);
  const all = walk(path.join(pub, 'js')).filter((f) => f.endsWith('.js'));
  // aslVocabulary.js is the target word list: used by the tests and training/vocabulary.json, not by a page.
  const reference = new Set([path.join(pub, 'js/recognition/aslVocabulary.js')]);
  const unused = all.filter((f) => !seen.has(f) && !reference.has(f)).map((f) => path.relative(root, f));
  assert.deepEqual(unused, [], 'files that no page loads (wrong folder?)');
});

test('every element id the scripts look up exists in the page that loads them', () => {
  const cases = [['index.html', ['js/call/main.js', 'js/call/captions.js', 'js/ui.js']], ['translate.html', ['js/app.js']]];
  for (const [html, scripts] of cases) {
    const page = read(path.join(pub, html));
    const ids = new Set([...page.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    for (const s of scripts) {
      for (const m of read(path.join(pub, s)).matchAll(/\$\('([A-Za-z][\w-]*)'\)/g)) {
        assert.ok(ids.has(m[1]), `${s} uses #${m[1]} but ${html} has no such element`);
      }
    }
  }
  const page = read(path.join(pub, 'index.html'));
  for (const t of ['People', 'Chat', 'Transcript']) assert.ok(page.includes(`id="tab${t}"`) && page.includes(`id="pane${t}"`));
});

test('the ASL model files are present and the call page offers ASL letters', () => {
  for (const f of ['model.json', 'group1-shard1of1.bin']) assert.ok(fs.existsSync(path.join(pub, 'models/asl', f)), f);
  const page = read(path.join(pub, 'index.html'));
  assert.match(page, /id="signMode"/); assert.match(page, /value="asl"/);
  const main = read(path.join(pub, 'js/call/main.js'));
  assert.match(main, /loadAslNowModel/); assert.match(main, /getModel:\s*\(\)\s*=>\s*signModel/);
});

test('landscape layouts exist for the call page and the translator', () => {
  for (const f of ['index.html', 'translate.html']) {
    assert.match(read(path.join(pub, f)), /@media \(orientation:landscape\) and \(max-height:720px\)/, f);
  }
});

test('vercel.json is valid JSON', () => {
  const v = JSON.parse(read(path.join(root, 'vercel.json')));
  assert.ok(Array.isArray(v.headers) && v.headers.length >= 1);
});

test('the version in package.json matches the version shown in the app', async () => {
  const { pathToFileURL } = require('node:url');
  const { APP_VERSION } = await import(pathToFileURL(path.join(pub, 'js/version.js')).href);
  assert.equal(JSON.parse(read(path.join(root, 'package.json'))).version, APP_VERSION);
});
