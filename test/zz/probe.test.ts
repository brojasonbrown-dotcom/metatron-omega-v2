import { test } from 'vitest';
import { LexiconMemory, spellingSignature, similarity } from '../../src/core/knowledge/lexicon';
import { injectTextPsi } from '../../src/core/gematria/lexeme';
test('probe', () => {
  const L = new LexiconMemory();
  const corpus = ['the cat drinks milk','the dog drinks water','a cat chases a mouse','a dog chases a cat','the sun warms the earth','the moon lights the night','the cat sleeps','the dog sleeps','the sun rises','the moon rises'];
  for (let e=0;e<5;e++) for (const s of corpus) L.learn(s.split(' '), 1);
  for (const w of ['cat','dog','sun','moon','milk']) { const r=L.recall(L.signature(w),4); console.log('NB',w,r.hits.map(h=>h.word+':'+h.score.toFixed(3)).join(' '),'crisp',r.crisp); }
  console.log('SPELL cat~cats',similarity(spellingSignature('cat'),spellingSignature('cats')).toFixed(3),'cat~dog',similarity(spellingSignature('cat'),spellingSignature('dog')).toFixed(3));
  // field decodability: can the word be identified from psi alone?
  const vocab=[...new Set(corpus.join(' ').split(' '))];
  const W=9*... 0;
});
