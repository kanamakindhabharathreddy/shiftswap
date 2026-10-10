import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eligibility, minutes, weekStart, weeklyImpact } from '../rules.js';
import { createStore } from '../store.js';
const staff = [{id:'a',name:'Alice',role:'STAFF',certifications:['ICU']},{id:'b',name:'Bob',role:'STAFF',certifications:['ICU']},{id:'c',name:'Carol',role:'STAFF',certifications:[]},{id:'m',name:'Manager',role:'MANAGER',certifications:[]}];
const shift = (id,start,end,owner='a',cert=null) => ({id,start,end,assigned_to:owner,required_certification:cert});
const target = shift('target','2026-03-02T08:00','2026-03-02T16:00');
function fixture(shifts=[target]) {return createStore(':memory:',{staff,shifts});}
test('own shift reports only rule 1, even with other violations',()=>{
  assert.deepEqual(eligibility({...staff[0],certifications:[]},{...target,required_certification:'ICU'},[target]).map(r=>r.rule),[1]);
});
test('all violations include certification, overlap and weekly hours with conflicting shift',()=>{
  const shifts=Array.from({length:5},(_,i)=>shift('x'+i,`2026-03-0${i+2}T08:00`,`2026-03-0${i+2}T16:00`,'c'));
  const errors=eligibility(staff[2],{...target,required_certification:'ICU'},shifts);
  assert.deepEqual(errors.map(r=>r.rule),[2,3,5]); assert.equal(errors[1].shift_id,'x0');
});
test('11 hour rest boundary is inclusive in either chronological direction',()=>{
  const before=shift('before','2026-03-01T13:00','2026-03-01T21:00','b');
  const after=shift('after','2026-03-03T03:00','2026-03-03T11:00','b');
  assert.deepEqual(eligibility(staff[1],target,[before,after]),[]);
  assert.deepEqual(eligibility(staff[1],target,[{...before,end:'2026-03-01T21:01'}]).map(r=>r.rule),[4]);
  assert.deepEqual(eligibility(staff[1],target,[{...after,start:'2026-03-03T02:59'}]).map(r=>r.rule),[4]);
});
test('touching shifts do not overlap, but fail rest rule',()=>{
  assert.deepEqual(eligibility(staff[1],target,[shift('touch','2026-03-02T16:00','2026-03-03T00:00','b')]).map(r=>r.rule),[4]);
});
test('40 hour boundary is inclusive, 40 hours and one minute fails',()=>{
  const shifts=Array.from({length:4},(_,i)=>shift('x'+i,`2026-03-0${i+3}T08:00`,`2026-03-0${i+3}T16:00`,'b'));
  assert.deepEqual(eligibility(staff[1],target,shifts),[]);
  assert.deepEqual(eligibility(staff[1],target,[...shifts.slice(0,3),{...shifts[3],end:'2026-03-06T16:01'}]).map(r=>r.rule),[5]);
});
test('cross-midnight duration and Sunday/Monday week membership',()=>{
  const overnight=shift('overnight','2026-03-08T23:00','2026-03-09T07:00');
  assert.equal(minutes(overnight.end)-minutes(overnight.start),480);
  assert.equal(weekStart(overnight.start),minutes('2026-03-02T00:00'));
  assert.equal(weekStart('2026-03-09T00:00'),minutes('2026-03-09T00:00'));
  const previousWeek=Array.from({length:5},(_,i)=>shift('p'+i,`2026-03-0${i+2}T00:00`,`2026-03-0${i+2}T08:00`,'b'));
  assert.deepEqual(eligibility(staff[1],shift('new','2026-03-09T08:00','2026-03-09T16:00'),previousWeek),[]);
});
test('invalid local timestamps are rejected instead of normalizing',()=>{
  for(const value of ['2026-02-30T08:00','2026-03-02T24:00','2026-03-02T08:60','2026-03-02T08:00Z']) assert.throws(()=>minutes(value));
});
test('post, claim, approval workflow and role enforcement',()=>{
  const store=fixture();
  try {
    assert.equal(store.act('m','post','target').ok,false);
    assert.equal(store.act('a','post','target').ok,true);
    const l=store.view('b').listings[0].id;
    assert.equal(store.act('a','post','target').ok,false);
    assert.equal(store.act('m','claim',l).ok,false);
    assert.equal(store.act('b','claim',l).ok,true);
    assert.equal(store.view('b').shifts[0].assigned_to,'a');
    assert.equal(store.act('a','withdraw',l).ok,false);
    assert.equal(store.act('b','approve',l).ok,false);
    assert.equal(store.act('m','approve',l).ok,true);
    assert.equal(store.view('b').shifts[0].assigned_to,'b');
    assert.equal(store.view('b').listings[0].status,'APPROVED');
    assert.equal(store.view('b').history.length,8);
  } finally {store.close();}
});
test('unclaim and reject reopen, withdraw permits a fresh listing',()=>{
  const store=fixture();try{
    store.act('a','post','target');const l=store.view('b').listings[0].id;
    store.act('b','claim',l);assert.equal(store.act('c','unclaim',l).ok,false);
    assert.equal(store.act('b','unclaim',l).ok,true);
    store.act('c','claim',l);assert.equal(store.act('m','reject',l).ok,true);
    assert.equal(store.view('b').listings[0].claimer_id,null);
    assert.equal(store.act('a','withdraw',l).ok,true);
    assert.equal(store.act('a','post','target').ok,true);
  }finally{store.close();}
});
test('second competing claim gets only no longer available',()=>{
  const store=fixture();try{
    store.act('a','post','target');const l=store.view('b').listings[0].id;
    assert.equal(store.act('b','claim',l).ok,true);
    assert.deepEqual(store.act('a','claim',l).reasons,[{message:'no longer available'}]);
    assert.equal(store.view('b').listings[0].claimer_id,'b');
  }finally{store.close();}
});
test('approval revalidates after another pending claim changes assignments',()=>{
  const second=shift('second','2026-03-02T09:00','2026-03-02T17:00','c');
  const store=fixture([target,second]);try{
    store.act('a','post','target');store.act('c','post','second');
    const [l1,l2]=store.view('b').listings;
    assert.equal(store.act('b','claim',l1.id).ok,true);assert.equal(store.act('b','claim',l2.id).ok,true);
    assert.equal(store.act('m','approve',l1.id).ok,true);
    const result=store.act('m','approve',l2.id);assert.equal(result.ok,false);assert.deepEqual(result.reasons.map(r=>r.rule),[3]);
    assert.equal(store.view('b').listings[1].status,'CLAIMED');assert.equal(store.view('b').shifts[1].assigned_to,'c');
  }finally{store.close();}
});
test('state and history survive restart; saved state is not reseeded',()=>{
  const directory=mkdtempSync(join(tmpdir(),'shiftswap-'));const path=join(directory,'state.sqlite');
  let store;
  try {store=createStore(path,{staff,shifts:[target]});store.act('a','post','target');store.close();store=createStore(path,{staff:[],shifts:[]});assert.equal(store.view('b').listings.length,1);assert.equal(store.view('b').history.length,1);assert.equal(store.view('b').staff.length,4);}
  finally{store?.close();rmSync(directory,{recursive:true,force:true});}
});
test('organizer seed loads and provides the full roster',()=>{
  const store=createStore(':memory:',fileURLToPath(new URL('../seed.json',import.meta.url)));try{assert.equal(store.view('S1').staff.length,10);assert.equal(store.view('S1').shifts.length,61);}finally{store.close();}
});
test('weekly impact excludes the target assignment and charges overnight duration to its start week', () => {
  const overnight = shift('night', '2026-03-08T23:00', '2026-03-09T07:00', 'b');
  const prior = shift('prior', '2026-03-06T08:00', '2026-03-06T16:00', 'b');
  const nextWeek = shift('next', '2026-03-10T08:00', '2026-03-10T16:00', 'b');
  assert.deepEqual(weeklyImpact(staff[1], overnight, [overnight, prior, nextWeek]), {
    week_start: '2026-03-02', assigned_minutes: 480, shift_minutes: 480, projected_minutes: 960, limit_minutes: 2400
  });
});
test('manager preview reflects changed eligibility without mutating state', () => {
  const store = fixture([target, shift('second', '2026-03-02T09:00', '2026-03-02T17:00', 'c')]);
  try {
    store.act('a', 'post', 'target'); store.act('c', 'post', 'second');
    const [first, second] = store.view('b').listings;
    store.act('b', 'claim', first.id); store.act('b', 'claim', second.id);
    assert.deepEqual(store.view('m').listings[1].approval_reasons, []);
    store.act('m', 'approve', first.id);
    const preview = store.view('m');
    assert.deepEqual(preview.listings[1].approval_reasons.map(reason => reason.rule), [3]);
    assert.equal(preview.listings[1].hours_impact.projected_minutes, 960);
    assert.equal(preview.listings[1].status, 'CLAIMED');
    assert.equal(preview.revision, 5);
    assert.equal(store.view('m').history.length, 5);
  } finally { store.close(); }
});
test('audit records preserve actor, status transition, handover and rejection claimant', () => {
  const store = fixture();
  try {
    store.act('a', 'post', 'target');
    const listing = store.view('b').listings[0].id;
    store.act('b', 'claim', listing); store.act('m', 'reject', listing);
    const rejection = store.view('m').history.at(-1);
    assert.equal(rejection.previous_status, 'CLAIMED'); assert.equal(rejection.resulting_status, 'OPEN');
    assert.equal(rejection.claimer_id, 'b'); assert.equal(rejection.assigned_to, 'a');
    store.act('b', 'claim', listing); store.act('m', 'approve', listing);
    const approval = store.view('m').history.at(-1);
    assert.equal(approval.assigned_from, 'a'); assert.equal(approval.assigned_to, 'b');
    assert.equal(approval.previous_status, 'CLAIMED'); assert.equal(approval.resulting_status, 'APPROVED');
  } finally { store.close(); }
});
test('one refusal reports all of rules 2, 3, 4 and 5 with both conflicting shift IDs', () => {
  const candidateShift = shift('candidate', '2026-03-02T06:00', '2026-03-02T14:00', 'a', 'ICU');
  const assignments = [
    shift('overlap', '2026-03-02T00:00', '2026-03-02T08:00', 'c'),
    shift('rest', '2026-03-02T19:00', '2026-03-03T03:00', 'c'),
    ...[4,5,6].map(day => shift('x'+day, `2026-03-0${day}T08:00`, `2026-03-0${day}T16:00`, 'c'))
  ];
  const reasons = eligibility(staff[2], candidateShift, assignments);
  assert.deepEqual(reasons.map(reason => reason.rule), [2,3,4,5]);
  assert.equal(reasons[1].shift_id, 'overlap'); assert.equal(reasons[2].shift_id, 'rest');
});
test('approval revalidates the 40 hour limit after a nonoverlapping pending claim is approved', () => {
  const existing = [3,4,5,6].map(day => shift('x'+day, `2026-03-0${day}T08:00`, `2026-03-0${day}T16:00`, 'b'));
  const second = shift('second', '2026-03-07T08:00', '2026-03-07T16:00', 'c');
  const store = fixture([target, second, ...existing]);
  try {
    store.act('a','post','target'); store.act('c','post','second');
    const [first, next] = store.view('b').listings;
    assert.equal(store.act('b','claim',first.id).ok,true); assert.equal(store.act('b','claim',next.id).ok,true);
    assert.equal(store.act('m','approve',first.id).ok,true);
    assert.deepEqual(store.act('m','approve',next.id).reasons.map(reason=>reason.rule),[5]);
    assert.equal(store.view('m').listings[1].status,'CLAIMED');
  } finally { store.close(); }
});
test('approval revalidates rest after another nonoverlapping pending claim is approved', () => {
  const store = fixture([target, shift('second','2026-03-02T20:00','2026-03-03T04:00','c')]);
  try {
    store.act('a','post','target'); store.act('c','post','second');
    const [first, next] = store.view('b').listings;
    assert.equal(store.act('b','claim',first.id).ok,true); assert.equal(store.act('b','claim',next.id).ok,true);
    assert.equal(store.act('m','approve',first.id).ok,true);
    assert.deepEqual(store.act('m','approve',next.id).reasons.map(reason=>reason.rule),[4]);
    assert.equal(store.view('m').listings[1].status,'CLAIMED');
  } finally { store.close(); }
});

