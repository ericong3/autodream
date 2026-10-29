export async function referralAccountRequest(action:string){
 if(action==='inspect')return {valid:true};
 throw Object.assign(new Error('This is a design preview. Nothing is saved.'),{code:'SETUP'});
}
