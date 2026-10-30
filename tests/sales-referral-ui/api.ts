export async function salesReferralRequest(action:string){
 if(action==='options')return {enabled:true,owners:[{id:'garage-example',name:'Example Garage salesperson'},{id:'director-example',name:'Example Director'}],usedCarStaff:[{id:'used-car-example',name:'Example Used Car salesperson'}],external:[{id:'11111111-1111-4111-8111-111111111111',name:'Example external salesperson',brand:'Honda',branch:'Example branch'}]};
 if(action==='deals')return {deals:[{customerId:'customer-example',carId:'car-example',submittedAt:'2026-10-10T10:00:00Z',vehicle:'EXAMPLE · Toyota Noah',customer:'Example customer'}],hasMore:false};
 throw new Error('Design preview only. Nothing is saved.');
}
