// Window actions built on BuildingLogic reducer actions, so the signed-quote guard and workflow rules stay in one place.
const WALLS=['N','E','S','W'],WALL_NAMES={N:'Back',E:'Right',S:'Front',W:'Left'};
const KIND_LETTER={window:'W',sliding:'S',custom:'C'};
// Only geometry and description travel with a copy. Progress, photos, verified areas and measurement checks never do.
const COPY_FIELDS=['w','h','shape','note'],SPAN_FIELDS=['row','col'];
const positive=v=>typeof v==='number'&&Number.isFinite(v)&&v>0;
const escapeRe=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export const wallName=w=>WALL_NAMES[w]||w;

// Highest number ever used for this room/kind prefix, across live windows, saved quote versions,
// audit text, pieces and any other record, plus a persistent counter that survives audit trimming.
function nextWindowNumber(state,prefix){
 const pattern=new RegExp('(?<![\\w-])'+escapeRe(prefix)+'(\\d+)(?!\\d)','g');let max=Number(state.seq?.['win:'+prefix])||0;
 for(const m of JSON.stringify(state).matchAll(pattern))max=Math.max(max,Number(m[1]));
 return max+1;
}
function everUsed(state,id){return new RegExp('(?<![\\w-])'+escapeRe(id)+'(?![\\d])').test(JSON.stringify(state));}

// Spread copies along the wall: pick the spot farthest from other windows on that wall, preferring the middle.
export function copyPosition(state,roomId,wall){
 const taken=state.assemblies.filter(a=>a.roomId===roomId&&a.wall===wall).map(a=>a.pos);let best=.5,score=-1;
 for(let i=2;i<=18;i++){const pos=i/20,gap=taken.length?Math.min(...taken.map(t=>Math.abs(t-pos))):1,rank=gap-Math.abs(pos-.5)*.001;if(rank>score){score=rank;best=pos;}}
 return best;
}

export function copyRooms(state,source){return source?.span?state.rooms.filter(r=>r.floorId===source.span.from):state.rooms;}

// Copies measurements into a fresh draft window. The source state is never mutated; failure throws before anything is returned.
export function duplicateWindow(BL,state,id,roomId,wall,actor='alex'){
 const source=state.assemblies.find(a=>a.id===id),room=state.rooms.find(r=>r.id===roomId);
 if(!source||!room)throw Error('Choose a window and destination room.');
 if(!WALLS.includes(wall))throw Error('Choose a wall.');
 if(!source.panels.length)throw Error('This window has no panes to copy.');
 if(source.panels.some(p=>!positive(p.w)||!positive(p.h)))throw Error('Fix the pane sizes before copying this window.');
 if(source.span){
  if(source.span.from!==room.floorId)throw Error('Tall glass copies must start on the same floor ('+source.span.from+').');
  const cells=source.panels.map(p=>p.row+':'+p.col);
  if(source.panels.some(p=>!Number.isInteger(p.row)||!Number.isInteger(p.col)||p.row<0||p.col<0||p.row>=source.span.rows||p.col>=source.span.cols)||new Set(cells).size!==cells.length)throw Error('This tall window has unplaced panes. Fix its grid before copying.');
 }
 const result=BL.apply(state,{type:'ADD_ASSEMBLY',actor,roomId,kind:source.kind,label:source.label+' copy',count:source.panels.length,w:source.panels[0].w,h:source.panels[0].h,series:source.series,wall,pos:copyPosition(state,roomId,wall)});
 if(!result.ok)throw Error(result.error);
 const next=result.state,copy=next.assemblies.find(a=>a.id===result.result.assemblyId),given=copy.id;
 // The reducer reuses the lowest free number; move the copy to a number that has never appeared anywhere.
 const prefix=room.id+'-'+(KIND_LETTER[copy.kind]||'W');let n=nextWindowNumber(state,prefix),fresh=prefix+n;
 while(everUsed(state,fresh)||next.assemblies.some(a=>a!==copy&&a.id===fresh))fresh=prefix+(++n);
 next.seq['win:'+prefix]=n;copy.id=fresh;
 copy.panels=copy.panels.map((p,i)=>{
  const old=source.panels[i],pane={id:fresh+'-'+(i+1),shape:'rect'};
  for(const key of COPY_FIELDS)if(old[key]!==undefined)pane[key]=structuredClone(old[key]);
  if(source.span)for(const key of SPAN_FIELDS)pane[key]=old[key];
  if(pane.shape==='custom'){pane.verifiedSqft=0;pane.photo='';}
  pane.measured=false;// a new opening has to be measured on site
  return pane;
 });
 if(source.span)copy.span=structuredClone(source.span);
 if(next.audit[0]?.text?.includes(given))next.audit[0].text=next.audit[0].text.replace(given,fresh)+' · copied from '+source.id;
 return {state:next,assembly:copy};
}

