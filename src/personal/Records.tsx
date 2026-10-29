import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { local, openPath, type Entry } from './api';
import { useDismissToc } from './useDismissToc';
import { FloatingToc } from './FloatingToc';
import { ContextArea } from '../components/ContextArea';
import { PageHeader } from './PageHeader';
import bar from '../components/Topbar.module.css';
import { JournalCalendar } from './JournalCalendar';
import { todayInZone } from './calendarDates';
import { Icon } from '../components/Icon';
import { Markdown } from './Markdown';
import { openSourceChat } from '../desktop';
import { cx } from '../utils';
import ui from '../components/ui.module.css';
import s from './Personal.module.css';
function RecordBody({ body, onWiki }: { body: string; onWiki: (target: string) => void }) {
  const lines = body.split('\n');
  const visible: string[] = [];
  const details: string[] = [];
  let folded = false;
  for (const line of lines) {
    if (/^#{2,4} (修改范围|变更文件|文件清单|内部标识)/.test(line)) {
      folded = true;
      details.push(line);
      continue;
    }
    if (folded && /^#{1,4} /.test(line)) folded = false;
    if (folded || /^\*\*(项目|标签|来源|触发)\*\*/.test(line)) details.push(line);
    else visible.push(line);
  }
  return (
    <>
      <Markdown body={visible.join('\n')} onWiki={onWiki} />
      {!!details.length && (
        <details className={s.properties}>
          <summary>文件清单与原记录属性</summary>
          <Markdown body={details.join('\n')} onWiki={onWiki} />
        </details>
      )}
    </>
  );
}
function groupBy<T>(rows: T[], key: (v: T) => string) {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    map.set(k, [...(map.get(k) || []), row]);
  }
  return map;
}
export function Records({
  onWiki,
  initialId,
  onToggleSidebar,
}: {
  onWiki: (target: string) => void;
  initialId?: string;
  onToggleSidebar?: () => void;
}) {
  const groupTocRef = useRef<HTMLDivElement | null>(null);
  const [groupTocOpen, setGroupTocOpen] = useState(false);
  useDismissToc(groupTocOpen, groupTocRef, () => setGroupTocOpen(false));
  const readerRef = useRef<HTMLElement | null>(null);
  const cardListRef = useRef<HTMLDivElement | null>(null);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const appliedSource = useRef('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState(initialId || '');
  const [query, setQuery] = useState('');
  const [project, setProject] = useState('');
  const [grouping, setGrouping] = useState<'date' | 'project'>('date');
  const [deleted, setDeleted] = useState(false);
  const [timezone, setTimezone] = useState('Asia/Shanghai');
  const today = todayInZone(timezone);
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [day, setDay] = useState('');
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [editing, setEditing] = useState<Entry | null>(null);
  const [message, setMessage] = useState('');
  const [relatedScope, setRelatedScope] = useState<'project' | 'chat'>('project');
  const [history, setHistory] = useState<Entry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [base, setBase] = useState<Entry | null>(null);
  const refresh = useCallback(
    () =>
      local<Entry[]>('journal.list', { deleted })
        .then(setEntries)
        .finally(() => setLoading(false))
        .catch((e) => setMessage(String(e))),
    [deleted],
  );
  useEffect(() => {
    const searchTimer = setTimeout(() => void refresh(), 200);
    const handler = () => void refresh();
    window.addEventListener('focus', handler);
    return () => {
      clearTimeout(searchTimer);
      window.removeEventListener('focus', handler);
    };
  }, [refresh]);
  useEffect(() => {
    void local<{ timezone: string }>('settings.get')
      .then((v) => setTimezone(v.timezone))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (initialId) setSelected(initialId);
  }, [initialId]);
  const projects = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of entries) {
      const name = entry.project?.trim() || '未分类';
      map.set(name, (map.get(name) || 0) + 1);
    }
    return [...map].sort((a, b) => a[0].localeCompare(b[0], 'zh-CN'));
  }, [entries]);
  const projectEntries = useMemo(
    () => entries.filter((entry) => !project || (entry.project?.trim() || '未分类') === project),
    [entries, project],
  );
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of projectEntries) map.set(entry.date, (map.get(entry.date) || 0) + 1);
    return map;
  }, [projectEntries]);
  const visible = useMemo(
    () =>
      projectEntries.filter(
        (entry) =>
          (!day || entry.date === day) &&
          (!from || entry.date >= from) &&
          (!to || entry.date <= to) &&
          (!query.trim() ||
            [entry.title, entry.body, entry.project || ''].some((value) =>
              value.toLowerCase().includes(query.trim().toLowerCase()),
            )),
      ),
    [projectEntries, day, from, to, query],
  );
  const current = entries.find((entry) => entry.id === selected);
  const canRelateByChat =
    !!current?.sessionId && current.sessionId !== 'manual' && !current.sessionId.startsWith('import:');
  const useChat = canRelateByChat && (relatedScope === 'chat' || !current?.project?.trim());
  const related = useMemo(
    () =>
      !current
        ? []
        : entries.filter((entry) =>
            useChat
              ? entry.sessionId === current.sessionId
              : current.project?.trim()
                ? entry.project?.trim() === current.project.trim()
                : entry.id === current.id,
          ),
    [entries, current, useChat],
  );
  const relatedDays = groupBy(related, (entry) => entry.date);
  const jumpToRelated = (entry: Entry) => {
    if (editing) return;
    setProject('');
    setQuery('');
    setFrom('');
    setTo('');
    setDay(entry.date);
    setMonth(entry.date.slice(0, 7));
    setSelected(entry.id);
    setHistory(null);
  };
  const projectDirectory = !!day || grouping === 'project';
  const directoryGroups = groupBy(visible, (entry) =>
    projectDirectory ? entry.project?.trim() || '未分类' : entry.date,
  );
  useEffect(() => setGroupTocOpen(false), [day, grouping, project]);
  const groups = groupBy(visible, (entry) =>
    grouping === 'project' ? entry.project?.trim() || '未分类' : entry.date,
  );
  useEffect(() => {
    if (editing) return;
    if (!visible.some((e) => e.id === selected)) {
      setSelected(visible[0]?.id || '');
      setHistory(null);
    }
  }, [visible, selected, !!editing]);
  useEffect(() => {
    const entry = entries.find((e) => e.id === initialId);
    if (entry && appliedSource.current !== initialId) {
      appliedSource.current = initialId || '';
      setProject('');
      setDay(entry.date);
      setMonth(entry.date.slice(0, 7));
      setSelected(entry.id);
    }
  }, [initialId, entries]);
  const chooseDay = (date: string) => {
    if (editing) return;
    setDay(date);
    setFrom('');
    setTo('');
    setHistory(null);
  };
  const displayed = [...groups.values()].flatMap((rows) =>
    [...groupBy(rows, (e) => (grouping === 'project' ? e.date : e.sessionId)).values()].flat(),
  );
  const currentIndex = displayed.findIndex((entry) => entry.id === selected);
  const navigateRecord = (delta: number) => {
    if (editing) return;
    const next = displayed[currentIndex + delta];
    if (!next) return;
    setSelected(next.id);
    setHistory(null);
    if (grouping === 'project')
      setCollapsedProjects((previous) => {
        const updated = new Set(previous);
        updated.delete(next.project?.trim() || '未分类');
        return updated;
      });
    requestAnimationFrame(() =>
      cardListRef.current
        ?.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(next.id)}"]`)
        ?.scrollIntoView({ block: 'nearest' }),
    );
  };
  useEffect(() => {
    const onArrow = (event: KeyboardEvent) => {
      if (
        editing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        !['ArrowUp', 'ArrowDown'].includes(event.key)
      )
        return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest(
          'input,textarea,select,[contenteditable="true"],[role="dialog"],[role="menu"],[data-journal-keyboard-local]',
        )
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      navigateRecord(event.key === 'ArrowUp' ? -1 : 1);
    };
    window.addEventListener('keydown', onArrow, true);
    return () => window.removeEventListener('keydown', onArrow, true);
  });
  const save = async () => {
    if (!editing || busy) return;
    setBusy(true);
    try {
      const old = base;
      const result = await local<{ status: string }>('journal.save', {
        ...editing,
        date: editing.date || undefined,
        baseVersion: old?.version,
        baseValues: old ? { title: old.title, body: old.body, project: old.project || '' } : {},
      });
      setMessage(result.status === 'saved' ? '记录已保存' : '存在待处理修改，请在设置中选择采用哪一份');
      setEditing(null);
      setSelected(editing.id);
      await refresh();
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (entry: Entry, restore = false) => {
    try {
      await local(restore ? 'journal.restore' : 'journal.delete', {
        id: entry.id,
        baseVersion: entry.version,
      });
      setMessage(restore ? '已恢复' : '已移到回收站，可撤销');
      await refresh();
    } catch (e) {
      setMessage(String(e));
    }
  };
  const createEntry = () => {
    setHistory(null);
    setBase(null);
    setEditing({
      id: crypto.randomUUID(),
      title: '',
      body: '',
      version: 0,
      date: day || today,
      occurredAt: new Date().toISOString(),
      savedAt: '',
      sessionId: 'manual',
      source: 'manual',
      project: project === '未分类' ? '' : project,
    });
  };
  return (
    <ContextArea
      actions={[
        { label: '新增记录', icon: 'plus', run: createEntry },
        ...(current && !deleted
          ? [
              {
                label: '编辑当前记录',
                icon: 'pencil' as const,
                run: () => {
                  setBase(current);
                  setEditing({ ...current });
                },
              },
              {
                label: '复制 Markdown',
                icon: 'copy' as const,
                run: () => navigator.clipboard.writeText(current.body || ''),
              },
            ]
          : []),
      ]}
    >
      <div className={s.page}>
        <PageHeader
          title="开发记录"
          onToggleSidebar={onToggleSidebar}
          tabs={
            <nav className={bar.views} aria-label="记录分组方式">
              {(['date', 'project'] as const).map((value) => (
                <button
                  key={value}
                  className={cx(bar.view, grouping === value && bar.viewActive)}
                  aria-pressed={grouping === value}
                  onClick={() => setGrouping(value)}
                >
                  <Icon name={value === 'date' ? 'calendar' : 'board'} size={15} />
                  {value === 'date' ? '按日期' : '按项目'}
                </button>
              ))}
            </nav>
          }
        >
          <div className={s.actions}>
            <label className={bar.search}>
              <Icon name="search" size={16} />
              <input
                placeholder="搜索记录"
                aria-label="搜索开发记录"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setDay('');
                }}
              />
            </label>
            <button className={cx(ui.btn, ui.primary)} onClick={createEntry}>
              <Icon name="plus" size={15} />
              新增记录
            </button>
            <button
              className={cx(ui.btn, ui.secondary)}
              onClick={() => {
                setDeleted(!deleted);
                setEditing(null);
              }}
            >
              {deleted ? '返回记录' : '回收站'}
            </button>
          </div>
        </PageHeader>
        {message && (
          <div className={s.notice} role="status">
            <span>{message}</span>
            <button onClick={() => setMessage('')}>关闭</button>
          </div>
        )}
        <div className={cx(s.split, s.journalSplit)}>
          <aside className={s.list} aria-label="开发记录筛选与列表">
            <div className={s.projectFilter}>
              <label htmlFor="journal-project">项目</label>
              <select
                id="journal-project"
                className={ui.input}
                value={project}
                disabled={!!editing}
                onChange={(e) => {
                  setProject(e.target.value);
                  setDay('');
                  setHistory(null);
                }}
              >
                <option value="">全部项目 · {entries.length} 条</option>
                {projects.map(([name, count]) => (
                  <option key={name} value={name}>
                    {name} · {count}
                  </option>
                ))}
              </select>
            </div>
            <div className={s.listHeading}>
              <strong>{day ? `${Number(day.slice(5, 7))} 月 ${Number(day.slice(8))} 日` : '全部记录'}</strong>
              <div className={s.listHeadingActions}>
                <span>{visible.length} 条</span>
                <div ref={groupTocRef} className={s.groupTocAnchor} data-journal-keyboard-local>
                  <button
                    className={s.tocTrigger}
                    aria-expanded={groupTocOpen}
                    onClick={() => setGroupTocOpen((value) => !value)}
                  >
                    <Icon name="text" size={14} />
                    {projectDirectory ? '项目目录' : '日期目录'}
                  </button>
                  {groupTocOpen && (
                    <nav className={s.tocPopup} aria-label={projectDirectory ? '项目目录' : '日期目录'}>
                      <div>
                        {projectDirectory ? '项目目录' : '日期目录'}
                        <button aria-label="关闭分组目录" onClick={() => setGroupTocOpen(false)}>
                          ×
                        </button>
                      </div>
                      {[...directoryGroups].map(([key, rows]) => (
                        <button
                          key={key}
                          onClick={() => {
                            setCollapsedProjects((previous) => {
                              const next = new Set(previous);
                              next.delete(key);
                              return next;
                            });
                            setGroupTocOpen(false);
                            requestAnimationFrame(() =>
                              cardListRef.current
                                ?.querySelector<HTMLElement>(
                                  projectDirectory
                                    ? `[data-entry-id="${CSS.escape(rows[0].id)}"]`
                                    : `[data-group-key="${CSS.escape(key)}"]`,
                                )
                                ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
                            );
                          }}
                        >
                          <span>{key}</span>
                          <small> · {rows.length}</small>
                        </button>
                      ))}
                    </nav>
                  )}
                </div>
              </div>
            </div>
            <div className={s.entries} ref={cardListRef}>
              {[...groups].map(([groupKey, groupEntries]) => (
                <section
                  data-group-key={groupKey}
                  key={groupKey}
                  className={grouping === 'project' ? s.projectGroup : undefined}
                >
                  {grouping === 'project' ? (
                    <button
                      className={s.projectGroupHeader}
                      aria-expanded={!collapsedProjects.has(groupKey)}
                      onClick={() =>
                        setCollapsedProjects((previous) => {
                          const next = new Set(previous);
                          if (next.has(groupKey)) next.delete(groupKey);
                          else next.add(groupKey);
                          return next;
                        })
                      }
                    >
                      <Icon
                        name={collapsedProjects.has(groupKey) ? 'chevronRight' : 'chevronDown'}
                        size={14}
                      />
                      <span>
                        <strong title={groupKey}>{groupKey}</strong>
                        <small>最近记录 {groupEntries[0].date}</small>
                      </span>
                      <b>{groupEntries.length}</b>
                    </button>
                  ) : (
                    !day && (
                      <h2 className={s.groupHeading}>
                        <Icon name="calendar" size={13} />
                        {Number(groupKey.slice(5, 7))} 月 {Number(groupKey.slice(8))} 日
                        <span>{groupEntries.length}</span>
                      </h2>
                    )
                  )}
                  <div hidden={grouping === 'project' && collapsedProjects.has(groupKey)}>
                    {[...groupBy(groupEntries, (e) => (grouping === 'project' ? e.date : e.sessionId))].map(
                      ([subgroup, rows]) => (
                        <div key={subgroup}>
                          <h3>{grouping === 'project' ? rows[0].date : rows[0].project || '未分类'}</h3>
                          {rows.map((entry) => (
                            <button
                              className={s.item}
                              onContextMenu={() => {
                                if (!editing) {
                                  setSelected(entry.id);
                                  setHistory(null);
                                }
                              }}
                              data-entry-id={entry.id}
                              aria-current={entry.id === selected}
                              key={entry.id}
                              onClick={() => {
                                if (editing) return;
                                setSelected(entry.id);
                                setHistory(null);
                              }}
                            >
                              <div className={s.entryTime}>
                                {new Date(entry.occurredAt).toLocaleTimeString('zh-CN', {
                                  timeZone: entry.timezone || 'Asia/Shanghai',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                                <span>
                                  {entry.source === 'codex'
                                    ? 'Codex'
                                    : entry.source === 'claude'
                                      ? 'Claude'
                                      : entry.source === 'manual'
                                        ? '手动记录'
                                        : '导入记录'}
                                </span>
                              </div>
                              <strong>{entry.title.replace(/^#+\s*/, '')}</strong>
                              <div className={s.preview}>
                                {entry.body
                                  .split('\n')
                                  .filter(
                                    (l) =>
                                      l.trim() &&
                                      !l.startsWith('#') &&
                                      !l.startsWith('<') &&
                                      !/^\*\*(标签|项目|来源|触发)/.test(l),
                                  )
                                  .slice(0, 3)
                                  .join('\n')}
                              </div>
                            </button>
                          ))}
                        </div>
                      ),
                    )}
                  </div>
                </section>
              ))}
              {!visible.length && (
                <div className={s.listEmpty}>
                  <Icon name="calendar" size={24} />
                  <p>
                    {loading
                      ? '正在读取记录…'
                      : query
                        ? '没有找到匹配的记录'
                        : day
                          ? '这一天还没有记录'
                          : '还没有开发记录'}
                  </p>
                  {day && (
                    <button className={cx(ui.btn, ui.ghost, ui.sm)} onClick={() => chooseDay('')}>
                      查看其他日期
                    </button>
                  )}
                </div>
              )}
            </div>
          </aside>
          <article
            ref={readerRef}
            className={cx(s.reader, s.journalReader)}
            key={editing ? 'editing' : current?.id || 'empty'}
          >
            {current && !editing && (
              <FloatingToc reader={readerRef} recordId={current.id + ':' + current.version} />
            )}
            <div className={s.document}>
              {editing ? (
                <div className={s.editor}>
                  <h1>{editing.version ? '编辑阶段' : '新增阶段'}</h1>
                  <label>
                    标题
                    <input
                      className={ui.input}
                      value={editing.title}
                      onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                    />
                  </label>
                  <label>
                    正文 · Markdown
                    <textarea
                      className={ui.textarea}
                      value={editing.body}
                      onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                    />
                  </label>
                  <label>
                    项目名称（可选）
                    <input
                      className={ui.input}
                      placeholder="例如：行记、Typst 课程报告"
                      list="journal-project-options"
                      value={editing.project || ''}
                      onChange={(e) => setEditing({ ...editing, project: e.target.value })}
                    />
                  </label>
                  <datalist id="journal-project-options">
                    {projects
                      .filter(([name]) => name !== '未分类')
                      .map(([name]) => (
                        <option key={name} value={name} />
                      ))}
                  </datalist>
                  {!editing.version && (
                    <label>
                      发生日期
                      <input
                        className={ui.input}
                        type="date"
                        value={editing.date}
                        onChange={(e) => setEditing({ ...editing, date: e.target.value })}
                      />
                    </label>
                  )}
                  <div className={s.actions}>
                    <button
                      className={cx(ui.btn, ui.primary)}
                      disabled={busy || !editing.title.trim() || !editing.body.trim()}
                      onClick={() => void save()}
                    >
                      保存
                    </button>
                    <button
                      className={cx(ui.btn, ui.secondary)}
                      disabled={busy}
                      onClick={() => setEditing(null)}
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : current ? (
                <>
                  <div className={s.readerEyebrow}>
                    <Icon name="activity" size={14} />
                    {current.date} / {current.project || '个人记录'}
                  </div>
                  <h1>{current.title.replace(/^#+\s*/, '')}</h1>
                  <div className={s.meta}>
                    {new Date(current.occurredAt).toLocaleTimeString('zh-CN', {
                      timeZone: current.timezone || timezone,
                      hour: '2-digit',
                      minute: '2-digit',
                    })}{' '}
                    记录 · 版本 {current.version}
                  </div>
                  <div className={cx(s.actions, s.readerActions)}>
                    <div className={s.recordPager}>
                      <button
                        className={cx(ui.btn, ui.ghost)}
                        disabled={currentIndex <= 0}
                        onClick={() => navigateRecord(-1)}
                        title="上一条"
                      >
                        <Icon name="chevronUp" size={14} />
                        上一条
                      </button>
                      <span>
                        {currentIndex + 1} / {displayed.length}
                      </span>
                      <button
                        className={cx(ui.btn, ui.ghost)}
                        disabled={currentIndex < 0 || currentIndex >= displayed.length - 1}
                        onClick={() => navigateRecord(1)}
                        title="下一条"
                      >
                        下一条
                        <Icon name="chevronDown" size={14} />
                      </button>
                    </div>
                    {deleted ? (
                      <button className={cx(ui.btn, ui.secondary)} onClick={() => void remove(current, true)}>
                        撤销删除
                      </button>
                    ) : (
                      <>
                        <button
                          className={cx(ui.btn, ui.secondary)}
                          onClick={() => {
                            setBase(current);
                            setEditing({ ...current });
                          }}
                        >
                          编辑
                        </button>
                        <button className={cx(ui.btn, ui.ghost)} onClick={() => void remove(current)}>
                          删除
                        </button>
                      </>
                    )}
                    <button
                      className={cx(ui.btn, ui.ghost)}
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(current.body)
                          .then(() => setMessage('已复制 Markdown'))
                      }
                    >
                      复制 Markdown
                    </button>
                    <button
                      className={cx(ui.btn, ui.ghost)}
                      onClick={() =>
                        void local<Entry[]>('history', { kind: 'journal', id: current.id }).then(setHistory)
                      }
                    >
                      修订记录
                    </button>
                    {current.sourceChat && (
                      <button
                        className={cx(ui.btn, ui.ghost)}
                        onClick={() =>
                          void openSourceChat(current.sourceChat!).catch((e) => setMessage(String(e)))
                        }
                      >
                        来源聊天
                      </button>
                    )}
                  </div>
                  <div data-record-body>
                    <RecordBody body={current.body} onWiki={onWiki} />
                  </div>
                  {current.artifacts?.length ? (
                    <div className={s.actions} style={{ marginTop: 20 }}>
                      {current.artifacts.map((a) => (
                        <button
                          className={cx(ui.btn, ui.secondary)}
                          key={a.path}
                          onClick={() => void openPath(a.path).catch((e) => setMessage(String(e)))}
                        >
                          {a.label || '打开产物'}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <details className={s.properties}>
                    <summary>属性与来源</summary>
                    {current.importPath && (
                      <button
                        className={cx(ui.btn, ui.ghost)}
                        onClick={() => void openPath(current.importPath!).catch((e) => setMessage(String(e)))}
                      >
                        打开原日记文件
                      </button>
                    )}
                    <p>
                      发生时间：{current.occurredAt}
                      <br />
                      保存时间：{current.savedAt}
                      <br />
                      客户端：{current.source}
                      <br />
                      阶段 ID：{current.id}
                      <br />
                      聊天分组：{current.sessionId}
                    </p>
                    {current.taskLinks?.length ? (
                      <pre>{JSON.stringify(current.taskLinks, null, 2)}</pre>
                    ) : null}
                  </details>
                  {history && (
                    <section>
                      <h2>历史修订</h2>
                      {history.map((v) => (
                        <details className={s.properties} key={v.version}>
                          <summary>
                            版本 {v.version} · {v.savedAt}
                          </summary>
                          <Markdown body={v.body} />
                        </details>
                      ))}
                    </section>
                  )}
                </>
              ) : (
                <div className={s.empty}>
                  <Icon name="calendar" size={36} />
                  <h2>{day ? '这一天，留待记录。' : '从一天开始回顾。'}</h2>
                  <p>
                    {day
                      ? '选择其他日期阅读已有成果，或新建一条记录。'
                      : '点击日历上的日期，查看当天的进展与完整记录。'}
                  </p>
                </div>
              )}
            </div>
          </article>
          <aside className={s.contextPanel} aria-label="日历与相关日志">
            <JournalCalendar
              month={month}
              day={day}
              today={today}
              counts={counts}
              onMonth={setMonth}
              onDay={chooseDay}
              disabled={!!editing}
            />
            <details className={s.rangeFilter}>
              <summary>
                <Icon name="calendar" size={14} />
                日期范围与导出
              </summary>
              <div className={s.rangeFields}>
                <label>
                  开始日期
                  <input
                    className={ui.input}
                    type="date"
                    value={from}
                    onChange={(e) => {
                      setFrom(e.target.value);
                      setDay('');
                    }}
                  />
                </label>
                <label>
                  结束日期
                  <input
                    className={ui.input}
                    type="date"
                    value={to}
                    onChange={(e) => {
                      setTo(e.target.value);
                      setDay('');
                    }}
                  />
                </label>
                <button
                  className={cx(ui.btn, ui.secondary, ui.sm)}
                  onClick={() =>
                    void local<{ path: string }>('journal.export', {
                      from: day || from,
                      to: day || to,
                      query,
                      project,
                    })
                      .then((v) => setMessage(`已导出：${v.path}`))
                      .catch((e) => setMessage(String(e)))
                  }
                >
                  <Icon name="download" size={14} />
                  导出 Markdown
                </button>
                {(from || to) && (
                  <button
                    className={cx(ui.btn, ui.ghost, ui.sm)}
                    onClick={() => {
                      setFrom('');
                      setTo('');
                    }}
                  >
                    清除范围
                  </button>
                )}
              </div>
            </details>
            {current && (
              <section className={s.relatedLogs} aria-label="跨日期相关日志">
                <div className={s.relatedHead}>
                  <div>
                    <strong>{useChat ? '聊天历史' : '项目历史'}</strong>
                    <p className={s.relatedProjectName} title={current.project}>
                      {current.project || '未分类'}
                    </p>
                    <p>
                      {relatedDays.size} 个日期 · {related.length} 条记录
                    </p>
                  </div>
                  {canRelateByChat && current.project?.trim() && (
                    <div className={bar.views}>
                      {current.project?.trim() && (
                        <button
                          className={cx(bar.view, !useChat && bar.viewActive)}
                          onClick={() => setRelatedScope('project')}
                        >
                          同项目
                        </button>
                      )}
                      {canRelateByChat && (
                        <button
                          className={cx(bar.view, useChat && bar.viewActive)}
                          onClick={() => setRelatedScope('chat')}
                        >
                          同聊天
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className={s.relatedTimeline}>
                  {[...relatedDays].map(([date, rows]) => (
                    <div className={s.relatedDay} key={date}>
                      <time>{date}</time>
                      <div>
                        {rows.map((entry) => (
                          <button
                            className={s.relatedEntry}
                            key={entry.id}
                            aria-current={entry.id === current.id ? 'true' : undefined}
                            onClick={() => jumpToRelated(entry)}
                          >
                            <span>
                              {new Date(entry.occurredAt).toLocaleTimeString('zh-CN', {
                                timeZone: entry.timezone || timezone,
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                            <strong>{entry.title.replace(/^#+\s*/, '')}</strong>
                            {entry.id === current.id && <small>当前</small>}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
            {!current && <div className={s.listEmpty}>选择一条日志，查看同项目的历次记录。</div>}
          </aside>
        </div>
      </div>
    </ContextArea>
  );
}
