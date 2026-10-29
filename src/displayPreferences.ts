import { create } from 'zustand';
const levels=[75,80,90,100,110,125,150];
const saved=Number(localStorage.getItem('xingji-zoom'))||100;
function apply(value:number){document.documentElement.style.zoom=String(value/100);document.documentElement.style.setProperty('--app-height',`${10000/value}dvh`);}
export const useDisplayPreferences=create<{zoom:number;setZoom:(value:number)=>void}>(set=>({zoom:levels.includes(saved)?saved:100,setZoom:value=>{const zoom=Math.max(75,Math.min(150,value));apply(zoom);localStorage.setItem('xingji-zoom',String(zoom));set({zoom});}}));
apply(useDisplayPreferences.getState().zoom);
export function handleZoomKey(event:KeyboardEvent){
 if(!(event.metaKey||event.ctrlKey)||event.altKey)return;
 if(!['+','=','-','0'].includes(event.key))return;
 event.preventDefault();event.stopPropagation();
 const {zoom,setZoom}=useDisplayPreferences.getState();
 setZoom(event.key==='0'?100:event.key==='-'?[...levels].reverse().find(v=>v<zoom)??75:levels.find(v=>v>zoom)??150);
}
