export {campaignView,campaignMonths,malaysiaMonth} from '/src/lib/bonusCampaigns.ts';
const participants=['A','B','C','D'].map(letter=>({id:letter,name:`Sample salesperson ${letter}`}));
const campaign={id:'11111111-1111-4111-8111-111111111111',title:'Year-end 2026',startMonth:'2026-10',endMonth:'2026-12',minimumUnits:6,amountPerUnit:500,revision:2,publishedAt:'2026-10-01T00:00:00Z',participants,confirmedMonths:['2026-10']};
export async function bonusCampaignRequest(action:string,data:Record<string,unknown>={}){
 if(action==='list')return {enabled:true,campaigns:[campaign,{...campaign,id:'22222222-2222-4222-8222-222222222222',title:'New year showroom bonus',startMonth:'2027-01',endMonth:'2027-03',publishedAt:null,confirmedMonths:[]},{...campaign,id:'33333333-3333-4333-8333-333333333333',title:'Previous sales campaign',startMonth:'2026-07',endMonth:'2026-09',confirmedMonths:['2026-07','2026-08','2026-09']}],participants,hasMore:false};
 if(action==='preview')return {campaignId:data.id,month:data.month,units:6,minimumUnits:6,pool:3000,qualified:true,confirmed:data.month==='2026-10',confirmedAt:'2026-11-01T03:00:00Z',previewHash:'a'.repeat(32),shares:participants.map(p=>({...p,amount:750})),issues:[],cars:Array.from({length:6},(_,i)=>({id:String(i),label:`Sample company-owned car ${i+1}`}))};
 throw Object.assign(new Error('Preview only. No campaign or payroll record is saved.'),{code:'INVALID'});
}