test('every action enforces its person and listing-state permissions without mutating a refused request', () => {
  for (const status of ['OPEN', 'CLAIMED', 'APPROVED', 'WITHDRAWN']) {
    for (const actor of ['a', 'b', 'c', 'm', 'unknown']) {
      for (const action of ['post', 'withdraw', 'claim', 'unclaim', 'approve', 'reject', 'invalid']) {
        const store = fixture();
        try {
          store.act('a', 'post', 'target');
          const listing = store.view('a').listings[0].id;
          if (['CLAIMED', 'APPROVED'].includes(status)) store.act('b', 'claim', listing);
          if (status === 'APPROVED') store.act('m', 'approve', listing);
          if (status === 'WITHDRAWN') store.act('a', 'withdraw', listing);
          const before = store.view(actor);
          const owner = status === 'APPROVED' ? 'b' : 'a';
          const allowed = {
            post: ['APPROVED', 'WITHDRAWN'].includes(status) && actor === owner,
            withdraw: status === 'OPEN' && actor === 'a',
            claim: status === 'OPEN' && ['b', 'c'].includes(actor),
            unclaim: status === 'CLAIMED' && actor === 'b',
            approve: status === 'CLAIMED' && actor === 'm',
            reject: status === 'CLAIMED' && actor === 'm',
            invalid: false
          }[action];
          const result = store.act(actor, action, action === 'post' ? 'target' : listing);
          const label = `${actor} ${action} on ${status}`;
          assert.equal(result.ok, allowed, label);
          const after = store.view(actor);
          assert.equal(after.history.length, before.history.length + 1, label);
          assert.equal(after.history.at(-1).outcome, allowed ? 'SUCCESS' : 'REFUSED', label);
          if (!allowed) {
            assert.ok(result.reasons.length, label);
            assert.deepEqual(after.shifts, before.shifts, label);
            assert.deepEqual(after.listings, before.listings, label);
          }
          if (action === 'claim' && status !== 'OPEN' && actor !== 'unknown') {
            assert.deepEqual(result.reasons, [{message: 'no longer available'}], label);
          }
        } finally { store.close(); }
      }
    }
  }
});

