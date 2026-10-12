// This runs in the original, logged-in website. Native <img> rendering can use
// images without exposing their bytes to fetch/canvas. Text remains DOM text.
export async function prepareNativePrint({chunks,report}) {
  window.__aliNativePrintClose?.();
  const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const css='@page{size:A4;margin:12mm}*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}body{margin:0;font:14px Arial;color:#142539;background:white}main{width:186mm;margin:auto}img,svg{max-width:100%!important}img{height:auto;max-height:245mm!important;object-fit:contain!important}img,svg,figure,tr,p,li,[data-ali-block="question"]{break-inside:avoid;page-break-inside:avoid}.chunk+.chunk{margin-top:24px}h1{font-size:20px}h1,h2,h3,h4{break-after:avoid}.notice{padding:12px;border:2px solid #b66c00;background:#fff4d6;margin-bottom:16px}';
  const overlay=document.createElement('div');overlay.dataset.aliUi='native-print';
  overlay.style.cssText='position:fixed;inset:16px;z-index:2147483647;background:white;color:#142539;box-shadow:0 4px 30px #0005;display:flex;flex-direction:column;padding:14px;font:14px Arial';
  const bar=document.createElement('div');bar.style.cssText='display:flex;gap:12px;align-items:center;margin-bottom:12px';
  const info=document.createElement('span');info.textContent='Đang chuẩn bị bản in từ tab đã đăng nhập...';
  const print=document.createElement('button');print.textContent='In / Lưu PDF';print.disabled=true;print.style.cssText='padding:12px 18px;background:#1c62d8;color:white;border:0;border-radius:8px;cursor:pointer';
  const close=document.createElement('button');close.textContent='Đóng bản in';close.style.cssText='padding:12px;border:1px solid #ccd9ee;background:white;border-radius:8px;cursor:pointer';
  const frame=document.createElement('iframe');frame.dataset.aliNativeFrame='true';frame.title='Bản in từ phiên đăng nhập';frame.setAttribute('sandbox','allow-same-origin allow-modals');frame.style.cssText='width:100%;flex:1;border:1px solid #dce4ec;background:white';
  const cleanup=()=>{overlay.remove();if(window.__aliNativePrintClose===cleanup)window.__aliNativePrintClose=null;};window.__aliNativePrintClose=cleanup;close.onclick=cleanup;
  bar.append(print,close,info);overlay.append(bar,frame);document.body.append(overlay);
  const html=`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data: blob:; font-src https: http: data: blob:; style-src 'unsafe-inline';"><title>${esc(report.title)}</title><style>${chunks.map(c=>c.fontCss).join('\n')}\n${css}</style></head><body><main><h1>${esc(report.title)}</h1><p>${report.questions.length} câu · ${esc(report.source)} · In từ tab đã đăng nhập</p><div class="notice" id="ali-native-notice" hidden></div>${chunks.map(c=>`<section class="chunk">${c.html}</section>`).join('\n')}</main></body></html>`;
  try {
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Website không cho mở khung in.')),10000);frame.onload=()=>{clearTimeout(timer);resolve();};frame.srcdoc=html;});
    const doc=frame.contentDocument;if(!doc?.querySelector('main'))throw new Error('Website đã chặn khung in.');
    const deadline=Date.now()+15000,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const images=[...doc.images];
    await Promise.all(images.map(async img=>{while(!img.complete && Date.now()<deadline)await wait(80);if(img.naturalWidth)await Promise.race([img.decode().catch(()=>{}),wait(Math.max(1,deadline-Date.now()))]);}));
    await Promise.race([doc.fonts.ready,wait(Math.max(1,deadline-Date.now()))]);
    const broken=images.filter(img=>!img.complete || !img.naturalWidth);
    for(const img of broken){const p=doc.createElement('p');p.textContent=`[Ảnh chưa hiển thị được${img.alt?`: ${img.alt}`:''}]`;p.style.cssText='border:1px dashed #b66c00;padding:12px;color:#805000';img.replaceWith(p);}
    const notice=doc.getElementById('ali-native-notice');
    if(broken.length || report.domComplete===false || doc.fonts.status!=='loaded') {notice.hidden=false;notice.textContent=`BẢN QUÉT CHƯA HOÀN TẤT · ${report.questions.length}${report.expectedCount?`/${report.expectedCount}`:''} câu. ${broken.length?`${broken.length} ảnh chưa hiển thị được. `:''}${report.domComplete===false?'Lượt quét ban đầu chưa xác nhận đầy đủ nội dung.':''}`;}
    info.textContent=`${report.questions.length} câu · ${images.length-broken.length}/${images.length} ảnh đã hiện. Chọn Lưu dưới dạng PDF trong hộp thoại in.`;
    print.disabled=false;print.onclick=()=>{frame.contentWindow.focus();frame.contentWindow.print();};
    return {images:images.length,brokenImages:broken.length};
  } catch(error){cleanup();throw error;}
}
