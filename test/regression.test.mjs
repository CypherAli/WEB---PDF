import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {chromium} from '../src/runtime.mjs';
import {exportLesson} from '../src/exporter.mjs';

async function poll(check,timeout=30000) {
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){if(await check())return;await new Promise(resolve=>setTimeout(resolve,100));}
  throw new Error('Timed out waiting for extension state');
}

const svg='<svg xmlns="http://www.w3.org/2000/svg" width="640" height="200"><rect width="640" height="200" fill="#e8f2ff"/><text x="40" y="110" font-size="30">ORIGINAL ANATOMY IMAGE</text></svg>';
const fixture=`<!doctype html><html lang="vi"><meta charset="utf-8"><title>Hồi quy · Giải phẫu</title><style>
body{font:16px Arial;margin:0}.frame{height:700px;overflow:auto;width:1534px;padding:24px}.shell{display:grid;grid-template-columns:260px 1fr;gap:24px}.lane{display:flex;flex-direction:column;margin-left:70px;padding:60px}.indent{display:flex;padding:48px}.questions{flex:1}.card{min-height:480px;padding:20px;margin-bottom:20px;border:1px solid #dce4ec}h3{font-size:17px}.answer{display:flex;gap:12px;padding:12px;background:#eafff3;border:1px solid #00b88a;border-radius:8px}.badge{display:flex;flex:none;align-items:center;justify-content:center;width:32px;height:32px;background:#00b88a;color:#fff;border-radius:50%}.answer-text{flex:1}.numbers{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}.numbers div{background:#e7f9ee;padding:9px}img{width:640px;max-width:100%}.menu{position:fixed;right:0;top:30px;width:200px;background:#fff}
</style><div id="app" class="frame"><h1>Tài liệu bài học</h1><div class="shell"><div><div><h4><span>Danh sách câu hỏi</span></h4></div><div>Tất cả <span>20</span></div><div class="numbers">${Array.from({length:20},(_,i)=>`<div><span>${i+1}</span></div>`).join('')}</div></div><div class="lane"><div class="indent"><div class="questions">${Array.from({length:20},(_,i)=>`<div class="card"><div><h3><span>Câu hỏi ${i+1}:</span> Tìm đáp án về động mạch đùi</h3></div><div class="answer"><span class="badge">A</span><div class="answer-text">Nhánh mũ chậu nông tiếp nối với nhánh mũ chậu sâu của động mạch chậu ngoài.</div></div><p>Giải thích ${i+1}: chữ tiếng Việt có thể sao chép và tìm kiếm.</p>${i%4===0?'<img data-src="/image.svg" loading="lazy" alt="Hình giải phẫu gốc">':''}</div>`).join('')}</div></div></div></div><div class="menu"><div><b><span>Nội dung khóa học</span></b></div><a href="/video/1">MENU ONE</a><a href="/video/2">MENU TWO</a><img src="/missing-menu.png"></div></div></html>`;

