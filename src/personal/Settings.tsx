import { useCallback, useEffect, useState } from 'react';
import {
  local,
  chooseDirectory,
  openPath,
  integrationStatus,
  takeover,
  type Conflict,
  type Integration,
  type PersonalSettings,
} from './api';
import { DesktopUpdates } from '../components/DesktopUpdates';
import { ConnectionForm } from '../components/ConnectionSetup';
import { checkSkill, installSkill, type DesktopInfo } from '../desktop';
import { useFlowStore } from '../store/useFlowStore';
import { cx } from '../utils';
import ui from '../components/ui.module.css';
import s from './Personal.module.css';
export function Settings({ connection }: { connection: DesktopInfo | null }) {
  const [settings, setSettings] = useState<PersonalSettings | null>(null);
  const [integrations, setIntegrations] = useState<Record<string, Integration>>({});
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [connect, setConnect] = useState(false);
  const syncInterval = useFlowStore((v) => v.syncInterval);
  const isLoading = useFlowStore((v) => v.isLoading);
  const syncError = useFlowStore((v) => v.syncError);
  const refresh = useCallback(async () => {
    try {
      const [settings, conflicts, codex, claude] = await Promise.all([
        local<PersonalSettings>('settings.get'),
        local<Conflict[]>('conflicts.list'),
        integrationStatus('codex'),
        integrationStatus('claude'),
      ]);
      setSettings(settings);
      setConflicts(conflicts);
      setIntegrations({ codex, claude });
    } catch (e) {
      setMessage(String(e));
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const run = async (label: string, action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(label);
    setMessage('');
    try {
      const value = await action();
      setMessage(typeof value === 'string' ? value : '已完成');
      await refresh();
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy('');
    }
  };
  const save = (patch: Record<string, unknown>) => run('settings', () => local('settings.save', patch));
  const directory = async (key: string) => {
    const path = await chooseDirectory();
    if (path) await save({ [key]: path });
  };
  if (!settings)
    return (
      <div className={s.empty} role="status">
        {message || '读取本机设置…'}
      </div>
    );
  return (
    <div className={s.settings}>
      <h1>设置</h1>
      {message && (
        <div className={s.notice} role="status">
          {message}
          <button onClick={() => setMessage('')}>关闭</button>
        </div>
      )}
      <section>
        <h2>个人记录</h2>
        <p>保存在此 Mac。未连接看板、断网或关闭窗口，都可以通过统一 Skill 保存。</p>
        <label>
          记录时区
          <input
            className={ui.input}
            type="text"
            defaultValue={settings.timezone}
            onBlur={(e) => {
              if (e.target.value !== settings.timezone) void save({ timezone: e.target.value });
            }}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.autoRecord}
            onChange={(e) => void save({ autoRecord: e.target.checked })}
          />
          自动检查未记录成果
        </label>
        <label>
          普通检查间隔
          <select
            className={ui.input}
            value={settings.checkpointMinutes}
            onChange={(e) => void save({ checkpointMinutes: Number(e.target.value) })}
          >
            {[
              [30, '30 分钟'],
              [60, '60 分钟'],
              [120, '120 分钟'],
              [0, '仅手动'],
            ].map(([v, l]) => (
              <option value={v} key={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <p>只有新增工作才产生检查点。压缩前可提前提醒；同一检查点只提醒一次，保存或跳过后推进范围。</p>
        <label>
          <input
            type="checkbox"
            checked={settings.hidePlaceholders}
            onChange={(e) => void save({ hidePlaceholders: e.target.checked })}
          />
          隐藏导入的固定占位记录
        </label>
        <div className={s.actions}>
          <button
            className={cx(ui.btn, ui.secondary)}
            disabled={!!busy}
            onClick={() =>
              void run('import', async () => {
                const directory = await chooseDirectory();
                if (!directory) return '已取消';
                const result = await local<{ imported: number; skipped: number }>('journal.import', {
                  directory,
                });
                return `导入 ${result.imported} 条，跳过已有 ${result.skipped} 条；原文件保留。`;
              })
            }
          >
            导入旧开发日记
          </button>
          <button className={cx(ui.btn, ui.secondary)} onClick={() => void directory('exportDir')}>
            选择自动导出目录
          </button>
          {settings.exportDir && (
            <button className={cx(ui.btn, ui.ghost)} onClick={() => void save({ exportDir: null })}>
              停止自动导出
            </button>
          )}
        </div>
        {settings.exportDir && (
          <p>App 维护的导出目录：{settings.exportDir}。需要在 Obsidian 单独修改时，请从记录页另导出副本。</p>
        )}
      </section>
      <section>
        <h2>知识库</h2>
        <p>{settings.knowledgeDir}</p>
        <p>Markdown 是正文唯一来源。可直接接入现有 References；外部编辑会刷新索引，保存前再检查当前文件。</p>
        <div className={s.actions}>
          <button
            className={cx(ui.btn, ui.secondary)}
            disabled={!!busy}
            onClick={() => void directory('knowledgeDir')}
          >
            选择 References 目录
          </button>
          <button
            className={cx(ui.btn, ui.ghost)}
            onClick={() => void openPath(settings.knowledgeDir).catch((e) => setMessage(String(e)))}
          >
            打开目录
          </button>
        </div>
      </section>
      <section>
        <h2>共享看板</h2>
        <p>
          {connection?.configured
            ? `服务地址：${connection.workerUrl}`
            : '可选连接。填写一次服务地址和共享密钥后，与协作者使用同一张看板。'}
        </p>
        <button className={cx(ui.btn, ui.secondary)} onClick={() => setConnect(!connect)}>
          {connect ? '收起' : connection?.configured ? '修改连接' : '连接共享看板'}
        </button>
        {connect && (
          <div style={{ maxWidth: 450, marginTop: 22 }}>
            <ConnectionForm initialUrl={connection?.workerUrl || ''} />
          </div>
        )}
        {connection?.configured && !isLoading && (
          <>
            <label>
              云端检查间隔
              <select
                className={ui.input}
                value={syncInterval}
                onChange={(e) =>
                  void run('sync', () => useFlowStore.getState().setSyncInterval(Number(e.target.value)))
                }
              >
                {[
                  [60, '1 分钟'],
                  [120, '2 分钟'],
                  [300, '5 分钟'],
                  [600, '10 分钟'],
                  [1800, '30 分钟'],
                  [3600, '1 小时'],
                ].map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <p>修改及时上传；切回应用、恢复网络时检查。定时检查间隔不影响主动保存。</p>
            {syncError && <p className={s.error}>{syncError}</p>}
          </>
        )}
      </section>
      <section>
        <h2>统一 Skill 与自动入口</h2>
        {(['codex', 'claude'] as const).map((target) => {
          const info = integrations[target];
          return (
            <div key={target} style={{ padding: '12px 0' }}>
              <strong>{target === 'codex' ? 'Codex' : 'Claude Code'}</strong>
              <p>
                App 内置 Skill：{info?.skill.bundledVersion || '读取中'}　系统 Skill：
                {info?.skill.version || '未安装'}
                <br />
                Hook：{info?.hookVersion || '未安装'} ·{' '}
                {info?.hooksConfigured
                  ? info.hooksTrusted
                    ? '已配置'
                    : '已配置，需在宿主审核／检查启用状态'
                  : '未配置'}
                <br />
                {info?.oldTaskSkill ? '检测到旧 FlowBoard Skill。 ' : ''}
                {info?.oldJournalEnabled ? '检测到旧 Dev Journal 自动入口。' : ''}
              </p>
              <div className={s.actions}>
                <button
                  className={cx(ui.btn, ui.secondary)}
                  disabled={!!busy}
                  onClick={() =>
                    void run(target, async () => {
                      const status = await checkSkill(target);
                      if (status.status === 'compatible') return 'Skill 兼容，保留已安装文件。';
                      await installSkill(target, status.status === 'update_required');
                      return '统一 Skill 已安装；自动记录还需单独接管 Hook。';
                    })
                  }
                >
                  检查／安装 Skill
                </button>
                <button
                  className={cx(ui.btn, ui.secondary)}
                  disabled={!!busy}
                  onClick={() =>
                    void run(target, async () => {
                      const result = await takeover(target);
                      return `已接管自动入口并备份旧配置。${result.reviewInstructions}`;
                    })
                  }
                >
                  由行记接管自动记录
                </button>
              </div>
              {info?.hooksConfigured && <p>{info.reviewInstructions}</p>}
            </div>
          );
        })}
      </section>
      {!!conflicts.length && (
        <section>
          <h2>待处理修改 · {conflicts.length}</h2>
          {conflicts.map((conflict) => (
            <div className={s.conflict} key={conflict.id}>
              <h3>
                {conflict.kind === 'journal' ? '开发记录' : '知识条目'} · {conflict.target}
              </h3>
              <details>
                <summary>当前内容</summary>
                <pre>{JSON.stringify(conflict.current, null, 2)}</pre>
              </details>
              <details>
                <summary>待处理修改</summary>
                <pre>{JSON.stringify(conflict.proposed, null, 2)}</pre>
              </details>
              <div className={s.actions}>
                <button
                  className={cx(ui.btn, ui.secondary)}
                  onClick={() =>
                    void run('conflict', () =>
                      local('conflicts.resolve', { id: conflict.id, choice: 'cloud' }),
                    )
                  }
                >
                  保留当前内容
                </button>
                <button
                  className={cx(ui.btn, ui.secondary)}
                  onClick={() =>
                    void run('conflict', () =>
                      local('conflicts.resolve', { id: conflict.id, choice: 'local' }),
                    )
                  }
                >
                  采用待处理修改
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
      <DesktopUpdates />
      <section>
        <h2>本地备份与恢复</h2>
        <p>备份个人记录、知识库文件、历史修订和本地设置。共享看板可在看板设置中单独导出。</p>
        <div className={s.actions}>
          <button
            className={cx(ui.btn, ui.secondary)}
            disabled={!!busy}
            onClick={() =>
              void run('backup', async () => {
                const v = await local<{ path: string }>('backup.create');
                return `备份已保存：${v.path}`;
              })
            }
          >
            创建备份
          </button>
          <button
            className={cx(ui.btn, ui.secondary)}
            disabled={!!busy}
            onClick={() =>
              void run('restore', async () => {
                const directory = await chooseDirectory();
                if (!directory) return '已取消';
                const v = await local<{ previousBackup: string }>('backup.restore', { directory });
                return `已恢复。恢复前的内容保存在：${v.previousBackup}`;
              })
            }
          >
            从备份恢复
          </button>
          <button
            className={cx(ui.btn, ui.ghost)}
            onClick={() => void openPath(settings.dataDir).catch((e) => setMessage(String(e)))}
          >
            打开数据目录
          </button>
        </div>
      </section>
      <section>
        <p>
          行记基于 BraveOPotato/FlowBoard，遵循
          LGPL-2.1。个人记录与知识正文保存在本机；共享服务仅接收你提交的任务内容。
        </p>
        <a href="https://github.com/hyskr/flowboard-macos" target="_blank" rel="noreferrer">
          开源仓库与使用说明
        </a>
      </section>
    </div>
  );
}
