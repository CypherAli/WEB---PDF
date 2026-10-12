import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, dependency } from '../src/runtime.mjs';
import { exportLesson, lessonUrls } from '../src/exporter.mjs';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="700" height="400"><rect width="700" height="400" fill="#e6f3ff"/><circle cx="350" cy="200" r="140" fill="#1274d6"/><text x="350" y="210" text-anchor="middle" font-size="28" fill="white">ANATOMY TEST IMAGE</text></svg>';
const fixture = `<!doctype html><html lang="vi"><meta charset="utf-8"><style>
body{font:16px Arial;margin:20px;background:#eee}aside{position:fixed;left:0;top:0;width:180px;background:white}#content{margin-left:200px;height:420px;overflow:auto;background:white;padding:22px}p{margin:18px 0}.question{margin-bottom:25px}img{width:640px;max-width:100%;height:auto} .correct{background:#e7fff1;border:1px solid #19a56c;padding:12px;border-radius:8px}
</style><aside>Danh sách câu hỏi</aside><main id="content">${Array.from({length:12},(_,i)=>`<section class="question"><h3>Câu hỏi ${i+1}: Giải phẫu người và động mạch đùi</h3><p>Nội dung tiếng Việt có thể tìm kiếm và sao chép: cơ khép, tĩnh mạch, thần kinh.</p><div class="correct">A. Đáp án và lời giải đúng cho câu ${i+1}</div><p>B. Một đáp án khác</p>${i%3===0?'<img data-src="/image.svg" loading="lazy" alt="Hình minh họa"/>':''}<p>Giải thích: giữ nguyên nội dung, màu sắc và dấu tiếng Việt.</p></section>`).join('')}</main><script>
const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting && e.target.dataset.src){e.target.src=e.target.dataset.src;delete e.target.dataset.src;}}),{root:document.querySelector('#content')});document.querySelectorAll('img').forEach(i=>observer.observe(i));
</script></html>`;

test('export pipeline on local fixtures', { timeout:180000 }, async t => {
  const server = http.createServer((req,res)=>{
    if(req.url === '/image.svg'){res.writeHead(200,{'content-type':'image/svg+xml'});res.end(svg);}
    else if(req.url === '/missing.png'){res.writeHead(404);res.end();}
    else {res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(fixture);}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel:'chrome',headless:true });
  const outDir = path.resolve('tmp/pdfs/test');
  const context = await browser.newContext({viewport:{width:1440,height:1000}});
  const page = await context.newPage();
  try {
    await t.test('nested lazy scroll, vector PDF and original image bytes', async()=>{
      await page.goto(base);
      await page.locator('aside').evaluate(el=>el.innerHTML='Danh sách câu hỏi <div>Tất cả <span>12</span></div>');
      const report = await exportLesson(page,{selector:'#content',outDir,name:'fixture',delayMs:20,maxSteps:120,timeoutMs:2000,log:()=>{}});
      assert.equal(report.complete,true);
      assert.equal(report.expectedSource,'visible-question-counter');
      assert.deepEqual(report.questions,Array.from({length:12},(_,i)=>i+1));
      assert.equal(report.checks[0].images,4);
      const html = await fs.readFile(path.join(outDir,'fixture.html'),'utf8');
      assert.ok(html.includes(Buffer.from(svg).toString('base64')),'image must retain source bytes');
      assert.ok(!html.includes('<script'));
      assert.ok(html.includes('Câu hỏi 12'));
      assert.ok(!html.includes('Danh sách câu hỏi'));
      const { PDFDocument } = dependency('pdf-lib');
      const pdf = await PDFDocument.load(await fs.readFile(path.join(outDir,'fixture.pdf')));
      assert.ok(pdf.getPageCount() >= 2);
      const offline = await context.newPage();
      await offline.route('http**',route=>route.abort());
      await offline.setContent(html);
      assert.equal(await offline.locator('img').evaluateAll(imgs=>imgs.every(i=>i.complete && i.naturalWidth>0)),true);
      await offline.close();
    });
    await t.test('broken image fails with a written report', async()=>{
      await page.goto(base);
      await page.evaluate(()=>{document.querySelector('img').src='/missing.png'; document.querySelector('img').removeAttribute('data-src');});
      await assert.rejects(exportLesson(page,{selector:'#content',outDir,name:'broken',expectedCount:12,delayMs:10,timeoutMs:500,log:()=>{}}),/Dừng xuất/);
      assert.equal(JSON.parse(await fs.readFile(path.join(outDir,'broken.report.json'))).status,'failed');
      await assert.rejects(fs.access(path.join(outDir,'broken.pdf')));
    });
    await t.test('missing questions stop export',async()=>{
      await page.goto(base);
      await assert.rejects(exportLesson(page,{selector:'#content',outDir,name:'missing-question',expectedCount:155,delayMs:10,log:()=>{}}),/Số câu không đủ/);
    });
    await t.test('virtualized questions are detected',async()=>{
      await page.setContent('<main id="content" style="height:200px;overflow:auto"><h3>Câu hỏi 1: Ban đầu</h3><div style="height:1000px"></div></main><script>document.querySelector("main").onscroll=()=>{if(document.querySelector("main").scrollTop>50)document.querySelector("h3").textContent="Câu hỏi 2: Sau cuộn"}</script>');
      await assert.rejects(exportLesson(page,{selector:'#content',outDir,name:'virtual',delayMs:20,maxSteps:80,log:()=>{}}),/virtualization/);
    });
    await t.test('question-by-question reads only navigation and waits for content',async()=>{
      await page.setContent('<aside id="sidebar"><div>Tất cả <span>3</span></div><div><button onclick="show(1)">1</button><button onclick="show(2)">2</button><button onclick="show(3)">3</button></div></aside><main id="content"><h3>Câu hỏi 1: Nội dung</h3><p>Giải thích câu 1</p></main><script>function show(n){setTimeout(()=>{document.querySelector("main").innerHTML=`<h3>Câu hỏi ${n}: Nội dung</h3><p>Giải thích câu ${n}</p>`},80)}</script>');
      const report=await exportLesson(page,{selector:'#content',sidebarSelector:'#sidebar',mode:'questions',outDir,name:'questions',expectedCount:3,delayMs:10,maxSteps:30,log:()=>{}});
      assert.deepEqual(report.questions,[1,2,3]);
      const html=await fs.readFile(path.join(outDir,'questions.html'),'utf8');
      assert.ok(html.includes('Giải thích câu 3'));
      assert.equal((html.match(/<section class="question-chunk">/g)||[]).length,3);
    });
    await t.test('course URL queue excludes other sites and deduplicates lesson ids',()=>{
      const origin='https://maihienvstep.edubit.vn/video/40129?lesson-id=one';
      assert.deepEqual(lessonUrls([origin,origin+'&x=1',origin.replace('one','two'),'https://other.test/video/40129?lesson-id=one','https://maihienvstep.edubit.vn/logout'],origin),[origin,origin.replace('one','two')]);
    });
  } finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
});
