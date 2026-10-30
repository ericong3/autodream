import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const server=await createServer({root,resolve:{alias:[
 {find:/^.*\/lib\/garageSalesAssignment$/,replacement:fileURLToPath(new URL('./api.ts',import.meta.url))},
 {find:/^\.\.\/store$/,replacement:fileURLToPath(new URL('./store.ts',import.meta.url))},
]},server:{host:'localhost',port:5202,strictPort:true}});
await server.listen();console.log('Salesperson/referrer design preview: http://localhost:5202/tests/sales-referral-ui/index.html');
