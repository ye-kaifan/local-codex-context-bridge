import { TOOL_DEFINITIONS } from '../dist/src/tools.js';

const device={type:'string',maxLength:80,description:'Device ID or display name from codex_devices/search results. Select the original device for every continuation.'};
const annotations={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
const nonblankFields={
  codex_threads:['parent_thread_id','ancestor_thread_id'],
  codex_history:['thread_id','turn_id','cursor'],
  codex_search:['search_term','thread_id','cursor'],
};
function portableProperties(name,properties){
  return Object.fromEntries(Object.entries(properties).map(([field,schema])=>{
    // Some hosts interpret JSON Schema patterns as full matches. Keep nonblank
    // validation in ControlSurface; publish the existing type/length constraints.
    if(nonblankFields[name]?.includes(field)&&schema.pattern==='\\S'){
      const {pattern,...portable}=schema;
      return [field,portable];
    }
    return [field,schema];
  }));
}
export const INSTRUCTIONS='Read-only Codex context across configured devices. Search/list without device_id queries all configured devices. Always report each unavailable device; never equate unavailable with no matches. Results retain native per-device cursors. Continue each page with that device_id and its original cursor. History and occurrence search require device_id. Read turns, then items in each turn until nextCursor:null when full history is requested. Never automatically switch protected to exact.';
export const CATALOG=[{name:'codex_devices',title:'Codex devices',description:'List configured device names and current availability. Use this to disambiguate a computer or explain incomplete search coverage.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations},
  ...['codex_threads','codex_history','codex_search'].map(name=>{
    const native=TOOL_DEFINITIONS.find(tool=>tool.name===name);
    // Flat schemas keep base arguments intact in ChatGPT/Codex schema conversion.
    return {...native,description:`${native.description} Multi-device: omit device_id to query every device for listing/thread search; history, metadata and occurrences require device_id. Return offline coverage explicitly.`,
      inputSchema:{type:'object',properties:{device_id:device,...portableProperties(name,native.inputSchema.properties)},
        required:[...(native.inputSchema.required??[]),...(name==='codex_history'?['device_id']:[])],additionalProperties:false}};
  })];