test('nested application layout and preserving cancelled scans',{timeout:180000},async t=>{
  const server=http.createServer((req,res)=>{
    if(req.url==='/image.svg'){res.writeHead(200,{'content-type':'image/svg+xml'});res.end(svg);return;}
    if(req.url==='/corrupt.svg'){res.writeHead(200,{'content-type':'image/svg+xml'});res.end('invalid image bytes');return;}
    if(req.url==='/display-only.svg') {
      if(req.headers['sec-fetch-dest']!=='image'){res.writeHead(403,{'cache-control':'no-store'});res.end();return;}
      res.writeHead(200,{'content-type':'image/svg+xml','cache-control':'no-store'});res.end(svg);return;
    }
    if(req.url?.includes('missing')){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end(fixture);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  const base=`http://127.0.0.1:${server.address().port}`,work=path.resolve('tmp/regression-test');await fs.mkdir(work,{recursive:true});
  const build=await fs.mkdtemp(path.join(work,'build-'));await fs.cp(path.resolve('extension'),build,{recursive:true});
  const manifest=JSON.parse(await fs.readFile(path.join(build,'manifest.json')));manifest.host_permissions=[base+'/*'];await fs.writeFile(path.join(build,'manifest.json'),JSON.stringify(manifest));
  const context=await chromium.launchPersistentContext(await fs.mkdtemp(path.join(work,'profile-')),{channel:'chrome',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging'],viewport:{width:1700,height:1000}});t.after(()=>context.close());context.setDefaultTimeout(12000);
  const session=await context.browser().newBrowserCDPSession(),{id:extensionId}=await session.send('Extensions.loadUnpacked',{path:build});
  const controller=await context.newPage();await controller.goto(`chrome-extension://${extensionId}/help.html`);
  const source=await context.newPage();await source.goto(base+'/video/1');
  const sourceId=await controller.evaluate(async base=>(await chrome.tabs.query({})).find(t=>t.url?.startsWith(base)).id,base);
  const send=(type,params={})=>controller.evaluate(({id,type,params})=>chrome.tabs.sendMessage(id,{app:'ali-pdf',type,...params}),{id:sourceId,type,params});
  await controller.evaluate(async id=>{await chrome.scripting.executeScript({target:{tabId:id},files:['content.js']});const tab=await chrome.tabs.get(id);await chrome.storage.local.set({lastSource:{id,title:tab.title,url:tab.url}});},sourceId);
  await send('CONFIGURE',{contentPath:'#app'});
  const panel=await context.newPage();await panel.goto(`chrome-extension://${extensionId}/panel.html`);await panel.setViewportSize({width:420,height:1000});
  await panel.waitForFunction(()=>!document.getElementById('scan').disabled);
  await t.test('a broad DIV selection prints full-width questions without number/menu columns',async()=>{
    await source.locator('.card').first().evaluate(el=>el.insertAdjacentHTML('beforeend','<p>Câu hỏi 1: nhắc lại trong lời giải, vẫn giữ chung với hình.</p>'));
    await exportLesson(source,{selector:'#app',expectedCount:20,outDir:work,name:'nested-layout',delayMs:5,maxSteps:200,log:()=>{}});
    const html=await fs.readFile(path.join(work,'nested-layout.html'),'utf8');
    assert.ok(!html.includes('Danh sách câu hỏi'));assert.ok(!html.includes('MENU ONE'));assert.ok(!html.includes('missing-menu'));
    const page=await context.newPage();await page.setContent(html);await page.emulateMedia({media:'screen'});
    assert.equal(await page.locator('h3').count(),20);
    const headingWidths=await page.locator('h3').evaluateAll(items=>items.map(h=>h.getBoundingClientRect().width));
    const answerWidths=await page.getByText('Nhánh mũ chậu nông tiếp nối với nhánh mũ chậu sâu của động mạch chậu ngoài.',{exact:true}).evaluateAll(items=>items.map(h=>h.getBoundingClientRect().width));
    assert.ok(headingWidths.every(w=>w>600),JSON.stringify(headingWidths));assert.ok(answerWidths.every(w=>w>550),JSON.stringify(answerWidths));
    await page.screenshot({path:path.join(work,'nested-layout.png')});await page.close();
  });
  await t.test('Stop keeps reached questions, opens a printable partial document and preserves good images',async()=>{
    await source.evaluate(()=>{document.querySelector('.card').insertAdjacentHTML('beforeend','<img src="/missing-image.png" alt="Ảnh chưa tải"><img src="/corrupt.svg" alt="Ảnh hỏng byte">');});
    await panel.locator('#scan').click();
    await source.waitForFunction(()=>document.querySelector('#app').scrollTop>600);
    const before=await send('STATE');assert.ok(before.checkpointQuestions.length>0);assert.ok(before.checkpointQuestions.length<20);
    const newPage=context.waitForEvent('page');await panel.locator('#stop').click();
    const preview=await newPage;await preview.waitForFunction(()=>!document.getElementById('print').disabled,{timeout:30000});
    const captured=await send('RESULT');assert.equal(captured.report.status,'stopped-partial');assert.equal(captured.report.complete,false);
    assert.ok(captured.report.questions.length>0 && captured.report.questions.length<20);
    assert.deepEqual(captured.report.questions,Array.from({length:captured.report.questions.length},(_,i)=>i+1));
    const doc=await preview.evaluate(async()=>{const {readDocument}=await import('./shared.js');return readDocument(new URL(location.href).searchParams.get('id'));});
    assert.equal(doc.questionCount,captured.report.questions.length);assert.ok(doc.html.includes('BẢN QUÉT CHƯA HOÀN TẤT'));assert.ok(doc.title.includes('bản quét dở'));
    assert.ok(doc.html.includes('Ảnh chưa lưu được: Ảnh chưa tải'));assert.ok(doc.html.includes(Buffer.from(svg).toString('base64')));
    assert.ok(doc.html.includes('Ảnh chưa lưu được: Ảnh hỏng byte'));
    assert.equal(doc.reports[0].failedResources.length,2);assert.equal(doc.reports[0].expectedCount,20);
    const printed=await context.newPage();await printed.setContent(doc.html);await printed.pdf({path:path.join(work,'stopped-partial.pdf'),preferCSSPageSize:true,printBackground:true});await fs.writeFile(path.join(work,'stopped-partial.html'),doc.html);await printed.close();
    await preview.screenshot({path:path.join(work,'stopped-preview.png')});
    await source.close();await preview.reload();await preview.waitForFunction(()=>!document.getElementById('print').disabled);
    assert.equal(await preview.frameLocator('iframe').locator('img').evaluateAll(images=>images.every(i=>i.complete && i.naturalWidth>0)),true);await preview.close();
  });
  await t.test('Stop in question navigation retains earlier questions and the current question',async()=>{
    const next=await context.newPage();await next.goto(base+'/video/1');
    const id=await controller.evaluate(async base=>(await chrome.tabs.query({})).find(t=>t.url===base+'/video/1').id,base);
    await next.evaluate(()=>{
      document.querySelector('#app').innerHTML='<div id="buttons">'+[1,2,3,4,5].map(n=>`<button>${n}</button>`).join('')+'</div><div id="question"></div>';
      const show=n=>{document.querySelector('#question').innerHTML=`<h3>Câu hỏi ${n}: Động mạch</h3><p>Giải thích câu ${n}.</p>`;};
      document.querySelectorAll('button').forEach((b,i)=>b.onclick=()=>show(i+1));show(1);
    });
    await controller.evaluate(async id=>{await chrome.scripting.executeScript({target:{tabId:id},files:['content.js']});await chrome.tabs.sendMessage(id,{app:'ali-pdf',type:'CONFIGURE',contentPath:'#question',sidebarPath:'#buttons'});await chrome.tabs.sendMessage(id,{app:'ali-pdf',type:'SCAN',options:{mode:'questions',expected:5}});},id);
    await next.waitForFunction(()=>document.querySelector('h3').textContent.startsWith('Câu hỏi 2:'));
    await controller.evaluate(id=>chrome.tabs.sendMessage(id,{app:'ali-pdf',type:'CANCEL'}),id);
    let result;
    for(let i=0;i<60;i++){result=await controller.evaluate(id=>chrome.tabs.sendMessage(id,{app:'ali-pdf',type:'RESULT'}),id);if(result)break;await new Promise(r=>setTimeout(r,100));}
    assert.equal(result.report.status,'stopped-partial');assert.ok(result.report.questions.includes(1));assert.ok(result.report.questions.includes(2));assert.ok(!result.report.questions.includes(5));
    await next.close();
  });
  await t.test('stopping a course preserves completed lessons and the current partial lesson in one printable document',async()=>{
    const next=await context.newPage();await next.goto(base+'/video/1');
    const id=await controller.evaluate(async base=>(await chrome.tabs.query({})).find(t=>t.url===base+'/video/1').id,base);
    await controller.evaluate(async id=>{
      await chrome.scripting.executeScript({target:{tabId:id},files:['content.js']});await chrome.tabs.sendMessage(id,{app:'ali-pdf',type:'CONFIGURE',contentPath:'#app'});
      const tab=await chrome.tabs.get(id);await chrome.storage.local.set({lastSource:{id,title:tab.title,url:tab.url}});
    },id);
    await panel.reload();await panel.waitForFunction(()=>!document.getElementById('scan').disabled);
    await panel.locator('[data-view="course"]').click();await panel.locator('#urls').fill([1,2,3].map(n=>base+'/video/'+n).join('\n'));
    await panel.locator('#scan').click();
    await poll(()=>controller.evaluate(async base=>{
      const tab=(await chrome.tabs.query({})).find(t=>t.url===base+'/video/2');if(!tab)return false;
      try{const state=await chrome.tabs.sendMessage(tab.id,{app:'ali-pdf',type:'STATE'});return state.pageUrl===base+'/video/2' && state.status==='scanning' && state.checkpointQuestions.length>0 && state.checkpointQuestions.length<20;}catch{return false;}
    },base),45000);
    await panel.locator('#stop').click();
    try {
      await poll(()=>panel.evaluate(async()=> (await chrome.storage.local.get('lastCourseReport')).lastCourseReport?.cancelled));
      assert.ok((await panel.locator('#status').innerText()).includes('2/3 bài đã lưu'));
    } catch(error) {
      console.log('Course stop diagnostic',JSON.stringify(await panel.evaluate(async()=>({status:document.getElementById('status').textContent,report:(await chrome.storage.local.get('lastCourseReport')).lastCourseReport})),null,2));
      await panel.screenshot({path:path.join(work,'course-stop-debug.png')});throw error;
    }
    const preview=context.pages().find(p=>p.url().includes('/preview.html'));assert.ok(preview);
    await preview.waitForFunction(()=>!document.getElementById('print').disabled,{timeout:30000});
    const doc=await preview.evaluate(async()=>{const {readDocument}=await import('./shared.js');return readDocument(new URL(location.href).searchParams.get('id'));});
    assert.ok(doc.html.includes('KHÓA HỌC CHƯA QUÉT HẾT: đã lưu 2/3 bài'));
    const lessons=doc.reports.filter(r=>r.mode==='document');assert.equal(lessons.length,2);assert.equal(lessons[0].complete,true);assert.equal(lessons[1].complete,false);
    assert.ok(doc.questionCount>20 && doc.questionCount<40);
    const report=await panel.evaluate(async()=>(await chrome.storage.local.get('lastCourseReport')).lastCourseReport);
    assert.equal(report.cancelled,true);assert.equal(report.completed,1);assert.equal(report.partialLessons.length,1);assert.equal(report.failures.length,0);
    const page=await context.newPage();await page.setContent(doc.html);await page.pdf({path:path.join(work,'stopped-course.pdf'),preferCSSPageSize:true,printBackground:true});await page.close();
    await preview.close();await next.close();
  });
  await t.test('three broken images still produce a printable PDF with all questions without pressing Stop',async sub=>{
    const next=await context.newPage();await next.goto(base+'/video/1');
    await next.locator('.card').first().evaluate(el=>el.insertAdjacentHTML('beforeend','<img src="/missing-one.png" alt="Ảnh thiếu 1"><img src="/missing-two.png" alt="Ảnh thiếu 2"><img src="/corrupt.svg" alt="Ảnh hỏng 3">'));
    const id=await controller.evaluate(async base=>(await chrome.tabs.query({})).find(t=>t.url===base+'/video/1').id,base);
    await controller.evaluate(async id=>{await chrome.scripting.executeScript({target:{tabId:id},files:['content.js']});await chrome.tabs.sendMessage(id,{app:'ali-pdf',type:'CONFIGURE',contentPath:'#app'});const tab=await chrome.tabs.get(id);await chrome.storage.local.set({lastSource:{id,title:tab.title,url:tab.url}});},id);
    await panel.reload();await panel.waitForFunction(()=>!document.getElementById('scan').disabled);
    const opened=context.waitForEvent('page');await panel.locator('#scan').click();const preview=await opened;
    await preview.waitForFunction(()=>!document.getElementById('print').disabled,null,{timeout:45000});
    const doc=await preview.evaluate(async()=>{const {readDocument}=await import('./shared.js');return readDocument(new URL(location.href).searchParams.get('id'));});
    assert.equal(doc.questionCount,20);assert.equal(doc.reports[0].complete,false);assert.equal(doc.reports[0].status,'partial-error');assert.equal(doc.reports[0].partialReason,'errors');assert.equal(doc.reports[0].failedResources.length,3);
    assert.ok(doc.html.includes('20/20'));assert.ok(doc.html.includes('Ảnh chưa lưu được: Ảnh thiếu 1'));assert.ok(doc.html.includes('Ảnh chưa lưu được: Ảnh hỏng 3'));assert.ok(doc.html.includes(Buffer.from(svg).toString('base64')));
    assert.ok(!doc.html.includes('Đã dừng theo yêu cầu'));assert.ok(doc.title.includes('bản quét có lỗi'));
    const printed=await context.newPage();await printed.setContent(doc.html);await printed.pdf({path:path.join(work,'error-images.pdf'),preferCSSPageSize:true,printBackground:true});await printed.close();
    await preview.screenshot({path:path.join(work,'error-images-preview.png')});await preview.close();
    await next.evaluate(()=>{document.querySelectorAll('img').forEach(img=>{if(/missing|corrupt/.test(img.src))img.remove();});document.querySelector('.card').insertAdjacentHTML('beforeend','<img src="/display-only.svg" alt="Ảnh bị chặn tải file">');});
    await next.locator('img[src="/display-only.svg"]').evaluate(img=>img.decode());
    await sub.test('a displayed image blocked from fetch is recovered from its decoded pixels',async()=>{
      await panel.locator('#scan').click();await panel.waitForFunction(()=>!document.getElementById('prepare').disabled && !document.getElementById('resultBox').hidden,null,{timeout:45000});
      const opened=context.waitForEvent('page');await panel.locator('#prepare').click();const preview=await opened;
      await preview.waitForFunction(()=>!document.getElementById('print').disabled,null,{timeout:30000});
      const doc=await preview.evaluate(async()=>{const {readDocument}=await import('./shared.js');return readDocument(new URL(location.href).searchParams.get('id'));});
      assert.equal(doc.questionCount,20);assert.equal(doc.reports[0].complete,true);assert.ok(!doc.html.includes('Ảnh chưa lưu được: Ảnh bị chặn tải file'));assert.equal(doc.reports[0].failedResources.length,0);assert.ok(doc.reports[0].recoveredResources.some(r=>r.method==='loaded-image-png' && r.width===640 && r.height===200));await preview.close();
    });
    await next.locator('#app').evaluate(el=>el.replaceChildren());
    await controller.evaluate(id=>chrome.tabs.sendMessage(id,{app:'ali-pdf',type:'SCAN',options:{mode:'document'}}),id);
    await poll(()=>controller.evaluate(async id=>(await chrome.tabs.sendMessage(id,{app:'ali-pdf',type:'STATE'})).status==='failed',id));
    const empty=await controller.evaluate(id=>chrome.tabs.sendMessage(id,{app:'ali-pdf',type:'RESULT'}),id);assert.equal(empty.chunks.length,0);assert.ok(empty.report.error.includes('không có nội dung'));
    await next.close();
  });
});
