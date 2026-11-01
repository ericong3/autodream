import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const server=await createServer({root,resolve:{alias:[{find:/^.*\/lib\/bonusCampaigns$/,replacement:fileURLToPath(new URL('./api.ts',import.meta.url))},{find:/^\.\.\/store$/,replacement:fileURLToPath(new URL('./store.ts',import.meta.url))}]},server:{host:'localhost',port:5203,strictPort:true}});
await server.listen();console.log('Bonus Campaigns preview: http://localhost:5203/tests/bonus-campaigns-ui/index.html#/payroll/bonus-campaigns');
