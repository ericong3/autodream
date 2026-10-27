import {useId} from 'react';
export type CarGlassPiece={id:string;glassPosition:string;installerId?:string|null;status:string;needsCorrection?:boolean};
const panes=[
 {position:'front_windscreen',name:'Front windscreen',path:'M137 155 Q200 139 263 155 L253 211 Q200 201 147 211 Z',x:200,y:179},
 {position:'front_left_window',name:'Front left window',path:'M130 220 L140 224 L140 306 L106 306 L110 264 Z',x:121,y:270},
 {position:'front_right_window',name:'Front right window',path:'M270 220 L260 224 L260 306 L294 306 L290 264 Z',x:279,y:270},
 {position:'rear_left_window',name:'Rear left window',path:'M106 316 L140 316 L140 384 L119 398 L108 364 Z',x:122,y:352},
 {position:'rear_right_window',name:'Rear right window',path:'M294 316 L260 316 L260 384 L281 398 L292 364 Z',x:278,y:352},
 {position:'rear_windscreen',name:'Rear windscreen',path:'M147 400 Q200 409 253 400 L265 449 Q200 469 135 449 Z',x:200,y:433},
 {position:'rear_left_panel_window',name:'Rear left quarter glass',path:'M122 406 L140 397 L133 440 L126 433 Z',x:130,y:418},
 {position:'rear_right_panel_window',name:'Rear right quarter glass',path:'M278 406 L260 397 L267 440 L274 433 Z',x:270,y:418},
];
export const carGlassNames=Object.fromEntries(panes.map(p=>[p.position,p.name]));
export default function GarageCarGlassMap({items,currentUserId,selectedIds=[],onSelect}:{items:CarGlassPiece[];currentUserId?:string;selectedIds?:string[];onSelect:(id:string)=>void}){
 const uid=useId().replace(/:/g,'');
 return <svg className="car-glass-map" viewBox="0 0 400 550" role="group" aria-label="Car glass blueprint, viewed from above">
  <defs><linearGradient id={uid+'body'} x1="0" x2="1"><stop stopColor="#151719"/><stop offset=".48" stopColor="#242629"/><stop offset="1" stopColor="#101214"/></linearGradient><linearGradient id={uid+'glass'} x2=".4" y2="1"><stop stopColor="#53616b" stopOpacity=".28"/><stop offset="1" stopColor="#141b20" stopOpacity=".8"/></linearGradient></defs>
  <path d="M200 18 v19 m-5-5 5 5 5-5" stroke="#6b7178" strokeWidth="1.5" fill="none"/><text x="200" y="12" textAnchor="middle" fill="#8a8e93" fontSize="10">Front of car</text>
  <g fill="#08090a" stroke="#363a3f"><rect x="83" y="150" width="25" height="67" rx="9"/><rect x="292" y="150" width="25" height="67" rx="9"/><rect x="83" y="406" width="25" height="65" rx="9"/><rect x="292" y="406" width="25" height="65" rx="9"/></g>
  <path d="M143 60 Q200 45 257 60 Q287 73 297 120 L307 210 L307 431 Q303 485 277 507 Q200 531 123 507 Q97 485 93 431 L93 210 L103 120 Q113 73 143 60 Z" fill={'url(#'+uid+'body)'} stroke="#60656b" strokeWidth="1.4"/>
  <path d="M143 72 Q200 59 257 72 Q278 87 284 119 L282 145 Q200 122 118 145 L116 119 Q122 87 143 72 Z M119 468 Q200 488 281 468 L272 495 Q200 515 128 495 Z" fill="none" stroke="#484c51"/>
  <path d="M151 226 Q200 215 249 226 L249 383 Q200 395 151 383 Z" fill="#17191b" stroke="#41464c"/><path d="M161 239 Q200 232 239 239 M161 370 Q200 378 239 370" fill="none" stroke="#30353b"/>
  <g stroke="#62676d" fill="#151719"><path d="M99 218 L75 229 L75 239 L99 235 Z"/><path d="M301 218 L325 229 L325 239 L301 235 Z"/></g>
  <path d="M100 310 H143 M257 310 H300 M101 390 L117 406 M283 406 L299 390" stroke="#4b5057" strokeWidth="1"/>
  {panes.map(p=>{const item=items.find(i=>i.glassPosition===p.position),selected=!!item&&selectedIds.includes(item.id),mine=item?.installerId===currentUserId,done=item?.status==='installed',other=!!item?.installerId&&!mine;const state=!item?'excluded':item.needsCorrection?'correction':done?'done':mine?'mine':other?'other':'available';const status=!item?'Not in this order':item.needsCorrection?'Needs correction':done?'Completed':mine?'Yours':other?'Taken by another installer':'Available';return <g key={p.position} data-glass-id={item?.id} aria-hidden={!item||undefined} role="button" aria-label={p.name+' — '+status} aria-pressed={selected} aria-disabled={!item} tabIndex={item?0:-1} className={'glass-pane glass-'+state+(selected?' glass-selected':'')} onClick={()=>item&&onSelect(item.id)} onKeyDown={e=>{if(item&&(e.key==='Enter'||e.key===' ')){e.preventDefault();onSelect(item.id);}}}>
   <title>{p.name+' — '+status}</title>{item&&<path d={p.path} fill="transparent" stroke="transparent" strokeWidth="20"/>}<path d={p.path} fill={'url(#'+uid+'glass)'} className="glass-surface"/>{item&&<text x={p.x} y={p.y+4} textAnchor="middle" className="glass-symbol" aria-hidden="true">{done?'✓':item.needsCorrection?'!':mine?'•':other?'−':'+'}</text>}
  </g>;})}
  <text x="200" y="289" textAnchor="middle" fill="#72777d" fontSize="13">Tap a glass</text><text x="200" y="308" textAnchor="middle" fill="#4f555c" fontSize="10">Top view</text>
 </svg>;
}
