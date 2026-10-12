// These functions run in the page. They must not refer to Node globals.
export function navigationRoots(root) {
  const excluded = new Set();
  const hasQuestion = el => /Câu\s*(?:hỏi\s*)?\d+\s*[:.]/i.test(el.innerText || '');
  const candidates = root.querySelectorAll('nav,aside,[role="navigation"],[role="menubar"],div,section,header,button,h1,h2,h3,h4,span');
  for (const el of candidates) {
    if (el.closest('[data-ali-ui]')) { excluded.add(el);continue; }
    const identity = `${el.id} ${el.className?.baseVal ?? el.className ?? ''}`;
    const text = (el.innerText || '').trim();
    const semantic = el.matches('nav,[role="navigation"],[role="menubar"]');
    const named = /(?:^|[\s_-])(?:sidebar|sidenav|course-outline|course-menu|table-of-contents)(?:$|[\s_-])/i.test(identity);
    // React/Vue headings often contain nested spans/icons, not a text leaf.
    const label = /^(?:Nội dung khóa học|Danh sách câu hỏi)\s*$/i.test(text) || /^Ruler mode\b/i.test(text) && text.length<80;
    const numericLeaves=[...el.querySelectorAll('button,a,span,div')].filter(n=>!n.children.length && /^\d+$/.test(n.textContent.trim()));
    const numericGrid=numericLeaves.length>=8 && new Set(numericLeaves.map(n=>n.textContent.trim())).size>=8 && text.replace(/\d+|\s+/g,'').length===0;
    const lessonMenu = el.tagName === 'ASIDE' && el.querySelectorAll('a[href*="/video/"]').length >= 2;
    if ((semantic || named || lessonMenu || numericGrid) && !hasQuestion(el)) {excluded.add(el);continue;}
    if (label) {
      let block = el;
      for (let parent=el.parentElement;parent && parent!==root;parent=parent.parentElement) {
        if (hasQuestion(parent)) break;
        block=parent;
      }
      excluded.add(block);
    }
    if (el.tagName==='BUTTON' && /^(?:Bài trước|Bài sau|Previous|Next)$/i.test(text)) excluded.add(el);
  }
  // Count/prune only the outermost excluded blocks.
  return new Set([...excluded].filter(el=>![...excluded].some(other=>other!==el && other.contains(el))));
}
export async function prepareRoot({ selector,excludeNavigation=false }) {
  const root = document.querySelector(selector);
  if (!root) throw new Error(`Không tìm thấy vùng nội dung: ${selector}`);
  const excluded=excludeNavigation ? navigationRoots(root):new Set();
  const included=el=>![...excluded].some(block=>block.contains(el));
  for (const img of [ ...(root.matches('img')?[root]:[]),...root.querySelectorAll('img') ].filter(included)) {
    img.loading = 'eager';
    if (!img.getAttribute('src') || /^(data:image\/gif|about:blank)/.test(img.src)) {
      const src = img.dataset.src || img.dataset.original || img.dataset.lazySrc;
      if (src) img.src = src;
    }
    if (!img.getAttribute('srcset') && img.dataset.srcset) img.srcset = img.dataset.srcset;
  }
  const elements = [root, ...root.querySelectorAll('*')].filter(included);
  for (const el of elements) {
    if (el instanceof HTMLElement && getComputedStyle(el).contentVisibility === 'auto') el.style.contentVisibility = 'visible';
  }
  // Include every scrollable ancestor plus scroll areas inside the chosen content.
  const scrollables = new Set([document.scrollingElement]);
  for (let el = root; el; el = el.parentElement) {
    // overflow:visible can have scrollHeight > clientHeight while scrollTop is
    // permanently zero. It is not a scroller and must not block completion.
    if (el.scrollHeight > el.clientHeight + 4 && /auto|scroll|hidden/.test(getComputedStyle(el).overflowY)) scrollables.add(el);
  }
  for (const el of elements) {
    if (el.clientHeight > 40 && el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(el).overflowY)) scrollables.add(el);
  }
  window.__aliScroll = [...scrollables].filter(Boolean);
  window.__aliScroll.forEach(el => { el.scrollTop = 0; });
  return { scrollers: window.__aliScroll.length };
}

