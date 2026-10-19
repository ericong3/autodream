import { useEffect, useRef, useState } from 'react';
import { BUILDING_LIMITS } from '../../utils/garageBuilding';
import type { BuildingProject, BuildingRoom, BuildingWindow } from '../../types/garageBuilding';

type Point = [number, number, number];
interface Props {
  readOnly?: boolean;
  onBusyChange?: (busy: boolean) => void;
  project: BuildingProject;
  onChange: (project: BuildingProject) => void;
  roomId: string | null;
  windowId: string | null;
  onSelect: (roomId: string, windowId?: string) => void;
  floorId: string;
  onFloor: (id: string) => void;
}
const selected = 'border-gold-400/70 bg-gold-400/20 text-gold-200';
const ordinary = 'border-white/15 bg-black/60 text-white/70';
function projected([x, y, z]: Point, yaw: number, pitch: number): Point {
  const u = x * Math.cos(yaw) - z * Math.sin(yaw), v = x * Math.sin(yaw) + z * Math.cos(yaw);
  return [u, v * Math.sin(pitch) - y * Math.cos(pitch), v * Math.cos(pitch) + y * Math.sin(pitch)];
}
function glassPoints(project: BuildingProject, w: BuildingWindow): Point[][] {
  const room = project.rooms.find(r => r.id === w.roomId);
  if (!room) return [];
  const elevation = project.floors.findIndex(f => f.id === room.floorId) * 132;
  const horizontal = w.wall === 'N' || w.wall === 'S', length = horizontal ? room.width : room.depth;
  const columns = w.span ? Array.from({ length: w.span.cols }, (_, col) => Math.max(1, ...w.panes.filter(p => p.col === col).map(p => p.width))) : w.panes.map(p => p.width);
  const rows = w.span ? Array.from({ length: w.span.rows }, (_, row) => Math.max(1, ...w.panes.filter(p => p.row === row).map(p => p.height))) : [];
  const width = columns.reduce((a, b) => a + b, 0), start = Math.max(0, Math.min(length - width, length * w.position - width / 2));
  const point = (along: number, height: number): Point => w.wall === 'N' ? [room.x + along, height + elevation, room.z - 1] : w.wall === 'S' ? [room.x + along, height + elevation, room.z + room.depth + 1] : w.wall === 'W' ? [room.x - 1, height + elevation, room.z + along] : [room.x + room.width + 1, height + elevation, room.z + along];
  return w.panes.map((p, i) => {
    const col = w.span ? p.col ?? 0 : i, row = p.row ?? 0;
    const left = start + columns.slice(0, col).reduce((a, b) => a + b, 0);
    const bottom = w.span ? w.span.bottom + rows.slice(0, row).reduce((a, b) => a + b, 0) : w.kind === 'sliding' ? 0 : Math.max(0, (108 - p.height) / 2);
    return [point(left, bottom), point(left + p.width, bottom), point(left + p.width, bottom + p.height), point(left, bottom + p.height)];
  });
}
export default function BuildingPlan({ readOnly = false, onBusyChange, project, onChange, roomId, windowId, onSelect, floorId, onFloor }: Props) {
  const [view, setView] = useState<'2d' | '3d'>('2d');
  const [yaw, setYaw] = useState(-.62), [pitch, setPitch] = useState(.5), [zoom, setZoom] = useState(1);
  const [pending, setPending] = useState<BuildingProject | null>(null);
  const [notice, setNotice] = useState('');
  const svg = useRef<SVGSVGElement>(null);
  const resizeSource = useRef<BuildingProject | null>(null);
  const drag = useRef<{
    mode: string; original: BuildingProject; start: { x: number; y: number }; room?: BuildingRoom; window?: BuildingWindow;
    scale: number; yaw: number; pitch: number; camera?: { cx: number; cy: number; scale: number }; plan?: { tx: number; tz: number }; moved: boolean;
  } | null>(null);
  const [resizing, setResizing] = useState(false);
  useEffect(() => { onBusyChange?.(!!pending); }, [pending, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  useEffect(() => { if(readOnly){setPending(null);setResizing(false);drag.current=null;} }, [readOnly]);
  const working = pending ?? project;
  const rooms = working.rooms.filter(r => floorId === 'all' || r.floorId === floorId);
  const local = (event: React.PointerEvent<SVGSVGElement>) => {
    const point = svg.current!.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    return point.matrixTransform(svg.current!.getScreenCTM()!.inverse());
  };
  const bounds = rooms.length ? { minX: Math.min(...rooms.map(r => r.x)) - 35, minZ: Math.min(...rooms.map(r => r.z)) - 35, maxX: Math.max(...rooms.map(r => r.x + r.width)) + 35, maxZ: Math.max(...rooms.map(r => r.z + r.depth)) + 35 } : { minX: 0, minZ: 0, maxX: 600, maxZ: 400 };
  const planScale = view === '2d' && drag.current ? drag.current.scale : Math.min(760 / (bounds.maxX - bounds.minX), 430 / (bounds.maxZ - bounds.minZ)) * zoom;
  const tx = view === '2d' && drag.current?.plan ? drag.current.plan.tx : 450 - (bounds.minX + bounds.maxX) / 2 * planScale, tz = view === '2d' && drag.current?.plan ? drag.current.plan.tz : 300 - (bounds.minZ + bounds.maxZ) / 2 * planScale;
  const X = (x: number) => x * planScale + tx, Z = (z: number) => z * planScale + tz;
  const surfaces: { points: Point[]; roomId: string; windowId?: string; floor: boolean }[] = [];
  if (view === '3d') {
    rooms.forEach(r => {
      const y = working.floors.findIndex(f => f.id === r.floorId) * 132;
      const p = (x: number, h: number, z: number): Point => [r.x + x, y + h, r.z + z];
      surfaces.push({ roomId: r.id, floor: true, points: [p(0, 0, 0), p(r.width, 0, 0), p(r.width, 0, r.depth), p(0, 0, r.depth)] });
      [[p(0, 0, 0), p(r.width, 0, 0), p(r.width, 108, 0), p(0, 108, 0)], [p(0, 0, r.depth), p(r.width, 0, r.depth), p(r.width, 108, r.depth), p(0, 108, r.depth)], [p(0, 0, 0), p(0, 0, r.depth), p(0, 108, r.depth), p(0, 108, 0)], [p(r.width, 0, 0), p(r.width, 0, r.depth), p(r.width, 108, r.depth), p(r.width, 108, 0)]].forEach(points => surfaces.push({ points, roomId: r.id, floor: false }));
    });
    working.windows.forEach(w => {
      const owner = working.rooms.find(r => r.id === w.roomId);
      if (!owner) return;
      const first = working.floors.findIndex(f => f.id === owner.floorId), last = w.span ? working.floors.findIndex(f => f.id === w.span!.toFloorId) : first;
      const at = working.floors.findIndex(f => f.id === floorId);
      if (floorId !== 'all' && (at < first || at > last)) return;
      glassPoints(working, w).forEach(points => surfaces.push({ points, roomId: w.roomId, windowId: w.id, floor: false }));
    });
  }
  const points = surfaces.flatMap(s => s.points).map(p => projected(p, yaw, pitch));
  const camera = drag.current?.mode === 'resize-glass' && drag.current.camera ? drag.current.camera : points.length ? {
    cx: (Math.min(...points.map(p => p[0])) + Math.max(...points.map(p => p[0]))) / 2,
    cy: (Math.min(...points.map(p => p[1])) + Math.max(...points.map(p => p[1]))) / 2,
    scale: Math.min(760 / Math.max(1, Math.max(...points.map(p => p[0])) - Math.min(...points.map(p => p[0]))), 430 / Math.max(1, Math.max(...points.map(p => p[1])) - Math.min(...points.map(p => p[1])))) * zoom,
  } : { cx: 0, cy: 0, scale: 1 };
  const screen = (p: Point) => { const q = projected(p, yaw, pitch); return [(q[0] - camera.cx) * camera.scale + 450, (q[1] - camera.cy) * camera.scale + 300]; };
  surfaces.sort((a, b) => a.points.reduce((n, p) => n + projected(p, yaw, pitch)[2], 0) / a.points.length - b.points.reduce((n, p) => n + projected(p, yaw, pitch)[2], 0) / b.points.length);
  const activeWindow = working.windows.find(w => w.id === windowId);
  const activeGlass = activeWindow ? glassPoints(working, activeWindow).flat() : [];
  const corner: Point | null = activeGlass.length && activeWindow ? (() => { const axis = activeWindow.wall === 'N' || activeWindow.wall === 'S' ? 0 : 2; const p: Point = [...activeGlass[0]]; p[axis] = Math.max(...activeGlass.map(p => p[axis])); p[1] = Math.max(...activeGlass.map(p => p[1])); return p; })() : null;
  function start(event: React.PointerEvent<SVGSVGElement>) {
    if (pending && !resizing) return;setNotice('');
    const target = (event.target as Element).closest('[data-kind]') as SVGElement | null;
    const kind = target?.dataset.kind;
    if(readOnly && (view==='2d'||kind==='resize-glass')){if(target?.dataset.room)onSelect(target.dataset.room,target.dataset.window);return;}
    if (view === '3d' && kind !== 'resize-glass') {
      if (target?.dataset.room) onSelect(target.dataset.room, target.dataset.window);
      drag.current = { mode: 'rotate', original: project, start: local(event), scale: 1, yaw, pitch, moved: false };
    } else if (kind) {
      const room = project.rooms.find(r => r.id === target!.dataset.room);
      const w = project.windows.find(w => w.id === target!.dataset.window);
      if (room) onSelect(room.id, w?.id);
      drag.current = { mode: kind, original: project, room, window: w, start: local(event), scale: view === '2d' ? planScale : camera.scale, yaw, pitch, camera, plan: view === '2d' ? { tx, tz } : undefined, moved: false };
      if (kind === 'resize-glass') { resizeSource.current=project;setResizing(true); setPending(project); }
    } else return;
    event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault();
  }
  function move(event: React.PointerEvent<SVGSVGElement>) {
    const d = drag.current; if (!d) return;
    const p = local(event), dx = p.x - d.start.x, dy = p.y - d.start.y;
    if (Math.abs(dx) + Math.abs(dy) < 3 && !d.moved) return; d.moved = true;
    if (d.mode === 'rotate') { setYaw(d.yaw + dx * .008); setPitch(Math.max(.15, Math.min(1.15, d.pitch + dy * .005))); return; }
    if (d.mode === 'resize-glass' && d.window) {
      const w = d.window, horizontal = w.wall === 'N' || w.wall === 'S';
      const u = projected(horizontal ? [1, 0, 0] : [0, 0, 1], d.yaw, d.pitch), v = projected([0, 1, 0], d.yaw, d.pitch), det = u[0] * v[1] - u[1] * v[0];
      if (Math.abs(det) < .08) { setNotice('Rotate slightly to see this window face.'); return; }
      const dw = (dx * v[1] - dy * v[0]) / det / d.scale, dh = (u[0] * dy - u[1] * dx) / det / d.scale;
      const columns = w.span ? Array.from({ length: w.span.cols }, (_, c) => Math.max(1, ...w.panes.filter(p => p.col === c).map(p => p.width))) : w.panes.map(p => p.width);
      const rows = w.span ? Array.from({ length: w.span.rows }, (_, r) => Math.max(1, ...w.panes.filter(p => p.row === r).map(p => p.height))) : [Math.max(...w.panes.map(p => p.height))];
      const width = columns.reduce((n, v) => n + v, 0), height = rows.reduce((n, v) => n + v, 0);
      const sx = Math.max(.1, Math.min(5, (width + dw * 2) / width)), sy = Math.max(.1, Math.min(5, (height + dh * (w.span || w.kind === 'sliding' ? 1 : 2)) / height));
      setPending({ ...d.original, windows: d.original.windows.map(a => a.id !== w.id ? a : { ...a, panes: a.panes.map(p => ({ ...p, width: Math.max(.125, Math.min(BUILDING_LIMITS.maxPaneInches, Math.round(p.width * sx * 8) / 8)), height: Math.max(.125, Math.min(BUILDING_LIMITS.maxPaneInches, Math.round(p.height * sy * 8) / 8)), measured: false })) }) });
      return;
    }
    if (!d.room) return;
    if (d.mode === 'window' && d.window) {
      const px = d.start.x + dx, py = d.start.y + dy;
      const x = (px - tx) / d.scale - d.room.x, z = (py - tz) / d.scale - d.room.z;
      const nearest = ([['N', Math.abs(z)], ['S', Math.abs(z - d.room.depth)], ['W', Math.abs(x)], ['E', Math.abs(x - d.room.width)]] as const).reduce((a, b) => a[1] < b[1] ? a : b)[0];
      const pos = nearest === 'N' || nearest === 'S' ? x / d.room.width : z / d.room.depth;
      onChange({ ...d.original, windows: d.original.windows.map(w => w.id !== d.window!.id ? w : { ...w, wall: nearest, position: Math.max(.08, Math.min(.92, pos)) }) });
    } else onChange({ ...d.original, rooms: d.original.rooms.map(r => r.id !== d.room!.id ? r : d.mode === 'room' ? { ...r, x: Math.round((r.x + dx / d.scale) / 6) * 6, z: Math.round((r.z + dy / d.scale) / 6) * 6 } : { ...r, width: d.mode === 'south' ? r.width : Math.max(48, Math.min(BUILDING_LIMITS.maxRoomInches, Math.round((r.width + dx / d.scale) / 6) * 6)), depth: d.mode === 'east' ? r.depth : Math.max(48, Math.min(BUILDING_LIMITS.maxRoomInches, Math.round((r.depth + dy / d.scale) / 6) * 6)) }) });
  }
  function finish(cancel = false) {
    const d = drag.current; drag.current = null;
    if (d?.mode === 'resize-glass') { setResizing(false); if (cancel || !d.moved) setPending(null); }
    else if (cancel && d && d.mode !== 'rotate') onChange(d.original);
  }
  return <section className="relative overflow-hidden rounded-2xl border border-white/15 bg-black/50">
    <div className="flex flex-wrap items-center justify-between gap-3 p-3">
      <div className="flex flex-wrap gap-1">{(view === '3d' ? [{ id: 'all', name: 'All floors' }, ...project.floors] : project.floors).map(f => <button key={f.id} disabled={!!pending} type="button" onClick={() => onFloor(f.id)} className={`rounded-lg border px-3 py-2 text-xs ${floorId === f.id ? selected : ordinary}`}>{f.name}</button>)}</div>
      <div className="flex gap-1">{(['2d', '3d'] as const).map(v => <button type="button" key={v} disabled={!!pending} onClick={() => { setView(v); if (v === '2d' && floorId === 'all') onFloor(project.floors[0].id); setZoom(1); }} className={`rounded-lg border px-3 py-2 text-xs ${view === v ? selected : ordinary}`}>{v === '2d' ? '2D plan' : '3D view'}</button>)}</div>
    </div>
    <svg ref={svg} viewBox="0 0 900 600" role="img" aria-label="Building plan. Choose rooms and windows using the list or drag them in the plan." className={`block min-h-[340px] w-full touch-none select-none ${view === '2d' ? 'bg-[#eff1ea]' : 'bg-[#101510]'}`} onPointerDown={start} onPointerMove={move} onPointerUp={() => finish()} onPointerCancel={() => finish(true)} onKeyDown={e => { if (e.key === 'Escape') finish(true); }} tabIndex={0}>
      {view === '2d' ? <>
        <defs><pattern id="building-plan-grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="#d8ddd4" strokeWidth=".6" /></pattern></defs><rect width="900" height="600" fill="url(#building-plan-grid)" />
        {rooms.map(r => <g key={r.id}>
          <rect data-kind="room" data-room={r.id} x={X(r.x)} y={Z(r.z)} width={r.width * planScale} height={r.depth * planScale} fill={roomId === r.id ? '#fff7df' : '#fffefa'} stroke={roomId === r.id ? '#b08a2a' : '#657165'} strokeWidth="6" className="cursor-move" />
          <text x={X(r.x + r.width / 2)} y={Z(r.z + r.depth / 2)} textAnchor="middle" fill="#354039" fontSize="17" pointerEvents="none">{r.name}</text>
          {working.windows.filter(w => w.roomId === r.id).map(w => {
            const h = w.wall === 'N' || w.wall === 'S', length = h ? r.width : r.depth;
            const raw = w.span ? Array.from({ length: w.span.cols }, (_, col) => Math.max(...w.panes.filter(p => p.col === col).map(p => p.width), 1)).reduce((a, b) => a + b, 0) : w.panes.reduce((n, p) => n + p.width, 0);
            const width = Math.min(raw, length * .82), start = Math.max(4, Math.min(length - width - 4, length * w.position - width / 2));
            return <rect key={w.id} data-kind="window" data-window={w.id} data-room={r.id} x={h ? X(r.x + start) : X(r.x + (w.wall === 'E' ? r.width : 0)) - 5} y={h ? Z(r.z + (w.wall === 'S' ? r.depth : 0)) - 5 : Z(r.z + start)} width={h ? width * planScale : 10} height={h ? 10 : width * planScale} fill={windowId === w.id ? '#e2b137' : '#6aa8b6'} stroke="#315762" strokeWidth="1.5" className="cursor-grab"><title>{w.label}{w.span ? ' · Tall glass' : ''}</title></rect>;
          })}
          {!readOnly && r.id === roomId && [['east', X(r.x + r.width), Z(r.z + r.depth / 2)], ['south', X(r.x + r.width / 2), Z(r.z + r.depth)], ['corner', X(r.x + r.width), Z(r.z + r.depth)]].map(([kind, x, y]) => <rect key={kind} data-kind={kind} data-room={r.id} x={Number(x) - 8} y={Number(y) - 8} width="16" height="16" rx="3" fill="#d4a017" stroke="white" strokeWidth="2" className="cursor-nwse-resize" />)}
        </g>)}
        {working.windows.filter(w => w.span && working.rooms.find(r => r.id === w.roomId)?.floorId !== floorId && w.span.toFloorId === floorId).map(w => <text key={w.id} x="35" y={45 + working.windows.indexOf(w) * 22} fontSize="13" fill="#315762" onPointerDown={e => { e.stopPropagation(); onSelect(w.roomId, w.id); }}>{w.label} · linked from lower floor</text>)}
      </> : <>
        {surfaces.map((s, i) => <polygon key={i} points={s.points.map(p => screen(p).join(',')).join(' ')} data-kind={s.windowId ? 'window' : s.floor ? 'room' : undefined} data-room={s.roomId} data-window={s.windowId} pointerEvents={s.windowId || s.floor ? 'auto' : 'none'} fill={s.windowId ? s.windowId === windowId ? '#e5b53d' : '#6aa9bc' : s.floor ? '#38463a' : '#a7b49f'} fillOpacity={s.windowId ? .85 : s.floor ? .9 : .16} stroke={s.windowId ? '#cce8e9' : '#91a48e'} strokeWidth={s.windowId === windowId ? 2.5 : 1} />)}
        {!readOnly && corner && activeWindow && activeWindow.kind !== 'custom' && !activeWindow.panes.some(p => p.shape === 'custom') && <circle data-kind="resize-glass" data-window={activeWindow.id} data-room={activeWindow.roomId} cx={screen(corner)[0]} cy={screen(corner)[1]} r="11" fill="#d4a017" stroke="white" strokeWidth="3" className="cursor-nwse-resize"><title>Resize whole window</title></circle>}
      </>}
      {!rooms.length && <text x="450" y="295" textAnchor="middle" fill={view === '2d' ? '#536052' : '#ddd'} fontSize="19">Add a room to start</text>}
    </svg>
    <div className="flex items-center justify-between gap-2 px-4 py-3 text-xs text-white/50"><span>{notice || (view === '2d' ? 'Drag rooms and windows · Pull gold handles' : 'Drag to rotate · Gold corner resizes selected window')}</span><div className="flex gap-2"><button type="button" disabled={!!pending} aria-label="Zoom out" onClick={() => setZoom(z => Math.max(.5, z - .15))}>−</button><button type="button" disabled={!!pending} aria-label="Zoom in" onClick={() => setZoom(z => Math.min(2, z + .15))}>+</button><button type="button" disabled={!!pending} onClick={() => { setYaw(-.62); setPitch(.5); setZoom(1); setNotice(''); }}>Reset</button></div></div>
    {pending && !resizing && <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 p-5"><div role="dialog" onKeyDown={e => {if(e.key==='Escape')setPending(null);}} aria-modal="true" aria-labelledby="building-resize-title" className="max-w-sm rounded-2xl border border-gold-400/30 bg-obsidian-950 p-6"><h3 id="building-resize-title" className="text-lg font-semibold text-white">Use this approximate size?</h3><p className="mt-2 text-sm text-white/60">All panes in this window will need their measurements checked again.</p><div className="mt-5 flex gap-3"><button type="button" className="rounded-lg bg-gold-400 px-4 py-2 text-black" autoFocus onClick={() => { if(project!==resizeSource.current){setNotice('The project changed. Resize again.');setPending(null);return;} onChange(pending); setPending(null); }}>Use size</button><button type="button" className="px-4 py-2 text-white/70" onClick={() => setPending(null)}>Cancel</button></div></div></div>}
  </section>;
}
