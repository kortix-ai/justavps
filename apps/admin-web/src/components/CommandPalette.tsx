import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCommandPalette } from './CommandPaletteContext';
import { useStore } from '../lib/store';
import { useFullWorkflow } from '../features/workflow/useFullWorkflow';
import { cx, shortId } from '../lib/utils';
import { IconSearch, IconArrowRight } from './ui/icons';
import { KbdRow } from './ui/Kbd';

type Item = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon?: string;
  perform: () => void | Promise<void>;
  keywords?: string;
};

export function CommandPalette() {
  const { isOpen, close } = useCommandPalette();
  const navigate = useNavigate();
  const { state, refreshAll, setSelectedMachineId } = useStore();
  const { run: runWorkflow } = useFullWorkflow();
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActiveIdx(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  const items: Item[] = useMemo(() => {
    const base: Item[] = [
      { id: 'go-dashboard', group: 'Navigation', label: 'Go to Dashboard', perform: () => navigate('/'), keywords: 'home overview' },
      { id: 'go-topology', group: 'Navigation', label: 'Go to Topology', perform: () => navigate('/topology'), keywords: 'cluster region host' },
      { id: 'go-machines', group: 'Navigation', label: 'Go to Machines', perform: () => navigate('/machines'), keywords: 'instances vm container' },
      { id: 'go-artifacts', group: 'Navigation', label: 'Go to Artifacts', perform: () => navigate('/artifacts'), keywords: 'images snapshots' },
      { id: 'go-vendor', group: 'Navigation', label: 'Go to Vendor', perform: () => navigate('/vendor'), keywords: 'hetzner robot' },
      { id: 'go-procurement', group: 'Navigation', label: 'Go to Procurement', perform: () => navigate('/procurement'), keywords: 'order bootstrap' },
      { id: 'go-console', group: 'Navigation', label: 'Go to API Console', perform: () => navigate('/console'), keywords: 'request raw http' },
      { id: 'go-settings', group: 'Navigation', label: 'Go to Settings', perform: () => navigate('/settings'), keywords: 'token api url' },
      { id: 'act-refresh', group: 'Actions', label: 'Refresh everything', perform: () => refreshAll(), keywords: 'sync reload' },
      { id: 'act-workflow', group: 'Actions', label: 'Run full E2E workflow', perform: () => runWorkflow(), keywords: 'live test e2e' },
    ];

    for (const machine of state.machines.slice(0, 50)) {
      base.push({
        id: `m-${machine.id}`,
        group: 'Machines',
        label: machine.name || machine.id,
        hint: machine.id,
        perform: () => {
          setSelectedMachineId(machine.id);
          navigate(`/machines/${encodeURIComponent(machine.id)}`);
        },
        keywords: `${machine.id} ${machine.region ?? ''} ${machine.cluster?.region ?? ''} ${machine.status ?? ''}`,
      });
    }

    return base;
  }, [navigate, refreshAll, runWorkflow, setSelectedMachineId, state.machines]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => `${item.label} ${item.hint ?? ''} ${item.keywords ?? ''}`.toLowerCase().includes(q));
  }, [items, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const item of filtered) {
      if (!map.has(item.group)) map.set(item.group, []);
      map.get(item.group)!.push(item);
    }
    return Array.from(map.entries());
  }, [filtered]);

  useEffect(() => {
    if (activeIdx >= filtered.length) setActiveIdx(0);
  }, [activeIdx, filtered.length]);

  if (!isOpen) return null;

  function selectIndex(idx: number) {
    const item = filtered[idx];
    if (!item) return;
    Promise.resolve(item.perform()).catch(() => {});
    close();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      selectIndex(activeIdx);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }

  let runningIdx = -1;
  return (
    <>
      <div className="scrim" onClick={close} aria-hidden />
      <div className="cmdk" role="dialog" aria-modal="true">
        <div className="cmdk-card">
          <div className="cmdk-input-wrap">
            <IconSearch />
            <input
              ref={inputRef}
              className="cmdk-input"
              placeholder="Type a command, machine name, or page…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              data-testid="v2-cmdk-input"
            />
            <KbdRow keys={['esc']} />
          </div>
          <div className="cmdk-list">
            {filtered.length === 0 ? (
              <div className="cmdk-empty">No results for “{query}”</div>
            ) : (
              grouped.map(([group, groupItems]) => (
                <div key={group}>
                  <div className="cmdk-section-title">{group}</div>
                  {groupItems.map((item) => {
                    runningIdx += 1;
                    const idx = runningIdx;
                    return (
                      <div
                        key={item.id}
                        className={cx('cmdk-item', activeIdx === idx && 'is-active')}
                        onMouseEnter={() => setActiveIdx(idx)}
                        onClick={() => selectIndex(idx)}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                          <span className="text-truncate">{item.label}</span>
                          {item.hint ? <span className="text-subtle text-sm text-mono text-truncate">{shortId(item.hint, 26)}</span> : null}
                        </div>
                        <span className="cmdk-spacer">
                          <IconArrowRight />
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
