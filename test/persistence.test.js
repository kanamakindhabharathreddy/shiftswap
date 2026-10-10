import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from '../store.js';

const organizerSeed = fileURLToPath(new URL('../seed.json', import.meta.url));

function savedState(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return JSON.parse(db.prepare('SELECT json FROM state WHERE id=1').get().json); }
  finally { db.close(); }
}

test('every handover action is durable before close and all data survives reopening without a seed', () => {
  const directory = mkdtempSync(join(tmpdir(), 'shiftswap-durable-'));
  const file = join(directory, 'state.sqlite');
  let store;
  try {
    store = createStore(file, organizerSeed);
    assert.equal(store.act('S2', 'post', 'SH007').ok, true);
    const posted = savedState(file);
    const listing = posted.listings.find(item => item.shift_id === 'SH007');
    assert.equal(listing.status, 'OPEN');
    assert.equal(posted.history.at(-1).action, 'post');
    assert.equal(posted.shifts.find(item => item.id === 'SH007').assigned_to, 'S2');

    assert.equal(store.act('S8', 'claim', listing.id).ok, true);
    const claimed = savedState(file);
    assert.equal(claimed.listings[0].status, 'CLAIMED');
    assert.equal(claimed.listings[0].claimer_id, 'S8');
    assert.equal(claimed.shifts.find(item => item.id === 'SH007').assigned_to, 'S2');
    assert.equal(claimed.history.at(-1).actor_id, 'S8');

    assert.equal(store.act('M1', 'approve', listing.id).ok, true);
    const approved = savedState(file);
    assert.equal(approved.listings[0].status, 'APPROVED');
    assert.equal(approved.shifts.find(item => item.id === 'SH007').assigned_to, 'S8');
    assert.equal(approved.history.at(-1).assigned_from, 'S2');
    assert.equal(approved.history.at(-1).assigned_to, 'S8');
    assert.deepEqual(approved.staff, posted.staff);
    store.close(); store = null;

    // A missing seed must be irrelevant once the database contains saved state.
    store = createStore(file, join(directory, 'missing-seed.json'));
    assert.deepEqual(savedState(file), approved);
    assert.equal(store.act('S2', 'post', 'SH007').ok, false);
    const refused = savedState(file);
    for (const key of ['staff', 'shifts', 'listings']) assert.deepEqual(refused[key], approved[key]);
    assert.deepEqual(refused.history.slice(0, -1), approved.history);
    assert.equal(refused.history.at(-1).outcome, 'REFUSED');
    store.close(); store = null;
    store = createStore(file, { staff: [], shifts: [] });
    assert.deepEqual(savedState(file), refused);
  } finally {
    store?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a database write failure rolls back assignment, listing and history together and releases the transaction', () => {
  const directory = mkdtempSync(join(tmpdir(), 'shiftswap-rollback-'));
  const file = join(directory, 'state.sqlite');
  let store, fault;
  try {
    store = createStore(file, organizerSeed);
    assert.equal(store.act('S2', 'post', 'SH007').ok, true);
    const listing = savedState(file).listings[0];
    assert.equal(store.act('S8', 'claim', listing.id).ok, true);
    const before = savedState(file);
    fault = new DatabaseSync(file);
    fault.exec("CREATE TRIGGER reject_test_write BEFORE UPDATE ON state BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END;");
    assert.throws(() => store.act('M1', 'approve', listing.id), /simulated storage failure/);
    assert.deepEqual(savedState(file), before);
    fault.exec('DROP TRIGGER reject_test_write');
    fault.close(); fault = null;
    assert.equal(store.act('M1', 'approve', listing.id).ok, true);
    const after = savedState(file);
    assert.equal(after.listings[0].status, 'APPROVED');
    assert.equal(after.shifts.find(item => item.id === 'SH007').assigned_to, 'S8');
    assert.equal(after.history.length, before.history.length + 1);
    store.close(); store = null;
    store = createStore(file, join(directory, 'missing-seed.json'));
    assert.deepEqual(savedState(file), after);
  } finally {
    fault?.close(); store?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
