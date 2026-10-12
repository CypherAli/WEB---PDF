import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { prepareRoot as rawPrepareRoot, scrollStep, inspectResources as rawInspectResources, snapshot as rawSnapshot, numberButtons } from './dom.mjs';
import {domFunction} from './dom-evaluate.mjs';
const prepareRoot=domFunction(rawPrepareRoot),inspectResources=domFunction(rawInspectResources),snapshot=domFunction(rawSnapshot);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = text => createHash('sha256').update(text).digest('hex');
const escaped = text => text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
// Avoid writing signed URLs / credentials into diagnostic reports.
const redact = raw => { try { const u = new URL(raw); return `${u.origin}${u.pathname}`; } catch { return 'embedded-resource'; } };

export async function crawl(frame, selector, { maxSteps = 600, delayMs = 250, timeoutMs = 15000,excludeNavigation=true } = {}) {
  await frame.evaluate(prepareRoot, { selector,excludeNavigation });
  let stable = 0, lastState, reachedBottom = false;
  const signatures = new Set();
  let changedContent = false;
  let lastNumbers = null;
  let snapshotCount = 0;
  for (let step = 0; step < maxSteps; step++) {
    const state = await frame.evaluate(({ selector }) => {
      const el = document.querySelector(selector);
      return { text: el.innerText, numbers: [...el.innerText.matchAll(/Câu\s*(?:hỏi\s*)?(\d+)\s*[:.]/gi)].map(m => m[1]), count: el.querySelectorAll('*').length };
    }, { selector });
    // A disappearing question indicates virtualization; do not call a final snapshot complete.
    if (lastNumbers && lastNumbers.some(n => !state.numbers.includes(n))) changedContent = true;
    lastNumbers = state.numbers;
    signatures.add(hash(state.text)); snapshotCount++;
    const result = await frame.evaluate(scrollStep);
    await sleep(delayMs);
    const current = JSON.stringify([result.after, state.count, hash(state.text)]);
    stable = result.bottom && current === lastState ? stable + 1 : 0;
    lastState = current;
    if (stable >= 4) { reachedBottom = true; break; }
  }
  // bounded network-idle is supplementary; image/font checks determine readiness.
  await frame.page().waitForLoadState('networkidle', { timeout: 2500 }).catch(() => {});
  const resources = await frame.evaluate(inspectResources, { selector, timeoutMs,excludeNavigation });
  return { ...resources, reachedBottom, changedContent, snapshots: snapshotCount, distinctViews: signatures.size };
}

