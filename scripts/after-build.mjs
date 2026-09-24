import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve('dist');
async function walk(dir){const found=[];for(const item of await readdir(dir,{withFileTypes:true})){const name=path.join(dir,item.name);if(item.isDirectory())found.push(...await walk(name));else found.push(path.relative(root,name).replaceAll('\\','/'));}return found;}
const paths=(await walk(root)).filter(p=>p!=='sw.js'&&p!=='precache.json'&&p!=='latest.pdf'&&p!=='source.json').sort();
const hash=createHash('sha256');for(const name of paths){hash.update(name);hash.update(await readFile(path.join(root,name)));}
await writeFile(path.join(root,'precache.json'),JSON.stringify(paths));
const sw=await readFile(path.join(root,'sw.js'),'utf8');
await writeFile(path.join(root,'sw.js'),sw.replace('__BUILD_ID__',hash.digest('hex').slice(0,16)));
const manifestPath=path.join(root,'manifest.webmanifest');const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
const base=process.env.VITE_BASE||'/';manifest.id=base;manifest.start_url=base;manifest.scope=base;
for(const icon of manifest.icons)icon.src=base+icon.src.replace(/^\//,'');
await writeFile(manifestPath,JSON.stringify(manifest));
