import {readDocument,downloadBlob,safeName} from './shared.js';
const $=id=>document.getElementById(id);
let doc;
try {
  const id=new URL(location.href).searchParams.get('id');doc=await readDocument(id);
  if(!doc) throw new Error('Bản lưu không còn tồn tại. Mở tiện ích → Đã lưu hoặc quét lại.');
  document.title=doc.title;$('title').textContent=doc.title;
  $('summary').textContent=`${doc.questionCount} câu nhận diện · ${new Date(doc.createdAt).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}`;
  const warnings=doc.reports.flatMap(r=>r.warnings || (r.warning?[r.warning]:[]));
  $('nativePrint').hidden=!doc.nativeSource;
  if(warnings.length) $('warnings').textContent='Cần kiểm tra: '+[...new Set(warnings)].join(' ');
  const frame=$('document');
  await new Promise(resolve=>{frame.onload=resolve;frame.srcdoc=doc.html;frame.hidden=false;});
  await frame.contentDocument.fonts.ready;
  const images=[...frame.contentDocument.images];
  await Promise.all(images.map(i=>i.decode().catch(()=>{})));
  if(images.some(i=>!i.complete || !i.naturalWidth)) throw new Error('Ảnh lỗi trong bản đã lưu; chưa cho in. Mở báo cáo và quét lại.');
  // Resize after content loads so the full document is visible with one outer scrollbar.
  frame.style.height=`${Math.max(600,frame.contentDocument.documentElement.scrollHeight+10)}px`;
  for(const id of ['print','html','report']) $(id).disabled=false;
}catch(error){$('error').textContent=error.message;$('error').hidden=false;}
$('print').onclick=()=>{$('document').contentWindow.focus();$('document').contentWindow.print();};
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
