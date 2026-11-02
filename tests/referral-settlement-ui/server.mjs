import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const server=await createServer({root,resolve:{alias:[{find:/^.*\/lib\/garageReferralSettlement$/,replacement:fileURLToPath(new URL('./api.ts',import.meta.url))},{find:/^\.\.\/store$/,replacement:fileURLToPath(new URL('./store.ts',import.meta.url))}]},server:{host:'localhost',port:5206,strictPort:true}});
await server.listen();console.log('Sample-only referral settlement http://localhost:5206/tests/referral-settlement-ui/index.html');
