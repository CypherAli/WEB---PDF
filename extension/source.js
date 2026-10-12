const isWeb = url => /^https?:\/\//.test(url || '');
export class SourceError extends Error {
  constructor(message,code) { super(message);this.code=code; }
}
export function describeSourceError(error) {
  if (error instanceof SourceError) return error.message;
  if (/Cannot access|Missing host permission|permission|not allowed/i.test(error.message)) return 'Chrome chưa cho phép Ali đọc trang này. Khi bài đang mở, bấm biểu tượng Ali màu xanh trên thanh Chrome; hoặc bấm Kết nối website trong tiện ích.';
  if (/No tab with id|tab.*closed/i.test(error.message)) return 'Tab bài học đã đóng. Mở bài rồi bấm biểu tượng Ali trên thanh Chrome.';
  return error.message;
}
export async function resolveSourceTab(api=chrome,{preferAction=true}={}) {
  const window=await api.windows.getCurrent();
  const [tabs,receipt]=await Promise.all([
    api.tabs.query({active:true,windowId:window.id}),
    api.runtime.sendMessage({app:'ali-source',type:'GET_SOURCE',windowId:window.id}).catch(()=>null),
  ]);
  const active=tabs[0],clicked=receipt?.source;
  const panelTab=active?.url?.startsWith(api.runtime.getURL(''));
  if(Number.isInteger(clicked?.id) && clicked.id>=0 && (preferAction || active?.id===clicked.id || panelTab)) {
    try {
      const live=await api.tabs.get(clicked.id);
      if(live.windowId===window.id) {
        const candidate={...clicked,...live,url:live.url || clicked.url,title:live.title || clicked.title};
        if(isWeb(candidate.url)) return candidate;
        if(candidate.url) throw new SourceError('Trang này không hỗ trợ quét. Mở website bài học rồi bấm biểu tượng Ali trên thanh Chrome.','unsupported');
      }
    } catch(error) {if(error instanceof SourceError) throw error;}
  }
  if(!active) throw new SourceError('Không tìm thấy tab đang mở trong cửa sổ này. Mở bài rồi bấm biểu tượng Ali.','no-tab');
  if(!active.url) throw new SourceError('Chrome chưa cấp quyền đọc tab đang mở. Bấm biểu tượng Ali màu xanh trên thanh Chrome khi bài đang mở, hoặc bấm Kết nối website bên dưới.','permission');
  if(!isWeb(active.url)) throw new SourceError('Trang này không hỗ trợ quét. Chuyển về website bài học rồi bấm biểu tượng Ali trên thanh Chrome.','unsupported');
  return active;
}