export function scrollStep() {
  const before = window.__aliScroll.map(el => `${el.scrollTop}:${el.scrollHeight}`);
  for (const el of window.__aliScroll) el.scrollTop += Math.max(100, el.clientHeight * 0.75);
  return { before, after: window.__aliScroll.map(el => `${el.scrollTop}:${el.scrollHeight}`), bottom: window.__aliScroll.every(el => el.scrollTop + el.clientHeight >= el.scrollHeight - 3) };
}

export async function inspectResources({ selector, timeoutMs,excludeNavigation=false,checkCancel=false }) {
  const root = document.querySelector(selector);
  if (!root) throw new Error('Vùng nội dung đã bị trang thay thế; hãy chọn lại.');
  const deadline = Date.now() + timeoutMs;
  const excluded=excludeNavigation ? navigationRoots(root):new Set();
  const images = [ ...(root.matches('img')?[root]:[]),...root.querySelectorAll('img') ].filter(el=>![...excluded].some(block=>block.contains(el)));
  await Promise.all(images.map(async img => {
    while (!img.complete && Date.now() < deadline && !(checkCancel && window.__aliScanStopRequested)) await new Promise(resolve => setTimeout(resolve, 100));
    if (img.complete && img.naturalWidth) await Promise.race([img.decode().catch(() => {}), new Promise(resolve => setTimeout(resolve, Math.max(1, deadline - Date.now())))]);
  }));
  while(document.fonts.status!=='loaded' && Date.now()<deadline && !(checkCancel && window.__aliScanStopRequested))await new Promise(resolve=>setTimeout(resolve,100));
  return { images: images.length, brokenImages: images.filter(img => !img.complete || !img.naturalWidth).map(img => ({ source: img.currentSrc || img.src, alt: img.alt })), fontsReady: document.fonts.status === 'loaded' };
}

