import test from 'node:test';
import assert from 'node:assert/strict';
import { filterRows, filterHistory, weekOf, weeklyWorkload } from '../public/view-model.js';

const rows = [
  {shift:{id:'SH2',start:'2026-03-09T08:00',end:'2026-03-09T20:00',required_certification:'ICU',assigned_to:'a'},reasons:[]},
  {shift:{id:'SH1',start:'2026-03-02T08:00',end:'2026-03-02T16:00',required_certification:null,assigned_to:'b'},reasons:[{rule:3,message:'Overlap'}]},
  {shift:{id:'SH3',start:'2026-03-02T20:00',end:'2026-03-03T04:00',required_certification:'PEDS',assigned_to:'a'},reasons:[]}
];
const defaults = {query:'',week:'',eligible:false,sort:'date'};
const nameOf = id => ({a:'Asha',b:'Ben'})[id] || '';
test('board filters combine person search, eligibility and Monday week without mutating rows', () => {
  const original = structuredClone(rows);
  const matches = filterRows(rows,{...defaults,query:'  aShA ',eligible:true,week:'2026-03-02'},nameOf);
  assert.deepEqual(matches.map(row=>row.shift.id),['SH3']);
  assert.deepEqual(rows,original);
  assert.equal(weekOf('2026-03-08T23:00'),'2026-03-02');
});
test('search covers shift ID, certification, general care and no-result cases', () => {
  for (const [query,ids] of [['icu',['SH2']],['sh1',['SH1']],['general care',['SH1']],['missing',[]]])
    assert.deepEqual(filterRows(rows,{...defaults,query},nameOf).map(row=>row.shift.id),ids);
});
test('sorting is deterministic for date and duration', () => {
  assert.deepEqual(filterRows(rows,defaults,nameOf).map(row=>row.shift.id),['SH1','SH3','SH2']);
  assert.deepEqual(filterRows(rows,{...defaults,sort:'duration'},nameOf).map(row=>row.shift.id),['SH2','SH1','SH3']);
});
test('history filters combine person, outcome and reason search in reverse order', () => {
  const events = [
    {id:1,actor_id:'b',action:'claim',shift_id:'SH1',outcome:'SUCCESS',reasons:[]},
    {id:2,actor_id:'a',action:'claim',shift_id:'SH2',outcome:'REFUSED',reasons:[{message:'Requires ICU certification'}]},
    {id:3,actor_id:'a',action:'approve',shift_id:'SH2',outcome:'REFUSED',reasons:[{message:'Overlaps SH1'}]}
  ];
  assert.deepEqual(filterHistory(events,{query:' ICU ',person:'a',outcome:'REFUSED'}).map(e=>e.id),[2]);
  assert.deepEqual(filterHistory(events,{query:'',person:'',outcome:'REFUSED'}).map(e=>e.id),[3,2]);
});

test('weekly planner assigns an overnight shift to its start day and includes quiet clinic weeks', () => {
  const shifts = [
    { id: 'overnight', start: '2026-03-08T23:00', end: '2026-03-09T07:00' },
    { id: 'monday', start: '2026-03-09T18:00', end: '2026-03-10T02:00' }
  ];
  const original = structuredClone(shifts);
  const weeks = weeklyWorkload(shifts, ['2026-03-16', '2026-03-09', '2026-03-02', '2026-03-02']);
  assert.deepEqual(weeks.map(({ week, count, minutes }) => ({ week, count, minutes })), [
    { week: '2026-03-02', count: 1, minutes: 480 },
    { week: '2026-03-09', count: 1, minutes: 480 },
    { week: '2026-03-16', count: 0, minutes: 0 }
  ]);
  assert.deepEqual(weeks[0].days[6], { date: '2026-03-08', count: 1, minutes: 480 });
  assert.deepEqual(weeks[1].days[0], { date: '2026-03-09', count: 1, minutes: 480 });
  assert.ok(weeks.every(week => week.days.length === 7));
  assert.ok(weeks[2].days.every(day => day.count === 0 && day.minutes === 0));
  assert.deepEqual(shifts, original);
});

test('selecting a planner week agrees with roster filtering including Sunday overnight', () => {
  const shifts = [
    { ...rows[0].shift, id: 'sunday', start: '2026-03-08T23:00', end: '2026-03-09T07:00' },
    { ...rows[0].shift, id: 'monday', start: '2026-03-09T18:00', end: '2026-03-10T02:00' }
  ];
  const planner = weeklyWorkload(shifts, ['2026-03-02', '2026-03-09', '2026-03-16']);
  for (const week of planner) {
    const visible = filterRows(shifts.map(shift => ({ shift })), { ...defaults, week: week.week }, nameOf);
    assert.equal(visible.length, week.count);
    assert.equal(visible.reduce((minutes, { shift }) => minutes + (new Date(shift.end + ':00Z') - new Date(shift.start + ':00Z')) / 60000, 0), week.minutes);
  }
  assert.deepEqual(filterRows(shifts.map(shift => ({ shift })), { ...defaults, week: '2026-03-02' }, nameOf).map(row => row.shift.id), ['sunday']);
});
