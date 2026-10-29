import { isDesktop, desktopInfo, type DesktopInfo } from './desktop';
import { ConnectionSetup } from './components/ConnectionSetup';
import { useEffect, useState } from 'react';
import { useFlowStore } from './store/useFlowStore';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { ConflictPanel } from './components/ConflictPanel';
import { BoardIntro } from './components/BoardIntro';
import { BoardToolbar } from './components/BoardToolbar';
import { FullPageMessage, ToastContainer } from './components/Shell';
import { Logo } from './components/Icon';
import { ModalRouter } from './modals';
import { BoardView } from './views/BoardView';
import { CalendarView } from './views/CalendarView';
import { TimelineView } from './views/TimelineView';
import { cx } from './utils';
import { boardIdFromPath } from './boardRouting';
import s from './App.module.css';

export function App() {
  const [connection,setConnection] = useState<DesktopInfo | null>(null);
  const [connectionReady,setConnectionReady] = useState(!isDesktop);
  const activeView = useFlowStore((st) => st.activeView);
  const activeBoardId = useFlowStore((st) => st.activeBoardId);
  const isLoading = useFlowStore((st) => st.isLoading);
  const error = useFlowStore((st) => st.error);
  const density = useFlowStore((st) => st.density);
  const [navOpen, setNavOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(() => {
    try { return localStorage.getItem('flowboard-stats-hidden') === 'false'; }
    catch { return false; }
  });
  const [sidebarHidden, setSidebarHidden] = useState(() => {
    try { return localStorage.getItem('flowboard-sidebar-hidden') !== 'false'; }
    catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem('flowboard-sidebar-hidden', String(sidebarHidden)); }
    catch { /* Keep the toggle usable when browser storage is unavailable. */ }
  }, [sidebarHidden]);

  useEffect(() => {
    try { localStorage.setItem('flowboard-stats-hidden', String(!filtersOpen)); }
    catch { /* Keep the toggle usable when browser storage is unavailable. */ }
  }, [filtersOpen]);

  useEffect(() => {
    const onPopState = () => {
      const state = useFlowStore.getState();
      const boardId = boardIdFromPath(window.location.pathname);
      if (state.isLoading || boardId === state.activeBoardId) return;
      void state.setActiveBoard(boardId, true)
        .catch(() => state.toast('Couldn’t save the selected board.', '⚠'));
    };
    const refresh = () => {
      const st=useFlowStore.getState();
      if (!st.isLoading && document.visibilityState==='visible') void st.saveSettings({workerUrl:st.workerUrl,syncInterval:st.syncInterval});
    };
    window.addEventListener('focus',refresh);
    window.addEventListener('online',refresh);
    document.addEventListener('visibilitychange',refresh);
    window.addEventListener('popstate', onPopState);
    if(isDesktop) void desktopInfo().then(info=>{
      setConnection(info);
      if(info.configured){setConnectionReady(true);void useFlowStore.getState().init();}
    }).catch(error=>setConnection({configured:false,workerUrl:null,updatesUrl:null,boardId:'shared',error:String(error)}));
    else void useFlowStore.getState().init();
    return () => {window.removeEventListener('popstate',onPopState);window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh);document.removeEventListener('visibilitychange',refresh);};
  }, []);


  if(isDesktop && !connectionReady && connection) return <ConnectionSetup initialUrl={connection.workerUrl || ''} initialError={connection.error || ''}/>;

  if (isLoading) {
    return (
      <div className={s.splash} aria-busy="true" aria-label="Loading FlowBoard">
        <Logo size={40} />
      </div>
    );
  }

  if (error) return <FullPageMessage title="FlowBoard couldn't start" detail={error} action={isDesktop ? {label:'修改连接',run:()=>setConnectionReady(false)} : undefined}/>;

  return (
    <div className={cx(s.app, sidebarHidden && s.sidebarHidden)} data-density={density}>
      <a className={s.skip} href="#main-content">Skip to board</a>
      <Sidebar open={navOpen} hidden={sidebarHidden} onClose={() => setNavOpen(false)} />
      <div className={s.main}>
        <Topbar onOpenNav={() => setNavOpen(true)} sidebarHidden={sidebarHidden} onToggleSidebar={() => setSidebarHidden((hidden) => !hidden)} filtersOpen={filtersOpen} onToggleFilters={() => setFiltersOpen((open) => !open)} />
        <BoardIntro />
        <ConflictPanel />
        <BoardToolbar hidden={!filtersOpen} />
        <main id="main-content" role="tabpanel" aria-labelledby={`view-${activeView}`} tabIndex={-1} className={s.content}>
          {!activeBoardId || activeView === 'board' ? <BoardView key={activeBoardId} /> : activeView === 'calendar' ? <CalendarView /> : <TimelineView />}
        </main>
      </div>
      <ModalRouter />
      <ToastContainer />
    </div>
  );
}
