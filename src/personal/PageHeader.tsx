import type { ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { cx } from '../utils';
import bar from '../components/Topbar.module.css';
import ui from '../components/ui.module.css';
export function PageHeader({
  title,
  onToggleSidebar,
  tabs,
  children,
}: {
  title: string;
  onToggleSidebar?: () => void;
  tabs?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className={bar.topbar}>
      {onToggleSidebar && (
        <button className={cx(ui.iconBtn, bar.sidebarBtn)} onClick={onToggleSidebar} aria-label="切换侧栏">
          <Icon name="sidebar" size={18} />
        </button>
      )}
      <h1 className={bar.title}>{title}</h1>
      {tabs}
      <div className={bar.spacer} />
      {children}
    </header>
  );
}