export async function exportLesson(page, { selector, sidebarSelector, mode = 'document', outDir, name, expectedCount, frame = page.mainFrame(), strict = true, log = console.log, ...crawlOptions }) {
  await fs.mkdir(outDir, { recursive: true });
  const detectedCount = await frame.evaluate(() => {
    const match = document.body.innerText.match(/Danh sách câu hỏi[\s\S]{0,200}?Tất cả\s*:?\s*(\d+)/i);
    return match ? Number(match[1]) : null;
  });
  const expectedSource = expectedCount ? 'user' : detectedCount ? 'visible-question-counter' : null;
  expectedCount ||= detectedCount;
  const report = { source: redact(page.url()), createdAt: new Date().toISOString(), mode, expectedCount: expectedCount || null, expectedSource, warnings: [], failedResources: [], questions: [], complete: false };
  const reportPath = path.join(outDir, `${name}.report.json`);
  const chunks = [];
  const checks = [];
  try {
    if (mode === 'questions') {
      if (!sidebarSelector) throw new Error('Chế độ từng câu cần sidebarSelector.');
      const sidebarCheck = await crawl(frame, sidebarSelector, {...crawlOptions,excludeNavigation:false});
      if (!sidebarCheck.reachedBottom) report.warnings.push('Chưa cuộn hết thanh số câu.');
      const numbers = await frame.evaluate(numberButtons, { selector: sidebarSelector });
      if (!numbers.length) throw new Error('Không thấy nút số câu trong vùng đã chọn.');
      const contentSignatures = new Set();
      report.discoveredButtons = numbers;
      for (const n of numbers) {
        log(`Đang lấy câu ${n}/${numbers.at(-1)}...`);
        const button = frame.locator(`${sidebarSelector} [data-ali-number="${n}"]`);
        await button.click({ timeout: 10000 });
        // Require the clicked question heading; do not snapshot stale content after a fixed delay.
        await frame.waitForFunction(({ selector, n }) => new RegExp(`Câu\\s*(?:hỏi\\s*)?${n}\\s*[:.]`, 'i').test(document.querySelector(selector)?.innerText || ''), { selector, n }, { timeout: 15000 });
        const check = await crawl(frame, selector, crawlOptions); checks.push(check);
        const content = await frame.evaluate(snapshot, { selector });
        if (content.numbers.length !== 1 || content.numbers[0] !== n) throw new Error('Vùng chọn chứa nhiều câu. Hãy dùng chế độ trang dài hoặc chọn riêng khung của một câu.');
        const signature = hash(content.text);
        if (contentSignatures.has(signature)) throw new Error(`Nội dung câu ${n} bị trùng; chưa thể xác nhận đủ dữ liệu.`);
        contentSignatures.add(signature); chunks.push(content); report.questions.push(n);
      }
    } else {
      log('Cuộn nội dung và chờ ảnh/font...');
      checks.push(await crawl(frame, selector, crawlOptions));
      chunks.push(await frame.evaluate(snapshot, { selector }));
      report.questions = chunks[0].numbers;
    }
    report.checks = checks.map(c => ({ ...c, brokenImages: c.brokenImages.map(i => ({ ...i, source: redact(i.source) })) }));
    if (checks.some(c => !c.reachedBottom)) report.warnings.push('Đã chạm giới hạn cuộn trước khi xác nhận cuối trang.');
    if (checks.some(c => c.changedContent)) report.warnings.push('Nội dung câu bị gỡ khỏi DOM khi cuộn (virtualization); dùng chế độ từng câu.');
    if (checks.some(c => !c.fontsReady)) report.warnings.push('Font chưa tải xong.');
    if (checks.some(c => c.brokenImages.length)) report.warnings.push('Có ảnh không tải được.');
    const unique = [...new Set(report.questions)].sort((a,b) => a-b);
    report.questions = unique;
    if (unique.length && !expectedCount) report.warnings.push('Chưa có số câu tổng để đối chiếu; không xác nhận đủ cả bài.');
    if (expectedCount && (unique.length !== expectedCount || unique.some((n,i) => n !== i + 1))) report.warnings.push(`Số câu không đủ hoặc không liên tục: thấy ${unique.length}, cần ${expectedCount}.`);
    if (!chunks.some(c => c.text.trim() || c.resources.length)) throw new Error('Vùng được chọn không có nội dung.');
    const assets = new Map();
    const request = page.context().request;
    for (const url of new Set(chunks.flatMap(c => c.resources))) {
      if (!url || url.startsWith('data:')) continue;
      try {
        if (!/^https?:/.test(url)) throw new Error('Không thể tải blob; chọn ảnh nguồn HTTP hoặc xuất trực tiếp trong trang.');
        const response = await request.get(url, { timeout: 20000, headers: { referer: page.url() } });
        if (!response.ok()) throw new Error(`HTTP ${response.status()}`);
        const mime = response.headers()['content-type']?.split(';')[0];
        if (!mime || (!mime.startsWith('image/') && !/font|octet-stream/.test(mime))) throw new Error(`Loại tài nguyên không phù hợp: ${mime}`);
        assets.set(url, `data:${mime};base64,${(await response.body()).toString('base64')}`);
      } catch (error) { report.failedResources.push({ source: redact(url), error: error.message }); }
    }
    report.warnings.push(...chunks.flatMap(c => c.warnings));
    if (report.failedResources.length) report.warnings.push('Có tài nguyên không đóng gói được; bản offline có thể thiếu.');
    report.warnings = [...new Set(report.warnings)];
    if (strict && report.warnings.some(w => /không đủ|không tải|virtualization|giới hạn cuộn|không đóng gói|iframe|không đọc được do/.test(w))) throw new Error(`Dừng xuất để tránh file thiếu: ${report.warnings.join(' ')}`);
    const embed = value => { for (const [url, data] of assets) value = value.split(escaped(url)).join(data).split(url).join(data); return value; };
    const title = await page.title();
    const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline';"><title>${escaped(title)}</title><style>${embed(chunks.map(c => c.fontCss).join('\n'))}
      @page { size:A4; margin:12mm; } * { box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      body { margin:0; color:#142539; font:14px Arial,sans-serif; } .export-content { width:186mm; }
      img,svg { max-width:100% !important; } img { max-height:245mm !important; object-fit:contain !important; }
      img,svg,figure,tr,p,li,blockquote,[data-ali-block="question"] { break-inside:avoid; page-break-inside:avoid; }
      h1,h2,h3,h4 { break-after:avoid; } p { orphans:3; widows:3; }
      table { max-width:100%; } thead { display:table-header-group; }
      .question-chunk + .question-chunk { margin-top:24px; } .source-note { font:10px Arial; color:#555; margin:0 0 12px; }
      </style></head><body><div class="export-content"><div class="source-note">${escaped(title)} · ${escaped(report.source)}</div>${chunks.map(c => `<section class="question-chunk">${embed(c.html)}</section>`).join('\n')}</div></body></html>`;
    const htmlPath = path.join(outDir, `${name}.html`);
    await fs.writeFile(htmlPath, html, 'utf8');
    const printPage = await page.context().newPage();
    try {
      await printPage.setContent(html, { waitUntil: 'load', timeout: 60000 });
      await printPage.emulateMedia({ media: 'screen' });
      const outputCheck = await printPage.evaluate(inspectResources, { selector: 'body', timeoutMs: 20000 });
      if (outputCheck.brokenImages.length) throw new Error('Ảnh lỗi trong bản đã đóng gói; chưa xuất PDF.');
      await printPage.pdf({ path: path.join(outDir, `${name}.pdf`), format: 'A4', printBackground: true, preferCSSPageSize: true, tagged: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="font:9px Arial;width:100%;text-align:center;color:#777"><span class="pageNumber"></span> / <span class="totalPages"></span></div>', margin: { top:'12mm',right:'12mm',bottom:'12mm',left:'12mm' } });
      report.complete = report.warnings.length === 0;
      report.status = report.complete ? 'verified-dom-and-resources' : 'exported-with-warnings';
      report.note = 'Kiểm tra DOM/tài nguyên không chứng minh layout PDF hoàn hảo. Chữ nằm trong ảnh vẫn là ảnh; không chạy OCR.';
      log(`Đã lưu ${path.join(outDir, `${name}.pdf`)} (${unique.length} câu nhận diện).`);
    } finally { await printPage.close(); }
    return report;
  } catch (error) { report.status = 'failed'; report.error = error.message; throw error; }
  finally { await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8'); }
}

export function lessonUrls(rawUrls, originUrl) {
  const origin = new URL(originUrl);
  const seen = new Set();
  return rawUrls.filter(raw => {
    try {
      const u = new URL(raw, origin);
      if (u.origin !== origin.origin || !/^\/video\/\d+\/?$/.test(u.pathname)) return false;
      const key = `${u.origin}${u.pathname}?lesson-id=${u.searchParams.get('lesson-id') || ''}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    } catch { return false; }
  });
}
