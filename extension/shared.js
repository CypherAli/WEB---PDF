export const escapeHtml = text => String(text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export const redact = raw => { try { const u=new URL(raw);return u.origin+u.pathname; } catch {return 'embedded';} };
export const safeName = title => (title || 'bai-hoc').normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').slice(0,120);
export function openDatabase() {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('ali-web-pdf',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('documents',{keyPath:'id'});
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
}
export async function saveDocument(doc) {
  const db=await openDatabase();
  try {await new Promise((resolve,reject)=>{const tx=db.transaction('documents','readwrite');tx.objectStore('documents').put(doc);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
  finally {db.close();}
}
export async function readDocument(id) {
  const db=await openDatabase();
  try {return await new Promise((resolve,reject)=>{const req=db.transaction('documents').objectStore('documents').get(id);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
  finally {db.close();}
}
export async function listDocuments() {
  const db=await openDatabase();
  try {return await new Promise((resolve,reject)=>{
    // Listing only summaries avoids copying all HTML/embedded images into the panel.
    const list=[],req=db.transaction('documents').objectStore('documents').openCursor();
    req.onsuccess=()=>{const c=req.result;if(!c){resolve(list.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));return;}const {id,title,createdAt,questionCount}=c.value;list.push({id,title,createdAt,questionCount});c.continue();};req.onerror=()=>reject(req.error);
  });}finally{db.close();}
}
export async function deleteDocument(id) {
  const db=await openDatabase();
  try {await new Promise((resolve,reject)=>{const tx=db.transaction('documents','readwrite');tx.objectStore('documents').delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}finally{db.close();}
}
export function downloadBlob(content,type,filename) {
  const url=URL.createObjectURL(new Blob([content],{type}));
  const a=document.createElement('a');a.href=url;a.download=filename;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
export function createHtml(lessons,{notice=''}={}) {
  const fonts=[...new Set(lessons.flatMap(l=>l.chunks.map(c=>c.fontCss)))].join('\n');
  const title=lessons.length===1 ? lessons[0].report.title:`Tài liệu khóa học · ${lessons.length} bài`;
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline';"><title>${escapeHtml(title)}</title><style>${fonts}
    @page{size:A4;margin:12mm}*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{margin:0;color:#142539;font:14px Arial,sans-serif;background:#fff}.document{width:186mm;margin:0 auto}
    img,svg{max-width:100%!important}img{max-height:245mm!important;object-fit:contain!important}
    img,svg,figure,tr,p,li,blockquote,[data-ali-block="question"]{break-inside:avoid;page-break-inside:avoid}
    h1,h2,h3,h4{break-after:avoid}p{orphans:3;widows:3}table{max-width:100%}thead{display:table-header-group}
    .lesson+.lesson{break-before:page;margin-top:24px}.lesson-title{font:600 19px Arial;margin:0 0 8px}
    .source-note{font:11px Arial;color:#596579;margin-bottom:16px}.question-chunk+.question-chunk{margin-top:24px}
    .partial-notice{padding:12px;border:2px solid #b66c00;background:#fff4d6;color:#734600;font:14px Arial;margin:0 0 18px;break-inside:avoid}
    @media screen{body{padding:24px;background:#edf1f6}.document{background:white;padding:12mm;width:210mm;box-shadow:0 3px 20px #23324d18}}
    @media print{body{padding:0}.document{width:auto;margin:0;box-shadow:none}}
    </style></head><body><main class="document">${notice?`<div class="partial-notice">${escapeHtml(notice)}</div>`:''}${lessons.map(l=>`<article class="lesson"><h1 class="lesson-title">${escapeHtml(l.report.title)}</h1><div class="source-note">${escapeHtml(l.report.source)} · ${l.report.questions.length} câu nhận diện</div>${l.report.complete===false?`<div class="partial-notice"><b>BẢN QUÉT CHƯA HOÀN TẤT</b><p>Đã giữ ${l.report.questions.length}${l.report.expectedCount?`/${l.report.expectedCount}`:''} câu. ${l.report.partialReason==='errors'?'Có lỗi khi quét hoặc lưu tài nguyên; bản này có thể thiếu ảnh hoặc nội dung.':'Đã dừng theo yêu cầu. Phần chưa quét chưa được xác nhận; bản này có thể thiếu ảnh hoặc nội dung.'}</p>${escapeHtml((l.report.warnings||[]).join(' '))}</div>`:''}${l.chunks.map(c=>`<section class="question-chunk">${c.html}</section>`).join('\n')}</article>`).join('\n')}</main></body></html>`;
}
