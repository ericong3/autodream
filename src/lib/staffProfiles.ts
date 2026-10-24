export interface StaffProfileData{identity:{id:string;name:string;username:string;role:string;businessAccess:string};data:Record<string,string>;revision:number;employmentStatus:'current'|'former';lastWorkingDate:string|null;email?:string;verified:boolean;history:{action:string;recorded_at:string;actor_name?:string;snapshot:Record<string,unknown>}[]}
export async function staffProfileRequest(data:Record<string,unknown>):Promise<any>{
 const res=await fetch('/api/auth/staff-profiles',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Garage-Building':'1'},body:JSON.stringify(data)});
 const result=await res.json().catch(()=>null);if(!res.ok)throw Object.assign(new Error(result?.error?.message||'Staff profiles are unavailable.'),{code:result?.error?.code});return result;
}
export function serviceLength(joined:string,end?:string|null){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(joined))return 'Joining date not set';
 const today=end||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const [y,m,d]=joined.split('-').map(Number),[ey,em,ed]=today.split('-').map(Number);let months=(ey-y)*12+em-m;if(ed<d)months--;if(months<0)return 'Less than a month';const years=Math.floor(months/12),remaining=months%12;return [years?years+' '+(years===1?'year':'years'):'',remaining?remaining+' '+(remaining===1?'month':'months'):''].filter(Boolean).join(', ')||'Less than a month';
}
