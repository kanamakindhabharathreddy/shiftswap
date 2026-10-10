import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

test('HTTP frontend, validation, simultaneous claims and restart persistence', {timeout:20000}, async () => {
  const directory = mkdtempSync(join(tmpdir(),'shiftswap-http-'));
  let child;
  async function start() {
    child = spawn(process.execPath,[fileURLToPath(new URL('../server.js',import.meta.url))], {
      env:{...process.env,PORT:'0',HOST:'127.0.0.1',DB_PATH:join(directory,'state.sqlite')}, windowsHide:true, stdio:['ignore','pipe','pipe']
    });
    return new Promise((resolve,reject)=>{
      let output='';
      child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/localhost:\d+/);if(match)resolve(match[0]);});
      child.once('error',reject);child.once('exit',code=>reject(new Error(`Server exited with ${code}`)));
    });
  }
  async function stop() {const stopped=once(child,'exit');child.kill();await stopped;child=null;}
  try {
    let base=await start();
    assert.equal((await fetch(base)).status,200);
    assert.equal((await fetch(base+'/style.css')).status,200);
    assert.equal((await fetch(base+'/missing')).status,404);
    const actions=base+'/api/actions';
    assert.equal((await fetch(actions,{method:'POST',body:'{}'})).status,415);
    assert.equal((await fetch(actions,{method:'POST',headers:{'Content-Type':'application/json'},body:'{broken'})).status,400);
    assert.equal((await fetch(actions,{method:'POST',headers:{'Content-Type':'application/json'},body:'null'})).status,400);
    for (const body of ['[]', '"text"', '{}', '{"actor_id":1,"action":"post","target_id":"SH001"}', '{"actor_id":"S2","action":"","target_id":"SH001"}']) {
      assert.equal((await fetch(actions, {method:'POST', headers:{'Content-Type':'application/json'}, body})).status, 400);
    }
    assert.equal((await fetch(actions, {method:'POST', headers:{'Content-Type':'application/json-invalid'}, body:'{}'})).status, 415);
    assert.equal((await fetch(actions, {method:'POST', headers:{'Content-Type':'Application/JSON; charset=utf-8'}, body:'{}'})).status, 400);
    assert.equal((await fetch(actions, {method:'POST', headers:{'Content-Type':'application/json', Origin:'https://other.example'}, body:'{}'})).status, 403);
    for (const body of [JSON.stringify({padding:'x'.repeat(17000)}), JSON.stringify({padding:'€'.repeat(6000)})]) {
      assert.equal((await fetch(actions, {method:'POST', headers:{'Content-Type':'application/json'}, body})).status, 413);
    }
    assert.equal((await (await fetch(base+'/api/state')).json()).history.length, 0);
    const act=(actor_id,action,target_id)=>fetch(actions,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({actor_id,action,target_id})});
    assert.equal((await act('S2','post','SH001')).status,200);
    const state=await (await fetch(base+'/api/state?actor=S7')).json();const listing=state.listings[0].id;
    assert.deepEqual(state.listings[0].reasons, []);
    const otherEligible = await (await fetch(base+'/api/state?actor=S6')).json();
    assert.deepEqual(otherEligible.listings[0].reasons, []);
    const concurrent=await Promise.all([act('S7','claim',listing),act('S6','claim',listing)]);
    assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
    const loser=await concurrent.find(r=>r.status===409).json();assert.deepEqual(loser.reasons,[{message:'no longer available'}]);
    assert.equal((await act('M1','approve',listing)).status,200);
    const final=await (await fetch(base+'/api/state?actor=M1')).json();
    assert.equal(final.listings[0].status,'APPROVED');assert.equal(final.history.length,4);
    await stop();base=await start();
    const restarted=await (await fetch(base+'/api/state?actor=M1')).json();
    assert.deepEqual(restarted.history,final.history);assert.deepEqual(restarted.shifts,final.shifts);

    // A TCP chunk may end in the middle of a Unicode code point. It must not
    // change an identifier before validation or when recording a refused action.
    const unicodeTarget = '不存在';
    const bytes = Buffer.from(JSON.stringify({actor_id:'S2', action:'post', target_id:unicodeTarget}));
    const split = bytes.indexOf(Buffer.from(unicodeTarget)) + 1;
    const unicodeResponse = await new Promise((resolve, reject) => {
      const req = request(base+'/api/actions', {method:'POST', headers:{'Content-Type':'application/json'}}, res => {
        res.resume(); res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
      req.write(bytes.subarray(0, split));
      delay(25).then(() => req.end(bytes.subarray(split)), reject);
    });
    assert.equal(unicodeResponse, 409);
    const unicodeState = await (await fetch(base+'/api/state')).json();
    assert.equal(unicodeState.history.at(-1).target_id, unicodeTarget);
    assert.equal(unicodeState.history.at(-1).shift_id, unicodeTarget);
  } finally {if(child)await stop();rmSync(directory,{recursive:true,force:true});}
});

