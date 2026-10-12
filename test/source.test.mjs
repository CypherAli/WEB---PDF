import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from '../src/runtime.mjs';

test('toolbar connection without pre-granted hosts', {timeout:60000},async t=>{
  const server=http.createServer((req,res)=>{
    res.writeHead(200,{'content-type':'text/html;charset=utf-8'});
    res.end('<!doctype html><html lang="vi"><meta charset="utf-8"><title>Fixture toolbar · Bài đã đăng nhập</title><aside>Danh sách câu hỏi <div>Tất cả <span>1</span></div></aside><main id="content"><h3>Câu hỏi 1: Nội dung kiểm tra</h3><p>Chữ tiếng Việt có thể tìm kiếm và sao chép.</p></main></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  const base=`http://127.0.0.1:${server.address().port}`;
  const work=path.resolve('tmp/source-test');await fs.mkdir(work,{recursive:true});
  const profile=await fs.mkdtemp(path.join(work,'profile-'));
  const context=await chromium.launchPersistentContext(profile,{channel:'chrome',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging'],viewport:{width:1440,height:1000}});
  t.after(()=>context.close());context.setDefaultTimeout(10000);
  const browserSession=await context.browser().newBrowserCDPSession();
  // Use the actual shipped manifest: no test-only host grants or fake source record.
  const manifest=JSON.parse(await fs.readFile('extension/manifest.json','utf8'));
  assert.equal(manifest.host_permissions,undefined);assert.ok(!manifest.permissions.includes('tabs'));
  const {id:extensionId}=await browserSession.send('Extensions.loadUnpacked',{path:path.resolve('extension')});
  const controller=await context.newPage();await controller.goto(`chrome-extension://${extensionId}/help.html`);
  const source=await context.newPage();await source.goto(base+'/lesson');await source.bringToFront();
  const sourceId=await controller.evaluate(async()=> (await chrome.tabs.query({active:true,currentWindow:true}))[0].id);
  const targets=await browserSession.send('Target.getTargets',{filter:[{type:'tab',exclude:false},{exclude:true}]});
  const targetInfo=targets.targetInfos.find(info=>info.url===base+'/lesson');
  assert.ok(targetInfo,JSON.stringify(targets.targetInfos));
  const apiState=await controller.evaluate(async({id,base})=>({
    url:(await chrome.tabs.get(id)).url,
    granted:await chrome.permissions.contains({origins:[base+'/*']}),
    saved:(await chrome.storage.local.get('lastSource')).lastSource,
  }),{id:sourceId,base});
  assert.equal(apiState.granted,false);assert.equal(apiState.saved,undefined);assert.equal(apiState.url,undefined,'Chrome really withholds the URL before invocation');
  await assert.rejects(controller.evaluate(id=>chrome.scripting.executeScript({target:{tabId:id},files:['content.js']}),sourceId),/Cannot access|permission/);
  await browserSession.send('Extensions.triggerAction',{id:extensionId,targetId:targetInfo.targetId});
  const receipt=await controller.evaluate(async()=>{
    const {id}=await chrome.windows.getCurrent();
    for(let i=0;i<30;i++) {
      const response=await chrome.runtime.sendMessage({app:'ali-source',type:'GET_SOURCE',windowId:id});
      if(response?.source) return response.source;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    return null;
  });
  assert.equal(receipt.id,sourceId);assert.equal(receipt.url,base+'/lesson');assert.equal(receipt.connectionError,undefined);
  const runnerState=await controller.evaluate(id=>chrome.tabs.sendMessage(id,{app:'ali-pdf',type:'STATE'}),sourceId);
  assert.equal(runnerState.status,'idle','toolbar action injected the scanner with temporary tab access');
  const panel=await context.newPage();await panel.goto(`chrome-extension://${extensionId}/panel.html`);await panel.setViewportSize({width:420,height:1000});
  await panel.waitForFunction(()=>document.getElementById('sourceTitle').textContent.includes('Fixture toolbar'));
  assert.equal(await panel.locator('#connectBox').isVisible(),false);
  assert.ok(!(await panel.locator('#status').innerText()).includes('nội bộ Chrome'));
  await panel.locator('#pickContent').click();await source.locator('h3').click();
  await source.locator('[data-ali-ui]').getByText('Mở rộng ↑',{exact:true}).click();
  await source.locator('[data-ali-ui]').getByText('Dùng vùng này',{exact:true}).click();
  await panel.waitForFunction(()=>document.getElementById('contentStatus').textContent.includes('✓'));
  await panel.locator('#scan').click();await panel.waitForFunction(()=>!document.getElementById('resultBox').hidden,{timeout:20000});
  const result=await controller.evaluate(id=>chrome.tabs.sendMessage(id,{app:'ali-pdf',type:'RESULT'}),sourceId);
  assert.deepEqual(result.report.questions,[1]);assert.equal(result.report.status,'captured');
  await panel.screenshot({path:path.join(work,'connected.png'),fullPage:true});
  // Revoking the temporary grant by leaving the origin must produce a permission
  // message, rather than classifying an ordinary website as a chrome:// page.
  await source.goto(base.replace('127.0.0.1','localhost')+'/other');
  await panel.locator('#pickContent').click();
  await panel.waitForFunction(()=>document.getElementById('status').classList.contains('error'));
  const error=await panel.locator('#status').innerText();
  assert.ok(error.includes('chưa cho phép'),error);assert.ok(!error.includes('nội bộ Chrome'));
  assert.equal(await panel.locator('#connectBox').isVisible(),true);
});
