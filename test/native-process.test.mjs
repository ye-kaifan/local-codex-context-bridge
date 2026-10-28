import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ReadOnlyAppServer, READ_METHODS } from '../bridge/readonly-policy.mjs';
import { nativeEnvironment } from '../bridge/native.mjs';
import { ControlSurface } from '../dist/src/tools.js';

test('native process wire contains initialization and reads only, excludes tunnel credentials and closes its child', { timeout: 15000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'context-native-fixture-'));
  const fixture = join(dir, 'native.mjs'), wire = join(dir, 'wire.txt');
  await writeFile(fixture, `
import { createInterface } from 'node:readline';
import { appendFileSync, writeFileSync } from 'node:fs';
const wire=process.argv[2];
writeFileSync(wire+'.state',JSON.stringify({pid:process.pid,tunnelCredentialInherited:Boolean(process.env.CONTROL_PLANE_API_KEY),home:process.env.CODEX_HOME}));
const page=(data=[])=>({data,nextCursor:null,backwardsCursor:null});
createInterface({input:process.stdin}).on('line',line=>{
 const request=JSON.parse(line); appendFileSync(wire,JSON.stringify(request)+'\\n');
 if(request.id===undefined)return;
 const p=request.params; let result={};
 if(request.method==='thread/read') result={thread:{id:p.threadId,historyMode:'paginated'}};
 if(request.method==='thread/list'||request.method==='thread/search') result=page();
 if(request.method==='thread/searchOccurrences') result={data:[],nextCursor:null};
 if(request.method==='thread/turns/list') result=page([{id:'fixture-turn',items:[]}]);
 if(request.method==='thread/items/list') result=page([{turnId:p.turnId,item:{id:'fixture-item',type:'agentMessage',text:'fixture text'}}]);
 process.stdout.write(JSON.stringify({id:request.id,result})+'\\n');
});
`);
  const native = new ReadOnlyAppServer(undefined, { executable: process.execPath, prefixArgs: [fixture, wire], environment: nativeEnvironment({ codex_home: dir }), requestTimeoutMs: 5000 });
  const surface = new ControlSurface(native);
  try {
    await assert.rejects(native.request('turn/start', {}), /denied/);
    await assert.rejects(readFile(wire));
    await surface.call('codex_threads', { limit: 1 });
    await surface.call('codex_threads', { thread_id: 'fixture-thread' });
    await surface.call('codex_history', { thread_id: 'fixture-thread', kind: 'turns' });
    await surface.call('codex_history', { thread_id: 'fixture-thread', turn_id: 'fixture-turn', kind: 'items' });
    await surface.call('codex_search', { kind: 'threads', search_term: 'fixture' });
    await surface.call('codex_search', { kind: 'occurrences', thread_id: 'fixture-thread', search_term: 'fixture' });
    await assert.rejects(native.request('thread/start', {}), /denied/);
    await assert.rejects(native.respond('fixture-approval', {}), /denied/);
    const requests = (await readFile(wire, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(requests.every(r => ['initialize', 'initialized', ...READ_METHODS].includes(r.method)));
    assert.deepEqual([...new Set(requests.map(r => r.method))].sort(), ['initialize', 'initialized', ...READ_METHODS].sort());
    assert.ok(requests.filter(r => r.method === 'thread/read').every(r => r.params.includeTurns === false));
    const state = JSON.parse(await readFile(wire + '.state', 'utf8'));
    assert.equal(state.tunnelCredentialInherited, false);
    assert.equal(state.home, dir);
    await native.close();
    assert.throws(() => process.kill(state.pid, 0), { code: 'ESRCH' });
  } finally { await native.close(); await rm(dir, { recursive: true, force: true }); }
});

test('malformed native frames fail without quoting their payload in diagnostics', { timeout: 15000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'context-native-malformed-'));
  const fixture = join(dir, 'native.mjs');
  await writeFile(fixture, `
import {createInterface} from 'node:readline';
createInterface({input:process.stdin}).on('line',line=>{
 const r=JSON.parse(line);if(r.id===undefined)return;
 process.stdout.write(r.method==='initialize'?JSON.stringify({id:r.id,result:{}})+'\\n':'NATIVE_LEAK\\n');
});
`);
  const native = new ReadOnlyAppServer(undefined, { executable: process.execPath, prefixArgs: [fixture], environment: nativeEnvironment({ codex_home: dir }), requestTimeoutMs: 5000 });
  try {
    await assert.rejects(native.request('thread/list', {}), error => {
      assert.match(error.message, /JSONL/);
      assert.doesNotMatch(error.message, /NATIVE_LEAK/);
      return true;
    });
  } finally { await native.close(); await rm(dir, { recursive: true, force: true }); }
});
