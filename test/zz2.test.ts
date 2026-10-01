import { it } from 'vitest';
import { injectTextPsi } from '@/core/gematria/lexeme';
import { LexiconMemory, lexiconCatalog } from '@/core/knowledge/lexicon';
it('d',()=>{const V:string[]=[];for(const e of lexiconCatalog())for(const t of e.word.toLowerCase().split(/[^a-z]+/))if(t&&!V.includes(t))V.push(t);V.sort();
const lex=new LexiconMemory(64);lex.learn(V,0);let n=0;const L=3;
for(let k=0;k<100&&n<8;k++){const ws:string[]=[];for(let i=0;i<L;i++){const w=V[(k*131+i*977+L*17)%V.length];if(!ws.includes(w))ws.push(w)}
const p=new Float64Array(224);injectTextPsi(p,ws.join(' '));const r=lex.readPsi(p,8);
if(r.sequence.join()!==ws.join()){n++;console.log(ws.join(' '),'=>',r.words.map(w=>w.word+'@'+w.pos+':'+w.weight.toFixed(3)).join(' '),'expl',r.explained.toFixed(3))}}});
