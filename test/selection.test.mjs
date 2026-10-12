import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {chromium} from '../src/runtime.mjs';
import {snapshot} from '../src/dom.mjs';
import {domFunction} from '../src/dom-evaluate.mjs';
import {exportLesson} from '../src/exporter.mjs';

const svg='<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240"><rect width="640" height="240" fill="#e8f2ff"/><circle cx="320" cy="120" r="95" fill="#1c62d8"/><text x="320" y="126" text-anchor="middle" font-size="22" fill="white">ANATOMY</text></svg>';
const html=`<!doctype html><html lang="vi"><meta charset="utf-8"><title>Kiểm tra kéo vùng · Giải phẫu</title><style>body{margin:0;font:16px Arial;background:#f4f7fc}.top{height:90px;background:#1c62d8;color:white;padding:30px;font-size:22px}#layout{display:grid;grid-template-columns:180px 900px 300px;grid-template-rows:730px;position:relative;padding:16px;gap:16px}aside{background:white;border:1px solid #ddd;padding:15px}#content{height:730px;overflow:auto;background:white;padding:20px;border:1px solid #dde4ef;border-radius:12px}.question{margin-bottom:24px}h3{font-size:17px}img{width:640px;max-width:100%;height:auto}.answer{display:flex;align-items:center;gap:12px;border:1px solid #18a573;background:#eafff3;padding:10px;border-radius:9px}.badge{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:32px;height:32px;border-radius:50%;background:#00b88a;color:white}.text{flex:1}#course{position:absolute;right:16px;top:16px;width:300px;z-index:30}aside a{display:block;margin:20px 0}#ruler{position:fixed;top:0;left:0;background:yellow;z-index:90;padding:8px}</style><div class="top">Giải phẫu người</div><div id="layout"><aside id="sidebar">Danh sách câu hỏi<div>Tất cả <span>12</span></div><div>${Array.from({length:12},(_,i)=>`<button>${i+1}</button>`).join('')}</div></aside><main id="content">${Array.from({length:12},(_,i)=>`<section class="question"><h3>Câu hỏi ${i+1}: Động mạch đùi</h3><p>Chữ tiếng Việt rõ ràng, giữ tĩnh mạch và thần kinh.</p><div class="answer"><span class="badge">A</span><div class="text">Đáp án và giải thích câu ${i+1}: nhánh mũ chậu nông, động mạch chậu ngoài và cơ khép.</div></div>${i%3===0?'<img data-src="/image.svg" loading="lazy" alt="Ảnh giải phẫu">':''}<p>B. Một lựa chọn khác của câu hỏi.</p></section>`).join('')}</main><aside id="course"><h2>Nội dung khóa học</h2><a href="/video/40129?lesson-id=one">Chương một · MENU MUST NOT EXPORT</a><a href="/video/40129?lesson-id=two">Chương hai · MENU MUST NOT EXPORT</a><img src="/missing.png" alt="Ảnh menu lỗi"></aside></div><div id="ruler"><span>Ruler mode...</span></div></html>`;

