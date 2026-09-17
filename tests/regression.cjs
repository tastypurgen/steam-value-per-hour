const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const content=require('../content.js');
for(const [input,expected] of [['1,299',1299],['1.299',1299],['12,000',12000],['59,99',59.99],['1,299.99',1299.99],['1.299,99',1299.99],['1 299,99',1299.99]]) test(`regional price ${input}`,()=>assert.equal(content.parseNumber(input),expected));
for(const [heading,expected] of [['Buy Example',true],['Купить Example',true],['Buy Example Soundtrack',false],['Buy Example DLC',false],['Buy Example Bundle',false],['Buy Other Game',false]]) test(`product ${heading}`,()=>assert.equal(content.isBaseGameHeading(heading,'example','example'),expected));
test('machine price retains displayed currency',()=>{const el={textContent:'59,99 zł',hasAttribute:k=>k==='data-price-final',getAttribute:k=>k==='data-price-final'?'5999':null};assert.deepEqual(content.priceFromElement(el,el),{amount:59.99,currency:'zł'});});
function background(searchResponse,initial={}){
 const stored={...initial},calls=[],timers=[];let handler;let writes=0;
 const browser={runtime:{onMessage:{addListener:f=>handler=f}},storage:{local:{get:async k=>k===null?{...stored}:{[k]:stored[k]},set:async v=>{writes++;Object.assign(stored,v)},remove:async keys=>{for(const k of [].concat(keys))delete stored[k]}}}};
 const context={browser,AbortSignal,setTimeout:f=>{timers.push(1);f()},fetch:async(url,options)=>{calls.push({url,options});return url.includes('/init')?{ok:true,json:async()=>({token:'t',hpKey:'k',hpVal:'v'})}:searchResponse;}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),context);
 return {send:(privateTab=false)=>handler({type:'get-hltb',appId:'123',title:'Example'},{tab:{incognito:privateTab}}),stored,calls,timers,get writes(){return writes}};
}
const success={ok:true,json:async()=>({data:[{game_id:1,profile_steam:123,game_name:'Example',comp_main:36000}]})};
test('private requests never persist and do not join ordinary lookup',async()=>{const b=background(success);await b.send(true);assert.equal(b.writes,0);assert.deepEqual(Object.keys(b.stored),[]);await b.send();assert.equal(b.writes,1);assert.equal(b.calls.filter(c=>!c.url.includes('/init')).length,2)});
test('successful lookup cached and reused',async()=>{const b=background(success);assert.equal((await b.send()).ok,true);const count=b.calls.length;assert.equal((await b.send()).source,'cache');assert.equal(b.calls.length,count)});
test('HTTP 503 bounded retries without negative caching',async()=>{const b=background({ok:false,status:503,headers:{get:()=>null}});assert.equal((await b.send()).reason,'service-error');assert.equal(b.writes,0);assert.equal(b.calls.filter(c=>!c.url.includes('/init')).length,3)});
test('long Retry-After does not retry early',async()=>{const b=background({ok:false,status:429,headers:{get:()=> '120'}});assert.equal((await b.send()).reason,'service-error');assert.equal(b.calls.length,2);assert.equal(b.timers.length,0)});
test('malformed response not cached as absent game',async()=>{const b=background({ok:true,json:async()=>({error:'unavailable'})});assert.equal((await b.send()).reason,'service-error');assert.equal(b.writes,0)});
test('genuine no-match is cached',async()=>{const b=background({ok:true,json:async()=>({data:[]})});assert.equal((await b.send()).reason,'no-id-match');assert.equal(b.writes,1)});
test('all runtime JavaScript parses',()=>{for(const file of ['background.js','content.js','popup.js','options.js'])new vm.Script(fs.readFileSync(path.join(root,file),'utf8'))});
test('data transmission declared',()=>{const m=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));assert.deepEqual(m.browser_specific_settings.gecko.data_collection_permissions.required,['websiteContent','browsingActivity'])});
