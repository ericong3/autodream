// Building tint project logic. Node 23.6+ strips the TS types on import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILDING_FILMS, createBuildingProject, paneArea, windowArea, projectArea, measurementIssues,
  validateBuildingProject, updateBuildingPane, duplicateBuildingWindow, removeBuildingRoom,
  removeBuildingWindow, saveBuildingVersion, canEditBuildingProject, resizeBuildingPanels,
} from '../src/utils/garageBuilding.ts';

function withWindows() {
  const doc = createBuildingProject('u1');
  const [l1, l2] = doc.floors;
  doc.rooms.push({ id: 'r1', floorId: l1.id, name: 'Living', width: 240, depth: 180, x: 0, z: 0 });
  doc.rooms.push({ id: 'r2', floorId: l2.id, name: 'Study', width: 144, depth: 144, x: 0, z: 0 });
  doc.windows.push({ id: 'w1', roomId: 'r1', label: 'Front', kind: 'window', wall: 'S', position: 0.5, film: 'classic',
    panes: [{ id: 'p1', width: 24, height: 60, measured: true, shape: 'rect' }, { id: 'p2', width: 30, height: 60, measured: true, shape: 'rect' }] });
  doc.windows.push({ id: 'w2', roomId: 'r1', label: 'Tall', kind: 'custom', wall: 'N', position: 0.5, film: 'royal',
    span: { toFloorId: l2.id, rows: 2, cols: 1, bottom: 0 },
    panes: [{ id: 't1', width: 72, height: 120, measured: true, shape: 'rect', row: 0, col: 0 }, { id: 't2', width: 72, height: 120, measured: false, shape: 'rect', row: 1, col: 0 }] });
  assert.deepEqual(validateBuildingProject(doc), []);
  return doc;
}

test('new project is a real empty entry with L1 and L2', () => {
  const doc = createBuildingProject('u1');
  assert.equal(doc.ownerId, 'u1');
  assert.deepEqual(doc.floors.map(f => f.name), ['L1', 'L2']);
  assert.equal(doc.customerName, '');
  assert.deepEqual([doc.rooms, doc.windows, doc.versions], [[], [], []]);
  assert.equal(doc.revision, 0);
  assert.deepEqual(validateBuildingProject(doc), []);
  assert.throws(() => createBuildingProject(''));
});

test('films are the real Garage tint series', () => {
  assert.deepEqual(BUILDING_FILMS.map(f => f.key).sort(), ['classic', 'eco', 'lite', 'majestic', 'royal', 'unique']);
});

test('areas in sqft; custom uses verified area; tall glass counted once', () => {
  assert.equal(paneArea({ id: 'a', width: 12, height: 12, measured: true, shape: 'rect' }), 1);
  assert.equal(paneArea({ id: 'a', width: 12, height: 12, measured: true, shape: 'custom', verifiedArea: 0.5 }), 0.5);
  const doc = withWindows();
  assert.equal(windowArea(doc.windows[0]), (24 * 60 + 30 * 60) / 144);
  assert.equal(projectArea(doc), (24 * 60 + 30 * 60 + 2 * 72 * 120) / 144);
  assert.deepEqual(measurementIssues({ id: 'a', width: 1, height: 1, measured: true, shape: 'custom' }).length, 2);
});

test('validation rejects bad refs, dims, IC numbers and unknown fields; allows blank customer', () => {
  const doc = withWindows();
  assert.deepEqual(validateBuildingProject({ ...doc, customerName: '', address: '' }), []);
  const bad = structuredClone(doc); bad.windows[0].roomId = 'nope';
  assert.ok(validateBuildingProject(bad).length);
  const nan = structuredClone(doc); nan.windows[0].panes[0].width = NaN;
  assert.ok(validateBuildingProject(nan).length);
  const dup = structuredClone(doc); dup.windows[1].panes[0].id = 'p1';
  assert.ok(validateBuildingProject(dup).length);
  assert.ok(validateBuildingProject({ ...doc, customerId: '900101-14-5678' }).length);
  assert.ok(validateBuildingProject({ ...doc, ic: 'x' }).length);
  const film = structuredClone(doc); film.windows[0].film = 'Demo Series A';
  assert.ok(validateBuildingProject(film).length);
  const span = structuredClone(doc); span.windows[1].span.toFloorId = doc.floors[0].id;
  assert.ok(validateBuildingProject(span).length);
});

test('changing a size unchecks unless the patch confirms measured', () => {
  const doc = withWindows();
  const a = updateBuildingPane(doc, 'w1', 'p1', { width: 25 });
  assert.equal(a.windows[0].panes[0].measured, false);
  assert.equal(doc.windows[0].panes[0].width, 24, 'input not mutated');
  const b = updateBuildingPane(doc, 'w1', 'p1', { width: 25, measured: true });
  assert.equal(b.windows[0].panes[0].measured, true);
  const c = updateBuildingPane(doc, 'w1', 'p1', { note: 'cracked corner' });
  assert.equal(c.windows[0].panes[0].measured, true, 'note alone keeps check');
  const set = updateBuildingPane(doc, 'w1', 'p1', { width: 20, height: 50 }, true);
  assert.deepEqual(set.windows[0].panes.map(p => [p.width, p.height, p.measured]), [[20, 50, false], [20, 50, false]]);
  assert.throws(() => updateBuildingPane(doc, 'w1', 'p1', { width: -1 }));
  const custom = updateBuildingPane(doc, 'w1', 'p1', { shape: 'custom', verifiedArea: 9 });
  assert.throws(() => updateBuildingPane(custom, 'w1', 'p2', { width: 10 }, true), /individually/);
});

