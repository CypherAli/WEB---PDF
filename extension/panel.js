import { escapeHtml, redact, safeName, saveDocument, listDocuments, deleteDocument, downloadBlob, createHtml } from './shared.js';
import { resolveSourceTab,describeSourceError,SourceError } from './source.js';
import {cropSelection} from './selection-preview.js';
import {loadResource} from './resource-loader.js';

const $=id=>document.getElementById(id),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let source=null,view='single',busy=false,cancel=false,jobTab=null,results=[],currentResult=null,pendingGrant=null;
let previewKey=null,previewRunning=false,previewGeneration=0;
const status=(text,error=false)=>{$('status').textContent=text;$('status').classList.toggle('error',error);};
const message=(tabId,type,params={})=>chrome.tabs.sendMessage(tabId,{app:'ali-pdf',type,...params});
function lock(value) {
  busy=value;
  for(const id of ['useTab','connectSource','dragContent','pickContent','pickSidebar','scan','mode','expected','getLinks','urls','prepare','refreshPreview']) $(id).disabled=value;
  $('stop').hidden=!value;$('progress').hidden=!value;
  if(!value && source) void refreshSelection().catch(()=>{});
}
function showSource() {
  $('sourceTitle').textContent=source?.title || 'Chưa chọn trang';
  $('sourceUrl').textContent=source?.url || 'Mở bài trong Chrome, bấm biểu tượng Ali rồi chọn tab.';
}
function showConnection() {
  const origin=new URL(source?.url || 'https://maihienvstep.edubit.vn').origin;
  $('connectInfo').textContent=`Cho phép Ali đọc ${new URL(origin).hostname} để chọn nội dung và quét. Chỉ xin quyền cho website này.`;
  $('connectBox').hidden=false;
}
async function inject(tabId) {
  await chrome.scripting.executeScript({target:{tabId},files:['content.js']});
}
async function setSource({preferAction=true}={}) {
  const tab=await resolveSourceTab(chrome,{preferAction});
  currentResult=null;$('resultBox').hidden=true;
  resetSelectionPreview();
  source={id:tab.id,windowId:tab.windowId,title:tab.title,url:tab.url};showSource();
  try {await inject(tab.id);}catch(error){showConnection();throw error;}
  $('connectBox').hidden=true;
  await chrome.storage.local.set({lastSource:source});
  const template=(await chrome.storage.local.get('template')).template;
  if(template?.origin===new URL(source.url).origin) await message(source.id,'CONFIGURE',template);
  const current=await refreshSelection();
  status(current?.content?'Đã có vùng nội dung. Kiểm tra ảnh xem trước rồi quét.':'Đã chọn trang. Chọn vùng nội dung để bắt đầu.');
}
async function refreshSelection() {
  if(!source) return;
  const s=await message(source.id,'STATE');
  if(s.contentPath) await chrome.storage.local.set({template:{origin:new URL(source.url).origin,contentPath:s.contentPath,sidebarPath:s.sidebarPath}});
  const template=view==='course' ? (await chrome.storage.local.get('template')).template:null;
  const saved=template?.origin===new URL(source.url).origin ? template:null;
  const content=!!(s.content || saved?.contentPath),sidebar=!!(s.sidebar || saved?.sidebarPath);
  $('contentStatus').textContent=s.content ? '✓ Đã chọn vùng nội dung':saved?.contentPath ? '✓ Dùng vùng nội dung bài mẫu đã lưu':'Chưa chọn vùng nội dung';
  $('contentStatus').classList.toggle('ok',content);
  $('sidebarStatus').textContent=s.sidebar ? '✓ Đã chọn thanh số câu':saved?.sidebarPath ? '✓ Dùng thanh số bài mẫu đã lưu':'Chưa chọn thanh số';
  $('sidebarStatus').classList.toggle('ok',sidebar);
  if(!busy) $('scan').disabled=!content || s.status==='picking' || ($('mode').value==='questions' && !sidebar);
  if(s.status==='picking') status(s.progress);
  if(s.status==='idle' && s.content && !busy && `${source.id}:${s.selectionRevision}`!==previewKey) status('Đã chọn vùng. Kiểm tra ảnh xem trước rồi bấm Quét bài này.');
  if(s.content && !busy && s.status!=='picking' && view!=='library' && `${source.id}:${s.selectionRevision}`!==previewKey) void updateSelectionPreview(s.selectionRevision);
  return s;
}
function resetSelectionPreview() {
  previewKey=null;previewGeneration++;$('selectionPreview').hidden=true;$('selectionImage').hidden=true;$('selectionImage').removeAttribute('src');
}
async function updateSelectionPreview(revision) {
  if(previewRunning || busy || !source)return;
  const tabId=source.id,generation=previewGeneration;
  previewRunning=true;previewKey=`${tabId}:${revision}`;$('selectionPreview').hidden=false;$('selectionNotice').textContent='Đang tạo ảnh xem trước...';
  try {
    const meta=await message(tabId,'SELECTION');if(meta.error)throw new Error(meta.error);
    if(generation!==previewGeneration || source?.id!==tabId || busy)return;
    $('selectionInfo').textContent=`${meta.questions} câu · ${meta.images} ảnh (${meta.loadedImages} đã tải)${meta.navigationBlocks ? ` · sẽ loại ${meta.navigationBlocks} khối điều hướng` : ''}`;
    const captured=await chrome.runtime.sendMessage({app:'ali-source',type:'CAPTURE_SELECTION',tabId});
    if(captured.error)throw new Error(captured.error);
    const cropped=await cropSelection(captured.image,captured.selection);
    if(generation!==previewGeneration || source?.id!==tabId || busy)return;
    $('selectionImage').src=cropped;$('selectionImage').hidden=false;
    const current=captured.selection;
    $('selectionInfo').textContent=`${current.questions} câu · ${current.images} ảnh (${current.loadedImages} đã tải)${meta.navigationBlocks ? ` · sẽ loại ${meta.navigationBlocks} khối điều hướng` : ''}`;
    $('selectionNotice').textContent=[captured.navigationHidden?'Ảnh xem trước đã bỏ thanh điều hướng/lớp đo vùng.':'',current.loadedImages<current.images?'Ảnh chưa hiện sẽ được tải khi quét.':''].filter(Boolean).join('\n');
  }catch(error){
    if(generation===previewGeneration && source?.id===tabId) {
      $('selectionNotice').textContent=/activeTab|<all_urls>|permission/i.test(error.message)?'Bấm lại biểu tượng Ali trên tab bài học, rồi Cập nhật ảnh vùng chọn để xem ảnh.':error.message;
    }
  }finally{previewRunning=false;}
}
async function requireSource() {
  if(!source) await setSource();
  const tab=await chrome.tabs.get(source.id);
  // url can be omitted by Chrome when access is missing; it does not mean the
  // tab is a chrome:// page. Injection is the actual capability check.
  if(tab.url && !/^https?:\/\//.test(tab.url)) throw new SourceError('Tab nguồn không còn là website bài học. Bấm Dùng tab web đang mở để chọn lại.','unsupported');
  if(tab.url && source.url!==tab.url) {currentResult=null;$('resultBox').hidden=true;}
  source.title=tab.title || source.title;source.url=tab.url || source.url;showSource();
  try {await inject(source.id);}catch(error){showConnection();throw error;}
  return source;
}
function scanOptions() {
  const value=$('expected').value.trim();
  if(value && (!/^\d+$/.test(value) || Number(value)<1)) throw new Error('Số câu dự kiến phải là số nguyên dương.');
  return {mode:$('mode').value,expected:value ? Number(value):null};
}
async function waitCapture(tabId) {
  for(;;) {
    if(cancel) await message(tabId,'CANCEL').catch(()=>{});
    const s=await message(tabId,'STATE');
    status(s.progress);
    if(['ready','partial','failed','cancelled'].includes(s.status)) {
      const result=await message(tabId,'RESULT');
      if(!['ready','partial'].includes(s.status)) {currentResult=result;$('failureReport').hidden=false;throw new Error(s.error || 'Chưa có nội dung để giữ lại.');}
      return result;
    }
    await sleep(450);
  }
}
async function runCapture(tabId,options) {
  const response=await message(tabId,'SCAN',{options});
  if(response.error) throw new Error(response.error);
  return waitCapture(tabId);
}
function showResult(result) {
  currentResult=result;
  $('resultBox').hidden=false;
  $('failureReport').hidden=!(result.report.complete===false && result.report.partialReason==='errors');
  $('resultInfo').textContent=`${result.report.complete===false?'Bản quét dở · ':''}${result.report.questions.length}${result.report.complete===false && result.report.expectedCount?`/${result.report.expectedCount}`:''} câu nhận diện · ${result.chunks.reduce((n,c)=>n+c.resources.filter(u=>!u.startsWith('data:')).length,0)} tài nguyên cần đóng gói`;
  const warnings=result.report.warnings;
  $('warnings').hidden=!warnings.length;$('warnings').textContent=warnings.join('\n');
}
function originsFor(result) {
  return [...new Set(result.chunks.flatMap(c=>c.resources).filter(u=>/^https?:/.test(u)).map(u=>new URL(u).origin+'/*'))];
}
async function refreshImageSources(result,tabId) {
  const parsed=result.chunks.map(c=>({chunk:c,dom:new DOMParser().parseFromString(c.html,'text/html')}));
  const ids=parsed.flatMap(p=>[...p.dom.querySelectorAll('img[data-ali-image-id]')].map(i=>i.dataset.aliImageId));
  if(!ids.length)return;
  const response=await message(tabId,'IMAGE_SOURCES',{ids}).catch(()=>null);
  const sources=new Map((response?.images || []).map(s=>[s.id,s]));
  for(const {chunk,dom} of parsed) {
    const oldUrls=new Set(),newUrls=new Set();
    for(const img of dom.querySelectorAll('img[data-ali-image-id]')) {
      const s=sources.get(img.dataset.aliImageId);if(!s)continue;
      oldUrls.add(img.getAttribute('src'));newUrls.add(s.url);img.setAttribute('src',s.url);img.style.width=`${s.width}px`;
    }
    const background=[...dom.querySelectorAll('[style]')].map(el=>el.style.backgroundImage).join(' ');
    chunk.resources=[...new Set([...chunk.resources.filter(u=>!oldUrls.has(u) || chunk.fontCss.includes(u) || background.includes(u)),...newUrls])];
    chunk.html=dom.body.innerHTML;
  }
}
async function requestResourceAccess(result,tabId) {
  await refreshImageSources(result,tabId);
  const missing=[];
  for(const origin of originsFor(result))if(!await chrome.permissions.contains({origins:[origin]}))missing.push(origin);
  if(!missing.length || cancel)return;
  $('permissionInfo').textContent='Ảnh/phông chữ nằm trên: '+missing.map(o=>new URL(o).hostname).join(', ')+'. Bấm Cho phép nguồn ảnh để lưu ảnh gốc, kể cả khi bản quét có lỗi.';
  $('permissionBox').hidden=false;$('permissionBox').scrollIntoView({block:'nearest'});
  await new Promise(resolve=>{pendingGrant={origins:missing,resolve};});
  pendingGrant=null;$('permissionBox').hidden=true;
}
async function pack(result,tabId) {
  await refreshImageSources(result,tabId);
  result.report.captureWarnings ||= [...result.report.warnings];
  result.report.warnings=[...result.report.captureWarnings];
  const urls=[...new Set(result.chunks.flatMap(c=>c.resources))].filter(u=>u && !u.startsWith('data:'));
  const assets=new Map(),errors=[],recovered=[];
  // Bounded concurrency; whole images stay as original bytes, not recompressed canvas.
  let next=0;
  await Promise.all(Array.from({length:Math.min(4,urls.length)},async()=>{
    for(;;) {
      const i=next++;if(i>=urls.length) break;
      // Finishing already captured content is necessary to preserve a stopped
      // scan. Cancellation stops crawling/next lessons, not this save.
      const url=urls[i];status(`Đang lưu ảnh/phông chữ ${i+1} / ${urls.length}...`);
      try {
        const asset=await loadResource({url,tabId,message});assets.set(url,asset.data);
        if(asset.method!=='page-fetch')recovered.push({source:redact(url),method:asset.method,width:asset.width,height:asset.height});
      } catch(error) {errors.push({source:redact(url),error:error.message,attempts:error.attempts});}
    }
  }));
  let partial=(result.report.domComplete ?? result.report.complete)===false || cancel;
  let partialReason=partial?result.report.partialReason || (cancel?'stopped':'errors'):null;
  if(errors.length) {
    result.report.failedResources=errors;
    partial=true;partialReason ||= 'errors';
    result.report.warnings.push(`${errors.length} tài nguyên chưa lưu được; ảnh thiếu được đánh dấu trong bản PDF dở.`);
  }
  const embed=value=>{
    for(const [url,data] of [...assets].sort((a,b)=>b[0].length-a[0].length)) value=value.split(escapeHtml(url)).join(data).split(url).join(data);
    return value;
  };
  const cleanPartial=async html=>{
    const dom=new DOMParser().parseFromString(html,'text/html');
    await Promise.all([...dom.querySelectorAll('img')].map(async img=>{
      let usable=img.getAttribute('src')?.startsWith('data:');
      if(usable) {
        const check=new Image();check.src=img.getAttribute('src');
        try{await check.decode();}catch{
          usable=false;errors.push({source:'embedded-image',error:'Không giải mã được ảnh đã tải.'});
          partial=true;partialReason ||= 'errors';
          result.report.warnings.push('Có ảnh không giải mã được; vị trí ảnh đã được đánh dấu trong bản dở.');
        }
      }
      if(!usable) {
        partial=true;partialReason ||= 'errors';
        const placeholder=dom.createElement('p');placeholder.textContent=`[Ảnh chưa lưu được${img.alt?`: ${img.alt}`:''}]`;
        placeholder.style.cssText='border:1px dashed #b66c00;padding:12px;color:#805000';img.replaceWith(placeholder);
      }
    }));
    for(const el of dom.querySelectorAll('[style]'))if(/url\(["']?https?:/i.test(el.style.backgroundImage)) {
      partial=true;partialReason ||= 'errors';
      result.report.warnings.push('Có ảnh nền chưa lưu được; vị trí đã được đánh dấu.');
      el.style.backgroundImage='none';const marker=dom.createElement('span');marker.textContent='[Ảnh nền chưa lưu được]';marker.style.cssText='display:block;border:1px dashed #b66c00;color:#805000;padding:8px';el.append(marker);
    }
    return dom.body.innerHTML;
  };
  const packedChunks=await Promise.all(result.chunks.map(async c=>({...c,html:await cleanPartial(embed(c.html)),fontCss:embed(c.fontCss).replace(/@font-face\s*\{[^}]*\}/g,rule=>partial && /url\(["']?https?:/i.test(rule)?'':rule),resources:[]})));
  if(recovered.some(r=>r.method==='loaded-image-png'))result.report.warnings.push('Một số ảnh lấy từ pixel đã tải ở độ phân giải gốc và lưu PNG; byte file nguồn không còn giữ nguyên.');
  const packed={report:{...result.report,partialReason,recoveredResources:recovered,warnings:[...new Set(result.report.warnings)],complete:!partial,status:partial?partialReason==='stopped'?'stopped-partial':'partial-error':result.report.warnings.length?'ready-with-warnings':'verified-dom-and-resources',failedResources:errors},chunks:packedChunks};
  if(partial && !packed.report.warnings.some(w=>w.includes('CHƯA HOÀN TẤT')))packed.report.warnings.push(partialReason==='stopped'?'BẢN QUÉT CHƯA HOÀN TẤT: đã dừng theo yêu cầu.':'BẢN QUÉT CHƯA HOÀN TẤT: có lỗi lưu tài nguyên; vẫn giữ nội dung đọc được.');
  // The panel's downloadable report must describe the packaged document too,
  // including errors discovered after a successful DOM scan.
  Object.assign(result.report,packed.report);
  if(errors.length) {
    const s=await message(tabId,'STATE').catch(()=>null);
    if(s?.captureId)packed.nativeSource={tabId,pageUrl:s.pageUrl,captureId:s.captureId};
  }
  return packed;
}
async function storeLessons(lessons,title,notice='') {
  const partial=lessons.some(l=>l.report.complete===false) || !!notice;
  if(partial)title+=lessons.some(l=>l.report.partialReason==='errors')?' · bản quét có lỗi':' · bản quét dở';
  const id=crypto.randomUUID(),html=createHtml(lessons,{notice}),questionCount=lessons.reduce((n,l)=>n+l.report.questions.length,0);
  const doc={id,title,createdAt:new Date().toISOString(),questionCount,html,reports:lessons.map(l=>l.report),nativeSource:lessons.length===1?lessons[0].nativeSource:null};
  await saveDocument(doc);return doc;
}
async function showPreview(doc) {
  await chrome.tabs.create({url:chrome.runtime.getURL(`preview.html?id=${encodeURIComponent(doc.id)}`)});
}
async function waitPage(tabId,contentPath,expectedUrl) {
  const end=Date.now()+45000;
  while(Date.now()<end) {
    if(cancel) throw new Error('Đã dừng.');
    const tab=await chrome.tabs.get(tabId);
    if(tab.status==='complete' && tab.url===expectedUrl && !tab.pendingUrl) {
      try {
        await inject(tabId);
        const configured=await message(tabId,'CONFIGURE',{contentPath});
        // Chrome may report the new tab URL while the old content script is
        // still answering. Never start a lesson on that previous document.
        if(configured.pageUrl===expectedUrl && configured.content) return;
      } catch {}
    }
    await sleep(500);
  }
  throw new Error('Bài chưa mở được hoặc cấu trúc khác vùng đã chọn. Mở bài đó và quét riêng; công cụ không tự đăng nhập/nộp bài.');
}
function courseUrls() {
  if(!source) throw new Error('Chọn tab nguồn trước.');
  const origin=new URL(source.url).origin;
  const raw=$('urls').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(!raw.length) throw new Error('Danh sách bài học còn trống.');
  const urls=[...new Set(raw.map(value=>{
    const u=new URL(value);if(!/^https?:$/.test(u.protocol) || u.origin!==origin) throw new Error('Các bài phải cùng website với tab nguồn.');return u.href;
  }))];
  if(urls.length>250) throw new Error('Tối đa 250 bài một lượt. Chia thành các nhóm nhỏ để tiết kiệm bộ nhớ.');
  return urls;
}
async function scanCourse(permissionPromise) {
  if(!await permissionPromise) throw new Error('Chưa được phép đọc các bài trên website này.');
  const s=await requireSource(),liveConfiguration=await message(s.id,'STATE'),urls=courseUrls(),options=scanOptions();
  const template=(await chrome.storage.local.get('template')).template;
  const configuration=liveConfiguration.contentPath ? liveConfiguration:template?.origin===new URL(s.url).origin ? template:liveConfiguration;
  if(!configuration.contentPath) throw new Error('Chọn vùng nội dung một bài mẫu trước.');
  if(options.mode==='questions' && !configuration.sidebarPath) throw new Error('Chọn thanh số trên bài mẫu trước.');
  cancel=false;lock(true);$('resultBox').hidden=true;$('failureReport').hidden=true;results=[];
  const failures=[],packedLessons=[],partialLessons=[];
  let succeeded=0,combinedSize=0,combineSkipped=false;
  let batchTab=null;
  try {
    batchTab=await chrome.tabs.create({url:'about:blank',active:false});jobTab=batchTab.id;
    for(let i=0;i<urls.length;i++) {
      if(cancel) break;
      const url=urls[i];status(`Đang mở bài ${i+1} / ${urls.length}...`);
      try {
        await chrome.tabs.update(batchTab.id,{url});
        await waitPage(batchTab.id,configuration.contentPath,url);
        await message(batchTab.id,'CONFIGURE',{contentPath:configuration.contentPath,sidebarPath:configuration.sidebarPath});
        const captured=await runCapture(batchTab.id,options);
        await requestResourceAccess(captured,batchTab.id);
        const packed=await pack(captured,batchTab.id);
        if(packed.report.complete===false)partialLessons.push({source:redact(url),questions:packed.report.questions.length,expectedCount:packed.report.expectedCount});
        // Save each successful lesson immediately, so stopping/failing later does not lose it.
        const saved=await storeLessons([packed],packed.report.title);succeeded++;results.push({id:saved.id,title:saved.title});
        if($('combine').checked && !combineSkipped) {
          combinedSize+=packed.chunks.reduce((n,c)=>n+c.html.length+c.fontCss.length,0);
          if(combinedSize>80*1024*1024) {combineSkipped=true;packedLessons.length=0;}
          else packedLessons.push(packed);
        }
      } catch(error) {
        failures.push({source:redact(url),status:'failed',error:error.message});
        if(cancel) break;
        status(`Bài ${i+1} chưa lấy được: ${error.message}`,true);
      }
    }
    if($('combine').checked && packedLessons.length) {
      const notice=cancel || failures.length ? `KHÓA HỌC CHƯA QUÉT HẾT: đã lưu ${succeeded}/${urls.length} bài, gồm cả bài dở nếu có. ${cancel?'Đã dừng theo yêu cầu.':''}`:'';
      const saved=await storeLessons(packedLessons,`Khóa học · ${packedLessons.length} bài`,notice);results.push({id:saved.id,title:saved.title});
      if(failures.length || cancel) {saved.reports.push({status:'course-incomplete',failedLessons:failures,warning:notice});await saveDocument(saved);}
    }
    const manifest={createdAt:new Date().toISOString(),requested:urls.length,succeeded,completed:succeeded-partialLessons.length,partialLessons,cancelled:cancel,failures,combineSkipped};
    await chrome.storage.local.set({lastCourseReport:manifest});
    downloadBlob(JSON.stringify(manifest,null,2),'application/json',`ali-course-report-${Date.now()}.json`);
    status(`${cancel?'Đã dừng':'Đã quét'}: ${succeeded}/${urls.length} bài đã lưu. ${partialLessons.length?`${partialLessons.length} bản chưa đầy đủ. `:''}${failures.length} bài không lưu được. ${combineSkipped?'Bản gộp vượt 80 MB HTML; đã lưu riêng các bài, hãy gộp nhóm nhỏ hơn. ':''}Xem mục Đã lưu và báo cáo tải xuống.`,!!failures.length);
    if(results.length) await showPreview(results.at(-1));
  } finally {jobTab=null;pendingGrant=null;$('permissionBox').hidden=true;lock(false);if(batchTab) await chrome.tabs.remove(batchTab.id).catch(()=>{});await refreshLibrary();}
}
async function refreshLibrary() {
  const docs=await listDocuments();$('libraryList').replaceChildren();
  if(!docs.length) {$('libraryList').textContent='Chưa có tài liệu đã lưu.';return;}
  for(const doc of docs) {
    const card=document.createElement('article');card.className='card';
    const title=document.createElement('strong');title.textContent=doc.title;
    const info=document.createElement('p');info.className='muted';info.textContent=`${doc.questionCount} câu · ${new Date(doc.createdAt).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}`;
    const actions=document.createElement('div');actions.className='library-actions';
    const open=document.createElement('button');open.className='secondary';open.textContent='Mở / Lưu PDF';open.onclick=()=>showPreview(doc).catch(e=>status(e.message,true));
    const remove=document.createElement('button');remove.className='danger';remove.textContent='Xóa bản lưu';remove.onclick=async()=>{await deleteDocument(doc.id);await refreshLibrary();};
    actions.append(open,remove);card.append(title,info,actions);$('libraryList').append(card);
  }
}
const guarded=handler=>async event=>{try {await handler(event);}catch(error){status(describeSourceError(error),true);if(error.code==='permission')showConnection();if(!busy) $('progress').hidden=true;}};
$('useTab').onclick=guarded(()=>setSource({preferAction:false}));
$('connectSource').onclick=guarded(async()=>{
  // Keep the permission request in this user click, before any awaited work.
  const origin=new URL(source?.url || 'https://maihienvstep.edubit.vn').origin;
  const allowed=await chrome.permissions.request({origins:[origin+'/*']});
  if(!allowed) throw new SourceError('Chưa được phép đọc website. Bạn có thể bấm lại biểu tượng Ali trên trang để dùng quyền tạm thời.','permission');
  await setSource({preferAction:false});
});
async function pickContent(method) {
  const s=await requireSource();currentResult=null;$('resultBox').hidden=true;
  const result=await message(s.id,'PICK',{kind:'content',method});if(result.error)throw new Error(result.error);
  resetSelectionPreview();$('scan').disabled=true;
  status(method==='drag'?'Giữ và kéo chuột quanh cột bài trên trang. Kiểm tra viền cam rồi bấm Dùng vùng này.':'Bấm vào nội dung trên trang; mở rộng vùng rồi bấm Dùng vùng này.');
}
$('pickContent').onclick=guarded(()=>pickContent('element'));
$('dragContent').onclick=guarded(()=>pickContent('drag'));
$('refreshPreview').onclick=guarded(async()=>{const s=await requireSource();const state=await message(s.id,'STATE');await updateSelectionPreview(state.selectionRevision);});
$('pickSidebar').onclick=guarded(async()=>{const s=await requireSource();await message(s.id,'PICK',{kind:'sidebar'});status('Chọn nhóm chứa các nút số câu trên trang.');});
$('mode').onchange=()=>{$('sidebarBox').hidden=$('mode').value!=='questions';if(source)void refreshSelection().catch(()=>{});};
$('getLinks').onclick=guarded(async()=>{const s=await requireSource();const links=await message(s.id,'LINKS');$('urls').value=links.map(l=>l.url).join('\n');status(`Tìm được ${links.length} bài trong các liên kết hiện có. Đối chiếu mục lục trước khi quét.`);});
$('scan').onclick=guarded(async()=>{
  if(view==='course') {
    // Request only this origin, synchronously from the user's click.
    if(!source) throw new Error('Chọn tab nguồn trước.');
    const urls=courseUrls();scanOptions();
    const permission=chrome.permissions.request({origins:[new URL(source.url).origin+'/*']});
    return scanCourse(permission);
  }
  const s=await requireSource();cancel=false;lock(true);$('resultBox').hidden=true;$('failureReport').hidden=true;currentResult=null;jobTab=s.id;
  try {
    const result=await runCapture(s.id,scanOptions());showResult(result);
    if(result.report.complete===false || cancel) {
      await requestResourceAccess(result,s.id);
      const packed=await pack(result,s.id),saved=await storeLessons([packed],packed.report.title);
      showResult(result);
      await refreshLibrary();await showPreview(saved);
      status(`Đã giữ ${saved.questionCount} câu trong bản quét ${packed.report.partialReason==='errors'?'có lỗi':'dở'}. Bấm In / Lưu PDF ở tab vừa mở.`);
    } else status('Đã quét xong. Tạo bản in để lưu tài liệu.');
  }
  finally {jobTab=null;lock(false);}
});
$('stop').onclick=()=>{cancel=true;status('Đang dừng cuộn và lưu phần đã quét...');pendingGrant?.resolve(false);if(jobTab) void message(jobTab,'CANCEL').catch(()=>{});};
$('grantResources').onclick=guarded(async()=>{
  if(!pendingGrant) return;
  const grant=chrome.permissions.request({origins:pendingGrant.origins});
  pendingGrant.resolve(await grant);
});
$('skipResources').onclick=()=>pendingGrant?.resolve(false);
$('prepare').onclick=guarded(async()=>{
  if(!currentResult || !source) throw new Error('Quét bài trước khi tạo bản in.');
  const origins=originsFor(currentResult);
  // Grant only the resource hosts actually present in the selected document.
  const permission=origins.length ? chrome.permissions.request({origins}):Promise.resolve(true);
  cancel=false;lock(true);
  try {
    const allowed=await permission;
    const packed=await pack(currentResult,source.id);
    showResult(currentResult);
    const saved=await storeLessons([packed],packed.report.title);
    await refreshLibrary();await showPreview(saved);status('Đã lưu bản offline. Trong tab bản in, bấm In / Lưu PDF.');
  } finally {lock(false);}
});
$('saveReport').onclick=guarded(async()=>{
  const report=currentResult?.report || (source && (await message(source.id,'RESULT'))?.report);
  if(!report) throw new Error('Chưa có báo cáo.');
  downloadBlob(JSON.stringify(report,null,2),'application/json',`${safeName(report.title)}.report.json`);
});
$('failureReport').onclick=$('saveReport').onclick;
$('refreshLibrary').onclick=guarded(refreshLibrary);
for(const tab of document.querySelectorAll('.tab')) tab.onclick=()=>{
  if(busy) return;view=tab.dataset.view;
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b===tab));
  $('captureView').hidden=view==='library';$('libraryView').hidden=view!=='library';$('sourceCard').hidden=view==='library';$('courseView').hidden=view!=='course';
  $('scan').textContent=view==='course'?'Quét danh sách bài':'Quét bài này';$('scanStep').textContent=view==='course'?'3':'2';
  if(source && view!=='library') void refreshSelection().catch(()=>{});
  if(view==='library') void refreshLibrary();
};
await refreshLibrary();
try {await setSource();}catch(error){
  let restored=false;
  const saved=(await chrome.storage.local.get('lastSource')).lastSource;
  if(saved) {try {const live=await chrome.tabs.get(saved.id),window=await chrome.windows.getCurrent();if(live.windowId===window.id){source=saved;showSource();await inject(saved.id);await refreshSelection();restored=true;}}catch{}}
  if(!restored) {status(describeSourceError(error),true);if(error.code==='permission' || source)showConnection();}
}
setInterval(async()=>{
  if(busy || !source) return;
  try {const s=await refreshSelection();if(s.status==='ready' && !currentResult) showResult(await message(source.id,'RESULT'));}catch{}
},1000);