export function removalSummary(BL,state,id){
 const a=state.assemblies.find(x=>x.id===id);if(!a)throw Error('Window not found.');
 const room=state.rooms.find(r=>r.id===a.roomId);
 return {id:a.id,label:a.label,room:room?.name||a.roomId,wall:wallName(a.wall),panes:a.panels.length,sqft:BL.quoteSqft(state,x=>x.asm.id===a.id),span:a.span?a.span.from+' → '+a.span.to:null};
}
export function removalMessage(summary){
 return 'Delete '+summary.label+' '+summary.id+'?\n\n'+summary.room+' · '+summary.wall+' wall\n'+summary.panes+' '+(summary.panes===1?'pane':'panes')+' · '+summary.sqft+' sqft'+(summary.span?'\nTall glass spanning '+summary.span+' (removed from every floor)':'')+'\n\nThis removes it from the quote. You can undo until the sketch changes.';
}

// Measurement checks are stored per pane: true checked, false approximate, undefined legacy (not yet checked).
export function allMeasured(panes){return panes.length>0&&panes.every(p=>p.measured===true);}
export function setMeasured(state,panelIds,measured,note){
 const next=structuredClone(state),ids=new Set(panelIds);let changed=0;
 for(const a of next.assemblies)for(const p of a.panels)if(ids.has(p.id)&&p.measured!==measured){p.measured=measured;changed++;}
 if(changed){next.quote.dirty=true;next.audit.unshift({at:new Date().toISOString(),by:'alex',role:'salesman',text:note||((measured?'Measurements checked · ':'Marked approximate · ')+changed+' pane(s)')});}
 return next;
}

export function paneIssues(p){
 const issues=[];
 if(!positive(p.w)||!positive(p.h))issues.push({code:'size',text:'Missing size'});
 if(p.shape==='custom'){if(!(p.verifiedSqft>0))issues.push({code:'area',text:'Custom area missing'});if(!String(p.photo??'').trim())issues.push({code:'photo',text:'Photo missing'});}
 if(p.measured===false)issues.push({code:'approx',text:'Approximate size'});
 else if(p.measured!==true)issues.push({code:'check',text:'Check size'});
 return issues;
}

// Room-grouped measurement summary. Areas come from BL.quoteSqft so tall glass counts once, under its base room.
export function buildReadiness(BL,state){
 const groups=state.rooms.map(r=>({roomId:r.id,name:r.name,floorId:r.floorId,floor:state.floors.find(f=>f.id===r.floorId)?.name||r.floorId,windows:[]}));
 const orphan={roomId:null,name:'Unassigned glass',floorId:null,floor:'',windows:[]};
 for(const a of state.assemblies){
  const panes=a.panels.map(p=>({id:p.id,issues:paneIssues(p)})),attention=panes.filter(p=>p.issues.length);
  const tally={};for(const p of panes)for(const i of p.issues)tally[i.text]=(tally[i.text]||0)+1;
  (groups.find(g=>g.roomId===a.roomId)||orphan).windows.push({assemblyId:a.id,label:a.label,wall:wallName(a.wall),firstPanelId:a.panels[0]?.id||null,attentionPanelId:attention[0]?.id||a.panels[0]?.id||null,panes:a.panels.length,sqft:BL.quoteSqft(state,x=>x.asm.id===a.id),span:a.span?a.span.from+' → '+a.span.to:null,attention:attention.length,issues:Object.entries(tally).map(([text,count])=>({text,count}))});
 }
 const rooms=[...groups,...(orphan.windows.length?[orphan]:[])].map(g=>({...g,sqft:g.roomId?BL.quoteSqft(state,x=>x.asm.roomId===g.roomId):BL.round2(g.windows.reduce((n,w)=>n+w.sqft,0)),attention:g.windows.reduce((n,w)=>n+w.attention,0),panes:g.windows.reduce((n,w)=>n+w.panes,0)}));
 const panes=rooms.reduce((n,r)=>n+r.panes,0),attention=rooms.reduce((n,r)=>n+r.attention,0);
 return {rooms,panes,attention,checked:panes-attention,sqft:BL.quoteSqft(state),allChecked:panes>0&&attention===0};
}
