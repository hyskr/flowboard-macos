import { useEffect, useRef, useState, type RefObject } from 'react';
import { useDismissToc } from './useDismissToc';
import { Icon } from '../components/Icon';
import s from './Personal.module.css';
export function FloatingToc({
  reader,
  recordId,
}: {
  reader: RefObject<HTMLElement | null>;
  recordId: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  useDismissToc(open, rootRef, () => setOpen(false));
  const [active, setActive] = useState(0);
  const [headings, setHeadings] = useState<{ label: string; level: number; node: HTMLElement }[]>([]);
  useEffect(() => {
    const root = reader.current;
    if (!root) return;
    const nodes = Array.from(
      root.querySelectorAll<HTMLElement>('[data-record-body] h1,[data-record-body] h2,[data-record-body] h3'),
    );
    setHeadings(
      nodes.map((node) => ({ label: node.textContent || '', level: Number(node.tagName.slice(1)), node })),
    );
    setActive(0);
    setOpen(false);
    const update = () => {
      const top = root.getBoundingClientRect().top + 100;
      let index = 0;
      nodes.forEach((node, i) => {
        if (node.getBoundingClientRect().top <= top) index = i;
      });
      setActive(index);
    };
    root.addEventListener('scroll', update, { passive: true });
    return () => root.removeEventListener('scroll', update);
  }, [reader, recordId]);
  if (!headings.length) return null;
  return (
    <div ref={rootRef} className={s.floatingToc} data-journal-keyboard-local>
      <button
        className={s.tocTrigger}
        aria-label="正文目录"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="text" size={16} />
        目录
      </button>
      {open && (
        <nav aria-label="正文目录" className={s.tocPopup}>
          <div>
            正文目录
            <button aria-label="关闭目录" onClick={() => setOpen(false)}>
              ×
            </button>
          </div>
          {headings.map((heading, i) => (
            <button
              key={i}
              aria-current={active === i ? 'location' : undefined}
              style={{ paddingLeft: 12 + Math.max(0, heading.level - 2) * 10 }}
              onClick={() => {
                heading.node.scrollIntoView({ behavior: 'smooth', block: 'start' });
                setActive(i);
              }}
            >
              {heading.label}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
