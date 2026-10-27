export const secureGarageLoginEnabled=()=>true;
export async function garageSessionRequest(method:'GET'|'POST'|'DELETE',body?:unknown){
 const response=await fetch('/api/test-session',{method,headers:{'Content-Type':'application/json','X-Test-Case':new URLSearchParams(location.search).get('case')||'normal'},body:body?JSON.stringify(body):undefined});
 if(method==='GET'&&response.status===401)return null;return (await response.json()).user;
}
export const garageAppUser=(identity:any)=>({...identity,authSource:'server',password:'',phone:'',monthlyTarget:0,carsInMonth:0});
