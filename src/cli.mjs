import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { chromium } from './runtime.mjs';
import { exportLesson, lessonUrls } from './exporter.mjs';
import { installPicker } from './dom.mjs';

const DEFAULT_URL = 'https://maihienvstep.edubit.vn/video/40129?lesson-id=EXAMPLE';
const { values } = parseArgs({ options: {
  url: { type:'string',default:DEFAULT_URL }, urls: { type:'string' }, out: { type:'string',default:'output/pdf' },
  selector: { type:'string' }, sidebar: { type:'string' }, mode: { type:'string',default:'document' },
  expected: { type:'string' }, frame: { type:'string' }, 'allow-incomplete': { type:'boolean',default:false },
  headless: { type:'boolean',default:false }, help: { type:'boolean',default:false },
  'max-steps': { type:'string',default:'600' }, 'delay-ms': { type:'string',default:'250' },
} });
if (values.help) {
  console.log('Web → PDF\nnode src/cli.mjs [--url URL] [--urls lesson-urls.txt] [--selector CSS] [--mode document|questions] [--sidebar CSS] [--expected 155] [--frame URL_FRAGMENT] [--out output/pdf] [--headless]\nMặc định dùng Chrome hiện cửa sổ, chọn nội dung bằng chuột. --allow-incomplete xuất bản có cảnh báo.');
  process.exit(0);
}
if (!['document','questions'].includes(values.mode)) throw new Error('--mode phải là document hoặc questions.');
for (const key of ['max-steps','delay-ms','expected']) if (values[key] !== undefined && (!/^\d+$/.test(values[key]) || Number(values[key]) < 1)) throw new Error(`--${key} phải là số nguyên dương.`);
if (values.headless && (!values.selector || (values.mode === 'questions' && !values.sidebar))) throw new Error('--headless cần --selector và --sidebar nếu dùng chế độ từng câu. Đăng nhập bằng chế độ có cửa sổ trước.');
if (!/^https?:\/\//.test(values.url)) throw new Error('URL phải bắt đầu bằng http:// hoặc https://.');
const rl = readline.createInterface({ input:process.stdin, output:process.stdout });
const runId = new Date().toISOString().replace(/[:.]/g,'-');
const outDir = path.resolve(values.out, `run-${runId}`);
const userDataDir = path.resolve('.browser-profile');
let context;
let hadFailure = false;
try {
  console.log('WEB → PDF | Nội dung bài học\nPDF + HTML offline + báo cáo sẽ lưu trong: ' + outDir);
  console.log('Dùng hồ sơ Chrome riêng trong .browser-profile. Không nhập mật khẩu vào terminal.');
  // Never reuse the user's live/default Chrome profile.
  context = await chromium.launchPersistentContext(userDataDir, { channel:'chrome', headless:values.headless, viewport:{width:1440,height:1000}, locale:'vi-VN' });
  const page = context.pages()[0] || await context.newPage();
  await page.goto(values.url, { waitUntil:'domcontentloaded',timeout:60000 });
  if (!values.headless) await rl.question('\nTrong Chrome vừa mở: đăng nhập, mở bài hoặc mục lục khóa học. Khi đã thấy nội dung, quay lại đây nhấn Enter: ');
  let urls = [];
  if (values.urls) {
    urls = (await fs.readFile(values.urls, 'utf8')).split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
    for (const u of urls) { const parsed = new URL(u); if (!['https:','http:'].includes(parsed.protocol) || parsed.origin !== new URL(values.url).origin) throw new Error('Danh sách URL phải cùng website với --url.'); }
    urls = [...new Set(urls)];
  } else if (!values.headless) {
    const strategy = (await rl.question('Nhiều bài: gõ links để lấy URL trong mục lục đang mở; Enter để xuất bài hiện tại rồi tiếp tục bài khác: ')).trim();
    if (strategy === 'links') {
      urls = lessonUrls(await page.locator('a[href]').evaluateAll(links => links.map(a => a.href)), page.url());
      console.log(`Tìm thấy ${urls.length} URL bài học. Chỉ lấy liên kết hiện có trong DOM; hãy đối chiếu mục lục.`);
      if (urls.length) {
        console.log(urls.map((u,i) => `${i+1}. ${u}`).join('\n'));
        if ((await rl.question('Enter để quét danh sách trên; gõ no để chỉ quét bài hiện tại: ')).trim() === 'no') urls = [];
      }
    }
  }
  let mode = values.mode;
  if (!values.selector && !values.headless) {
    const answer = (await rl.question('Chế độ: Enter = trang dài có nhiều câu; gõ 2 = chỉ thấy một câu mỗi lần chọn số: ')).trim();
    if (answer === '2') mode = 'questions';
  }
  let expected = values.expected ? Number(values.expected) : undefined;
  if (!expected && !values.headless) {
    const answer = (await rl.question('Số câu dự kiến MỖI bài (Enter nếu khác nhau/chưa biết; bài trong ảnh là 155): ')).trim();
    if (answer) { if (!/^\d+$/.test(answer) || Number(answer) < 1) throw new Error('Số câu phải là số nguyên dương.'); expected = Number(answer); }
  }
  const pick = async (frame, message, token) => {
    console.log(message + ' — chọn trong cửa sổ Chrome.');
    await frame.evaluate(installPicker, { message, token });
    await frame.waitForFunction(() => !!window.__aliPicked, null, { timeout:0 });
    const selected = await frame.evaluate(() => window.__aliPicked);
    if (selected === '__cancelled__') throw new Error('Đã hủy chọn vùng.');
    return selected;
  };
  const manifest = { startedAt:new Date().toISOString(), lessons:[] };
  await fs.mkdir(outDir, { recursive:true });
  let index = 0;
  const queue = urls.length ? urls : [null];
  while (index < queue.length) {
    const url = queue[index];
    if (url && url !== page.url()) await page.goto(url, { waitUntil:'domcontentloaded',timeout:60000 });
    if (url) console.log(`\nBài ${index+1}/${queue.length}: ${url}`);
    if (!values.headless && url && !values.selector) await rl.question('Đợi bài hiện nội dung. Nhấn Enter để chọn vùng xuất: ');
    const frames = page.frames();
    const frame = values.frame ? frames.find(f => f.url().includes(values.frame)) : page.mainFrame();
    if (!frame) throw new Error('Không tìm thấy frame theo --frame.');
    let sidebarSelector = values.sidebar;
    if (mode === 'questions' && !sidebarSelector) sidebarSelector = await pick(frame, 'Chọn CẢ thanh danh sách số câu', 'sidebar');
    const selector = values.selector || await pick(frame, 'Chọn cột nội dung bài (chữ, đáp án, giải thích, ảnh)', 'content');
    const lessonId = new URL(page.url()).searchParams.get('lesson-id') || 'lesson';
    const name = `${String(index+1).padStart(3,'0')}-${lessonId.replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80)}`;
    try {
      const report = await exportLesson(page, { selector,sidebarSelector,mode,outDir,name,expectedCount:expected,frame,strict:!values['allow-incomplete'],maxSteps:Number(values['max-steps']),delayMs:Number(values['delay-ms']) });
      manifest.lessons.push({ name,status:report.status,questionCount:report.questions.length,warnings:report.warnings });
      if (report.warnings.length) console.log('Cảnh báo: ' + report.warnings.join('\n'));
    } catch (error) {
      hadFailure = true; console.error('\nBài này chưa xuất được: ' + error.message);
      manifest.lessons.push({ name,status:'failed',error:error.message });
    }
    await fs.writeFile(path.join(outDir, 'course-manifest.json'), JSON.stringify(manifest,null,2));
    index++;
    if (!urls.length && !values.headless) {
      const next = (await rl.question('\nĐể tiếp tục: mở bài kế tiếp trong Chrome rồi nhấn Enter, hoặc dán URL bài kế. Gõ q để kết thúc: ')).trim();
      if (next.toLowerCase() === 'q') break;
      if (next) { const u = new URL(next); if (u.origin !== new URL(values.url).origin) throw new Error('Bài tiếp phải cùng website.'); queue.push(u.href); }
      else queue.push(null);
    }
  }
  console.log('\nHoàn tất lượt chạy. Xem course-manifest.json và report từng bài trong ' + outDir);
} catch (error) { hadFailure = true; console.error(error.message); }
finally { rl.close(); if (context) await context.close(); }
if (hadFailure) process.exitCode = 1;
