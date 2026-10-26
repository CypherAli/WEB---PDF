// Bundled inside one isolated-world closure with the shared DOM functions.
const state = { status:'idle',progress:'Chưa quét',content:null,sidebar:null,contentPath:null,sidebarPath:null,result:null,error:null,cancel:false,selectionRevision:0 };
function currentSelection() {
  if(state.selectionMode!=='exact')return {...selectionSummary(state.content),inputMode:'full'};
  const meta=state.exactMeta;
  if(!meta || meta.viewport.width!==innerWidth || meta.viewport.height!==innerHeight || meta.scrollPositions.some(({el,top,left})=>!el.isConnected || el.scrollTop!==top || el.scrollLeft!==left))throw new Error('Trang đã cuộn hoặc đổi kích thước sau khi kéo. Chọn lại khung để chụp đúng vị trí.');
  return {rect:{...meta.drawnRect},viewport:{...meta.viewport},images:0,loadedImages:0,questions:0,navigationBlocks:0,inputMode:'exact'};
}
async function captureReference(selector) {
  if(!state.referenceEnabled || selector!==state.content || state.cancel)return;
  const root=document.querySelector(selector);
  if(!root)return;
  const visible=visibleBounds(root);if(!visible.width || !visible.height)return;
  const key=JSON.stringify([(window.__aliScroll || []).map(el=>[el.scrollTop,el.scrollLeft,el.scrollHeight]),root?.textContent.slice(0,300),[...root.querySelectorAll('img')].map(el=>[el.currentSrc,el.naturalWidth])]);
  if(state.referenceKeys.has(key))return;
  state.referenceKeys.add(key);
  if(state.referenceImages.length>=60 || state.referenceBytes>20*1024*1024) {
    state.referenceEnabled=false;state.referenceWarnings.push('Ảnh gốc đạt giới hạn lưu (60 khung hoặc 20 MB); phần sau chưa có ảnh đối chiếu.');return;
  }
  try {
    const capture=await chrome.runtime.sendMessage({app:'ali-source',type:'CAPTURE_REFERENCE',captureId:state.captureId});
    if(capture.error)throw new Error(capture.error);
    state.referenceBytes+=capture.image.length;
    const atBottom=(window.__aliScroll || []).every(el=>el.scrollTop+el.clientHeight>=el.scrollHeight-3);
    state.referenceImages.push({image:capture.image,width:capture.width,height:capture.height,cssWidth:capture.selection.rect.width,atBottom,label:`Khung gốc ${state.referenceImages.length+1}${atBottom?' · cuối vùng':''}`,createdAt:new Date().toISOString()});
  } catch(error) {state.referenceEnabled=false;state.referenceWarnings.push('Chưa chụp đủ bản gốc để so sánh: '+error.message);}
}
const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
let imageElements=new Map();
function rememberImages(root) {
  for(const img of [...(root.matches('img')?[root]:[]),...root.querySelectorAll('img')]) {
    const url=img.currentSrc || img.src;if(url && img.complete && img.naturalWidth)imageElements.set(url,img);
  }
}
function currentImageSources(ids) {
  const root=state.content && document.querySelector(state.content);
  const groups=root?questionRoots(root,navigationRoots(root)):[];
  const values=[];
  for(const id of ids) {
    const record=window.__aliImageRegistry?.get(id);if(!record)continue;
    const img=record.el,url=img.currentSrc || img.src;
    if(!img.complete || !img.naturalWidth || !/^(https?:|data:|blob:)/.test(url))continue;
    if(url!==record.url) {
      if(!root?.contains(img))continue;
      const current=groups.find(g=>g.block.contains(img))?.number ?? null;
      if(current!==record.owner)continue;
    }
    values.push({id,url,width:img.getBoundingClientRect().width || img.naturalWidth});
  }
  return values;
}
async function readLoadedImage(url) {
  const root=state.content && document.querySelector(state.content);if(root)rememberImages(root);
  const img=imageElements.get(url);
  if(!img || (img.currentSrc || img.src)!==url || !img.complete || !img.naturalWidth)throw new Error('Ảnh chưa tải hoặc không còn trong phần đã quét.');
  if(img.naturalWidth>16384 || img.naturalHeight>16384 || img.naturalWidth*img.naturalHeight>32000000)throw new Error('Ảnh quá lớn để sao chép từ bộ nhớ; dùng In từ trang gốc.');
  const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
  canvas.getContext('2d').drawImage(img,0,0);
  let blob;
  try {blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));}
  catch {throw new Error('Ảnh khác miền bị chặn đọc pixel; dùng quyền nguồn ảnh hoặc In từ trang gốc.');}
  if(!blob)throw new Error('Không lấy được pixel ảnh đã tải.');
  if(blob.size>40*1024*1024)throw new Error('Ảnh PNG trên 40 MB; dùng In từ trang gốc.');
  const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('Không đọc được ảnh.'));r.readAsDataURL(blob);});
  return {data,width:canvas.width,height:canvas.height};
}
let previewRestore=null,previewToken=null,previewTimer=null;
function restorePreview(token) {
  if(token && token!==previewToken)return;
  previewRestore?.();previewRestore=null;previewToken=null;clearTimeout(previewTimer);
}
async function loadVisiblePreviewImages(root) {
  const images=[...(root.matches('img')?[root]:[]),...root.querySelectorAll('img')].filter(img=>{const r=visibleBounds(img);return r.width>0 && r.height>0;});
  const deadline=Date.now()+2500;
  for(const img of images) {
    img.loading='eager';
    if(!img.getAttribute('src') || /^(data:image\/gif|about:blank)/.test(img.src)) {
      const value=img.dataset.src || img.dataset.original || img.dataset.lazySrc;if(value)img.src=value;
    }
    if(!img.getAttribute('srcset') && img.dataset.srcset)img.srcset=img.dataset.srcset;
  }
  await Promise.all(images.map(async img=>{
    while(!img.complete && Date.now()<deadline)await pause(80);
    if(img.naturalWidth)await Promise.race([img.decode().catch(()=>{}),pause(Math.max(1,deadline-Date.now()))]);
  }));
}
const redactSource = value => { try { const u=new URL(value);return `${u.origin}${u.pathname}`; } catch { return 'embedded'; } };
function selectorPath(el) {
  if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) return `#${CSS.escape(el.id)}`;
  const parts=[];
  for (let node=el; node && node!==document.documentElement; node=node.parentElement) {
    if(node.id && document.querySelectorAll(`#${CSS.escape(node.id)}`).length===1) { parts.unshift(`#${CSS.escape(node.id)}`);break; }
    let part=node.tagName.toLowerCase();
    const siblings=[...node.parentElement.children].filter(n=>n.tagName===node.tagName);
    if(siblings.length>1) part+=`:nth-of-type(${siblings.indexOf(node)+1})`;
    parts.unshift(part);
  }
  return parts.join(' > ');
}
function assertActive() { if(state.cancel) throw new Error('Đã dừng theo yêu cầu.'); }
async function waitHeading(selector,n) {
  const end=Date.now()+15000;
  while(Date.now()<end) {
    assertActive();
    const el=document.querySelector(selector);
    if(el && new RegExp(`Câu\\s*(?:hỏi\\s*)?${n}\\s*[:.]`,'i').test(el.innerText)) return;
    await pause(100);
  }
  throw new Error(`Không thấy câu ${n} sau khi bấm số. Trang có thể chưa tải hoặc cần thao tác thủ công.`);
}
async function scrollContent(selector,excludeNavigation=true,onCheckpoint=()=>{}) {
  const root=document.querySelector(selector);
  if(!root) throw new Error('Vùng đã chọn không còn tồn tại. Chọn lại vùng nội dung.');
  const saved=[];
  for(let el=root;el;el=el.parentElement) saved.push([el,el.scrollTop,el.scrollLeft]);
  for(const el of root.querySelectorAll('*')) if(el.scrollHeight>el.clientHeight+4) saved.push([el,el.scrollTop,el.scrollLeft]);
  try {
    await prepareRoot({selector,excludeNavigation});
    // Bring the column into view before scrolling its inner list. Otherwise a
    // below-fold list can pass its first items before any reference is visible.
    if(state.referenceEnabled && selector===state.content)root.scrollIntoView({block:'start',inline:'nearest',behavior:'instant'});
    onCheckpoint();
    await captureReference(selector);
    let stable=0,last='',lastNumbers=[],virtual=false,finished=false,steps=0;
    for(;steps<600;steps++) {
      assertActive();
      const live=document.querySelector(selector);
      if(!live) throw new Error('Trang đã thay vùng nội dung trong lúc quét. Chọn lại vùng.');
      const text=live.innerText || '';
      const numbers=[...text.matchAll(/Câu\s*(?:hỏi\s*)?(\d+)\s*[:.]/gi)].map(m=>m[1]);
      if(lastNumbers.some(n=>!numbers.includes(n))) virtual=true;
      lastNumbers=numbers;
      const step=scrollStep();
      const signature=JSON.stringify([step.after,live.childElementCount,text]);
      stable=step.bottom && last===signature ? stable+1 : 0;
      last=signature;
      state.progress=`Đang cuộn · lượt ${steps+1} · ${numbers.length} câu trong vùng`;
      await pause(180);
      onCheckpoint();
      await captureReference(selector);
      if(stable>=4) {finished=true;break;}
    }
    state.progress='Đang chờ ảnh và phông chữ...';
    const resources=await inspectResources({selector,timeoutMs:15000,excludeNavigation,checkCancel:true});
    onCheckpoint();
    await captureReference(selector);
    assertActive();
    return {...resources,finished,virtual,steps:steps+1};
  } finally { for(const [el,top,left] of saved) {el.scrollTop=top;el.scrollLeft=left;} }
}
async function collect(options) {
  // The selection preview temporarily hides navigation, including its question
  // counter. Restore it before reading totals or starting the scan.
  restorePreview();
  window.__aliNativePrintClose?.();
  imageElements=new Map();state.captureId=crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  window.__aliImageRegistry=new Map();window.__aliImageIds=new WeakMap();
  state.status='scanning';state.cancel=false;window.__aliScanStopRequested=false;state.error=null;state.result=null;
  state.referenceEnabled=options.compare===true;state.referenceImages=[];state.referenceWarnings=[];state.referenceKeys=new Set();state.referenceBytes=0;
  const report={source:redactSource(location.href),title:document.title,mode:options.mode,createdAt:new Date().toISOString(),warnings:[],questions:[],checks:[],expectedCount:null,status:'scanning'};
  const chunks=[],checkpoints=new Map(),checkpointSignatures=new Map();
  const readable=chunk=>!!(chunk.text.trim() || /<(?:img|svg|canvas)\b/i.test(chunk.html));
  const checkpoint=()=>{
    const root=document.querySelector(state.content);if(!root)return;
    rememberImages(root);
    const groups=questionRoots(root,navigationRoots(root));
    if(groups.length) {
      for(const {number,block} of groups) {
        const rect=visibleBounds(block);if(!rect.width || !rect.height)continue;
        const signature=block.textContent+JSON.stringify([...block.querySelectorAll('img')].map(img=>[img.currentSrc || img.src,img.naturalWidth,img.complete]));
        if(checkpointSignatures.get(number)===signature)continue;
        // Save each reached question as an independent full-width block. Avoid
        // cloning all previous questions on every scroll (quadratic work).
        const value=snapshot({element:block});
        checkpoints.set(number,value);checkpointSignatures.set(number,signature);
      }
    } else {
      const value=snapshot({selector:state.content,visibleOnly:true});
      if(readable(value))checkpoints.set(value.text,value);
    }
    state.checkpointQuestions=[...new Set([...checkpoints.values()].flatMap(c=>c.numbers))];
  };
  state.checkpointQuestions=[];
  try {
    if(!state.content) throw new Error('Chọn vùng nội dung trước khi quét.');
    if(state.selectionMode==='exact')throw new Error('Khung chính xác cần dùng nút Chụp vùng đã kéo trong bảng Ali.');
    const detected=document.body.innerText.match(/Danh sách câu hỏi[\s\S]{0,200}?Tất cả\s*:?\s*(\d+)/i);
    const expected=options.expected || (detected ? Number(detected[1]):null);
    report.expectedCount=expected;
    report.expectedSource=options.expected ? 'user':detected ? 'visible-counter':null;
    if(options.mode==='questions')checkpoint();
    const check=async (selector,excludeNavigation=true)=>{
      const value=await scrollContent(selector,excludeNavigation,selector===state.content?checkpoint:()=>{});
      report.checks.push({...value,brokenImages:value.brokenImages.map(i=>({...i,source:redactSource(i.source)}))});
      if(!value.finished) throw new Error('Chưa xác nhận cuối trang sau 600 lượt cuộn.');
      if(value.virtual) throw new Error('Câu cũ bị gỡ khỏi trang khi cuộn. Hãy chọn chế độ từng câu.');
      // An unavailable image/font must not discard readable text or prevent
      // visiting later questions. Keep the issue and produce an incomplete PDF.
      if(value.brokenImages.length) {report.complete=false;report.warnings.push(`${value.brokenImages.length} ảnh chưa tải được trong vùng đã kiểm tra.`);}
      if(!value.fontsReady) {report.complete=false;report.warnings.push('Phông chữ chưa tải xong; bản in có thể dùng phông thay thế.');}
    };
    if(options.mode==='questions') {
      if(!state.sidebar) throw new Error('Chọn thanh số câu để dùng chế độ từng câu.');
      await check(state.sidebar,false);
      const numbers=numberButtons({selector:state.sidebar});
      if(!numbers.length) throw new Error('Không thấy nhóm nút số câu trong vùng thanh số.');
      if(expected && (numbers.length!==expected || numbers.some((n,i)=>n!==i+1))) {report.complete=false;report.warnings.push(`Thanh số chỉ chứa ${numbers.length}/${expected} câu. Quét các nút hiện có; danh sách chưa đầy đủ.`);}
      const initial=snapshot({selector:state.content}).numbers;
      try {
        for(const n of numbers) {
          assertActive();state.progress=`Đang lấy câu ${n} / ${numbers.at(-1)}`;
          const button=document.querySelector(`${state.sidebar} [data-ali-number="${n}"]`);
          if(!button) throw new Error(`Nút số ${n} đã biến mất. Trang dùng danh sách ảo, chưa hỗ trợ quét tự động kiểu này.`);
          button.scrollIntoView({block:'nearest'});button.click();
          await waitHeading(state.content,n);
          await check(state.content);
          const chunk=snapshot({selector:state.content});
          if(chunk.numbers.length!==1 || chunk.numbers[0]!==n) throw new Error('Vùng nội dung chứa nhiều câu: hãy dùng chế độ trang dài hoặc chọn riêng khung một câu.');
          chunks.push(chunk);
        }
      } finally {
        if(initial.length===1) document.querySelector(`${state.sidebar} [data-ali-number="${initial[0]}"]`)?.click();
      }
    } else {
      await check(state.content);
      chunks.push(snapshot({selector:state.content}));
    }
    assertActive();
    report.questions=[...new Set(chunks.flatMap(c=>c.numbers))].sort((a,b)=>a-b);
    if(expected && (report.questions.length!==expected || report.questions.some((n,i)=>n!==i+1))) throw new Error(`Thấy ${report.questions.length}/${expected} câu; bản quét chưa đầy đủ.`);
    if(report.questions.length && !expected) report.warnings.push('Chưa biết tổng số câu để đối chiếu độ đầy đủ.');
    report.warnings.push(...new Set(chunks.flatMap(c=>c.warnings)));
    if(report.warnings.some(w=>/iframe|không đọc được do/.test(w))) throw new Error(report.warnings.join(' '));
    if(!chunks.some(readable)) throw new Error('Vùng được chọn không có nội dung đọc được.');
    report.complete=report.complete!==false;report.domComplete=report.complete;
    report.status=report.complete?'captured':'partial-error';
    if(!report.complete) {report.partialReason='errors';report.error=report.warnings.join(' ');report.warnings.push('BẢN QUÉT CHƯA HOÀN TẤT: có lỗi, vẫn giữ nội dung đọc được để lưu PDF.');}
    report.warnings=[...new Set(report.warnings)];
    state.result={chunks,report,referenceImages:state.referenceImages};state.status=report.complete?'ready':'partial';state.progress=`Đã giữ ${report.questions.length} câu${report.complete?'':' · có lỗi tải tài nguyên'} · sẵn sàng tạo bản in`;
  } catch(error) {
    // Prefer a finished document snapshot when count/iframe validation failed.
    // Otherwise retain checkpoints, including earlier virtualized questions.
    const retained=(options.mode==='document' && chunks.length?chunks:[...checkpoints.values()]).filter(readable).sort((a,b)=>(a.numbers[0] || 0)-(b.numbers[0] || 0));
    report.status=retained.length?state.cancel?'stopped-partial':'partial-error':state.cancel?'cancelled':'failed';report.error=error.message;report.complete=false;report.domComplete=false;report.partialReason=state.cancel?'stopped':'errors';
    if(retained.length) {
      report.questions=[...new Set(retained.flatMap(c=>c.numbers))].sort((a,b)=>a-b);
      report.warnings=[...new Set([...report.warnings,...retained.flatMap(c=>c.warnings),error.message,state.cancel?'BẢN QUÉT CHƯA HOÀN TẤT: đã dừng theo yêu cầu, chỉ giữ nội dung đã đi qua.':'BẢN QUÉT CHƯA HOÀN TẤT: có lỗi, vẫn giữ nội dung đọc được để lưu PDF.'])];
      state.result={chunks:retained,report,referenceImages:state.referenceImages};state.status='partial';state.error=null;
      state.progress=`${state.cancel?'Đã dừng':'Có lỗi'} · giữ ${report.questions.length}${report.expectedCount?`/${report.expectedCount}`:''} câu · đang chuẩn bị bản PDF dở`;
    } else {
      state.result={chunks:[],report};state.status=report.status;state.error=error.message;state.progress=error.message;
    }
  } finally {report.referenceRequested=options.compare===true;report.referenceFrames=state.referenceImages.length;report.referenceWarnings=[...state.referenceWarnings];}
}
async function fetchResource(url) {
  if(!/^(https?:|blob:|data:)/.test(url)) throw new Error('Không hỗ trợ loại URL này.');
  const response=await fetch(url,{credentials:'include',cache:'force-cache',signal:AbortSignal.timeout(15000)});
  if(!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob=await response.blob();
  if(!/^(image\/|font\/)|font|octet-stream/i.test(blob.type)) throw new Error(`Không phải ảnh/font: ${blob.type}`);
  if(blob.size>40*1024*1024) throw new Error('Tài nguyên trên 40 MB, cần xuất riêng.');
  const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Không đọc được tài nguyên.'));reader.readAsDataURL(blob);});
  return data;
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id || message.app!=='ali-pdf') return;
  if(message.type==='STATE') {respond({pageUrl:location.href,captureId:state.captureId,status:state.status,progress:state.progress,content:state.content,sidebar:state.sidebar,contentPath:state.contentPath,sidebarPath:state.sidebarPath,error:state.error,selectionMode:state.selectionMode || 'full',selectionRevision:state.selectionRevision,checkpointQuestions:state.checkpointQuestions || []});return;}
  if(message.type==='SELECTION') {
    if(!state.content || state.status==='picking') {respond({error:'Chọn và xác nhận vùng nội dung trước.'});return;}
    try {respond({...currentSelection(),revision:state.selectionRevision});}catch(error){respond({error:error.message});}
    return;
  }
  if(message.type==='PREVIEW_BEGIN') {
    if(!state.content || state.status==='picking' || (state.status==='scanning' && (!message.duringScan || message.captureId!==state.captureId))) {respond({error:'Chọn xong vùng và giữ trang mở trước khi cập nhật ảnh.'});return;}
    if(message.revision!==state.selectionRevision) {respond({error:'Vùng chọn đã thay đổi. Hãy chụp lại.'});return;}
    restorePreview();
    const root=document.querySelector(state.content);
    if(!root) {respond({error:'Vùng đã chọn không còn tồn tại.'});return;}
    const rootRect=visibleBounds(root);
    const floating=[...document.body.querySelectorAll('*')].filter(el=>{
      if(el===root || root.contains(el) || el.contains(root) || el.closest('[data-ali-ui]'))return false;
      if(!['fixed','sticky'].includes(getComputedStyle(el).position))return false;
      const r=visibleBounds(el);return r.width>0 && r.height>0 && r.left<rootRect.left+rootRect.width && r.left+r.width>rootRect.left && r.top<rootRect.top+rootRect.height && r.top+r.height>rootRect.top;
    });
    const hidden=state.selectionMode==='exact'?[]:[...new Set([...navigationRoots(document.body),...floating])].filter(el=>el!==root && !el.contains(root));
    const saved=hidden.map(el=>({el,value:el.style.getPropertyValue('visibility'),priority:el.style.getPropertyPriority('visibility')}));
    for(const {el} of saved)el.style.setProperty('visibility','hidden','important');
    previewRestore=()=>{for(const {el,value,priority} of saved){if(value)el.style.setProperty('visibility',value,priority);else el.style.removeProperty('visibility');}};
    previewToken=crypto.randomUUID();const token=previewToken;
    // Restore even if the worker closes/restarts or capture fails.
    previewTimer=setTimeout(()=>restorePreview(token),6000);
    (state.selectionMode==='exact'?Promise.resolve():loadVisiblePreviewImages(root)).then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))).then(()=>respond({token,navigationHidden:hidden.length,selection:{...currentSelection(),revision:state.selectionRevision}})).catch(error=>{restorePreview(token);respond({error:error.message});});
    return true;
  }
  if(message.type==='PREVIEW_END') {restorePreview(message.token);respond({ok:true});return;}
  if(message.type==='RESULT') {respond(state.result);return;}
  if(message.type==='CONFIGURE') {
    if(state.status==='scanning') {respond({error:'Đang quét.'});return;}
    if(message.contentPath && document.querySelector(message.contentPath)) {state.content=message.contentPath;state.contentPath=message.contentPath;state.selectionMode='full';state.exactMeta=null;state.selectionRevision++;}
    if(message.sidebarPath && document.querySelector(message.sidebarPath)) {state.sidebar=message.sidebarPath;state.sidebarPath=message.sidebarPath;}
    respond({ok:true,pageUrl:location.href,content:state.content,sidebar:state.sidebar});return;
  }
  if(message.type==='PICK') {
    if(state.status==='scanning') {respond({error:'Dừng quét trước khi chọn vùng khác.'});return;}
    if(state.status==='picking') {respond({error:'Hoàn tất hoặc hủy vùng đang chọn trên trang trước.'});return;}
    state.status='picking';state.result=null;state.progress='Chọn vùng trên trang rồi bấm “Dùng vùng này”.';
    const picker=message.method==='drag' ? installDragPicker:installPicker;
    picker({message:message.kind==='sidebar'?'Chọn cả vùng chứa các nút số câu':message.exact?'Copy đúng khung kéo':'Chọn cả cột nội dung bài học',token:message.kind,exact:message.exact===true});
    const timer=setInterval(()=>{
      if(!window.__aliPicked) return;
      clearInterval(timer);
      if(window.__aliPicked!=='__cancelled__') {
        state[message.kind]=window.__aliPicked;
        state[`${message.kind}Path`]=selectorPath(document.querySelector(window.__aliPicked));
        if(message.kind==='content'){state.selectionMode=window.__aliPickedMeta?.mode==='exact'?'exact':'full';state.exactMeta=state.selectionMode==='exact'?window.__aliPickedMeta:null;state.selectionRevision++;}
      }
      state.status='idle';state.progress='Đã chọn vùng. Bấm Quét bài này.';
    },200);
    respond({ok:true});return;
  }
  if(message.type==='SCAN') {
    if(state.status==='scanning' || state.status==='picking') {respond({error:'Đang quét hoặc chọn vùng.'});return;}
    void collect(message.options || {mode:'document'});respond({ok:true});return;
  }
  if(message.type==='CANCEL') {state.cancel=true;window.__aliScanStopRequested=true;globalThis.__aliPickerCancel?.();respond({ok:true});return;}
  if(message.type==='RESOURCE') {fetchResource(message.url).then(data=>respond({data})).catch(error=>respond({error:error.message}));return true;}
  if(message.type==='LOADED_IMAGE') {readLoadedImage(message.url).then(respond).catch(error=>respond({error:error.message}));return true;}
  if(message.type==='IMAGE_SOURCES') {respond({images:currentImageSources(message.ids || [])});return;}
  if(message.type==='NATIVE_PRINT') {
    if(!state.result?.chunks.length || state.captureId!==message.captureId || location.href!==message.pageUrl || ['scanning','picking'].includes(state.status)) {respond({error:'Tab nguồn đã đổi hoặc đã quét bài khác. Mở bài đúng rồi quét lại để in đủ ảnh.'});return;}
    restorePreview();
    let live=state.result.chunks.map(c=>({...c}));
    // A completed long-page scan can refresh late-mounted image nodes too.
    // Never replace checkpoints of a stopped/virtualized document with only
    // whatever happens to remain in the DOM now.
    if(state.result.report.mode==='document' && state.result.report.checks.some(c=>c.finished) && !state.result.report.checks.some(c=>c.virtual)) {
      try {
        const fresh=snapshot({selector:state.content});
        if(fresh.numbers.length===state.result.report.questions.length && fresh.numbers.every(n=>state.result.report.questions.includes(n)))live=[fresh];
      }catch{}
    }
    const replace=(html)=>{
      const box=document.createElement('div');box.innerHTML=html;
      const imgs=[...box.querySelectorAll('img[data-ali-image-id]')],sources=currentImageSources(imgs.map(i=>i.dataset.aliImageId));
      for(const img of imgs){const s=sources.find(s=>s.id===img.dataset.aliImageId);if(s){img.src=s.url;img.style.width=`${s.width}px`;}}
      return box.innerHTML;
    };
    for(const c of live)c.html=replace(c.html);
    prepareNativePrint({chunks:live,report:state.result.report}).then(respond).catch(error=>respond({error:error.message}));return true;
  }
  if(message.type==='LINKS') {
    const current=new URL(location.href),seen=new Set(),links=[];
    for(const a of document.querySelectorAll('a[href]')) {
      const u=new URL(a.href,location.href);
      if(u.origin!==current.origin || !/^\/video\/\d+\/?$/.test(u.pathname)) continue;
      const key=`${u.origin}${u.pathname}?lesson-id=${u.searchParams.get('lesson-id') || ''}`;
      if(seen.has(key)) continue;seen.add(key);links.push({url:u.href,title:a.innerText.trim().slice(0,160) || `Bài ${links.length+1}`});
    }
    respond(links);return;
  }
});
