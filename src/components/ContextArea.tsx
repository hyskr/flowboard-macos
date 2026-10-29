import { useState, type ReactNode } from 'react';
import { Menu, MenuItem } from './Menu';
import type { IconName } from './Icon';
export interface ContextAction {
  label: string;
  icon?: IconName;
  run: () => void | Promise<unknown>;
  danger?: boolean;
}
export function ContextArea({ children, actions }: { children: ReactNode; actions: ContextAction[] }) {
  const [menu, setMenu] = useState<{ anchor: HTMLElement; point: { x: number; y: number } } | null>(null);
  return (
    <div
      style={{ display: 'contents' }}
      onContextMenu={(event) => {
        if ((event.target as HTMLElement).closest('input,textarea,[contenteditable="true"]')) {
          event.stopPropagation();
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        setMenu({ anchor: event.target as HTMLElement, point: { x: event.clientX, y: event.clientY } });
      }}
    >
      {children}
      {menu && (
        <Menu anchor={menu.anchor} point={menu.point} onClose={() => setMenu(null)}>
          {actions.map((action) => (
            <MenuItem
              key={action.label}
              icon={action.icon}
              danger={action.danger}
              onClick={() => {
                setMenu(null);
                void action.run();
              }}
            >
              {action.label}
            </MenuItem>
          ))}
        </Menu>
      )}
    </div>
  );
}