test('drag selection, screenshot preview and navigation-free A4 layout', {timeout:120000},async t=>{
  const server=http.createServer((req,res)=>{
    if(req.url==='/image.svg'){res.writeHead(200,{'content-type':'image/svg+xml'});res.end(svg);return;}
    if(req.url==='/missing.png'){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end(html);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  const base=`http://127.0.0.1:${server.address().port}`;
  const work=path.resolve('tmp/selection-test');await fs.mkdir(work,{recursive:true});
  const profile=await fs.mkdtemp(path.join(work,'profile-'));
  const context=await chromium.launchPersistentContext(profile,{channel:'chrome',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging'],viewport:null});
  t.after(()=>context.close());context.setDefaultTimeout(10000);
  const browserSession=await context.browser().newBrowserCDPSession();
  const {id:extensionId}=await browserSession.send('Extensions.loadUnpacked',{path:path.resolve('extension')});
  const controller=await context.newPage();await controller.goto(`chrome-extension://${extensionId}/help.html`);
  const source=await context.newPage();await source.goto(base+'/lesson');await source.bringToFront();
  const sourceId=await controller.evaluate(async()=> (await chrome.tabs.query({active:true,currentWindow:true}))[0].id);
  const targets=await browserSession.send('Target.getTargets',{filter:[{type:'tab',exclude:false},{exclude:true}]});
  const {windowId:nativeWindow}=await browserSession.send('Browser.getWindowForTarget',{targetId:targets.targetInfos.find(info=>info.url===base+'/lesson').targetId});
  await browserSession.send('Browser.setWindowBounds',{windowId:nativeWindow,bounds:{width:1520,height:1150}});
  await browserSession.send('Extensions.triggerAction',{id:extensionId,targetId:targets.targetInfos.find(info=>info.url===base+'/lesson').targetId});
  const panel=await context.newPage();await panel.goto(`chrome-extension://${extensionId}/panel.html`);await panel.setViewportSize({width:420,height:1000});
  await panel.waitForFunction(()=>document.getElementById('sourceTitle').textContent.includes('Kiểm tra kéo vùng'));
  await t.test('drag picks the entire question column and previews it before crawling',async()=>{
    await panel.locator('#dragContent').click();await source.bringToFront();
    const sourceSession=await context.newCDPSession(source);await sourceSession.send('Emulation.clearDeviceMetricsOverride');
    await browserSession.send('Browser.setWindowBounds',{windowId:nativeWindow,bounds:{width:1520,height:1150}});
    const bounds=await source.locator('#content').boundingBox();
    await source.mouse.move(bounds.x+8,bounds.y+8);await source.mouse.down();
    await source.mouse.move(bounds.x+bounds.width-14,bounds.y+540,{steps:12});await source.mouse.up();
    await source.screenshot({path:path.join(work,'drag-on-page.png')});
    const use=source.locator('[data-ali-ui]').getByText('Dùng vùng này',{exact:true});assert.equal(await use.isEnabled(),true);await use.click();
    await panel.waitForFunction(()=>document.getElementById('contentStatus').textContent.includes('✓'));
    const state=await controller.evaluate(id=>chrome.tabs.sendMessage(id,{app:'ali-pdf',type:'STATE'}),sourceId);
    assert.equal(state.contentPath,'#content');
    await panel.waitForFunction(()=>!document.getElementById('selectionImage').hidden && document.getElementById('selectionImage').naturalWidth>0,{timeout:15000});
    assert.ok((await panel.locator('#selectionInfo').innerText()).includes('12 câu'));
    assert.ok(await source.locator('#content img').first().evaluate(img=>img.naturalWidth>0),'visible lazy image loads before scan');
    assert.equal(await source.locator('[data-ali-ui]').count(),0,'picker does not cover the screenshot or persist after confirmation');
    assert.equal(await source.locator('#course').evaluate(el=>el.style.getPropertyValue('visibility')),'','menu visibility is restored after preview');
    assert.equal(await source.locator('#ruler').evaluate(el=>el.style.getPropertyValue('visibility')),'','foreign ruler visibility is restored after preview');
    await panel.screenshot({path:path.join(work,'selection-preview.png'),fullPage:true});
  });
  await t.test('broad selection excludes sidebars, external ruler and broken navigation images',async()=>{
    const content=await source.evaluate(domFunction(snapshot),{selector:'#layout'});
    assert.equal(content.numbers.length,12);
    assert.ok(!content.html.includes('MENU MUST NOT EXPORT'));
    assert.ok(!content.html.includes('Danh sách câu hỏi'));
    assert.ok(!content.html.includes('missing.png'));
    assert.ok(content.navigationRemoved>=2);
    assert.equal((content.html.match(/<section[^>]*data-ali-block="question"/g)||[]).length,12,'a repeated question number in the explanation must not prevent keeping the whole question together');
    // The fully selected body also removes the foreign ruler overlay from export.
    const whole=await source.evaluate(domFunction(snapshot),{selector:'body'});
    assert.ok(!whole.html.includes('Ruler mode'));
    const report=await exportLesson(source,{selector:'#layout',outDir:work,name:'clean-layout',expectedCount:12,delayMs:20,maxSteps:150,log:()=>{}});
    assert.equal(report.complete,true);
    const printable=await context.newPage();await printable.setContent(await fs.readFile(path.join(work,'clean-layout.html'),'utf8'));
    await printable.emulateMedia({media:'screen'});
    await printable.screenshot({path:path.join(work,'clean-layout.png'),fullPage:false});
    const sizes=await printable.locator('h3').evaluateAll(headings=>headings.map(h=>h.getBoundingClientRect().width));
    assert.ok(sizes.every(width=>width>500),'question text receives the full A4 content width');
    const badges=await printable.locator('span').evaluateAll(spans=>spans.filter(s=>s.textContent==='A').map(s=>s.getBoundingClientRect().width));
    assert.equal(badges.length,12);assert.ok(badges.every(width=>width>=30),'option badges cannot shrink to a sliver');
    await printable.close();
  });
  await t.test('preview refuses to photograph a different active tab',async()=>{
    await controller.bringToFront();
    const result=await controller.evaluate(id=>chrome.runtime.sendMessage({app:'ali-source',type:'CAPTURE_SELECTION',tabId:id}),sourceId);
    assert.ok(result.error.includes('Không chụp tab khác'));assert.equal(result.image,undefined);
  });
});
