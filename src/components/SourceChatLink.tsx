import type { ChatSource } from '../chatSource';
import { validChatSource } from '../chatSource';
import { openSourceChat } from '../desktop';
import { useFlowStore } from '../store/useFlowStore';
import { Icon } from './Icon';

export function SourceChatLink({ source }: { source?: ChatSource }) {
  if (!validChatSource(source)) return null;
  return <button type="button" title="使用来源聊天所属的账号和设备打开" style={{display:'inline-flex',alignItems:'center',gap:5,border:0,background:'transparent',color:'var(--accent)',padding:'4px 0',fontSize:12,cursor:'pointer'}}
    onPointerDown={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()} onClick={event=>{
      event.stopPropagation();
      void openSourceChat(source.url).catch(error=>useFlowStore.getState().toast(String(error),'⚠'));
    }}><Icon name="link" size={12}/>打开来源聊天</button>;
}
