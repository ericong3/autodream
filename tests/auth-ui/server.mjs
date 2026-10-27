import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
const states=new Map();
const user={id:'fictional-director',name:'Sample Director',username:'sample',role:'director',businessAccess:'both'};
const server=await createServer({configFile:false,plugins:[react(),{name:'fictional-login-only',configureServer(s){s.middlewares.use(async(req,res,next)=>{
 if(!req.url.startsWith('/api/test-session'))return next();
 const scenario=req.headers['x-test-case']||'normal';if(!states.has(scenario))states.set(scenario,scenario==='existing');
 if(req.method==='POST')states.set(scenario,scenario!=='blocked');
 if(req.method==='DELETE')states.set(scenario,false);
 const allowed=req.method==='POST'||states.get(scenario);res.writeHead(allowed?200:401,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(allowed?{user}:{error:{message:'No fixture session'}}));
 });}}],resolve:{alias:[{find:/^\.\.\/store$/,replacement:resolve('tests/auth-ui/store.ts')},{find:/^\.\.\/lib\/garageSession$/,replacement:resolve('tests/auth-ui/session.ts')}]},server:{host:'127.0.0.1',port:5183,strictPort:true}});
await server.listen();console.log('Fictional sign-in test: http://127.0.0.1:5183/tests/auth-ui/index.html?case=normal#/login');
