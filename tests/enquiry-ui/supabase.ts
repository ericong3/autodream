// No external database traffic in this isolated harness.
const query:any=new Proxy({}, {get:(_,key)=>key==='then'?((done:any)=>Promise.resolve({data:[]}).then(done)):key==='maybeSingle'?(()=>Promise.resolve({data:null})):(()=>query)});
export const supabase={from:()=>query};
