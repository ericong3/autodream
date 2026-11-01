import type { Payment } from '../types';
export function campaignBonusFor(payments: Payment[], userId: string, month: string): number {
  return [...new Map(payments.filter(p=>p.type==='campaign_bonus'&&p.recipientId===userId&&p.bonusMonth===month).map(p=>[p.id,p])).values()]
    .reduce((sum,p)=>Math.round((sum+p.amount)*100)/100,0);
}
