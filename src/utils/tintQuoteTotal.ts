export function tintQuoteTotal({agreedBase,packageType,fullPrice,mixTotal,roofTotal,extrasTotal,discount}:{agreedBase?:number;packageType:'full'|'mix';fullPrice:number;mixTotal:number;roofTotal:number;extrasTotal:number;discount:number}):number{
 // Mix already contains the separately agreed roof lines. Agreed-price jobs replace the grid base.
 const base=agreedBase!==undefined?agreedBase+roofTotal:packageType==='full'?fullPrice+roofTotal:mixTotal;
 return Math.round(Math.max(0,base+extrasTotal-discount)*100)/100;
}