export function questionRoots(root,excluded=new Set()) {
  const prefix=/^Câu\s*(?:hỏi\s*)?(\d+)\s*[:.]/i;
  const candidates=[root,...root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,div,span,section,article')];
  const headings=candidates.filter(el=>prefix.test(el.textContent.trim()) && ![...el.children].some(child=>prefix.test(child.textContent.trim())) && ![...excluded].some(nav=>nav.contains(el)) && getComputedStyle(el).display!=='none');
  return headings.map(heading=>{
    let block=heading;
    for(let parent=heading.parentElement;parent && root.contains(parent);parent=parent.parentElement) {
      const ids=new Set(headings.filter(h=>parent.contains(h)).map(h=>Number(h.textContent.trim().match(prefix)[1])));
      if(ids.size!==1 || [...excluded].some(nav=>parent.contains(nav)))break;
      block=parent;
      if(parent===root)break;
    }
    return {heading,block,number:Number(heading.textContent.trim().match(prefix)[1])};
  });
}

export function snapshot({ selector,element=null,excludeNavigation=true,questionNumbers=null,visibleOnly=false }) {
  const root = element || document.querySelector(selector);
  if (!root) throw new Error('Vùng nội dung không tồn tại.');
  const resources = new Set();
  const warnings = [];
  const excluded=excludeNavigation ? navigationRoots(root):new Set();
  const groups=questionRoots(root,excluded);
  const selectedNumbers=questionNumbers===null ? null:new Set(questionNumbers);
  const omitted=new Set(groups.filter(g=>selectedNumbers && !selectedNumbers.has(g.number)).map(g=>g.block));
  const questionBlocks = new Set(groups.map(g=>g.block));
  // Keep a short question with its options/explanation together. Oversized blocks
  // remain splittable; making an entire long lesson unbreakable wastes pages.
  const properties = ['display','font-family','font-size','font-weight','font-style','line-height','color','background-color','text-align','text-decoration','white-space','vertical-align','border-top','border-right','border-bottom','border-left','border-radius','padding-top','padding-right','padding-bottom','padding-left','margin-top','margin-right','margin-bottom','margin-left','list-style-type','border-collapse','border-spacing','flex-direction','flex-wrap','align-items','justify-content','gap','grid-template-columns','grid-template-rows','object-fit','object-position'];
  function clone(el, outer = false) {
    if (el.nodeType === Node.TEXT_NODE) return document.createTextNode(el.textContent);
    if (!(el instanceof Element)) return null;
    if (excluded.has(el) || omitted.has(el)) return null;
    if(visibleOnly && !groups.length && !outer && !visibleBounds(el).height)return null;
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|LINK|META)$/.test(el.tagName) || el.closest('[data-ali-ui]')) return null;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    if (el.tagName === 'IFRAME') { warnings.push('Có iframe: chọn trực tiếp nội dung trong frame bằng --frame, không tự bỏ qua.'); return null; }
    if (/^(VIDEO|AUDIO)$/.test(el.tagName)) { warnings.push('Video/audio không được đưa vào PDF.'); return null; }
    if (el.tagName === 'CANVAS') {
      warnings.push('Canvas giữ dạng ảnh, chữ trong canvas không có lớp văn bản.');
      try { const img = document.createElement('img'); img.src = el.toDataURL(); return img; }
      catch { warnings.push('Canvas không đọc được do tài nguyên khác miền.'); return null; }
    }
    const result = el.cloneNode(false);
    for (const a of [...result.attributes]) if (/^on/i.test(a.name) || ['id','class','style','srcset','sizes','loading','data-ali-root','contenteditable','tabindex'].includes(a.name)) result.removeAttribute(a.name);
    for (const p of properties) result.style.setProperty(p, cs.getPropertyValue(p));
    result.style.setProperty('position', 'static');
    result.style.setProperty('overflow', 'visible');
    result.style.setProperty('height', 'auto');
    result.style.setProperty('max-height', 'none');
    result.style.setProperty('min-height', '0');
    result.style.setProperty('min-width', '0');
    result.style.setProperty('max-width', '100%');
    result.style.setProperty('box-sizing', 'border-box');
    const containsQuestion = groups.some(g=>el.contains(g.heading));
    if (containsQuestion && /flex|grid/.test(cs.display)) {
      result.style.display='block';result.style.gridTemplateColumns='none';
    } else if (cs.display.includes('grid')) {
      // Computed grid tracks are screen pixels. Convert them to proportional
      // tracks for A4; fixed-height grid rows would overlap wrapped text.
      const tracks=cs.gridTemplateColumns.trim().split(/\s+/);
      if(tracks.length && tracks.every(t=>/^\d+(?:\.\d+)?px$/.test(t))) result.style.gridTemplateColumns=tracks.map(t=>`minmax(0,${parseFloat(t)}fr)`).join(' ');
      result.style.gridTemplateRows='none';result.style.gridAutoRows='auto';
    }
    if(containsQuestion && /^(DIV|SECTION|ARTICLE|MAIN)$/.test(el.tagName)) {
      // Application columns are viewport geometry. Reset EVERY ancestor of
      // question text; nested padding/margins otherwise accumulate on A4.
      result.style.width='100%';result.style.flex='none';
      result.style.marginLeft='0';result.style.marginRight='0';
      result.style.padding='0';
      result.style.whiteSpace='normal';
    }
    // Option badges must not shrink to a narrow sliver inside flex answer rows.
    if (/flex/.test(el.parentElement ? getComputedStyle(el.parentElement).display : '') && /^[A-F]$/.test(el.textContent.trim())) {
      const rect=el.getBoundingClientRect();result.style.flex='0 0 auto';
      if(rect.width>0 && rect.width<100) {result.style.width=`${rect.width}px`;result.style.minWidth=`${rect.width}px`;}
      if(rect.height>0 && rect.height<100) result.style.height=`${rect.height}px`;
    }
    if (questionBlocks.has(el)) {
      result.setAttribute('data-ali-block', 'question');
      result.style.display='block';result.style.width='100%';result.style.marginBottom='20px';
      result.style.paddingTop='12px';result.style.paddingBottom='12px';
      if(el.getBoundingClientRect().height>950){result.style.breakInside='auto';result.style.pageBreakInside='auto';}
    }
    if (outer) { result.style.display = 'block'; result.style.width = '100%'; result.style.margin = '0'; }
    if (cs.backgroundImage !== 'none') {
      result.style.backgroundImage = cs.backgroundImage;
      result.style.backgroundSize = cs.backgroundSize;
      result.style.backgroundPosition = cs.backgroundPosition;
      if (!el.textContent.trim()) result.style.minHeight = `${el.getBoundingClientRect().height}px`;
      for (const match of cs.backgroundImage.matchAll(/url\(["']?(.*?)["']?\)/g)) resources.add(match[1]);
    }
    if (el.tagName === 'IMG') {
      result.src = el.currentSrc || el.src;
      // Keep a link to this source image for late lazy-load URL replacements.
      // Separate IDs per question protect against virtualized node reuse.
      const registry=window.__aliImageRegistry ||= new Map(),ids=window.__aliImageIds ||= new WeakMap();
      const owner=groups.find(g=>g.block.contains(el))?.number ?? null;
      let keys=ids.get(el);if(!keys){keys=new Map();ids.set(el,keys);}
      const key=owner ?? 'document';let id=keys.get(key);
      if(!id){window.__aliImageSerial=(window.__aliImageSerial || 0)+1;id=`ali-image-${window.__aliImageSerial}`;keys.set(key,id);}
      registry.set(id,{el,owner,url:result.src});result.setAttribute('data-ali-image-id',id);
      for(const attr of ['data-src','data-original','data-lazy-src','data-srcset'])result.removeAttribute(attr);
      resources.add(result.src);
      result.style.width = `${el.getBoundingClientRect().width || el.naturalWidth}px`;
      result.style.height = 'auto';
      result.style.maxHeight = '245mm';
      result.style.objectFit = 'contain';
      if (!el.naturalWidth) warnings.push('Có ảnh chưa tải được.');
    }
    if (el.tagName === 'A') result.href = el.href;
    if (el.tagName === 'INPUT') result.setAttribute('value', el.value);
    if (el.tagName.toLowerCase() === 'use' && ((el.getAttribute('href') || el.getAttribute('xlink:href') || '').startsWith('#'))) warnings.push('SVG sprite cần kiểm tra trực quan.');
    // Keep generated labels (option letters, bullets). Icon-font labels require visual review.
    const pseudo = which => {
      const s = getComputedStyle(el, which);
      if (!s.content || ['none','normal','""','\'\''].includes(s.content)) return null;
      if (!/^(["']).*\1$/.test(s.content)) { warnings.push('Có nội dung CSS pseudo không chuyển được tự động.'); return null; }
      const span = document.createElement('span');
      span.textContent = s.content.slice(1, -1).replace(/\\([0-9a-f]{1,6})\s?/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
      for (const p of properties) span.style.setProperty(p, s.getPropertyValue(p));
      return span;
    };
    const before = pseudo('::before'); if (before) result.append(before);
    for (const child of el.childNodes) { const c = clone(child); if (c) result.append(c); }
    const after = pseudo('::after'); if (after) result.append(after);
    return result;
  }
  const copied = clone(root, true);
  // Use the sanitized clone's text, so menu labels and controls do not enter
  // completeness checks. It stays detached and never runs website scripts.
  const text = copied?.textContent || '';
  const numbers = [...text.matchAll(/Câu\s*(?:hỏi\s*)?(\d+)\s*[:.]/gi)].map(m => Number(m[1]));
  const fonts = [];
  for (const sheet of document.styleSheets) {
    try { for (const rule of sheet.cssRules) if (rule.type === CSSRule.FONT_FACE_RULE) fonts.push(rule.cssText.replace(/url\((["']?)(.*?)\1\)/g, (_, quote, url) => { const absolute = new URL(url, sheet.href || document.baseURI).href; resources.add(absolute); return `url("${absolute}")`; })); }
    catch { warnings.push('Stylesheet khác miền: không đọc được khai báo font; PDF cần kiểm tra font.'); }
  }
  return { html: copied?.outerHTML || '', text, numbers: [...new Set(numbers)], resources: [...resources], fontCss: fonts.join('\n'), warnings: [...new Set(warnings)],navigationRemoved:excluded.size };
}

export function installPicker({ message, token = 'content' }) {
  window.__aliPickerCancel?.();
  const panel = document.createElement('div');
  panel.dataset.aliUi = 'true';
  panel.style.cssText = 'position:fixed;right:18px;top:18px;z-index:2147483647;background:#fff;color:#142539;font:15px Arial;padding:18px;width:350px;box-shadow:0 4px 30px #0005;border:2px solid #145cff;border-radius:12px;';
  const title = document.createElement('b'); title.textContent = message;
  const help = document.createElement('p'); help.textContent = 'Bấm vào nội dung cần lấy. Dùng “Mở rộng” để chọn cả cột nội dung; tránh chọn thanh điều hướng hoặc cả trang.';
  const info = document.createElement('p');
  let selected, previousOutline, previousOffset;
  const history = [];
  window.__aliPicked = null;
  window.__aliPickedMeta = {mode:'element'};
  const paint = el => {
    if (selected) { selected.style.outline = previousOutline; selected.style.outlineOffset = previousOffset; }
    selected = el; previousOutline = el.style.outline; previousOffset = el.style.outlineOffset;
    el.style.outline = '3px solid #ff8500'; el.style.outlineOffset = '-3px';
    info.textContent = `${el.tagName.toLowerCase()} · ${el.querySelectorAll('img').length} ảnh · ${(el.innerText || '').length} ký tự`;
  };
  const listener = event => {
    if (panel.contains(event.target)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    history.length = 0; paint(event.target);
  };
  document.addEventListener('click', listener, true);
  const cleanup = () => {
    if (selected) { selected.style.outline = previousOutline; selected.style.outlineOffset = previousOffset; }
    document.removeEventListener('click', listener, true); panel.remove(); window.__aliPickerCancel = null;
  };
  window.__aliPickerCancel = () => { cleanup(); window.__aliPicked = '__cancelled__'; };
  const button = (label, action) => { const b = document.createElement('button'); b.textContent = label; b.style.cssText = 'padding:9px;margin:3px;cursor:pointer'; b.onclick = action; panel.append(b); };
  panel.append(title, help, info);
  button('Mở rộng ↑', () => { if (selected?.parentElement && selected !== document.body) { history.push(selected); paint(selected.parentElement); } });
  button('Thu hẹp ↓', () => { if (history.length) paint(history.pop()); });
  button('Dùng vùng này', () => {
    if (!selected) return;
    selected.style.outline = previousOutline; selected.style.outlineOffset = previousOffset;
    document.querySelectorAll(`[data-ali-picked-id="${token}"]`).forEach(el => el.removeAttribute('data-ali-picked-id'));
    selected.setAttribute('data-ali-picked-id', token);
    window.__aliPicked = `[data-ali-picked-id="${token}"]`;
    cleanup();
  });
  button('Hủy chọn', () => window.__aliPickerCancel?.());
  document.body.append(panel);
}

export function visibleBounds(el) {
  const r=el.getBoundingClientRect();
  let left=Math.max(0,r.left),top=Math.max(0,r.top),right=Math.min(innerWidth,r.right),bottom=Math.min(innerHeight,r.bottom);
  for(let parent=el.parentElement;parent;parent=parent.parentElement) {
    const style=getComputedStyle(parent),p=parent.getBoundingClientRect();
    if(/hidden|clip|auto|scroll/.test(style.overflowX)) {left=Math.max(left,p.left);right=Math.min(right,p.right);}
    if(/hidden|clip|auto|scroll/.test(style.overflowY)) {top=Math.max(top,p.top);bottom=Math.min(bottom,p.bottom);}
  }
  return {left,top,width:Math.max(0,right-left),height:Math.max(0,bottom-top)};
}

export function selectionSummary(selector) {
  const el=document.querySelector(selector);
  if(!el) throw new Error('Vùng đã chọn không còn tồn tại. Hãy chọn lại.');
  const excluded=navigationRoots(el),text=el.innerText || '';
  const images=[...(el.matches('img')?[el]:[]),...el.querySelectorAll('img')].filter(img=>![...excluded].some(nav=>nav.contains(img)));
  return {rect:visibleBounds(el),viewport:{width:innerWidth,height:innerHeight},images:images.length,loadedImages:images.filter(img=>img.complete && img.naturalWidth).length,questions:new Set([...text.matchAll(/Câu\s*(?:hỏi\s*)?(\d+)\s*[:.]/gi)].map(m=>m[1])).size,navigationBlocks:excluded.size};
}

export function matchDragRegion(rect) {
  const excluded=navigationRoots(document.body),candidates=new Set();
  const blocked=el=>el.closest('[data-ali-ui]') || [...excluded].some(nav=>nav.contains(el));
  for(const dx of [.08,.35,.65,.92]) for(const dy of [.08,.35,.65,.92]) {
    const x=rect.left+rect.width*dx,y=rect.top+rect.height*dy;
    const seed=document.elementsFromPoint(x,y).find(el=>!blocked(el));
    for(let el=seed;el && el!==document.documentElement;el=el.parentElement) if(!blocked(el)) candidates.add(el);
  }
  const area=rect.width*rect.height;
  let best=null,bestScore=-Infinity;
  for(const el of candidates) {
    if(!el.textContent.trim() && !el.matches('img,canvas,svg') && !el.querySelector('img,canvas,svg')) continue;
    const b=visibleBounds(el);if(b.width<8 || b.height<8) continue;
    const overlap=Math.max(0,Math.min(b.left+b.width,rect.left+rect.width)-Math.max(b.left,rect.left))*Math.max(0,Math.min(b.top+b.height,rect.top+rect.height)-Math.max(b.top,rect.top));
    const coverage=overlap/area,iou=overlap/Math.max(1,b.width*b.height+area-overlap);
    const widthFit=Math.min(b.width,rect.width)/Math.max(b.width,rect.width);
    const navCount=[...excluded].filter(nav=>el.contains(nav)).length;
    const question=/Câu\s*(?:hỏi\s*)?\d+\s*[:.]/i.test(el.innerText || '');
    const score=coverage*3+iou*2+widthFit*3+(question ? .6 : 0)-navCount*1.6;
    if(score>bestScore) {best=el;bestScore=score;}
  }
  if(!best || bestScore<2) throw new Error('Không tìm được khối nội dung trong vùng kéo. Kéo quanh cột chứa chữ và ảnh.');
  // Promote a small question/answer rectangle to its column while the horizontal
  // bounds remain the same. Stop before columns containing navigation menus.
  const initial=best.getBoundingClientRect();
  for(let parent=best.parentElement;parent && parent!==document.body;parent=parent.parentElement) {
    const p=parent.getBoundingClientRect();
    if(p.width>initial.width*1.25 || p.width<initial.width*.8 || [...excluded].some(nav=>parent.contains(nav))) break;
    if(/Câu\s*(?:hỏi\s*)?\d+\s*[:.]/i.test(parent.innerText || '')) best=parent;
  }
  return best;
}

export function installDragPicker({message='Kéo quanh cột nội dung cần quét',token='content'}) {
  window.__aliPickerCancel?.();window.__aliPicked=null;window.__aliPickedMeta={mode:'drag'};
  const create=(css)=>{const el=document.createElement('div');el.dataset.aliUi='true';el.style.cssText=css;document.body.append(el);return el;};
  const overlay=create('position:fixed;inset:0;z-index:2147483645;cursor:crosshair;touch-action:none;background:rgba(20,40,70,.025);');
  const drawn=create('position:fixed;display:none;pointer-events:none;z-index:2147483646;border:2px dashed #1c62d8;background:rgba(28,98,216,.10);');
  const matched=create('position:fixed;display:none;pointer-events:none;z-index:2147483646;border:3px solid #f28b18;');
  const panel=create('position:fixed;left:16px;bottom:16px;z-index:2147483647;max-width:calc(100vw - 32px);width:440px;');
  const shadow=panel.attachShadow({mode:'open'});
  shadow.innerHTML='<style>:host{all:initial}.box{font:14px/1.5 Arial;color:#17304c;background:#fff;border:1px solid #c9d8eb;border-radius:12px;padding:15px;box-shadow:0 5px 30px #13284835}p{margin:8px 0;font-size:12px;color:#56708f}.actions{display:flex;flex-wrap:wrap;gap:6px}button{font:600 12px Arial;padding:9px 11px;border:1px solid #c9d8eb;border-radius:7px;background:#f3f7ff;color:#234b82;cursor:pointer}button.primary{background:#1c62d8;color:#fff;border-color:#1c62d8}button:disabled{opacity:.4;cursor:default}</style><div class="box"><strong></strong><p class="help">Giữ và kéo chuột quanh cột chữ/ảnh. Viền cam là toàn bộ khối sẽ quét, gồm phần bên dưới màn hình. Esc để hủy.</p><p class="info">Chưa kéo vùng.</p><div class="actions"></div></div>';
  shadow.querySelector('strong').textContent=message;
  const info=shadow.querySelector('.info'),actions=shadow.querySelector('.actions');
  let start=null,rectangle=null,selected=null,dragging=false;
  const history=[];
  const drawBox=(el,rect)=>{el.style.display='block';el.style.left=`${rect.left}px`;el.style.top=`${rect.top}px`;el.style.width=`${rect.width}px`;el.style.height=`${rect.height}px`;};
  const choose=el=>{
    selected=el;const b=visibleBounds(el);drawBox(matched,b);
    const summary=selectionSummaryForElement(el);
    info.textContent=`${summary.questions} câu · ${summary.images} ảnh · khối rộng ${Math.round(el.getBoundingClientRect().width)} px${summary.navigationBlocks?' · sẽ loại thanh điều hướng':''}`;
    use.disabled=false;
  };
  const selectionSummaryForElement=el=>({questions:new Set([...(el.innerText || '').matchAll(/Câu\s*(?:hỏi\s*)?(\d+)\s*[:.]/gi)].map(m=>m[1])).size,images:el.querySelectorAll('img').length+(el.matches('img')?1:0),navigationBlocks:navigationRoots(el).size});
  const add=(label,callback,primary=false)=>{const b=document.createElement('button');b.textContent=label;if(primary)b.className='primary';b.onclick=callback;actions.append(b);return b;};
  add('Mở rộng ↑',()=>{if(selected?.parentElement && selected!==document.body){history.push(selected);choose(selected.parentElement);}});
  add('Thu hẹp ↓',()=>{if(history.length)choose(history.pop());});
  add('Vẽ lại',()=>{selected=null;rectangle=null;start=null;drawn.style.display=matched.style.display='none';use.disabled=true;info.textContent='Kéo lại quanh cột nội dung.';});
  const cleanup=()=>{overlay.remove();drawn.remove();matched.remove();panel.remove();document.removeEventListener('keydown',onKey,true);window.__aliPickerCancel=null;};
  window.__aliPickerCancel=()=>{cleanup();window.__aliPicked='__cancelled__';};
  const use=add('Dùng vùng này',()=>{
    if(!selected) return;
    document.querySelectorAll(`[data-ali-picked-id="${token}"]`).forEach(el=>el.removeAttribute('data-ali-picked-id'));
    selected.setAttribute('data-ali-picked-id',token);
    window.__aliPicked=`[data-ali-picked-id="${token}"]`;
    window.__aliPickedMeta={mode:'drag',drawnRect:rectangle};cleanup();
  },true);use.disabled=true;
  add('Hủy chọn',()=>window.__aliPickerCancel?.());
  const onKey=event=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();window.__aliPickerCancel?.();}};
  document.addEventListener('keydown',onKey,true);
  overlay.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;event.preventDefault();event.stopImmediatePropagation();
    overlay.setPointerCapture(event.pointerId);dragging=true;start={x:event.clientX,y:event.clientY};selected=null;use.disabled=true;history.length=0;matched.style.display='none';
  });
  overlay.addEventListener('pointermove',event=>{
    if(!dragging)return;event.preventDefault();event.stopImmediatePropagation();
    const x=Math.max(0,Math.min(innerWidth,event.clientX)),y=Math.max(0,Math.min(innerHeight,event.clientY));
    rectangle={left:Math.min(start.x,x),top:Math.min(start.y,y),width:Math.abs(x-start.x),height:Math.abs(y-start.y)};drawBox(drawn,rectangle);
    info.textContent=`Vùng kéo: ${Math.round(rectangle.width)} × ${Math.round(rectangle.height)} px`;
  });
  overlay.addEventListener('pointerup',event=>{
    if(!dragging)return;event.preventDefault();event.stopImmediatePropagation();dragging=false;
    if(rectangle?.width<20 || rectangle?.height<20 || !rectangle) {info.textContent='Kéo vùng rộng hơn 20 × 20 px.';return;}
    try {choose(matchDragRegion(rectangle));}catch(error){info.textContent=error.message;}
  });
  overlay.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();});
}

export function numberButtons({ selector }) {
  const root = document.querySelector(selector);
  if (!root) throw new Error('Không tìm thấy thanh số câu.');
  const seen = new Set();
  const list = [];
  for (const el of root.querySelectorAll('*')) {
    const t = el.textContent.trim();
    if (!/^\d{1,5}$/.test(t) || [...el.children].some(c => c.textContent.trim() === t)) continue;
    const n = Number(t); if (n < 1 || seen.has(n)) continue;
    // Numeric counters beside “Tất cả/Đúng/Sai” are not question navigation.
    // Follow wrappers with the same numeric text up to their grid/list parent.
    let control = el;
    while (control.parentElement && control.parentElement !== root && control.parentElement.textContent.trim() === t) control = control.parentElement;
    const numericSiblings = [...(control.parentElement?.children || [])].filter(child => /^\d{1,5}$/.test(child.textContent.trim()));
    if (numericSiblings.length < 2 && !(control.parentElement === root && root.children.length === 1)) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    control.dataset.aliNumber = `${n}`; list.push(n); seen.add(n);
  }
  return list.sort((a,b) => a-b);
}