test('duplicate keeps unequal sizes, film and span; fresh ids; unchecked', () => {
  let doc = withWindows();
  doc = updateBuildingPane(doc, 'w1', 'p2', { shape: 'custom', verifiedArea: 10, photoReference: 'visit 1', measured: true });
  const next = duplicateBuildingWindow(doc, 'w1', 'r1', 'E');
  const copy = next.windows.at(-1);
  assert.deepEqual(copy.panes.map(p => p.width), [24, 30]);
  assert.equal(copy.film, 'classic');
  assert.ok(copy.panes.every(p => p.measured === false && p.verifiedArea === undefined && !['p1', 'p2'].includes(p.id)));
  const tall = duplicateBuildingWindow(doc, 'w2', 'r1', 'W').windows.at(-1);
  assert.deepEqual(tall.span.rows, 2);
  assert.throws(() => duplicateBuildingWindow(doc, 'w2', 'r2', 'W'), /same base floor/);
});

test('remove room drops its windows; remove window', () => {
  const doc = withWindows();
  assert.equal(removeBuildingRoom(doc, 'r1').windows.length, 0);
  assert.equal(removeBuildingWindow(doc, 'w1').windows.length, 1);
  assert.throws(() => removeBuildingWindow(doc, 'zz'));
});

test('resize keeps surviving panes, new ones unchecked, limits enforced', () => {
  const doc = withWindows();
  const more = resizeBuildingPanels(doc, 'w1', 4, 20, 40);
  const panes = more.windows[0].panes;
  assert.deepEqual(panes.slice(0, 2).map(p => [p.id, p.width, p.measured]), [['p1', 24, true], ['p2', 30, true]]);
  assert.ok(panes.slice(2).every(p => p.measured === false && p.shape === 'rect' && p.width === 20));
  assert.equal(new Set(panes.map(p => p.id)).size, 4);
  assert.equal(resizeBuildingPanels(doc, 'w1', 1, 20, 40).windows[0].panes[0].id, 'p1');
  assert.throws(() => resizeBuildingPanels(doc, 'w1', 25, 20, 40));
  const grid = resizeBuildingPanels(doc, 'w2', { rows: 2, cols: 2 }, 60, 100).windows[1];
  assert.equal(grid.panes.length, 4);
  assert.equal(grid.panes.find(p => p.row === 0 && p.col === 0).id, 't1');
  assert.throws(() => resizeBuildingPanels(doc, 'w2', { rows: 5, cols: 1 }, 60, 100));
  assert.throws(() => resizeBuildingPanels(doc, 'w2', 3, 60, 100));
});

test('versions capture scope and unchecked count, no pricing, need windows', () => {
  const doc = { ...withWindows(), customerName: 'Tan', address: 'Jalan 1' };
  const v = saveBuildingVersion(doc, ' site visit ').versions[0];
  assert.equal(v.number, 1);
  assert.equal(v.note, 'site visit');
  assert.equal(v.unchecked, 1);
  assert.equal(v.customerName, 'Tan');
  assert.equal(v.sqft, Math.round(projectArea(doc) * 100) / 100);
  assert.ok(!('price' in v) && !('total' in v));
  assert.throws(() => saveBuildingVersion(createBuildingProject('u1'), ''), /at least one window/);
  const two = saveBuildingVersion(saveBuildingVersion(doc, 'a'), 'b');
  assert.deepEqual(two.versions.map(x => x.number), [1, 2]);
});

test('edit permission: owner salesman or manager, with Garage access', () => {
  const p = { ownerId: 'u1' };
  assert.ok(canEditBuildingProject(p, { id: 'u1', role: 'garage_salesman', businessAccess: 'garage' }));
  assert.ok(!canEditBuildingProject(p, { id: 'u2', role: 'garage_salesman', businessAccess: 'garage' }));
  assert.ok(canEditBuildingProject(p, { id: 'u9', role: 'garage_head', businessAccess: 'garage' }));
  assert.ok(canEditBuildingProject(p, { id: 'u9', role: 'director', businessAccess: 'both' }));
  assert.ok(!canEditBuildingProject(p, { id: 'u9', role: 'director', businessAccess: 'used_car' }));
  assert.ok(!canEditBuildingProject(p, { id: 'u1', role: 'garage_installer', businessAccess: 'garage' }));
  assert.ok(!canEditBuildingProject(p, null));
});

test('custom glass never guesses area from its bounding rectangle',()=>{const pane={id:'custom',width:60,height:60,shape:'custom',measured:true};assert.equal(paneArea(pane),0);assert.ok(measurementIssues(pane).includes('Photo reference missing'));assert.equal(paneArea({...pane,verifiedArea:12}),12);assert.equal(measurementIssues({...pane,verifiedArea:12,photoReference:'Site photo A'}).length,0);});
test('new panes in a custom window remain custom and need their own verification',()=>{const doc=withWindows();doc.windows[0].kind='custom';const next=resizeBuildingPanels(doc,'w1',3,24,60),pane=next.windows[0].panes[2];assert.equal(pane.shape,'custom');assert.equal(paneArea(pane),0);assert.ok(measurementIssues(pane).includes('Photo reference missing'));});
test('clearing a custom area keeps a valid unfinished draft and zero area',()=>{const doc=withWindows();const custom=updateBuildingPane(doc,'w1','p1',{shape:'custom',verifiedArea:4});const next=updateBuildingPane(custom,'w1','p1',{verifiedArea:undefined});assert.equal(paneArea(next.windows[0].panes[0]),0);assert.deepEqual(validateBuildingProject(next),[]);});
