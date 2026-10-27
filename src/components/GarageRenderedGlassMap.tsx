import {useId} from 'react';
import type {CarGlassPiece} from './GarageCarGlassMap';
export type VehicleGlassBody='sedan'|'coupe'|'mpv'|'suv'|'van'|'bus';
export const renderedGlassNames:Record<string,string>={extra_rear_2pc:'Extra rear glass',small_window:'Small window',front_windscreen:'Front windscreen',front_left_window:'Front left door glass',front_right_window:'Front right door glass',rear_left_window:'Rear left door glass',rear_right_window:'Rear right door glass',rear_left_panel_window:'Left quarter glass',rear_right_panel_window:'Right quarter glass',rear_windscreen:'Rear windscreen',front_roof_glass:'Front roof glass',rear_roof_glass:'Rear roof glass',panoramic_roof_glass:'Panoramic roof glass'};
export const vehicleBodyNames:Record<VehicleGlassBody,string>={sedan:'Sedan',coupe:'Two-door coupe',mpv:'MPV',suv:'SUV',van:'Van',bus:'Bus'};
export function glassName(body:VehicleGlassBody,position:string){const side=position.includes('_left_')?'Left':'Right';if(position.startsWith('side_'))return side+' side window '+position.split('_').pop();if((body==='mpv'||body==='van')&&['rear_left_window','rear_right_window'].includes(position))return side+' sliding-door glass';if((body==='van'||body==='bus')&&['front_left_window','front_right_window'].includes(position))return side+' cab glass';return renderedGlassNames[position]??position;}
type Shape={position:string;path:string;x:number;y:number;anchor?:[number,number];inner?:boolean};
function shapes(body:VehicleGlassBody,sideRows:number):Shape[]{
 const roofShapes:Shape[]=[{position:'front_roof_glass',path:'M310 420 L458 420 L458 452 L310 452 Z',x:384,y:436,inner:true},{position:'rear_roof_glass',path:'M310 472 L458 472 L458 504 L310 504 Z',x:384,y:488,inner:true},{position:'panoramic_roof_glass',path:'M310 420 L458 420 L458 504 L310 504 Z',x:384,y:462,inner:true}];
 if(body==='bus'||body==='van'){const end=Math.max(720,430+sideRows*110),step=sideRows?(end-420)/sideRows:110;const left:Shape[]=[{position:'front_left_window',path:'M55 285 L177 264 L177 367 L55 389 Z',x:116,y:329,anchor:[275,325]},...Array.from({length:sideRows},(_,i)=>{const y=420+i*step;return {position:'side_left_'+(i+1),path:`M55 ${y} L177 ${y} L177 ${y+step-18} L55 ${y+step-18} Z`,x:116,y:y+(step-18)/2,anchor:[275,y+(step-18)/2] as [number,number]};})];return [{position:'front_windscreen',path:'M285 260 L483 260 L483 325 L285 325 Z',x:384,y:292,inner:true},...left,...left.map(p=>({...p,position:p.position.replace('_left_','_right_'),x:768-p.x,anchor:[768-p.anchor![0],p.anchor![1]] as [number,number]})),{position:'rear_windscreen',path:`M285 ${end+12} L483 ${end+12} L483 ${end+54} L285 ${end+54} Z`,x:384,y:end+33,inner:true},...(body==='van'?roofShapes:[])];}

 if(body==='mpv'||body==='suv'){const left:Shape[]=[{position:'front_left_window',path:'M55 310 Q110 265 180 250 L178 374 L53 403 Z',x:118,y:332,anchor:[267,355]},{position:'rear_left_window',path:'M53 443 L178 414 L178 562 L53 593 Z',x:118,y:506,anchor:[267,491]},{position:'rear_left_panel_window',path:'M54 635 L178 605 L178 714 L57 741 Z',x:118,y:675,anchor:[267,648]}];return [{position:'front_windscreen',path:body==='suv'?'M283 341 Q384 318 485 341 L478 402 Q384 389 290 402 Z':'M279 288 Q384 272 489 288 L481 365 Q384 353 287 365 Z',x:384,y:body==='suv'?368:325,inner:true},...left,...left.map(p=>({...p,position:p.position.replace('_left_','_right_'),x:768-p.x,anchor:[768-p.anchor![0],p.anchor![1]] as [number,number]})),{position:'rear_windscreen',path:body==='suv'?'M290 672 Q384 659 478 672 L478 714 Q384 728 290 714 Z':'M286 716 Q384 725 482 716 L482 759 Q384 778 286 759 Z',x:384,y:body==='suv'?695:746,inner:true},{position:'front_roof_glass',path:'M299 445 L469 445 L469 490 L299 490 Z',x:384,y:467,inner:true},{position:'rear_roof_glass',path:'M299 545 L469 545 L469 605 L299 605 Z',x:384,y:575,inner:true},{position:'panoramic_roof_glass',path:'M299 445 L469 445 L469 605 L299 605 Z',x:384,y:525,inner:true}];}
 const front:Shape={position:'front_windscreen',path:body==='sedan'?'M278 317 Q384 282 490 317 L476 389 Q384 371 291 389 Z':'M280 325 Q384 290 488 325 L475 395 Q384 379 294 395 Z',x:384,y:348,inner:true};
 const rear:Shape={position:'rear_windscreen',path:body==='sedan'?'M290 563 Q384 553 479 563 L484 638 Q384 672 284 638 Z':'M295 525 Q384 538 478 525 L484 628 Q384 670 288 628 Z',x:384,y:609,inner:true};
 const left:Shape[]=body==='sedan'?[
  {position:'front_left_window',path:'M54 331 Q99 263 182 237 L174 373 Q104 392 49 428 Z',x:118,y:344,anchor:[264,414]},
  {position:'rear_left_window',path:'M56 483 L174 424 L170 568 L53 631 Z',x:117,y:526,anchor:[267,520]},
  {position:'rear_left_panel_window',path:'M96 696 L165 624 L160 709 L87 748 Z',x:134,y:695,anchor:[269,593]},
 ]:[
  {position:'front_left_window',path:'M47 391 Q88 312 184 264 L172 496 Q113 530 43 592 Z',x:117,y:442,anchor:[264,429]},
  {position:'rear_left_panel_window',path:'M89 657 L164 571 L160 671 L86 713 Z',x:132,y:653,anchor:[269,533]},
 ];
 return [front,...left,...left.map(p=>({...p,position:p.position.replace('_left_','_right_'),path:p.path,x:768-p.x,anchor:p.anchor?[768-p.anchor[0],p.anchor[1]] as [number,number]:undefined})),rear,...roofShapes];
}
export default function GarageRenderedGlassMap({items,body,artwork,currentUserId,selectedIds=[],sideRows=3,onSelect}:{items:CarGlassPiece[];body:VehicleGlassBody;artwork:string;currentUserId?:string;selectedIds?:string[];sideRows?:number;onSelect:(id:string)=>void}){
 const id=useId().replace(/:/g,'');
 const longBody=body==='van'||body==='bus',end=longBody?Math.max(720,430+sideRows*110):760,viewHeight=longBody?end-50:670;
 return <svg className="car-glass-map rendered-glass-map" viewBox={"0 145 768 "+viewHeight} role="group" aria-label={vehicleBodyNames[body]+' glass map, viewed from above'}>
  <defs>
   <linearGradient id={id+'glass'} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#86a9ba" stopOpacity=".55"/><stop offset=".4" stopColor="#263f4e" stopOpacity=".88"/><stop offset="1" stopColor="#101c25" stopOpacity=".98"/></linearGradient>
   <linearGradient id={id+'gold'} x2=".6" y2="1"><stop stopColor="#fae3a1" stopOpacity=".85"/><stop offset=".55" stopColor="#977337" stopOpacity=".9"/><stop offset="1" stopColor="#2f2519"/></linearGradient>
   <linearGradient id={id+'green'} x2="1" y2="1"><stop stopColor="#6bba8c" stopOpacity=".7"/><stop offset="1" stopColor="#152c21" stopOpacity=".95"/></linearGradient>
  </defs>
  {longBody?<g aria-hidden="true" pointerEvents="none">{(body==='van'?[{y:210,h:177,box:'225 130 580 370'},{y:387,h:end-412,box:'225 500 580 700'},{y:end-25,h:110,box:'225 1200 580 230'}]:[{y:210,h:183,box:'285 65 455 300'},{y:393,h:end-421,box:'285 365 455 915'},{y:end-28,h:113,box:'285 1280 455 185'}]).map((slice,i)=><svg key={i} x="245" y={slice.y} width="278" height={slice.h} viewBox={slice.box} preserveAspectRatio="none"><image href={artwork} width="1024" height="1536"/></svg>)}</g>:body!=='sedan'&&body!=='coupe'?<image href={artwork} x="145" y="170" width="478" height="640" preserveAspectRatio="xMidYMid meet" aria-hidden="true" pointerEvents="none"/>:<svg x="210" y="110" width="348" height="760" viewBox={(body==='sedan'?'218':'798')+' 50 520 940'} preserveAspectRatio="xMidYMid meet" aria-hidden="true" pointerEvents="none"><image href={artwork} x="0" y="0" width="1536" height="1024"/></svg>}
  {shapes(body,sideRows).map(p=>{const piece=items.find(i=>i.glassPosition===p.position),right=p.position.includes('_right_'),chosen=!!piece&&selectedIds.includes(piece.id),mine=piece?.installerId===currentUserId,done=piece?.status==='installed',state=!piece?'excluded':piece.needsCorrection?'correction':done?'done':mine?'mine':piece.installerId?'other':'available',status=!piece?'Not in this order':piece.needsCorrection?'Needs correction':done?'Completed':mine?'Yours':piece.installerId?'Taken by another installer':'Available',transform=right?'translate(768 0) scale(-1 1)':undefined;
  if(!piece)return null;
  const name=glassName(body,p.position);
  return <g key={p.position}>
   {p.anchor&&piece&&<path d={'M'+(right?588:180)+' '+(p.y-12)+' L'+(right?564:204)+' '+(p.y-12)+' L'+p.anchor[0]+' '+p.anchor[1]} className="glass-connector" fill="none"/>}
   <g role="button" data-glass-id={piece?.id} aria-label={name+' — '+status} aria-pressed={chosen} aria-hidden={!piece||undefined} aria-disabled={!piece} tabIndex={piece?0:-1} className={'glass-pane glass-'+state+(chosen?' glass-selected':'')+(p.inner?' glass-on-car':'')} onClick={()=>piece&&onSelect(piece.id)} onKeyDown={e=>{if(piece&&(e.key==='Enter'||e.key===' ')){e.preventDefault();onSelect(piece.id);}}}>
    <title>{name+' — '+status}</title>
    {piece&&<path d={p.path} transform={transform} stroke="transparent" strokeWidth={p.inner?8:18} fill="transparent"/>}
    <path d={p.path} transform={transform} className="glass-surface" style={{fill:state==='mine'?'url(#'+id+'gold)':state==='done'?'url(#'+id+'green)':state==='correction'?'#9a4e2caa':'url(#'+id+'glass)'}}/>
    {!p.inner&&<path d={p.path} transform={transform} className="glass-inner-shine" fill="none" pointerEvents="none"/>}
    {piece&&<text x={p.x} y={p.y+7} textAnchor="middle" className="glass-symbol" aria-hidden="true">{done?'✓':state==='correction'?'!':mine?'•':'+'}</text>}
   </g>
  </g>;})}

 </svg>;
}
