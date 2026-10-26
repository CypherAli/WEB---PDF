import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {chromium} from '../src/runtime.mjs';

test('exact-region pixels and saved side-by-side comparison',{timeout:180000},async t=>{
  const fixture=`<!doctype html><meta charset="utf-8"><title>So sánh vùng chụp</title><style>
    body{margin:0;font:18px Arial;background:#eff3f9}#target{position:absolute;left:120px;top:60px;width:320px;height:120px;background:rgb(34,139,85)}
    #content{margin:220px 40px 20px;width:800px;height:420px;overflow:auto;background:white;border:1px solid #b8c6d8}
    .card{height:240px;padding:20px;border-bottom:1px solid #ddd}h3{margin:8px 0}svg{width:220px;height:80px}
    </style><div id="target"></div><main id="content">${Array.from({length:5},(_,i)=>`<section class="card"><h3>Câu hỏi ${i+1}: Đối chiếu hình ${i+1}</h3><p>Nội dung cuối bài ${i+1}</p><svg viewBox="0 0 220 80"><rect width="220" height="80" fill="#d9efff"/><path d="M10 40H210" stroke="#245eff" stroke-width="3"/><text x="35" y="30">HÌNH GỐC ${i+1}</text></svg></section>`).join('')}</main>`;
  const server=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end(fixture);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  const base=`http://127.0.0.1:${server.address().port}`,work=path.resolve('tmp/comparison-test');await fs.mkdir(work,{recursive:true});
  const context=await chromium.launchPersistentContext(await fs.mkdtemp(path.join(work,'profile-')),{channel:'chrome',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging'],viewport:null});t.after(()=>context.close());context.setDefaultTimeout(15000);
  const browserSession=await context.browser().newBrowserCDPSession();
  const {id:extId}=await browserSession.send('Extensions.loadUnpacked',{path:path.resolve('extension')});
  const controller=await context.newPage();await controller.goto(`chrome-extension://${extId}/help.html`);
  const source=await context.newPage();await source.goto(base);await source.bringToFront();
  const {targetInfos}=await browserSession.send('Target.getTargets',{filter:[{type:'tab',exclude:false},{exclude:true}]});
  const target=targetInfos.find(info=>info.url.startsWith(base));
  const {windowId}=await browserSession.send('Browser.getWindowForTarget',{targetId:target.targetId});
  await browserSession.send('Browser.setWindowBounds',{windowId,bounds:{width:1440,height:1000}});
  await browserSession.send('Extensions.triggerAction',{id:extId,targetId:target.targetId});
  const tabId=await controller.evaluate(async base=>(await chrome.tabs.query({})).find(tab=>tab.url?.startsWith(base)).id,base);
  await controller.evaluate(tabId=>chrome.scripting.executeScript({target:{tabId},files:['content.js']}),tabId);
  const send=(type,args={})=>controller.evaluate(({tabId,type,args})=>chrome.tabs.sendMessage(tabId,{app:'ali-pdf',type,...args}),{tabId,type,args});
  await send('CONFIGURE',{contentPath:'#content'});
  const panel=await context.newPage();await panel.goto(`chrome-extension://${extId}/panel.html`);await panel.setViewportSize({width:440,height:1050});
  await panel.waitForFunction(()=>!document.getElementById('scan').disabled);
  let exactDoc;
  await t.test('exact crop preserves pixels at double display density',async()=>{
    const result=await panel.evaluate(async()=>{
      const {cropSelection}=await import('./selection-preview.js');
      const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=1200;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#f00';ctx.fillRect(0,0,1600,1200);ctx.fillStyle='rgb(34,139,85)';ctx.fillRect(200,140,400,160);
      const image=new Image();image.src=await cropSelection(canvas.toDataURL(),{viewport:{width:800,height:600},rect:{left:100,top:70,width:200,height:80}},{maxWidth:Infinity,maxHeight:Infinity});await image.decode();
      const output=document.createElement('canvas');output.width=image.naturalWidth;output.height=image.naturalHeight;const pixels=output.getContext('2d');pixels.drawImage(image,0,0);
      return {width:output.width,height:output.height,corner:[...pixels.getImageData(399,159,1,1).data]};
    });
    assert.deepEqual(result,{width:400,height:160,corner:[34,139,85,255]});
  });
  await t.test('exact picker has no DOM expansion, cancels safely and rejects stale scroll',async()=>{
    await panel.locator('#exactContent').click();await source.bringToFront();
    await source.locator('[data-ali-ui]').getByText('Hủy chọn',{exact:true}).click();
    await panel.waitForFunction(()=>!document.getElementById('scan').disabled);
    assert.equal((await send('STATE')).selectionMode,'full');
    await panel.locator('#exactContent').click();await source.bringToFront();
    const session=await context.newCDPSession(source);await session.send('Emulation.clearDeviceMetricsOverride');
    await browserSession.send('Browser.setWindowBounds',{windowId,bounds:{width:1440,height:1000}});
    await source.mouse.move(130,70);await source.mouse.down();await source.mouse.move(330,150,{steps:6});await source.mouse.up();
    assert.equal(await source.locator('[data-ali-ui]').getByText('Mở rộng ↑',{exact:true}).count(),0);
    await source.locator('[data-ali-ui]').getByText('Dùng vùng này',{exact:true}).click();
    await panel.waitForFunction(()=>document.getElementById('contentStatus').textContent.includes('khung chính xác'));
    const selection=await send('SELECTION');assert.equal(selection.inputMode,'exact');assert.deepEqual(selection.rect,{left:130,top:70,width:200,height:80});
    await source.locator('#content').evaluate(el=>{el.scrollTop=50;});
    assert.match((await send('SELECTION')).error,/đã cuộn/);
    await source.locator('#content').evaluate(el=>{el.scrollTop=0;});
    assert.equal((await send('SELECTION')).error,undefined);
  });
  await t.test('only the dragged pixels are exported and comparison survives offline reopening',async()=>{
    await source.bringToFront();await panel.locator('#scan').click();
    await panel.waitForFunction(()=>!document.getElementById('resultBox').hidden && !document.getElementById('prepare').disabled);
    const opened=context.waitForEvent('page');await panel.locator('#prepare').click();const preview=await opened;
    await preview.setViewportSize({width:1440,height:1000});await preview.waitForFunction(()=>!document.getElementById('print').disabled);
    exactDoc=await preview.evaluate(async()=>{const {readDocument}=await import('./shared.js');return readDocument(new URL(location.href).searchParams.get('id'));});
    assert.equal(exactDoc.reports[0].mode,'region');assert.equal(exactDoc.referenceImages.length,1);
    const image=await preview.evaluate(async data=>{const img=new Image();img.src=data;await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return {width:c.width,height:c.height,pixels:[[1,1],[c.width-2,1],[1,c.height-2],[c.width-2,c.height-2]].map(([x,y])=>[...ctx.getImageData(x,y,1,1).data])};},exactDoc.referenceImages[0].image);
    assert.equal(image.width/image.height,2.5);assert.ok(image.width>=200);
    assert.ok(image.pixels.every(pixel=>pixel.join(',')==='34,139,85,255'),JSON.stringify(image));
    assert.equal(await preview.locator('#compare').getAttribute('aria-pressed'),'true');
    const left=await preview.locator('#originalPanel').boundingBox(),right=await preview.locator('#exportPanel').boundingBox();assert.ok(left.x+left.width<=right.x);
    assert.ok((await preview.frameLocator('#document').locator('img').getAttribute('src')).startsWith('data:image/png'));
    assert.ok(!exactDoc.html.includes('Câu hỏi 5'),'outside text is not added to exact crop');
    await preview.locator('#compare').click();assert.equal(await preview.locator('#originalPanel').isVisible(),false);
    await preview.locator('#compare').click();await preview.screenshot({path:path.resolve('../../outputs/ali-exact-comparison.png')});
    await preview.route('http**',route=>route.abort());await preview.reload();await preview.waitForFunction(()=>!document.getElementById('print').disabled);
    assert.equal(await preview.locator('#originalImages img').count(),1);await preview.close();
  });
  await t.test('copy full captures original frames through the bottom and prints searchable content',async()=>{
    await send('CONFIGURE',{contentPath:'#content'});await panel.reload();await panel.waitForFunction(()=>!document.getElementById('scan').disabled);
    await source.bringToFront();await panel.locator('#scan').click();
    await panel.waitForFunction(()=>!document.getElementById('resultBox').hidden && !document.getElementById('prepare').disabled,null,{timeout:60000});
    const captured=await send('RESULT');assert.equal(captured.report.complete,true);assert.ok(captured.referenceImages.length>=3,JSON.stringify(captured.report));
    assert.ok(captured.referenceImages.some(frame=>frame.atBottom),'reference capture reaches the end of the selected content');
    assert.equal(captured.report.referenceWarnings.length,0);assert.equal(await source.locator('#content').evaluate(el=>el.scrollTop),0,'scan restores original scroll');
    const opened=context.waitForEvent('page');await panel.locator('#prepare').click();const preview=await opened;
    await preview.setViewportSize({width:1600,height:1000});await preview.waitForFunction(()=>!document.getElementById('print').disabled);
    assert.ok(await preview.frameLocator('#document').locator('body').innerText().then(text=>text.includes('Nội dung cuối bài 5')));
    assert.equal(await preview.locator('#originalImages img').count(),captured.referenceImages.length);
    await preview.screenshot({path:path.resolve('../../outputs/ali-full-comparison.png')});
    const doc=await preview.evaluate(async()=>{const {readDocument}=await import('./shared.js');return readDocument(new URL(location.href).searchParams.get('id'));});
    await fs.writeFile(path.join(work,'full.html'),doc.html);
    const printer=await context.newPage();await printer.setContent(doc.html);await printer.pdf({path:path.join(work,'full.pdf'),preferCSSPageSize:true,printBackground:true});await printer.close();
    assert.ok(!doc.html.includes('originalPanel'),'reference screenshots are not included in printed content');
    await source.bringToFront();await source.locator('#content').evaluate(el=>{el.style.marginTop='1500px';});
    const started=await send('SCAN',{options:{mode:'document',expected:5,compare:true}});assert.ok(!started.error,JSON.stringify(started));
    const deadline=Date.now()+60000;let belowFold;
    while(Date.now()<deadline) {const state=await send('STATE');if(['ready','partial','failed'].includes(state.status)){belowFold=await send('RESULT');if(belowFold)break;}await new Promise(resolve=>setTimeout(resolve,100));}
    assert.ok(belowFold,JSON.stringify(await send('STATE')));assert.equal(belowFold.report.complete,true);
    assert.ok(belowFold.referenceImages.length>0,'original capture starts when below-fold content enters the viewport');
    assert.deepEqual(belowFold.report.referenceWarnings,[]);
    await source.close();await preview.reload();await preview.waitForFunction(()=>!document.getElementById('print').disabled);
    assert.equal(await preview.locator('#originalImages img').count(),captured.referenceImages.length);
    // Older stored documents still work and clearly identify missing references.
    await preview.evaluate(async()=>{const {readDocument,saveDocument}=await import('./shared.js');const doc=await readDocument(new URL(location.href).searchParams.get('id'));delete doc.referenceImages;await saveDocument(doc);});
    await preview.reload();await preview.waitForFunction(()=>!document.getElementById('print').disabled);
    assert.equal(await preview.locator('#compare').getAttribute('aria-pressed'),'false');await preview.locator('#compare').click();
    assert.match(await preview.locator('#comparisonNote').innerText(),/chưa có ảnh gốc/);await preview.close();
  });
});
