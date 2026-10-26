import {readDocument,downloadBlob,safeName} from './shared.js';
const $=id=>document.getElementById(id);
let doc;
let comparing=false;
function fitWorkspace() {
  const height=document.querySelector('header').getBoundingClientRect().height+document.querySelector('.notice').getBoundingClientRect().height;
  document.documentElement.style.setProperty('--chrome-height',`${Math.ceil(height)}px`);
}
function setComparison(value) {
  comparing=value;
  $('workspace').classList.toggle('comparing',value);$('originalPanel').hidden=!value;$('exportHeading').hidden=!value;
  $('compare').setAttribute('aria-pressed',String(value));
  const frame=$('document');frame.contentDocument.documentElement.toggleAttribute('data-ali-comparing',value);
  fitWorkspace();
  if(!value) {frame.style.height='600px';requestAnimationFrame(()=>{frame.style.height=`${Math.max(600,frame.contentDocument.documentElement.scrollHeight+10)}px`;});}
}
function loadOriginals() {
  const originals=(doc.referenceImages || []).filter(item=>/^data:image\/png;base64,/.test(item.image));
  $('originalCount').textContent=`${originals.length} khung`;
  const notes=doc.reports.flatMap(report=>report.referenceWarnings || []);
  $('comparisonNote').textContent=originals.length?notes.length?[...new Set(notes)].join(' '):'Cuộn riêng từng cột để đối chiếu ảnh và nội dung ở cùng vị trí.':'Tài liệu này chưa có ảnh gốc. Quét lại Bài đang mở và bật “Lưu ảnh gốc để so sánh cạnh bản xuất”.';
  for(const [index,item] of originals.entries()) {
    const figure=document.createElement('figure'),caption=document.createElement('figcaption'),image=document.createElement('img');
    caption.textContent=`${index+1}. ${item.lessonTitle || doc.title} · ${item.label || 'Ảnh gốc'}`;
    image.src=item.image;image.alt=item.label || `Khung gốc ${index+1}`;image.loading='lazy';
    if(item.cssWidth || item.width){image.style.width=`${item.cssWidth || item.width}px`;image.style.maxWidth='100%';}
    image.onerror=()=>{$('comparisonNote').textContent='Có ảnh gốc không đọc được. Bản xuất vẫn có thể in; quét lại để bổ sung ảnh đối chiếu.';};
    figure.append(caption,image);$('originalImages').append(figure);
  }
  return originals.length;
}
try {
  const id=new URL(location.href).searchParams.get('id');doc=await readDocument(id);
  if(!doc) throw new Error('Bản lưu không còn tồn tại. Mở tiện ích → Đã lưu hoặc quét lại.');
  document.title=doc.title;$('title').textContent=doc.title;
  $('summary').textContent=`${doc.reports.every(r=>r.mode==='region')?'Khung chụp chính xác · chữ dạng ảnh':`${doc.questionCount} câu nhận diện`} · ${new Date(doc.createdAt).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}`;
  const warnings=doc.reports.flatMap(r=>r.warnings || (r.warning?[r.warning]:[]));
  $('nativePrint').hidden=!doc.nativeSource;
  if(warnings.length) $('warnings').textContent='Cần kiểm tra: '+[...new Set(warnings)].join(' ');
  const frame=$('document');
  await new Promise(resolve=>{frame.onload=resolve;frame.srcdoc=doc.html;frame.hidden=false;});
  await frame.contentDocument.fonts.ready;
  const images=[...frame.contentDocument.images];
  await Promise.all(images.map(i=>i.decode().catch(()=>{})));
  if(images.some(i=>!i.complete || !i.naturalWidth)) throw new Error('Ảnh lỗi trong bản đã lưu; chưa cho in. Mở báo cáo và quét lại.');
  const style=frame.contentDocument.createElement('style');style.textContent='@media screen{html[data-ali-comparing] body{padding:16px}html[data-ali-comparing] .document{max-width:100%}}';frame.contentDocument.head.append(style);
  // Resize after content loads so the full document is visible with one outer scrollbar.
  frame.style.height=`${Math.max(600,frame.contentDocument.documentElement.scrollHeight+10)}px`;
  const originals=loadOriginals();
  for(const id of ['print','html','report','compare']) $(id).disabled=false;
  if(originals)setComparison(true);
}catch(error){$('error').textContent=error.message;$('error').hidden=false;}
$('print').onclick=()=>{$('document').contentWindow.focus();$('document').contentWindow.print();};
$('compare').onclick=()=>setComparison(!comparing);
new ResizeObserver(fitWorkspace).observe(document.querySelector('header'));
$('html').onclick=()=>downloadBlob(doc.html,'text/html;charset=utf-8',`${safeName(doc.title)}.html`);
$('report').onclick=()=>downloadBlob(JSON.stringify(doc.reports,null,2),'application/json',`${safeName(doc.title)}.report.json`);
$('nativePrint').onclick=async()=>{
  $('nativePrint').disabled=true;
  try {
    const source=doc.nativeSource;
    const state=await chrome.tabs.sendMessage(source.tabId,{app:'ali-pdf',type:'STATE'});
    if(state.pageUrl!==source.pageUrl || state.captureId!==source.captureId)throw new Error('Tab nguồn đã đổi bài. Quét lại bài cần in.');
    await chrome.tabs.update(source.tabId,{active:true});
    const result=await chrome.tabs.sendMessage(source.tabId,{app:'ali-pdf',type:'NATIVE_PRINT',...source});
    if(result.error)throw new Error(result.error);
  } catch(error){$('error').textContent=/No tab|Receiving end|Could not establish/i.test(error.message)?'Giữ tab bài học đã quét mở để in từ ảnh đang hiển thị; mở lại và quét lại nếu tab đã đóng.':error.message;$('error').hidden=false;}
  finally{$('nativePrint').disabled=false;}
};
