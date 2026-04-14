const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'src', 'i18n', 'locales');
function list(dir){
  const out=[];
  for (const ent of fs.readdirSync(dir, {withFileTypes:true})){
    const p=path.join(dir, ent.name);
    if(ent.isDirectory()) out.push(...list(p));
    else if(ent.isFile() && p.endsWith('.json')) out.push(p);
  }
  return out;
}
const files=list(root);
let ok=true;
for (const f of files){
  const buf=fs.readFileSync(f);
  const text=buf.toString('utf8');
  const reenc=Buffer.from(text, 'utf8');
  if (buf.equals(reenc)===false && !(buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF)){
    console.log('Mismatch bytes:', f);
    ok=false;
  }
  try { JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch(e){ console.log('Invalid JSON:', f, e.message); ok=false; }
}
if(ok) console.log('OK: all locale json are valid utf8+json');
