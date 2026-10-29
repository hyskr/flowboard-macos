import { useEffect, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { local, openPath } from './api';
import { openSourceChat } from '../desktop';
import s from './Personal.module.css';
function Image({src,alt,path}:{src?:string;alt?:string;path?:string}){
 const [url,setUrl]=useState('');
 useEffect(()=>{let alive=true;if(!src)return;
  if(src.startsWith('https://')||src.startsWith('data:')){setUrl(src);return;}
  const base=path?.split('/').slice(0,-1)??[];for(const part of decodeURIComponent(src).split('/')){if(part==='..')base.pop();else if(part!=='.')base.push(part);}
  void local<string>('knowledge.asset',{path:base.join('/')}).then(v=>{if(alive)setUrl(v);}).catch(()=>setUrl(''));
  return()=>{alive=false;};
 },[src,path]);
 return url?<img src={url} alt={alt??''}/>:<span>{alt||'图片'}</span>;
}
function CodeBlock({children}:{children?:ReactNode}){
 const [copied,setCopied]=useState(false);
 return <div className={s.codeBlock}><button onClick={event=>{const text=event.currentTarget.parentElement?.querySelector('pre')?.textContent||'';void navigator.clipboard.writeText(text).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),1500);});}}>{copied?'已复制':'复制代码'}</button><pre>{children}</pre></div>;
}
export function Markdown({body,path,onWiki}:{body:string;path?:string;onWiki?:(target:string)=>void}){
 const content=body.replace(/^---\n[\s\S]*?\n---\n/,'').replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,(_all,target,label)=>`[${label||target}](xingji-wiki:${encodeURIComponent(target)})`);
 return <div className={s.markdown}><ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={url=>url} components={{
  pre:({children})=><CodeBlock>{children}</CodeBlock>,
  img:({src,alt})=><Image src={typeof src==='string'?src:undefined} alt={alt} path={path}/>,
  h2:({children})=><h2 id={String(children)}>{children}</h2>,
  a:({href,children})=><a href={href} onClick={event=>{
   if(href?.startsWith('#'))return;event.preventDefault();
   if(href?.startsWith('xingji-wiki:'))onWiki?.(decodeURIComponent(href.slice(12)));
   else if(href?.startsWith('codex:')||href?.startsWith('https://chatgpt.com/')||href?.startsWith('https://claude.ai/'))void openSourceChat(href).catch(()=>{});
   else if(href?.startsWith('https://')||href?.startsWith('http://'))window.open(href,'_blank','noopener,noreferrer');
   else if(href?.startsWith('file://'))void openPath(decodeURIComponent(href.slice(7))).catch(()=>{});
   else if(href)onWiki?.(decodeURIComponent(href));
  }}>{children}</a>
 }}>{content}</ReactMarkdown></div>;
}
