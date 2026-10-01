import { it } from 'vitest';
import { injectTextPsi, lexemePattern } from '@/core/gematria/lexeme';
import { LexiconMemory, lexiconCatalog } from '@/core/knowledge/lexicon';
const cos=(a:any,b:any)=>{let d=0,x=0,y=0;for(let i=0;i<a.length;i++){d+=a[i]*b[i];x+=a[i]*a[i];y+=b[i]*b[i]}return d/Math.sqrt(x*y)};
const no=(t:string,R:number)=>{const p=new Float64Array(R*4);t.split(' ').forEach((w,r)=>{const q=lexemePattern(w,R,0)!;for(let i=0;i<q.length;i++)p[i]+=q[i]*0.618034**r});return p};
const ps=(t:string,R:number)=>{const p=new Float64Array(R*4+4);injectTextPsi(p,t);return p.subarray(0,R*4)};
it('m',()=>{for(const R of [9,55]){for(const [a,b] of [['dog chases cat','cat chases dog'],['man bites dog','dog bites man'],['memory shapes thought','thought shapes memory']])console.log(R,a,'before',cos(no(a,R),no(b,R)).toFixed(3),'after',cos(ps(a,R),ps(b,R)).toFixed(3));}
const V:string[]=[];for(const e of lexiconCatalog())for(const t of e.word.toLowerCase().split(/[^a-z]+/))if(t&&!V.includes(t))V.push(t);V.sort();
for(const R of [9,21,55]){const lex=new LexiconMemory(64);lex.learn(V,0);
for(const L of [1,2,3,4,6]){let tp=0,fp=0,fn=0,ord=0;const N=100;const t0=performance.now();
for(let k=0;k<N;k++){const ws:string[]=[];for(let i=0;i<L;i++){const w=V[(k*131+i*977+L*17)%V.length];if(!ws.includes(w))ws.push(w)}
const p=new Float64Array(R*4+4);injectTextPsi(p,ws.join(' '));const r=lex.readPsi(p,8);const g=r.words.map(w=>w.word);
for(const x of g)ws.includes(x)?tp++:fp++;for(const x of ws)if(!g.includes(x))fn++;if(JSON.stringify(r.sequence)===JSON.stringify(ws))ord++}
console.log('R',R,'L',L,'P',(tp/(tp+fp)).toFixed(3),'R',(tp/(tp+fn)).toFixed(3),'order',(ord/N).toFixed(2),'ms',((performance.now()-t0)/N).toFixed(1))}}});
