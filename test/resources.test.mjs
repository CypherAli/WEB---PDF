import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {chromium} from '../src/runtime.mjs';

const svg='<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240"><rect width="640" height="240" fill="#dff2ff"/><text x="30" y="120" font-size="32">ORIGINAL PROTECTED IMAGE</text></svg>';
async function poll(check,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,100));}throw new Error('Timed out');}

test('recover images already visible on the logged-in website',{timeout:120000},async t=>{
  const requests=[];
  const images=http.createServer((req,res)=>{
    requests.push({url:req.url,destination:req.headers['sec-fetch-dest'],referrer:req.headers.referer});
    if(req.url==='/protected.svg' && req.headers['sec-fetch-dest']!=='image'){res.writeHead(403,{'cache-control':'no-store'});res.end();return;}
    res.writeHead(200,{'content-type':'image/svg+xml','cache-control':'no-store'});res.end(svg);
  });await new Promise(r=>images.listen(0,'127.0.0.1',r));t.after(()=>images.close());
  const assetBase=`http://localhost:${images.address().port}`;
  const server=http.createServer((req,res)=>{
    if(req.url==='/missing.png'){res.writeHead(404);res.end();return;}
    const protectedImage=req.url==='/protected';
    res.writeHead(200,{'content-type':'text/html;charset=utf-8'});
    res.end(`<!doctype html><html lang="vi"><meta charset="utf-8"><title>Kiểm tra ảnh đã đăng nhập</title><aside>Danh sách câu hỏi <div>Tất cả 1</div></aside><main id="content"><h3>Câu hỏi 1: Động mạch đùi</h3><p>Văn bản tiếng Việt phải giữ dạng chữ.</p><img src="${assetBase}/${protectedImage?'protected':'public'}.svg" alt="Ảnh gốc đã hiện" width="640">${protectedImage?'':'<img src="/missing.png" alt="Ảnh thực sự thiếu">'}</main></html>`);
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
  const base=`http://127.0.0.1:${server.address().port}`,work=path.resolve('tmp/resources-test');await fs.mkdir(work,{recursive:true});
  const build=await fs.mkdtemp(path.join(work,'build-'));await fs.cp(path.resolve('extension'),build,{recursive:true});
  const manifest=JSON.parse(await fs.readFile(path.join(build,'manifest.json')));manifest.host_permissions=[base+'/*',assetBase+'/*'];await fs.writeFile(path.join(build,'manifest.json'),JSON.stringify(manifest));
  const context=await chromium.launchPersistentContext(await fs.mkdtemp(path.join(work,'profile-')),{channel:'chrome',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging'],viewport:{width:1500,height:1000}});t.after(()=>context.close());context.setDefaultTimeout(15000);
  const session=await context.browser().newBrowserCDPSession(),{id:extId}=await session.send('Extensions.loadUnpacked',{path:build});
  const controller=await context.newPage();await controller.goto(`chrome-extension://${extId}/help.html`);
  const source=await context.newPage();await source.goto(base+'/public');await source.locator('img').first().evaluate(img=>img.decode());
  const tabId=await controller.evaluate(async base=>(await chrome.tabs.query({})).find(t=>t.url?.startsWith(base)).id,base);
  const send=(type,args={})=>controller.evaluate(({id,type,args})=>chrome.tabs.sendMessage(id,{app:'ali-pdf',type,...args}),{id:tabId,type,args});
  async function connect(){await controller.evaluate(async id=>{await chrome.scripting.executeScript({target:{tabId:id},files:['content.js']});await chrome.tabs.sendMessage(id,{app:'ali-pdf',type:'CONFIGURE',contentPath:'#content'});const tab=await chrome.tabs.get(id);await chrome.storage.local.set({lastSource:{id,title:tab.title,url:tab.url}});},tabId);}
  await connect();
  const panel=await context.newPage();await panel.goto(`chrome-extension://${extId}/panel.html`);await panel.waitForFunction(()=>!document.getElementById('scan').disabled);
  await t.test('CORS blocks the page reader but extension host access retains original bytes on partial autosave',async()=>{
    const read=await send('RESOURCE',{url:assetBase+'/public.svg'});assert.ok(read.error);
    // Simulate the pending host-consent state at the panel boundary. The test
    // manifest grants both localhost hosts so Chrome can execute the granted fetch.
    await panel.evaluate(origin=>{
      const contains=chrome.permissions.contains.bind(chrome.permissions);window.__assetGrant=false;
      chrome.permissions.contains=async p=>p.origins?.includes(origin) && !window.__assetGrant?false:contains(p);
      chrome.permissions.request=async()=>{window.__assetGrant=true;return true;};
    },assetBase+'/*');
    const opened=context.waitForEvent('page');await panel.locator('#scan').click();
    await panel.waitForFunction(()=>!document.getElementById('permissionBox').hidden);assert.ok((await panel.locator('#permissionInfo').innerText()).includes('localhost'));
    await panel.locator('#grantResources').click();const preview=await opened;await preview.waitForFunction(()=>!document.getElementById('print').disabled);
    const doc=await preview.evaluate(async()=>{const {readDocument}=await import('./shared.js');return readDocument(new URL(location.href).searchParams.get('id'));});
    assert.ok(doc.html.includes(Buffer.from(svg).toString('base64')),'visible cross-origin image must retain its original source bytes');
    assert.ok(!doc.html.includes('Ảnh chưa lưu được: Ảnh gốc đã hiện'));assert.ok(doc.html.includes('Ảnh chưa lưu được: Ảnh thực sự thiếu'));
    assert.ok(doc.reports[0].recoveredResources.some(r=>r.method==='extension-fetch'));assert.equal(doc.reports[0].failedResources.length,1);await preview.close();
  });
  await t.test('when fetch and canvas are blocked, native printing keeps the live cross-origin image',async()=>{
    await source.goto(base+'/protected');await source.locator('img').evaluate(img=>img.decode());await connect();await panel.reload();await panel.waitForFunction(()=>!document.getElementById('scan').disabled);
    const pixel=await send('LOADED_IMAGE',{url:assetBase+'/protected.svg'});assert.ok(pixel.error.includes('khác miền'));
    await panel.locator('#scan').click();await panel.waitForFunction(()=>!document.getElementById('prepare').disabled && !document.getElementById('resultBox').hidden);
    const opened=context.waitForEvent('page');await panel.locator('#prepare').click();const preview=await opened;await preview.waitForFunction(()=>!document.getElementById('print').disabled);
    assert.equal(await preview.locator('#nativePrint').isVisible(),true);await preview.locator('#nativePrint').click();
    await source.locator('[data-ali-ui="native-print"]').getByText('In / Lưu PDF',{exact:true}).waitFor();
    await poll(()=>source.locator('[data-ali-ui="native-print"]').getByText('In / Lưu PDF',{exact:true}).isEnabled());
    const frame=source.frames().find(f=>f.url()==='about:srcdoc');assert.ok(frame);
    assert.equal(await frame.locator('img').count(),1);assert.equal(await frame.locator('img').evaluate(img=>img.complete && img.naturalWidth===640),true);
    assert.equal(await frame.locator('h3').innerText(),'Câu hỏi 1: Động mạch đùi');assert.ok(await frame.locator('h3').evaluate(h=>h.getBoundingClientRect().width>600));
    assert.ok(requests.some(r=>r.url==='/protected.svg' && r.destination==='image' && r.referrer?.startsWith(base+'/')),'native image rendering retains the source-page referrer');
    const html=await frame.content();await fs.writeFile(path.join(work,'native-print.html'),html);
    // Print the same native HTML from a same-origin test carrier so images use
    // the same image-request/referrer rules as the actual print frame.
    const printer=await context.newPage();await printer.goto(base+'/carrier');await printer.setContent(html);await printer.locator('img').evaluate(img=>img.decode());await printer.pdf({path:path.join(work,'native-images.pdf'),preferCSSPageSize:true,printBackground:true});await printer.close();
    await source.screenshot({path:path.join(work,'native-frame.png')});
    await source.locator('[data-ali-ui="native-print"]').getByText('Đóng bản in',{exact:true}).click();assert.equal(await source.locator('[data-ali-ui="native-print"]').count(),0);
    const state=await send('STATE');const stale=await send('NATIVE_PRINT',{captureId:'stale',pageUrl:state.pageUrl});assert.ok(stale.error.includes('đã đổi'));await preview.close();
  });
  await t.test('late lazy-load source changes are refreshed without pairing a reused image with the wrong question',async()=>{
    const captured=await send('RESULT');
    const id=captured.chunks[0].html.match(/data-ali-image-id="([^"]+)"/)[1];
    await source.locator('img').evaluate((img,url)=>{img.src=url;return img.decode();},assetBase+'/public.svg?late=true');
    const sources=await send('IMAGE_SOURCES',{ids:[id]});assert.equal(sources.images[0].url,assetBase+'/public.svg?late=true');
    const opened=context.waitForEvent('page');await panel.locator('#prepare').click();const preview=await opened;await preview.waitForFunction(()=>!document.getElementById('print').disabled);
    const doc=await preview.evaluate(async()=>{const {readDocument}=await import('./shared.js');return readDocument(new URL(location.href).searchParams.get('id'));});
    assert.ok(doc.html.includes(Buffer.from(svg).toString('base64')));assert.equal(doc.reports[0].failedResources.length,0);assert.equal(doc.reports[0].complete,true);
    await source.locator('h3').evaluate(el=>{el.textContent='Câu hỏi 2: Câu khác dùng lại nút ảnh';});
    await source.locator('img').evaluate((img,url)=>{img.src=url;return img.decode();},assetBase+'/public.svg?question=2');
    assert.deepEqual((await send('IMAGE_SOURCES',{ids:[id]})).images,[]);await preview.close();
  });
});
