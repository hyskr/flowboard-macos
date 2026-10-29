import { isDesktop, desktopInfo, type DesktopInfo } from './desktop';
import { Records } from './personal/Records';
import { KnowledgeView } from './personal/KnowledgeView';
import { Settings } from './personal/Settings';
import { ConnectionSetup } from './components/ConnectionSetup';
import { useEffect, useState } from 'react';
import { useFlowStore } from './store/useFlowStore';
import { ContextArea } from './components/ContextArea';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { ConflictPanel } from './components/ConflictPanel';
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
  const [page, setPage] = useState<'board' | 'knowledge' | 'journal' | 'settings'>('board');
  const [knowledgeQuery, setKnowledgeQuery] = useState('');
  const [journalId, setJournalId] = useState('');
  const wiki = (target: string) => {
    const match = target.match(/\^j([\w-]+)/);
    if (match) {
      setJournalId(match[1]);
      setPage('journal');
    } else {
      setKnowledgeQuery(target.split('#')[0].split('/').pop() || target);
      setPage('knowledge');
    }
  };
  const [connection, setConnection] = useState<DesktopInfo | null>(null);
  const [connectionReady, setConnectionReady] = useState(false);
  const activeView = useFlowStore((st) => st.activeView);
  const activeBoardId = useFlowStore((st) => st.activeBoardId);
  const isLoading = useFlowStore((st) => st.isLoading);
  const error = useFlowStore((st) => st.error);
  const density = useFlowStore((st) => st.density);
  const [navOpen, setNavOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(() => {
    try {
      return localStorage.getItem('flowboard-stats-hidden') === 'false';
    } catch {
      return false;
    }
  });
  const [sidebarHidden, setSidebarHidden] = useState(() => {
    try {
      return localStorage.getItem('flowboard-sidebar-hidden') === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('flowboard-sidebar-hidden', String(sidebarHidden));
    } catch {
      /* Keep the toggle usable when browser storage is unavailable. */
    }
  }, [sidebarHidden]);

  useEffect(() => {
    try {
      localStorage.setItem('flowboard-stats-hidden', String(!filtersOpen));
    } catch {
      /* Keep the toggle usable when browser storage is unavailable. */
    }
  }, [filtersOpen]);

  useEffect(() => {
    const onPopState = () => {
      const state = useFlowStore.getState();
      const boardId = boardIdFromPath(window.location.pathname);
      if (state.isLoading || boardId === state.activeBoardId) return;
      void state
        .setActiveBoard(boardId, true)
        .catch(() => state.toast('Couldn’t save the selected board.', '⚠'));
    };
    const refresh = () => {
      const st = useFlowStore.getState();
      if (!st.isLoading && document.visibilityState === 'visible')
        void st.saveSettings({ workerUrl: st.workerUrl, syncInterval: st.syncInterval });
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('popstate', onPopState);
    void desktopInfo()
        .then((info) => {
          setConnection(info);
          if (info.configured) {
            setConnectionReady(true);
            void useFlowStore.getState().init();
          }
        })
        .catch((error) =>
          setConnection({
            configured: false,
            workerUrl: null,
            updatesUrl: null,
            boardId: 'shared',
            error: String(error),
          }),
        );
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  return (
    <ContextArea
      actions={
        page === 'board'
          ? [
              {
                label: '新增卡片',
                icon: 'plus',
                run: () => {
                  if (activeBoardId) useFlowStore.getState().openModal('card', {});
                },
              },
              {
                label: '添加栏目',
                icon: 'plus',
                run: () => document.querySelector<HTMLButtonElement>('[data-add-column]')?.click(),
              },
              {
                label: '立即同步',
                icon: 'cloud',
                run: () => {
                  const st = useFlowStore.getState();
                  return st.saveSettings({ workerUrl: st.workerUrl, syncInterval: st.syncInterval });
                },
              },
              { label: '设置', icon: 'settings', run: () => isDesktop?setPage('settings'):useFlowStore.getState().openModal('settings',{}) },
            ]
          : [
              { label: '共享看板', icon: 'board', run: () => setPage('board') },
              { label: '开发记录', icon: 'activity', run: () => setPage('journal') },
              { label: '知识库', icon: 'text', run: () => setPage('knowledge') },
              { label: '设置', icon: 'settings', run: () => isDesktop?setPage('settings'):useFlowStore.getState().openModal('settings',{}) },
            ]
      }
    >
      <div className={cx(s.app, sidebarHidden && s.sidebarHidden)} data-density={density}>
        <a className={s.skip} href="#main-content">
          Skip to board
        </a>
        <Sidebar
          open={navOpen}
          hidden={sidebarHidden}
          onClose={() => setNavOpen(false)}
          page={page}
          onNavigate={isDesktop ? setPage : undefined}
        />
        <div className={s.main}>
          {isDesktop && page !== 'board' ? (
            <>
              {page === 'journal' && (
                <Records
                  initialId={journalId}
                  onWiki={wiki}
                  onToggleSidebar={() => {
                    setSidebarHidden((v) => !v);
                    setNavOpen((v) => !v);
                  }}
                />
              )}
              {page === 'knowledge' && (
                <KnowledgeView
                  initialQuery={knowledgeQuery}
                  onJournal={(id) => {
                    setJournalId(id);
                    setPage('journal');
                  }}
                  onSettings={() => setPage('settings')}
                  onToggleSidebar={() => {
                    setSidebarHidden((v) => !v);
                    setNavOpen((v) => !v);
                  }}
                />
              )}
              {page === 'settings' && (
                <Settings
                  connection={connection}
                  onToggleSidebar={() => {
                    setSidebarHidden((v) => !v);
                    setNavOpen((v) => !v);
                  }}
                />
              )}
            </>
          ) : !connectionReady ? (
            <ConnectionSetup
              initialUrl={connection?.workerUrl || (isDesktop?'':location.origin)}
              initialError={connection?.error || ''}
            />
          ) : isLoading ? (
            <div className={s.splash} aria-busy="true">
              <Logo size={40} />
            </div>
          ) : error ? (
            <FullPageMessage
              title="无法打开看板"
              detail={error}
              action={isDesktop ? { label: '修改连接', run: () => setConnectionReady(false) } : undefined}
            />
          ) : (
            <>
              <Topbar
                onOpenNav={() => setNavOpen(true)}
                sidebarHidden={sidebarHidden}
                onToggleSidebar={() => setSidebarHidden((hidden) => !hidden)}
                filtersOpen={filtersOpen}
                onToggleFilters={() => setFiltersOpen((open) => !open)}
              />
              <ConflictPanel />
              <BoardToolbar hidden={!filtersOpen} />
              <main
                id="main-content"
                role="tabpanel"
                aria-labelledby={`view-${activeView}`}
                tabIndex={-1}
                className={s.content}
              >
                {!activeBoardId || activeView === 'board' ? (
                  <BoardView key={activeBoardId} />
                ) : activeView === 'calendar' ? (
                  <CalendarView />
                ) : (
                  <TimelineView />
                )}
              </main>
            </>
          )}
        </div>
        <ModalRouter />
        <ToastContainer />
      </div>
    </ContextArea>
  );
}