test('nonexistent targets are refused with an explanation and preserve roster and listings', () => {
  const store = fixture();
  try {
    for (const action of ['post', 'withdraw', 'claim', 'unclaim', 'approve', 'reject']) {
      const before = store.view('a');
      const result = store.act(['approve', 'reject'].includes(action) ? 'm' : 'a', action, 'missing');
      assert.equal(result.ok, false);
      assert.ok(result.reasons[0].message);
      const after = store.view('a');
      assert.deepEqual(after.shifts, before.shifts);
      assert.deepEqual(after.listings, before.listings);
      assert.equal(after.history.length, before.history.length + 1);
    }
  } finally { store.close(); }
});

test('invalid initial seeds fail before saving a roster', () => {
  const invalidSeeds = [
    {},
    {staff: [...staff, staff[0]], shifts: [target]},
    {staff, shifts: [target, target]},
    {staff, shifts: [{...target, start: '2026-02-30T08:00'}]},
    {staff, shifts: [{...target, end: target.start}]},
    {staff, shifts: [{...target, assigned_to: 'missing'}]},
    {staff, shifts: [{...target, assigned_to: 'm'}]},
    {staff, shifts: [{...target, assigned_to: 'c', required_certification: 'ICU'}]},
    {staff, shifts: [target, shift('conflict', '2026-03-02T15:00', '2026-03-02T23:00')]},
    {staff, shifts: Array.from({length: 6}, (_, day) => shift(`long-week-${day}`, `2026-03-0${day + 2}T08:00`, `2026-03-0${day + 2}T16:00`))}
  ];
  for (const seed of invalidSeeds) assert.throws(() => createStore(':memory:', seed));
});
