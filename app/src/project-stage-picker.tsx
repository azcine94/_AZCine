import { Feedback } from './components/ui/feedback.tsx';
import { Button } from './components/ui/button.tsx';
import { Input } from './components/ui/input.tsx';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { useAnchoredPopover } from './use-anchored-popover.ts';

export interface ProjectStageLabelActions {
  draftName(labelId?: string): string;
  changeDraftName(value: string, labelId?: string): void;
  error: string;
  create(name: string): boolean;
  rename(labelId: string, name: string): boolean;
  remove(labelId: string): boolean;
}

type PickerView = 'select' | 'create' | 'manage' | 'rename';

interface ProjectStagePickerProps {
  labels: readonly { id: string; name: string }[];
  labelActions?: ProjectStageLabelActions;
  currentId: string | null;
  onChange(id: string | null): void;
  disabled?: boolean;
  label: string;
}

export function ProjectStagePicker({
  labels,
  labelActions,
  currentId,
  onChange,
  disabled = false,
  label,
}: ProjectStagePickerProps) {
  const instanceId = useId();
  const panelId = `${instanceId}-stage-panel`;
  const listboxId = `${instanceId}-stage-options`;
  const rootRef = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef<'option' | 'input' | 'manage' | null>(null);

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<PickerView>('select');
  const [editingId, setEditingId] = useState<string | undefined>();
  const { triggerRef, panelRef: listboxRef } = useAnchoredPopover(open && !disabled, () => setOpen(false), view === 'select' ? 224 : 280, 'start', 400);
  // 仅用于键盘游标，不作为正式阶段或待保存阶段。
  const [activeId, setActiveId] = useState<string | null>(null);

  const expanded = open && !disabled;
  const options: readonly { id: string | null; name: string }[] = [
    { id: null, name: '未设阶段' },
    ...labels,
  ];
  const selectedIndex = options.findIndex(option => option.id === currentId);
  // 异常引用不伪装成“未设阶段”，也不主动改写父组件的值。
  const currentName = options[selectedIndex]?.name ?? '阶段待核对';
  const tabStopId = options.some(option => option.id === activeId)
    ? activeId
    : null;

  function tagStyle(labelId: string | null): (CSSProperties & { '--stage-hue': number }) | undefined {
    const index = labels.findIndex(item => item.id === labelId);
    return index < 0 ? undefined : { '--stage-hue': (250 + index * 137.508) % 360 };
  }

  function revealOption(element: HTMLElement | null) {
    const region = listboxRef.current?.querySelector<HTMLElement>('[role="listbox"]');
    if (!region || !element) return;
    const bounds = region.getBoundingClientRect(), option = element.getBoundingClientRect();
    if (option.top < bounds.top) region.scrollTop += option.top - bounds.top;
    else if (option.bottom > bounds.bottom) region.scrollTop += option.bottom - bounds.bottom;
  }

  useLayoutEffect(() => {
    if (disabled) {
      focusOnOpen.current = null;
      if (open) setOpen(false);
      return;
    }
    if (!open) return;

    const root = rootRef.current;
    if (!root) return;

    // Only explicit open/view changes request focus; typing and save receipts
    // must not repeatedly move the cursor back to the selected stage.
    const request = focusOnOpen.current;
    if (request) {
      focusOnOpen.current = null;
      const selector = request === 'input' ? 'input'
        : request === 'manage' ? '[data-stage-edit], [data-stage-back]'
        : '[role="option"][tabindex="0"]';
      const target = listboxRef.current?.querySelector<HTMLElement>(selector) ?? null;
      target?.focus({ preventScroll: true });
      if (request === 'option') revealOption(target);
    }

    // 如果父组件移除了正在聚焦的选项，关闭而不是抢回焦点。
    if (!root.contains(root.ownerDocument.activeElement)) {
      setOpen(false);
    }
  }, [disabled, labels, open, view]);

  useEffect(() => {
    if (!expanded) return;

    const root = rootRef.current;
    if (!root) return;
    const ownerDocument = root.ownerDocument;

    const closeFromOutside = (event: Event) => {
      if (!event.composedPath().includes(root)) {
        focusOnOpen.current = null;
        setOpen(false);
      }
    };

    // pointerdown 覆盖鼠标/触摸；click 同时覆盖辅助技术的虚拟点击。
    ownerDocument.addEventListener('pointerdown', closeFromOutside, true);
    ownerDocument.addEventListener('click', closeFromOutside, true);
    return () => {
      ownerDocument.removeEventListener('pointerdown', closeFromOutside, true);
      ownerDocument.removeEventListener('click', closeFromOutside, true);
    };
  }, [expanded]);

  function close(restoreFocus = false) {
    focusOnOpen.current = null;
    setOpen(false);

    const trigger = triggerRef.current;
    if (restoreFocus && trigger && trigger.getAttribute('aria-disabled') !== 'true') {
      trigger.focus({ preventScroll: true });
    }
  }

  function focusOption(index: number) {
    const option = options[index];
    if (!option) return;

    setActiveId(option.id);
    const buttons = listboxRef.current
      ?.querySelectorAll<HTMLButtonElement>('[role="option"]');
    buttons?.[index]?.focus({ preventScroll: true });
    revealOption(buttons?.[index] ?? null);
  }

  function openAt(index: number) {
    if (disabled) return;
    const option = options[index];
    if (!option) return;

    if (expanded) {
      focusOption(index);
      return;
    }

    setActiveId(option.id);
    setView('select');
    focusOnOpen.current = 'option';
    setOpen(true);
  }

  function showView(next: PickerView, labelId?: string) {
    if (disabled) return;
    setEditingId(labelId);
    focusOnOpen.current = next === 'create' || next === 'rename' ? 'input' : next === 'manage' ? 'manage' : 'option';
    setView(next);
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (
      disabled ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }

    let nextIndex: number;
    switch (event.key) {
      case 'ArrowDown':
        nextIndex = Math.max(0, selectedIndex);
        break;
      case 'ArrowUp':
        nextIndex = selectedIndex >= 0 ? selectedIndex : options.length - 1;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = options.length - 1;
        break;
      default:
        // Enter / Space 使用原生 button 的 click，不重复模拟选择。
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    openAt(nextIndex);
  }

  function handleOptionKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (
      !expanded ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }

    let nextIndex: number;
    switch (event.key) {
      case 'ArrowDown':
        nextIndex = (index + 1) % options.length;
        break;
      case 'ArrowUp':
        nextIndex = (index - 1 + options.length) % options.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = options.length - 1;
        break;
      default:
        // 不拦截 Tab；Enter / Space 由原生按钮触发 onClick。
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    focusOption(nextIndex);
  }

  return (
    <div
      ref={rootRef}
      className="project-stage-picker"
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          close();
        }
      }}
      onKeyDown={event => {
        if (
          expanded &&
          event.key === 'Escape' &&
          !event.nativeEvent.isComposing
        ) {
          event.preventDefault();
          event.stopPropagation();
          close(true);
        }
      }}
    >
      <Button variant="app-pill"
        ref={triggerRef}
        type="button"
        className="pill project-stage-picker__trigger"
        aria-disabled={disabled}
        data-project-commit
        aria-label={`${label}：${currentName}`}
        aria-haspopup="dialog"
        aria-expanded={expanded}
        aria-controls={panelId}
        onKeyDown={handleTriggerKeyDown}
        onClick={() => {
          if (disabled) return;
          if (expanded) close(true);
          else openAt(Math.max(0, selectedIndex));
        }}
      >
        <span className={`project-stage-picker__text project-stage-picker__tag${currentId === null ? ' project-stage-picker__tag--neutral' : ''}`} style={tagStyle(currentId)}>{currentName}</span>
        <svg
          className="project-stage-picker__chevron"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </Button>

      <div
        ref={listboxRef}
        id={panelId}
        className="project-stage-picker__listbox"
        data-view={view}
        role="dialog"
        popover="manual"
        data-project-commit
        aria-label={`${label}阶段选择`}
      >
        {expanded && view === 'select' && <>
        <div className="project-stage-picker__caption"><span>项目阶段</span><span>仅本项目</span></div>
        <div id={listboxId} className="project-stage-picker__options" role="listbox" aria-label={label} aria-multiselectable={false}>
        {options.map((option, index) => {
          const selected = option.id === currentId;
          return (
            <Button variant="app-control"
              key={option.id ?? 'none'}
              type="button"
              role="option"
              className="project-stage-picker__option"
              title={option.name}
              aria-selected={selected}
              tabIndex={option.id === tabStopId ? 0 : -1}
              disabled={disabled}
              onFocus={() => setActiveId(option.id)}
              onKeyDown={event => handleOptionKeyDown(event, index)}
              onClick={() => {
                if (disabled || !expanded) return;
                // 先返回按钮，再交给父组件处理保存/忙碌状态。
                close(true);
                if (option.id !== currentId) onChange(option.id);
              }}
            >
              <span className={`project-stage-picker__text project-stage-picker__tag${option.id === null ? ' project-stage-picker__tag--neutral' : ''}`} style={tagStyle(option.id)}>
                <span className="project-stage-picker__name">{option.name}</span>
                {selected && <span className="project-stage-picker__mark" aria-hidden="true">✓</span>}
              </span>
            </Button>
          );
        })}
        </div>
        {labelActions && <div className="project-stage-picker__actions">
          <Button variant="app-control" type="button" className="project-stage-picker__action" onClick={() => showView('create')}><span aria-hidden="true">＋</span>新增标签</Button>
          <Button variant="app-control" type="button" className="project-stage-picker__action" disabled={!labels.length} onClick={() => showView('manage')}>管理标签</Button>
        </div>}
        </>}
        {expanded && view !== 'select' && labelActions && <>
          <header className="project-stage-picker__header">
            <Button variant="app-control" type="button" data-stage-back className="project-stage-picker__back" aria-label="返回阶段选择" onClick={() => showView('select')}>←</Button>
            <strong>{view === 'manage' ? '管理标签' : view === 'rename' ? '修改标签名称' : '新增标签'}</strong>
          </header>
          {view === 'manage' ? <>
            <ul className="project-stage-picker__management">{labels.map(item => <li key={item.id}>
              <span className="project-stage-picker__tag" style={tagStyle(item.id)}>{item.name}</span>
              <Button variant="app-control" type="button" data-stage-edit className="project-stage-picker__back" aria-label={`改名：${item.name}`} onClick={() => showView('rename', item.id)}>改名</Button>
              <Button variant="app-control" type="button" className="project-stage-picker__back" aria-label={`删除标签：${item.name}`} onClick={() => { if (labelActions.remove(item.id)) close(true); }}>删除</Button>
            </li>)}</ul>
            <Button variant="app-control" type="button" className="project-stage-picker__action" onClick={() => showView('create')}><span aria-hidden="true">＋</span>新增标签</Button>
          </> : <form className="project-stage-picker__editor" noValidate onSubmit={event => {
            event.preventDefault();
            if (disabled) return;
            const name = labelActions.draftName(view === 'rename' ? editingId : undefined);
            const applied = view === 'rename' && editingId ? labelActions.rename(editingId, name) : labelActions.create(name);
            if (applied) close(true);
          }}>
            <label htmlFor={`${instanceId}-stage-name`}>标签名称</label>
            <Input variant="app" id={`${instanceId}-stage-name`} className="input" autoComplete="off" placeholder="填写阶段名称" value={labelActions.draftName(view === 'rename' ? editingId : undefined)} aria-invalid={!!labelActions.error} aria-describedby={labelActions.error ? `${instanceId}-stage-error` : undefined} onChange={event => labelActions.changeDraftName(event.target.value, view === 'rename' ? editingId : undefined)} onKeyDown={event => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault(); }} />
            <p className="meta">仅保存在当前项目，其他行可复用。阶段不等于已交完。</p>
            <div className="project-stage-picker__form-actions"><Button variant="app-pill" type="button" className="pill" onClick={() => showView('select')}>取消</Button><Button variant="app-pill" type="submit" className="pill on">{view === 'rename' ? '保存名称' : '保存并选用'}</Button></div>
          </form>}
          {labelActions.error && <Feedback as="p" tone="error" id={`${instanceId}-stage-error`} className="form-error project-stage-picker__error" role="alert">{labelActions.error}</Feedback>}
        </>}
      </div>
    </div>
  );
}
