import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {chromium} from '../src/runtime.mjs';

const svg='<svg xmlns="http://www.w3.org/2000/svg" width="600" height="320"><rect width="600" height="320" fill="#e6f3ff"/><circle cx="300" cy="160" r="125" fill="#1c62d8"/><text x="300" y="168" text-anchor="middle" font-size="24" fill="white">PRIVATE IMAGE</text></svg>';
const fixture=lesson=>`<!doctype html><html lang="vi"><meta charset="utf-8"><title>Bài ${lesson} · Giải phẫu người</title><style>body{font:16px Arial;background:#f6f8fb;margin:20px}aside{width:200px;float:left}#content{margin-left:220px;height:430px;overflow:auto;padding:20px;background:#fff}.question{padding-bottom:20px}img{max-width:100%;width:600px}h3{font-size:17px}.correct{background:#e7fff1;border:1px solid #19a56c;padding:12px;border-radius:8px}</style><aside id="sidebar">Danh sách câu hỏi<div>Tất cả <span>9</span></div><div>${Array.from({length:9},(_,i)=>`<button>${i+1}</button>`).join('')}</div><a href="/video/40129?lesson-id=first">Bài một</a><a href="/video/40129?lesson-id=second">Bài hai</a></aside><main id="content">${Array.from({length:9},(_,i)=>`<section class="question"><h3>Câu hỏi ${i+1}: Giải phẫu ${lesson}</h3><p>Động mạch đùi, tĩnh mạch và thần kinh.</p><div class="correct">A. Đáp án đúng và lời giải câu ${i+1}.</div>${i%3===0?'<img data-src="/private.svg" loading="lazy" alt="Hình minh họa riêng tư">':''}<p>B. Đáp án khác. Nội dung copy và tìm kiếm được.</p></section>`).join('')}</main></html>`;

