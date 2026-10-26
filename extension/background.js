// Handle the action explicitly: opening a panel is not itself proof that its
// page has a tab URL or activeTab access. Preserve the clicked tab before focus
// moves into the panel. Do not request persistent/all-site access here.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick:false }).catch(console.error);
const bindings = new Map();
async function bindTab(tab) {
  const source = { id:tab.id,windowId:tab.windowId,title:tab.title || '',url:tab.url || null };
  await chrome.storage.session.set({ [`actionSource:${tab.windowId}`]:source });
  if (/^https?:\/\//.test(source.url || '')) {
    await chrome.storage.local.set({ lastSource:source });
    try { await chrome.scripting.executeScript({ target:{tabId:tab.id},files:['content.js'] }); }
    catch (error) { source.connectionError=error.message; }
  }
  return source;
}
chrome.action.onClicked.addListener(tab => {
  // Invoke open synchronously while Chrome still has the toolbar user gesture.
  void chrome.sidePanel.open({ windowId:tab.windowId }).catch(console.error);
  bindings.set(tab.windowId,bindTab(tab));
  void bindings.get(tab.windowId).catch(console.error);
});
chrome.runtime.onMessage.addListener((message,sender,respond) => {
  if (sender.id !== chrome.runtime.id || message.app !== 'ali-source') return;
  if(message.type==='CAPTURE_SELECTION') {
    captureSelection(message.tabId).then(result=>respond(result)).catch(error=>respond({error:error.message}));
    return true;
  }
  if(message.type==='CAPTURE_REFERENCE' && sender.tab) {
    captureSelection(sender.tab.id,{duringScan:true,captureId:message.captureId}).then(async result=>respond({...await cropReference(result),selection:result.selection})).catch(error=>respond({error:error.message}));
    return true;
  }
  if(message.type!=='GET_SOURCE')return;
  const windowId=message.windowId;
  const result=bindings.get(windowId) || chrome.storage.session.get(`actionSource:${windowId}`).then(saved=>saved[`actionSource:${windowId}`] || null);
  result.then(source=>respond({ source })).catch(error=>respond({ error:error.message }));
  return true;
});
let captureQueue=Promise.resolve(),lastCapture=0;
function captureSelection(tabId,options={}) {
  const job=captureQueue.catch(()=>{}).then(async()=>{
    const wait=650-(Date.now()-lastCapture);if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));
    return captureSelectionNow(tabId,options);
  });
  captureQueue=job;return job;
}
async function captureSelectionNow(tabId,options) {
  const tab=await chrome.tabs.get(tabId);
  const active=await chrome.tabs.query({active:true,windowId:tab.windowId});
  if(active[0]?.id!==tabId) throw new Error('Mở lại tab bài học để cập nhật ảnh vùng chọn. Không chụp tab khác.');
  const selection=await chrome.tabs.sendMessage(tabId,{app:'ali-pdf',type:'SELECTION'});
  if(selection.error)throw new Error(selection.error);
  if(!selection.rect.width || !selection.rect.height) throw new Error('Vùng đã chọn nằm ngoài màn hình. Cuộn tới vùng đó rồi cập nhật ảnh.');
  const preparation=await chrome.tabs.sendMessage(tabId,{app:'ali-pdf',type:'PREVIEW_BEGIN',...options,revision:selection.revision});
  if(preparation.error)throw new Error(preparation.error);
  try {
    const before=await chrome.tabs.query({active:true,windowId:tab.windowId});
    if(before[0]?.id!==tabId)throw new Error('Tab đã đổi trước khi chụp ảnh. Không chụp tab khác.');
    lastCapture=Date.now();
    const image=await chrome.tabs.captureVisibleTab(tab.windowId,{format:'png'});
    const after=await chrome.tabs.query({active:true,windowId:tab.windowId});
    if(after[0]?.id!==tabId)throw new Error('Tab đã đổi khi chụp ảnh. Hãy cập nhật ảnh sau khi mở lại bài.');
    const current=await chrome.tabs.sendMessage(tabId,{app:'ali-pdf',type:'SELECTION'});
    if(current.error)throw new Error(current.error);
    if(current.revision!==selection.revision)throw new Error('Vùng chọn đã đổi khi chụp. Hãy thử lại.');
    return {image,selection:preparation.selection || selection,navigationHidden:preparation.navigationHidden};
  } finally {await chrome.tabs.sendMessage(tabId,{app:'ali-pdf',type:'PREVIEW_END',token:preparation.token}).catch(()=>{});}
}
async function cropReference({image,selection:{rect,viewport}}) {
  const bytes=Uint8Array.from(atob(image.split(',')[1]),c=>c.charCodeAt(0));
  const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
  try {
    const sx=bitmap.width/viewport.width,sy=bitmap.height/viewport.height;
    const x=Math.max(0,rect.left*sx),y=Math.max(0,rect.top*sy);
    const width=Math.min(bitmap.width-x,rect.width*sx),height=Math.min(bitmap.height-y,rect.height*sy);
    if(width<1 || height<1)throw new Error('Không thấy vùng gốc để so sánh.');
    const scale=Math.min(1,1400/width,1800/height),canvas=new OffscreenCanvas(Math.max(1,Math.round(width*scale)),Math.max(1,Math.round(height*scale)));
    canvas.getContext('2d').drawImage(bitmap,x,y,width,height,0,0,canvas.width,canvas.height);
    const png=new Uint8Array(await (await canvas.convertToBlob({type:'image/png'})).arrayBuffer());
    let binary='';for(let i=0;i<png.length;i+=32768)binary+=String.fromCharCode(...png.subarray(i,i+32768));
    return {image:'data:image/png;base64,'+btoa(binary),width:canvas.width,height:canvas.height};
  } finally {bitmap.close();}
}
