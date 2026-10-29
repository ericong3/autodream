import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const server=await createServer({root,resolve:{alias:[{find:/^.*\/lib\/garageReferralAccounts$/,replacement:fileURLToPath(new URL('./api.ts',import.meta.url))}]},server:{host:'localhost',port:5201,strictPort:true}});
await server.listen();console.log('Registration design preview: http://localhost:5201/tests/referral-ui/index.html#/referral-account/register?token=preview');
