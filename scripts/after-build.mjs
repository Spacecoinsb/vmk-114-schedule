import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve('dist');
const manifestPath=path.join(root,'manifest.webmanifest');
const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
const base=process.env.VITE_BASE||'/';
manifest.id=base; manifest.start_url=base; manifest.scope=base;
manifest.theme_color='#f8f9fb'; manifest.background_color='#f8f9fb';
for(const icon of manifest.icons)icon.src=base+icon.src.replace(/^\//,'');
await writeFile(manifestPath,JSON.stringify(manifest));
async function walk(dir){const found=[];for(const item of await readdir(dir,{withFileTypes:true})){const name=path.join(dir,item.name);if(item.isDirectory())found.push(...await walk(name));else found.push(path.relative(root,name).replaceAll('\\','/'));}return found;}
// PDF parsing now runs on GitHub; the phone only needs the small app and saved timetable.
const paths=(await walk(root)).filter(p=>!['sw.js','precache.json','latest.pdf','source.json','parser.mjs'].includes(p)&&!p.startsWith('vendor/')).sort();
const sw=await readFile(path.join(root,'sw.js'),'utf8');
const hash=createHash('sha256').update(sw);
for(const name of paths){hash.update(name);hash.update(await readFile(path.join(root,name)));}
await writeFile(path.join(root,'precache.json'),JSON.stringify(paths));
await writeFile(path.join(root,'sw.js'),sw.replace('__BUILD_ID__',hash.digest('hex').slice(0,16)));