test('Chrome extension end-to-end', {timeout:180000},async t=>{
  const requests=[];
  const server=http.createServer((req,res)=>{
    requests.push({url:req.url,cookie:req.headers.cookie});
    if(req.url==='/private.svg') {
      if(!req.headers.cookie?.includes('fixture-session=logged-in')) {res.writeHead(401);res.end('not logged in');return;}
      res.writeHead(200,{'content-type':'image/svg+xml'});res.end(svg);return;
    }
    const u=new URL(req.url,'http://localhost');
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','set-cookie':'fixture-session=logged-in; Path=/; SameSite=Lax'});
    res.end(fixture(u.searchParams.get('lesson-id') || 'first'));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>server.close());
  const base=`http://127.0.0.1:${server.address().port}`;
  const work=path.resolve('tmp/extension-test');await fs.mkdir(work,{recursive:true});
  const extensionPath=await fs.mkdtemp(path.join(work,'build-'));
  await fs.cp(path.resolve('extension'),extensionPath,{recursive:true});
  const manifest=JSON.parse(await fs.readFile(path.join(extensionPath,'manifest.json')));
  // Test-only grant for the localhost fixture. The shipped extension has no fixed host access.
  manifest.host_permissions=[base+'/*'];
  await fs.writeFile(path.join(extensionPath,'manifest.json'),JSON.stringify(manifest));
  const profile=await fs.mkdtemp(path.join(work,'profile-'));
  const context=await chromium.launchPersistentContext(profile,{channel:'chrome',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging'],viewport:{width:1440,height:1000},acceptDownloads:true});
  t.after(()=>context.close());
  context.setDefaultTimeout(10000);
  const browserSession=await context.browser().newBrowserCDPSession();
  const {id:extensionId}=await browserSession.send('Extensions.loadUnpacked',{path:extensionPath});
  const worker=await context.newPage();
  await worker.goto(`chrome-extension://${extensionId}/help.html`);
  const source=await context.newPage();await source.goto(base+'/video/40129?lesson-id=first');
  const sourceId=await worker.evaluate(async base=>(await chrome.tabs.query({})).find(t=>t.url?.startsWith(base)).id,base);
  const send=(type,params={})=>worker.evaluate(({id,type,params})=>chrome.tabs.sendMessage(id,{app:'ali-pdf',type,...params}),{id:sourceId,type,params});
  await worker.evaluate(async ({id})=>{
    await chrome.scripting.executeScript({target:{tabId:id},files:['content.js']});
    await chrome.storage.local.set({lastSource:{id,title:'Bài first · Giải phẫu người',url:(await chrome.tabs.get(id)).url}});
  },{id:sourceId});
  const panel=await context.newPage();await panel.goto(`chrome-extension://${extensionId}/panel.html`);await panel.setViewportSize({width:390,height:1000});
  const consoleErrors=[];panel.on('pageerror',e=>consoleErrors.push(e.message));
  try {
    await t.test('mouse picker selects the content and cancellation restores UI',async()=>{
      await panel.locator('#pickContent').click();
      await source.locator('h3').first().click();
      const ui=source.locator('[data-ali-ui]');
      await ui.getByText('Mở rộng ↑',{exact:true}).click();
      await ui.getByText('Mở rộng ↑',{exact:true}).click();
      await ui.getByText('Dùng vùng này',{exact:true}).click();
      await panel.waitForFunction(()=>document.getElementById('contentStatus').textContent.includes('✓'));
      const state=await send('STATE');assert.equal(state.contentPath,'#content');
      await panel.locator('#mode').selectOption('questions');
      await panel.locator('#pickSidebar').click();
      await source.locator('aside button').first().click();
      await ui.getByText('Hủy chọn',{exact:true}).click();
      await source.waitForFunction(()=>!document.querySelector('[data-ali-ui]'));
      assert.equal(await source.locator('aside button').first().evaluate(el=>el.style.outline),'');
      await worker.evaluate(async id=>{for(let i=0;i<20;i++){const s=await chrome.tabs.sendMessage(id,{app:'ali-pdf',type:'STATE'});if(s.status==='idle')return;await new Promise(r=>setTimeout(r,50));}},sourceId);
      await panel.locator('#mode').selectOption('document');
    });
    await t.test('logged-in lazy images, original bytes, inert offline preview and report',async()=>{
      await panel.locator('#scan').click();
      await panel.waitForFunction(()=>!document.getElementById('resultBox').hidden,{timeout:30000});
      const result=await send('RESULT');
      assert.deepEqual(result.report.questions,[1,2,3,4,5,6,7,8,9]);
      assert.equal(result.report.expectedCount,9);
      const newPage=context.waitForEvent('page');
      await panel.locator('#prepare').click();
      const preview=await newPage;
      await preview.waitForFunction(()=>!document.getElementById('print').disabled,{timeout:30000});
      const doc=await preview.evaluate(async()=>{
        const {readDocument}=await import('./shared.js');return readDocument(new URL(location.href).searchParams.get('id'));
      });
      assert.ok(doc.html.includes(Buffer.from(svg).toString('base64')));
      assert.ok(doc.html.includes('Động mạch đùi, tĩnh mạch và thần kinh.'));
      assert.ok(!doc.html.includes('<script'));
      assert.equal(await preview.locator('iframe').getAttribute('sandbox'),'allow-same-origin allow-modals');
      assert.ok(requests.some(r=>r.url==='/private.svg' && r.cookie?.includes('fixture-session=logged-in')));
      assert.equal(doc.questionCount,9);
      await preview.screenshot({path:path.join(work,'preview.png'),fullPage:false});
      // Print the packaged document with Chromium to validate the same HTML used by the dialog.
      const printable=await context.newPage();await printable.setContent(doc.html,{waitUntil:'load'});
      await printable.pdf({path:path.join(work,'extension-fixture.pdf'),format:'A4',printBackground:true,preferCSSPageSize:true});
      await printable.close();
      await panel.screenshot({path:path.join(work,'panel.png'),fullPage:true});
      await preview.close();
    });
    await t.test('missing question count saves a printable incomplete document and exposes its report',async()=>{
      await panel.locator('#expected').fill('155');
      const newPage=context.waitForEvent('page');
      await panel.locator('#scan').click();
      const preview=await newPage;await preview.waitForFunction(()=>!document.getElementById('print').disabled,null,{timeout:30000});
      assert.ok((await panel.locator('#resultInfo').innerText()).includes('9/155'));
      assert.equal(await panel.locator('#resultBox').isVisible(),true);
      assert.equal(await panel.locator('#failureReport').isVisible(),true);
      const failed=await send('RESULT');assert.equal(failed.report.status,'partial-error');assert.equal(failed.report.complete,false);
      assert.ok(failed.report.error.includes('9/155'));assert.ok(failed.chunks.length>0);
      assert.ok((await preview.frameLocator('iframe').locator('.partial-notice').innerText()).includes('9/155'));
      await preview.close();
      await panel.locator('#expected').fill('');
    });
    await t.test('extension captures question navigation and detects virtualized content',async()=>{
      try {
      await source.evaluate(()=>{
        const main=document.querySelector('#content'),sidebar=document.querySelector('#sidebar');
        sidebar.innerHTML='Danh sách câu hỏi <div>Tất cả <span>3</span></div><div><button>1</button><button>2</button><button>3</button></div>';
        const show=n=>{main.innerHTML=`<h3>Câu hỏi ${n}: Động mạch</h3><p>Giải thích câu ${n}.</p>`;};
        sidebar.querySelectorAll('button').forEach((b,i)=>b.onclick=()=>setTimeout(()=>show(i+1),70));show(1);
      });
      await send('CONFIGURE',{contentPath:'#content',sidebarPath:'#sidebar'});
      await send('SCAN',{options:{mode:'questions',expected:3}});
      for(let i=0;i<80;i++){const s=await send('STATE');if(['ready','failed'].includes(s.status))break;await new Promise(r=>setTimeout(r,100));}
      const questions=await send('RESULT');
      assert.equal(questions.report.status,'captured');assert.deepEqual(questions.report.questions,[1,2,3]);assert.equal(questions.chunks.length,3);
      await new Promise(resolve=>setTimeout(resolve,200));
      await source.evaluate(()=>{
        const main=document.querySelector('#content');
        main.innerHTML='<h3>Câu hỏi 1: Ban đầu</h3><div style="height:1600px"></div>';
        main.onscroll=()=>{if(main.scrollTop>50)main.querySelector('h3').textContent='Câu hỏi 2: Sau cuộn';};
      });
      await send('SCAN',{options:{mode:'document'}});
      for(let i=0;i<80;i++){const s=await send('STATE');if(['ready','partial','failed'].includes(s.status))break;await new Promise(r=>setTimeout(r,100));}
      const virtual=await send('RESULT');assert.equal(virtual.report.status,'partial-error');assert.ok(virtual.report.error.includes('Câu cũ bị gỡ'),virtual.report.error);assert.deepEqual(virtual.report.questions,[1,2]);
      } finally {
        await source.goto(base+'/video/40129?lesson-id=first');
        await worker.evaluate(async id=>{await chrome.scripting.executeScript({target:{tabId:id},files:['content.js']});await chrome.tabs.sendMessage(id,{app:'ali-pdf',type:'CONFIGURE',contentPath:'#content'});},sourceId);
      }
    });
    await t.test('course queue uses same browser session, combines chapters and retains each lesson',async()=>{
      await panel.locator('[data-view=course]').click();
      await panel.locator('#getLinks').click();
      await panel.waitForFunction(()=>document.getElementById('urls').value.includes('lesson-id=second'));
      assert.equal((await panel.locator('#urls').inputValue()).split('\n').length,2);
      // The batch tab opens before its URL changes; wait for the final preview by condition instead.
      await panel.locator('#scan').click();
      await panel.waitForFunction(()=>document.getElementById('status').textContent.includes('2/2 bài đã lưu'),{timeout:60000});
      let preview=context.pages().find(p=>p.url().includes('/preview.html'));
      if(!preview) preview=await context.waitForEvent('page');
      await preview.waitForFunction(()=>!document.getElementById('print').disabled,{timeout:30000});
      const merged=await preview.evaluate(async()=>{const {readDocument}=await import('./shared.js');return readDocument(new URL(location.href).searchParams.get('id'));});
      assert.equal(merged.questionCount,18);
      assert.equal(merged.reports.length,2);
      assert.ok(merged.html.includes('Giải phẫu first') && merged.html.includes('Giải phẫu second'));
      const library=await panel.evaluate(async()=>{const {listDocuments}=await import('./shared.js');return listDocuments();});
      assert.equal(library.length,5);
      const manifest=await panel.evaluate(async()=>(await chrome.storage.local.get('lastCourseReport')).lastCourseReport);
      assert.equal(manifest.succeeded,2);assert.equal(manifest.failures.length,0);
      await preview.close();
    });
    await t.test('saved documents reopen offline and do not need the source tab',async()=>{
      await source.close();
      await panel.locator('[data-view=library]').click();
      await panel.waitForFunction(()=>document.querySelectorAll('#libraryList article').length===5);
      const opened=context.waitForEvent('page');
      await panel.locator('#libraryList article').first().getByText('Mở / Lưu PDF',{exact:true}).click();
      const preview=await opened;
      await preview.route('http**',r=>r.abort());
      await preview.waitForFunction(()=>!document.getElementById('print').disabled,{timeout:30000});
      assert.equal(await preview.frameLocator('iframe').locator('img').evaluateAll(imgs=>imgs.every(i=>i.complete && i.naturalWidth)),true);
      await preview.close();
    });
    assert.deepEqual(consoleErrors,[]);
  } finally {await panel.screenshot({path:path.join(work,'panel-debug.png'),fullPage:true}).catch(()=>{});await context.close();await new Promise(resolve=>server.close(resolve));}
});
