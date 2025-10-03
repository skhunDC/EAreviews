const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const htmlPath = path.join(projectRoot, 'index.html');

const html = fs.readFileSync(htmlPath, 'utf8');

test('index.html exists', () => {
  assert.ok(fs.existsSync(htmlPath), 'index.html should exist');
});

test('Tailwind CDN script is not referenced', () => {
  assert.ok(!/cdn\\.tailwindcss\\.com/.test(html), 'Tailwind CDN should not be referenced');
});

test('Key utility classes are defined locally', () => {
  const utilities = [
    '.flex{',
    '.items-center{',
    '.justify-between{',
    '.rounded-full{',
    '.bg-emerald-600{'
  ];
  for (const utility of utilities) {
    assert.ok(html.includes(utility), `Expected to find utility class definition for ${utility}`);
  }
});

test('FullCalendar initialization safely accesses plugins', () => {
  const snippets = [
    'const fc=window.FullCalendar;',
    "typeof fc.Calendar!=='function'",
    '.filter(Boolean)'
  ];
  for (const snippet of snippets) {
    assert.ok(html.includes(snippet), `Expected initCalendar to include snippet: ${snippet}`);
  }
});
