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
  if(message.type!=='GET_SOURCE')return;
  const windowId=message.windowId;
  const result=bindings.get(windowId) || chrome.storage.session.get(`actionSource:${windowId}`).then(saved=>saved[`actionSource:${windowId}`] || null);
  result.then(source=>respond({ source })).catch(error=>respond({ error:error.message }));
  return true;
});
async function captureSelection(tabId) {
  const tab=await chrome.tabs.get(tabId);
  const active=await chrome.tabs.query({active:true,windowId:tab.windowId});
  if(active[0]?.id!==tabId) throw new Error('Mở lại tab bài học để cập nhật ảnh vùng chọn. Không chụp tab khác.');
  const selection=await chrome.tabs.sendMessage(tabId,{app:'ali-pdf',type:'SELECTION'});
  if(selection.error)throw new Error(selection.error);
  if(!selection.rect.width || !selection.rect.height) throw new Error('Vùng đã chọn nằm ngoài màn hình. Cuộn tới vùng đó rồi cập nhật ảnh.');
  const preparation=await chrome.tabs.sendMessage(tabId,{app:'ali-pdf',type:'PREVIEW_BEGIN'});
  if(preparation.error)throw new Error(preparation.error);
  try {
    const before=await chrome.tabs.query({active:true,windowId:tab.windowId});
    if(before[0]?.id!==tabId)throw new Error('Tab đã đổi trước khi chụp ảnh. Không chụp tab khác.');
    const image=await chrome.tabs.captureVisibleTab(tab.windowId,{format:'png'});
    const after=await chrome.tabs.query({active:true,windowId:tab.windowId});
    if(after[0]?.id!==tabId)throw new Error('Tab đã đổi khi chụp ảnh. Hãy cập nhật ảnh sau khi mở lại bài.');
    return {image,selection:preparation.selection || selection,navigationHidden:preparation.navigationHidden};
  } finally {await chrome.tabs.sendMessage(tabId,{app:'ali-pdf',type:'PREVIEW_END',token:preparation.token}).catch(()=>{});}
}
