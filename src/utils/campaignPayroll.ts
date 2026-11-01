import type { Payment } from '../types';
export type BonusPayrollSnapshot={payrollPayments?:Record<string,unknown>[];payrollJournal?:Record<string,unknown>|null;payrollAccount?:Record<string,unknown>|null};
export function mergeBonusRows<T extends {id:string}>(remote:T[],local:T[],protectedRow:(row:T)=>boolean):T[]{
  const rows=new Map(remote.map(row=>[row.id,row]));
  for(const row of local){
    if(!protectedRow(row))continue;
    const incoming=rows.get(row.id);
    if(!incoming||('status' in row&&row.status==='transferred'&&'status' in incoming&&incoming.status==='pending'))rows.set(row.id,row);
  }
  return [...rows.values()];
}
export function campaignBonusFor(payments: Payment[], userId: string, month: string): number {
  return [...new Map(payments.filter(p=>p.type==='campaign_bonus'&&p.recipientId===userId&&p.bonusMonth===month).map(p=>[p.id,p])).values()]
    .reduce((sum,p)=>Math.round((sum+p.amount)*100)/100,0);
}
