import {supabase} from './supabase';
type Filter={op:'eq'|'in';column:string;value:unknown};
class FinanceQuery implements PromiseLike<any>{
 private operation='select';private data:unknown;private filters:Filter[]=[];private orders:{column:string;ascending:boolean}[]=[];private page=[0,499];
 constructor(private table:string){}
 select(_columns='*'){return this;}
 insert(data:unknown){this.operation='insert';this.data=data;return this;}
 update(data:unknown){this.operation='update';this.data=data;return this;}
 delete(){this.operation='delete';return this;}
 eq(column:string,value:unknown){this.filters.push({op:'eq',column,value});return this;}
 in(column:string,value:unknown[]){this.filters.push({op:'in',column,value});return this;}
 order(column:string,options?:{ascending?:boolean}){this.orders.push({column,ascending:options?.ascending!==false});return this;}
 range(from:number,to:number){this.page=[from,to];return this;}
 async then<TResult1=any,TResult2=never>(onfulfilled?:((value:any)=>TResult1|PromiseLike<TResult1>)|null,onrejected?:((reason:any)=>TResult2|PromiseLike<TResult2>)|null):Promise<TResult1|TResult2>{
  return this.execute().then(onfulfilled,onrejected);
 }
 private async execute(){
  const response=await fetch('/api/garage/sales',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Garage-Building':'1'},body:JSON.stringify({scope:'private_finance',table:this.table,operation:this.operation,data:this.data,filters:this.filters,orders:this.orders,range:this.page})});
  const result=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(result?.error?.message||'Could not load or save finance records.');
  return {data:result.data,error:null};
 }
}
export function financeFrom(table:string):any{return import.meta.env.VITE_USED_CAR_PRIVATE_FINANCE==='1'?new FinanceQuery(table):supabase.from(table);}
