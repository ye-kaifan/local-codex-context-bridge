import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_DEFINITIONS,ControlSurface } from '../dist/src/tools.js';
import { CATALOG } from '../bridge/catalog.mjs';
import { catalogFor } from '../bridge/server.mjs';

const fields={
  codex_threads:['parent_thread_id','ancestor_thread_id'],
  codex_history:['thread_id','turn_id','cursor'],
  codex_search:['search_term','thread_id','cursor'],
};
const thread='example-thread-id';

test('portable schemas change only the eight redundant nonblank patterns',()=>{
  let count=0;
  for(const [name,names] of Object.entries(fields)){
    const native=TOOL_DEFINITIONS.find(t=>t.name===name).inputSchema;
    const expected=structuredClone(native.properties);
    for(const field of names){
      assert.equal(expected[field].pattern,'\\S');
      delete expected[field].pattern;
      count++;
    }
    for(const catalog of [CATALOG,...['laptop','desktop','travel'].map(id=>catalogFor({id,label:id}))]){
      const schema=catalog.find(t=>t.name===name).inputSchema;
      const {device_id,...properties}=schema.properties;
      assert.deepEqual(properties,expected);
      assert.equal(schema.additionalProperties,false);
      assert.equal(schema.oneOf,undefined);
      assert.deepEqual(schema.required.filter(k=>k!=='device_id'),native.required??[]);
      assert.ok(device_id);
    }
    // The adapter must not mutate the upstream definitions shared by other clients.
    for(const field of names)assert.equal(native.properties[field].pattern,'\\S');
  }
  assert.equal(count,8);
});

for(const [name,names] of Object.entries(fields))for(const field of names){
  test(`${name}.${field}: server rejects invalid values before native access and preserves valid input`,async()=>{
    const max=TOOL_DEFINITIONS.find(t=>t.name===name).inputSchema.properties[field].maxLength;
    let args=name==='codex_threads'?{}:name==='codex_history'?{thread_id:thread,kind:'turns'}:{kind:'threads',search_term:'phase transition'};
    if(name==='codex_history'&&field==='turn_id')args={thread_id:thread,kind:'items'};
    if(name==='codex_search'&&field==='thread_id')args={kind:'occurrences',search_term:'phase transition'};
    for(const value of ['', ' ', '\t\r\n','\u00a0','\u3000',123,{},[],'x'.repeat(max+1)]){
      let calls=0;
      const surface=new ControlSurface({request:async()=>{calls++;throw Error('UNEXPECTED_NATIVE_CALL');}});
      await assert.rejects(surface.call(name,{...args,[field]:value}),e=>e.message!=='UNEXPECTED_NATIVE_CALL');
      assert.equal(calls,0);
    }
    const valid=field==='search_term'?'  phase transition\n相变  ':field==='cursor'?'opaque_cursor:one/two+three=':thread;
    const calls=[];
    const surface=new ControlSurface({request:async(method,params)=>{
      calls.push({method,params});
      if(name==='codex_history'&&method==='thread/read')return {thread:{id:params.threadId,historyMode:'paginated'}};
      throw Error('REACHED_NATIVE_BOUNDARY');
    }});
    await assert.rejects(surface.call(name,{...args,[field]:valid}),/REACHED_NATIVE_BOUNDARY/);
    const nativeKey={thread_id:'threadId',turn_id:'turnId',cursor:'cursor',search_term:'searchTerm',parent_thread_id:'parentThreadId',ancestor_thread_id:'ancestorThreadId'}[field];
    assert.equal(calls.at(-1).params[nativeKey],valid);
  });
}
