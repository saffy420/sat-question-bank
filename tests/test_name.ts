// Account names (src/name.js): the identity provider's forward slashes are dropped, and so are the spaces they leave.
//
//   node --test tests/test_name.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { cleanName, accountName } from '../src/name.js';

test('cleanName drops every forward slash and tidies the spaces', () => {
  assert.equal(cleanName('/Leon Chakraborty'), 'Leon Chakraborty');
  assert.equal(cleanName('/ Leon Chakraborty'), 'Leon Chakraborty');
  assert.equal(cleanName('Leon / Chakraborty/'), 'Leon Chakraborty');
  assert.equal(cleanName('Leon Chakraborty'), 'Leon Chakraborty');
  assert.equal(cleanName('/'), '');
  assert.equal(cleanName(undefined), '');
  assert.equal(cleanName(null), '');
});

test('accountName prefers full_name, then name, and is empty when both are', () => {
  assert.equal(accountName({ user_metadata: { full_name: '/Leon Chakraborty', name: 'x' } }), 'Leon Chakraborty');
  assert.equal(accountName({ user_metadata: { full_name: '/', name: '/Leon' } }), 'Leon');
  assert.equal(accountName({ user_metadata: {} }), '');
  assert.equal(accountName({}), '');
});

test('the D1 data fix gives stored names the same result, and leaves clean names alone', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, name TEXT)');
  const names = ['/Leon Chakraborty', '/ Leon Chakraborty', 'Leon / Chakraborty/', 'Ada Lovelace', '/', null];
  const put = db.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)');
  names.forEach((n, i) => put.run('u' + i, `u${i}@example.com`, n));
  db.exec(readFileSync(new URL('../data-fixes/main/0001_user_name_slashes.sql', import.meta.url), 'utf8'));
  const after = db.prepare('SELECT name FROM users ORDER BY id').all().map((r: any) => r.name);
  assert.deepEqual(after, ['Leon Chakraborty', 'Leon Chakraborty', 'Leon Chakraborty', 'Ada Lovelace', null, null]);
  assert.deepEqual(after.slice(0, 4), names.slice(0, 4).map(cleanName));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE name LIKE '%/%'").get()['n'], 0);
});
