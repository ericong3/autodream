import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,readdirSync,statSync} from 'node:fs';import {join} from 'node:path';
// garage_building_auth_throttle_hit rejects keys not matching ^[a-z]{1,8}:[A-Za-z0-9_-]{16,128}$,
// which surfaces as a 500 on every request of the affected screen.
const files=d=>readdirSync(d).flatMap(n=>{const p=join(d,n);return statSync(p).isDirectory()?files(p):p.endsWith('.mjs')?[p]:[];});
test('every throttle key prefix is one to eight lowercase letters followed by a hash',()=>{
 const found=[];
 for(const f of files('server'))for(const m of readFileSync(f,'utf8').matchAll(/throttleHit\(\s*\(?['`]([^'`]*)['`]\s*\+\s*([^,]*)/g)){found.push(m[1]);assert.match(m[1],/^[a-z]{1,8}:$/,`${f}: ${m[1]}`);assert.doesNotMatch(m[2],/^['`]/,`${f}: ${m[1]} must be followed by a hash`);}
 assert.ok(found.length>20);
});
