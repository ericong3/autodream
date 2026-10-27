export type PersonalColumn={id:string;name:string;color:string};
export const standardNames=['New','Follow up','Waiting for customer','Ready to book'];
export const starterColumns=standardNames.map((name,i)=>({id:'personal-'+i,name,color:['#B0B6A8','#D4B577','#8DA2BA','#9BB58A'][i]}));
export function readBoardPreferences(){return {mode:'standard',personalOrder:[] as string[],standardOrder:[] as string[],products:[] as string[],columns:starterColumns,personalPositions:{} as Record<string,string>,standardPositions:{} as Record<string,string>,pins:[] as string[]};}
export function boardSnapshot(value:unknown):string {if(Array.isArray(value))return '['+value.map(boardSnapshot).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+boardSnapshot((value as Record<string,unknown>)[key])).join(',')+'}';return JSON.stringify(value);}
export async function boardRequest(data?:Record<string,unknown>):Promise<{preferences:ReturnType<typeof readBoardPreferences>|null;revision:number}>{
 const response=await fetch('/api/garage/board',{method:data?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:{'X-Garage-Building':'1',...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
 const result=await response.json().catch(()=>null);if(!response.ok)throw Object.assign(new Error(result?.error?.message||'Could not load your board.'),{code:result?.error?.code});return result;
}

let boardWriteQueue:Promise<void>=Promise.resolve();
export function queueBoardWrite(task:()=>Promise<void>){boardWriteQueue=boardWriteQueue.then(task,task);return boardWriteQueue;}
export async function waitBoardWrites(){await boardWriteQueue;}
