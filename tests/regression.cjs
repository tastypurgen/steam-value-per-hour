const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const content=require('../content.js');
for(const [input,expected] of [['1,299',1299],['1.299',1299],['12,000',12000],['59,99',59.99],['1,299.99',1299.99],['1.299,99',1299.99],['1 299,99',1299.99]]) test(`regional price ${input}`,()=>assert.equal(content.parseNumber(input),expected));
for(const [heading,expected] of [
  ['Buy Example',true],
  ['Купить Example',true],
  ['Придбати Example',true],
  ['Kaufe Example',true],
  ['Example kaufen',true],
  ['Buy Example Standard Edition',true],
  ['Купить Example Standard Edition',true],
  ['Придбати Example Standard Edition',true],
  ['Buy Example Complete Edition',true],
  ['Buy Example Deluxe Edition',true],
  ['Buy Example Soundtrack',false],
  ['Buy Example DLC',false],
  ['Buy Example Bundle',false],
  ['Buy Example Season Pass',false],
  ['Buy Other Game',false]
]) test(`product ${heading}`,()=>assert.equal(content.isBaseGameHeading(heading,'example','example'),expected));
test('Prince of Persia Standard Edition heading',()=>assert.equal(content.isBaseGameHeading('Buy Prince of Persia The Lost Crown Standard Edition','prince of persia the lost crown','prince of persia the lost crown'),true));
test('Prince of Persia franchise bundle heading',()=>assert.equal(content.isBaseGameHeading('Buy Prince Of Persia Franchise','prince of persia the lost crown','prince of persia the lost crown'),false));
test('Standard Edition scores higher than Complete Edition',()=>{
  const std = content.scorePurchaseBlock('Buy Prince of Persia The Lost Crown Standard Edition','prince of persia the lost crown','prince of persia the lost crown',0);
  const comp = content.scorePurchaseBlock('Buy Prince of Persia The Lost Crown Complete Edition','prince of persia the lost crown','prince of persia the lost crown',1);
  assert.ok(std > comp, `Expected Standard Edition (${std}) > Complete Edition (${comp})`);
});
test('bundle block detection recognizes bundleid and bundle label',()=>{
  const elWithBundleId = { matches: sel => sel.includes('data-ds-bundleid'), querySelector: () => null };
  const elWithForm = { matches: () => false, querySelector: sel => sel.includes('bundleid') ? {} : null };
  const elStandard = { matches: () => false, querySelector: () => null };
  assert.equal(content.isBundleBlock(elWithBundleId), true);
  assert.equal(content.isBundleBlock(elWithForm), true);
  assert.equal(content.isBundleBlock(elStandard), false);
});
test('subscription block detection recognizes ea play or subscription dropdown',()=>{
  const elSub = { matches: sel => sel.includes('subscription'), querySelector: () => null };
  const elStandard = { matches: () => false, querySelector: () => null };
  assert.equal(content.isSubscriptionBlock(elSub), true);
  assert.equal(content.isSubscriptionBlock(elStandard), false);
});
test('machine price retains displayed currency',()=>{const el={textContent:'59,99 zł',hasAttribute:k=>k==='data-price-final',getAttribute:k=>k==='data-price-final'?'5999':null};assert.deepEqual(content.priceFromElement(el,el),{amount:59.99,currency:'zł'});});
function background(searchResponse,initial={},permissions){
 const stored={...initial},calls=[],timers=[];let handler;let writes=0;let optionsOpened=0;
 const browser={runtime:{openOptionsPage:()=>{optionsOpened++},onMessage:{addListener:f=>handler=f}},permissions,storage:{local:{get:async k=>k===null?{...stored}:{[k]:stored[k]},set:async v=>{writes++;Object.assign(stored,v)},remove:async keys=>{for(const k of [].concat(keys))delete stored[k]}}}};
 const context={browser,AbortSignal,setTimeout:f=>{timers.push(1);f()},fetch:async(url,options)=>{calls.push({url,options});return url.includes('/init')?{ok:true,json:async()=>({token:'t',hpKey:'k',hpVal:'v'})}:searchResponse;}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),context);
 return {send:(privateTab=false)=>handler({type:'get-hltb',appId:'123',title:'Example'},{tab:{incognito:privateTab}}),raw:(message,sender)=>handler(message,sender),stored,calls,timers,get writes(){return writes},get optionsOpened(){return optionsOpened}};
}
const success={ok:true,json:async()=>({data:[{game_id:1,profile_steam:123,game_name:'Example',comp_main:36000}]})};
test('private requests never persist and do not join ordinary lookup',async()=>{const b=background(success);await b.send(true);assert.equal(b.writes,0);assert.deepEqual(Object.keys(b.stored),[]);await b.send();assert.equal(b.writes,1);assert.equal(b.calls.filter(c=>!c.url.includes('/init')).length,2)});
test('successful lookup cached and reused',async()=>{const b=background(success);assert.equal((await b.send()).ok,true);const count=b.calls.length;assert.equal((await b.send()).source,'cache');assert.equal(b.calls.length,count)});
test('HTTP 503 bounded retries without negative caching',async()=>{const b=background({ok:false,status:503,headers:{get:()=>null}});assert.equal((await b.send()).reason,'service-error');assert.equal(b.writes,0);assert.equal(b.calls.filter(c=>!c.url.includes('/init')).length,3)});
test('long Retry-After does not retry early',async()=>{const b=background({ok:false,status:429,headers:{get:()=> '120'}});assert.equal((await b.send()).reason,'service-error');assert.equal(b.calls.length,2);assert.equal(b.timers.length,0)});
test('malformed response not cached as absent game',async()=>{const b=background({ok:true,json:async()=>({error:'unavailable'})});assert.equal((await b.send()).reason,'service-error');assert.equal(b.writes,0)});
test('genuine no-match is cached',async()=>{const b=background({ok:true,json:async()=>({data:[]})});assert.equal((await b.send()).reason,'no-id-match');assert.equal(b.writes,1)});
test('cached failure is reused for the same title but retried for another one',async()=>{
  const b=background({ok:true,json:async()=>({data:[]})});
  assert.equal((await b.send()).reason,'no-id-match');
  const first=b.calls.length;
  assert.equal((await b.send()).source,'cache');
  assert.equal(b.calls.length,first);
  assert.equal((await b.raw({type:'get-hltb',appId:'123',title:'Другое название'},{tab:{}})).reason,'no-id-match');
  assert.ok(b.calls.length>first,'expected a fresh HLTB search for the new title');
});
test('cached success is reused regardless of page title language',async()=>{
  const b=background(success);
  assert.equal((await b.send()).ok,true);
  const count=b.calls.length;
  assert.equal((await b.raw({type:'get-hltb',appId:'123',title:'Пример'},{tab:{}})).source,'cache');
  assert.equal(b.calls.length,count);
});
test('non-Latin titles are detected for the HLTB English fallback',()=>{
  assert.equal(content.hasNonLatinTitle('Альфред Хичкок: «Головокружение»'),true);
  assert.equal(content.hasNonLatinTitle('ペルソナ'),true);
  assert.equal(content.hasNonLatinTitle('Alfred Hitchcock - Vertigo'),false);
  assert.equal(content.hasNonLatinTitle('Brütal Legend'),false);
});
test('english title resolver reads the appdetails name and fails soft',async()=>{
  const original=globalThis.fetch;
  const requested=[];
  globalThis.fetch=async(url)=>{requested.push(url);return {ok:true,json:async()=>({'1449320':{success:true,data:{name:'Alfred Hitchcock - Vertigo'}}})};};
  try { assert.equal(await content.fetchEnglishTitle('1449320'),'Alfred Hitchcock - Vertigo'); }
  finally { globalThis.fetch=original; }
  assert.ok(requested[0].includes('appids=1449320') && requested[0].includes('l=english'),requested[0]);
  globalThis.fetch=async()=>{throw new Error('offline')};
  try { assert.equal(await content.fetchEnglishTitle('1449320'),null); }
  finally { globalThis.fetch=original; }
});
test('missing host permission short-circuits without network or caching',async()=>{const b=background(success,{}, {contains:async()=>false});assert.equal((await b.send()).reason,'no-permission');assert.equal(b.calls.length,0);assert.equal(b.writes,0)});
test('open-options message opens the options page',async()=>{const b=background(success);b.raw({type:'open-options'},{});assert.equal(b.optionsOpened,1);b.raw({type:'get-hltb',appId:'123',title:'Example'},{});assert.equal(b.optionsOpened,1)});
test('all runtime JavaScript parses',()=>{for(const file of ['background.js','content.js','popup.js','options.js'])new vm.Script(fs.readFileSync(path.join(root,file),'utf8'))});
test('data transmission declared',()=>{const m=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));assert.deepEqual(m.browser_specific_settings.gecko.data_collection_permissions.required,['websiteContent','browsingActivity'])});
