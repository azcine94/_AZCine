import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from './desktop-api.ts';
import { beijingDay, emptyModelBoards, MODEL_BOARDS, parseModelBoards, parseModelBoardState, parseModelSnapshot } from './model-ranking-contract.ts';
import type { ModelBoard, ModelBoardState } from './model-ranking-contract.ts';
import { fetchRanking } from './model-ranking-source.ts';
import { fetchRankingPrices, retainRankingPrices } from './model-ranking-prices.ts';
import { workspaceError } from './workspace-contract.ts';

const blankMessages = (): Record<ModelBoard, string> => ({ agent: '', 'text-to-image': '' });

// App owns requests and feedback across route, board and theme switches.
export function useModelRanking(root: string | null, visible: boolean) {
  const connected = isTauri();
  const [selected, setSelected] = useState<ModelBoard>('agent');
  const [boards, setBoards] = useState(emptyModelBoards);
  const boardsRef = useRef(boards);
  const [errors, setErrors] = useState(blankMessages);
  const [notices, setNotices] = useState(blankMessages);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<{ board: ModelBoard; action: string } | null>(null);
  const busyRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const rootRef = useRef(root);
  rootRef.current = root;
  const autoAttempts = useRef(new Set<string>());
  const [, setDay] = useState(beijingDay);

  function accept(next: ModelBoardState) {
    const previous = boardsRef.current[next.board];
    const retained = next.error && !next.snapshot && previous.snapshot
      ? { ...next, snapshotId: previous.snapshotId, snapshot: previous.snapshot, savedAt: previous.savedAt } : next;
    boardsRef.current = { ...boardsRef.current, [next.board]: retained };
    setBoards(boardsRef.current);
  }
  function message(board: ModelBoard, error = '', notice = '') {
    setErrors(previous => ({ ...previous, [board]: error }));
    setNotices(previous => ({ ...previous, [board]: notice }));
  }
  async function refresh() {
    if (!connected || !rootRef.current || busyRef.current) return;
    busyRef.current = true; setLoading(true);
    const stamp = generation.current;
    try {
      const next = parseModelBoards(await invoke<unknown>('model_ranking_workspace'));
      if (stamp !== generation.current) return;
      accept(next.agent); accept(next['text-to-image']); setLoadError('');
    } catch (error) { if (stamp === generation.current) setLoadError(workspaceError(error)); }
    finally { if (stamp === generation.current) { busyRef.current = false; setLoading(false); } }
  }
  useEffect(() => {
    generation.current += 1;
    requestRef.current?.abort(); requestRef.current = null;
    busyRef.current = false;
    boardsRef.current = emptyModelBoards(); setBoards(boardsRef.current);
    setErrors(blankMessages()); setNotices(blankMessages()); setLoadError(''); setLoading(false); setBusy(null);
    autoAttempts.current.clear();
    if (root && connected) void refresh();
    return () => { generation.current += 1; requestRef.current?.abort(); };
  }, [root, connected]);
  useEffect(() => {
    if (!visible) return;
    setDay(beijingDay());
    const timer = window.setInterval(() => setDay(beijingDay()), 60_000);
    return () => window.clearInterval(timer);
  }, [visible]);

  async function update(board: ModelBoard) {
    const expectedRoot = rootRef.current;
    if (!connected || !expectedRoot || busyRef.current || loadError || boardsRef.current[board].error) return;
    const stamp = generation.current, previous = boardsRef.current[board].snapshot;
    const expectedSnapshotId = boardsRef.current[board].snapshotId;
    const controller = new AbortController();
    requestRef.current = controller;
    busyRef.current = true; setBusy({ board, action: 'fetch' }); message(board);
    const current = () => stamp === generation.current && expectedRoot === rootRef.current;
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 60_000);
    autoAttempts.current.add(`${board}:${beijingDay()}`);
    try {
      const attempt = parseModelBoardState(await invoke<unknown>('model_ranking_attempt', { board, expectedRoot }));
      if (!current()) return;
      if (attempt.board !== board || attempt.error) throw new Error('无法记录取数状态，请重新读取榜单后刷新。');
      accept(attempt);
      controller.signal.throwIfAborted();
      let snapshot = await fetchRanking(board, controller.signal);
      let priceWarning = '';
      if (board === 'agent') {
        try {
          snapshot = parseModelSnapshot({ ...snapshot, pricing: await fetchRankingPrices(snapshot.rows, controller.signal) });
        } catch {
          controller.signal.throwIfAborted();
          snapshot = parseModelSnapshot({ ...snapshot, pricing: retainRankingPrices(snapshot.rows, previous?.pricing) });
          priceWarning = previous?.pricing?.capturedAt
            ? 'Models.dev 价格更新失败，已保留仍在榜单中的旧报价；报价时间可悬停查看。'
            : 'Models.dev 价格暂未获取成功，价格显示“—”，可稍后刷新榜单重试。';
        }
      }
      if (!current()) return;
      controller.signal.throwIfAborted();
      // Cancellation applies to network acquisition. Atomic saving awaits its
      // actual receipt and cannot be presented as cancelled after committing.
      window.clearTimeout(timer); requestRef.current = null;
      setBusy({ board, action: 'save' });
      const saved = parseModelBoardState(await invoke<unknown>('model_ranking_update', {
        input: { board, json: JSON.stringify(snapshot), expectedSnapshotId, expectedRoot },
      }));
      if (!current()) return;
      if (saved.board !== board || saved.error || !saved.snapshot || !saved.snapshotId) throw new Error('更新保存回执尚未确认，请重新读取榜单后核对。');
      // Reconcile an acknowledged commit even if a later receipt-content check
      // fails; otherwise the next update could use the pre-commit snapshot ID.
      accept(saved);
      if (JSON.stringify(saved.snapshot) !== JSON.stringify(snapshot)) throw new Error('保存回执与获取字段不一致，请重新读取榜单后核对。');
      message(board, priceWarning, '已自动获取并保存完整前 50 名。');
    } catch (error) {
      controller.abort();
      if (current()) {
        if (timedOut) message(board, '获取官方公开数据超时，原榜单及获取时间未改变。');
        else if (error instanceof DOMException && error.name === 'AbortError') message(board, '', '已取消获取，原榜单及获取时间未改变。');
        else message(board, `${workspaceError(error)} 原榜单保留。`);
      }
    } finally {
      window.clearTimeout(timer);
      if (current()) { requestRef.current = null; busyRef.current = false; setBusy(null); }
    }
  }
  function cancel() { requestRef.current?.abort(); }
  async function openSource(board: ModelBoard) {
    if (!connected) return;
    const stamp = generation.current;
    try {
      await invoke('model_ranking_open_source', { board });
      if (stamp === generation.current) setNotices(previous => ({ ...previous, [board]: '已请求默认浏览器打开 Arena 官方榜单。' }));
    } catch (error) { if (stamp === generation.current) setErrors(previous => ({ ...previous, [board]: workspaceError(error) })); }
  }
  useEffect(() => {
    if (!visible || !root || !connected || loading || loadError || busyRef.current) return;
    const today = beijingDay();
    const board = MODEL_BOARDS.find(id => !boardsRef.current[id].error
      && (boardsRef.current[id].sourceCheck.day !== today
        || id === 'agent' && !!boardsRef.current[id].snapshot && !boardsRef.current[id].snapshot?.pricing)
      && !autoAttempts.current.has(`${id}:${today}`));
    if (board) void update(board);
  });
  return { connected, selected, setSelected, boards, errors, notices, loading, loadError, busy,
    refresh, update, cancel, openSource };
}
export type ModelRankingController = ReturnType<typeof useModelRanking>;
