import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { eligibility, minutes, weeklyImpact } from './rules.js';

export function createStore(file, seed) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);`);
  // Serialize first-run initialization too, so concurrent server starts cannot reseed.
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare('SELECT id FROM state WHERE id=1').get()) {
      const initial = typeof seed === 'string' ? JSON.parse(readFileSync(seed, 'utf8')) : structuredClone(seed);
      validateSeed(initial);
      db.prepare('INSERT INTO state VALUES (1, ?)').run(JSON.stringify({ ...initial, listings: [], history: [] }));
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }
  function read() { return JSON.parse(db.prepare('SELECT json FROM state WHERE id=1').get().json); }
  function view(actorId) {
    const state = read(), actor = state.staff.find(p => p.id === actorId);
    return { ...state, revision: state.history.length, listings: state.listings.map(l => {
      const shift = state.shifts.find(s => s.id === l.shift_id);
      const claimant = state.staff.find(p => p.id === l.claimer_id);
      const viewer = actor?.role === 'STAFF' && l.status === 'OPEN' ? actor : claimant;
      return {
        ...l,
        reasons: actor?.role === 'STAFF' && l.status === 'OPEN' ? eligibility(actor, shift, state.shifts) : [],
        approval_reasons: l.status === 'CLAIMED' && claimant ? eligibility(claimant, shift, state.shifts, { approval: true }) : [],
        hours_impact: viewer && ['OPEN', 'CLAIMED'].includes(l.status) ? weeklyImpact(viewer, shift, state.shifts) : null
      };
    }) };
  }
  function act(actorId, action, targetId) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const s = read(), actor = s.staff.find(p => p.id === actorId);
      const originalListing = action === 'post' ? null : s.listings.find(l => l.id === targetId);
      const originalShift = s.shifts.find(x => x.id === (action === 'post' ? targetId : originalListing?.shift_id));
      const previousStatus = originalListing?.status ?? null;
      const previousOwner = originalShift?.assigned_to ?? null;
      const previousClaimant = originalListing?.claimer_id ?? null;
      let shift, listing, reasons = [];
      const refuse = message => { reasons = [{ message }]; };
      if (!actor) refuse('Unknown person.');
      else if (action === 'post') {
        shift = s.shifts.find(x => x.id === targetId);
        if (actor.role !== 'STAFF' || !shift || shift.assigned_to !== actor.id) refuse('Only the staff member assigned to this shift can post it.');
        else if (s.listings.some(l => l.shift_id === shift.id && ['OPEN','CLAIMED'].includes(l.status))) refuse('This shift already has an active listing.');
        else { listing = {id: `l${s.history.length + 1}`, shift_id: shift.id, poster_id: actor.id, claimer_id: null, status: 'OPEN'}; s.listings.push(listing); }
      } else if (!['withdraw','claim','unclaim','approve','reject'].includes(action)) refuse('Unknown action.');
      else {
        listing = s.listings.find(l => l.id === targetId);
        shift = s.shifts.find(x => x.id === listing?.shift_id);
        if (!listing) refuse('Listing does not exist.');
        else if (action === 'claim') {
          if (listing.status !== 'OPEN') refuse('no longer available');
          else if (actor.role !== 'STAFF') refuse('Managers cannot claim shifts.');
          else { reasons = eligibility(actor, shift, s.shifts); if (!reasons.length) { listing.status = 'CLAIMED'; listing.claimer_id = actor.id; } }
        } else if (action === 'withdraw') {
          if (actor.role !== 'STAFF' || listing.poster_id !== actor.id || listing.status !== 'OPEN') refuse('Only the poster can withdraw an OPEN listing.');
          else listing.status = 'WITHDRAWN';
        } else if (action === 'unclaim') {
          if (actor.role !== 'STAFF' || listing.claimer_id !== actor.id || listing.status !== 'CLAIMED') refuse('Only the claimer can unclaim a CLAIMED listing.');
          else { listing.status = 'OPEN'; listing.claimer_id = null; }
        } else {
          if (actor.role !== 'MANAGER' || listing.status !== 'CLAIMED') refuse('Only managers can approve or reject CLAIMED listings.');
          else if (action === 'reject') { listing.status = 'OPEN'; listing.claimer_id = null; }
          else {
            const claimant = s.staff.find(p => p.id === listing.claimer_id);
            reasons = eligibility(claimant, shift, s.shifts, {approval: true});
            if (!reasons.length) { shift.assigned_to = claimant.id; listing.status = 'APPROVED'; }
          }
        }
      }
      const ok = reasons.length === 0;
      s.history.push({
        id: s.history.length + 1,
        actor_id: actorId,
        action,
        shift_id: shift?.id ?? listing?.shift_id ?? (action === 'post' ? targetId : null),
        target_id: targetId,
        listing_id: listing?.id ?? null,
        outcome: ok ? 'SUCCESS' : 'REFUSED',
        previous_status: previousStatus,
        resulting_status: listing?.status ?? null,
        assigned_from: previousOwner,
        assigned_to: shift?.assigned_to ?? previousOwner,
        claimer_id: listing?.claimer_id ?? previousClaimant,
        reasons
      });
      db.prepare('UPDATE state SET json=? WHERE id=1').run(JSON.stringify(s));
      db.exec('COMMIT');
      return {ok, reasons};
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return {view, act, close: () => db.close()};
}
function validateSeed(s) {
  if (!Array.isArray(s.staff) || !Array.isArray(s.shifts)) throw new Error('Seed requires staff and shifts arrays');
  for (const key of ['staff','shifts']) {
    if (new Set(s[key].map(x => x.id)).size !== s[key].length || s[key].some(x => typeof x.id !== 'string' || !x.id)) throw new Error(`Invalid or duplicate ${key} IDs`);
  }
  for (const p of s.staff) if (!['STAFF','MANAGER'].includes(p.role) || typeof p.name !== 'string' || !Array.isArray(p.certifications) || p.certifications.some(c => typeof c !== 'string')) throw new Error('Invalid staff');
  for (const shift of s.shifts) {
    const owner = s.staff.find(p => p.id === shift.assigned_to);
    if (!owner || owner.role !== 'STAFF' || minutes(shift.end) <= minutes(shift.start) || !(shift.required_certification === null || typeof shift.required_certification === 'string')) throw new Error('Invalid shift');
    if (eligibility(owner, shift, s.shifts, {approval: true}).length) throw new Error(`Seed roster violates rules for ${shift.id}`);
  }
}