test('two backend processes serialize initialization, posts, claims and conflicting approvals', {timeout:20000}, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'shiftswap-multi-'));
  const children = [];
  async function start() {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../server.js', import.meta.url))], {
      env: {...process.env, PORT:'0', HOST:'127.0.0.1', DB_PATH:join(directory, 'shared.sqlite')},
      windowsHide:true, stdio:['ignore', 'pipe', 'pipe']
    });
    children.push(child);
    return new Promise((resolve, reject) => {
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; const match = output.match(/http:\/\/localhost:\d+/); if (match) resolve(match[0]); });
      child.once('error', reject);
      child.once('exit', code => reject(new Error(`Server exited with ${code}`)));
    });
  }
  try {
    const bases = await Promise.all([start(), start()]);
    const act = (base, actor_id, action, target_id) => fetch(base+'/api/actions', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({actor_id, action, target_id})
    });
    const posted = await Promise.all(bases.map(base => act(base, 'S2', 'post', 'SH001')));
    assert.deepEqual(posted.map(result=>result.status).sort(), [200,409]);
    const state = await (await fetch(bases[0]+'/api/state?actor=S7')).json();
    assert.equal(state.listings.length,1);
    assert.deepEqual(state.listings[0].reasons,[]);
    const secondView = await (await fetch(bases[1]+'/api/state?actor=S6')).json();
    assert.deepEqual(secondView.listings[0].reasons,[]);
    const claims = await Promise.all([act(bases[0], 'S7', 'claim', state.listings[0].id), act(bases[1], 'S6', 'claim', state.listings[0].id)]);
    assert.deepEqual(claims.map(result=>result.status).sort(),[200,409]);
    assert.deepEqual((await claims.find(result=>result.status===409).json()).reasons,[{message:'no longer available'}]);
    const views = await Promise.all(bases.map(async base => (await fetch(base+'/api/state?actor=M1')).json()));
    assert.deepEqual(views[0],views[1]);
    assert.equal(views[0].history.length,4);

    // Each pending claim passes independently. Competing approvals must use
    // the assignment written by the winner, even in different server processes.
    assert.equal((await act(bases[0], 'S2', 'post', 'SH033')).status, 200);
    assert.equal((await act(bases[1], 'S5', 'post', 'SH034')).status, 200);
    const approvalState = await (await fetch(bases[0]+'/api/state?actor=S7')).json();
    const candidates = approvalState.listings.filter(item => ['SH033','SH034'].includes(item.shift_id));
    for (const [index, listing] of candidates.entries()) {
      assert.deepEqual(listing.reasons, []);
      assert.equal((await act(bases[index], 'S7', 'claim', listing.id)).status, 200);
    }
    const approvals = await Promise.all(candidates.map((listing, index) => act(bases[index], index ? 'M2' : 'M1', 'approve', listing.id)));
    assert.deepEqual(approvals.map(result => result.status).sort(), [200,409]);
    assert.deepEqual((await approvals.find(result => result.status === 409).json()).reasons.map(reason => reason.rule), [3,5]);
    const approvedState = await (await fetch(bases[1]+'/api/state?actor=M1')).json();
    assert.deepEqual(approvedState.listings.filter(item => candidates.some(candidate => candidate.id === item.id)).map(item => item.status).sort(), ['APPROVED','CLAIMED']);
    assert.equal(approvedState.shifts.filter(item => ['SH033','SH034'].includes(item.id) && item.assigned_to === 'S7').length, 1);
    assert.equal(approvedState.history.length, 10);
  } finally {
    await Promise.all(children.map(async child => { if(child.exitCode===null){ const stopped=once(child,'exit'); child.kill(); await stopped; } }));
    rmSync(directory,{recursive:true,force:true});
  }
});
