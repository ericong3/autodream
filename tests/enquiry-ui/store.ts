export const testUser={id:'sample-a',name:'Sample Salesperson',username:'sample-a',role:'garage_salesman',businessAccess:'garage'};
export const useStore=(select:any)=>select({users:[testUser],currentUser:testUser,logout:async()=>{}});
