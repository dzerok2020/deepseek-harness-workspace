import fs from 'node:fs';
import crypto from 'node:crypto';
import {gunzipSync} from 'node:zlib';
export const OWNER='/home/dzerok/.dsh/profiles/web/node_modules/billion-context/dist/index.js';
export const HASH='104502cb11fa98e205f61ba9cc0dde8d3d03b57d8330bfcbafe84f8d130ed2d9';
export function verifyOriginal(source){
 if(crypto.createHash('sha256').update(source).digest('hex')!==HASH)throw Error('Owner SHA256 mismatch; refusing candidate generation');
 return source;
}
export function loadOriginal(compressed=fs.readFileSync(new URL('./original-index.js.gz',import.meta.url))){
 return verifyOriginal(gunzipSync(compressed)).toString('utf8');
}
