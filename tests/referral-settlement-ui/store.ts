const state:any={currentUser:{id:'sample-director',role:'director'},users:[{id:'sample-sales',name:'Sample Salesman'},{id:'sample-director',name:'Sample Director'}]};
export const useStore=(select:any)=>select(state);
