// Confere fsrs.js contra os valores esperados dos testes do próprio fsrs-rs v6.6.2 (src/model.rs).
// Rodar: node teste/fsrs.test.js
const F = require('../fsrs.js');
const { nextDifficulty, stabilityAfterSuccess, stabilityAfterFailure, stabilityShortTerm } = F._interno;

let falhas = 0;
function perto(nome, obtido, esperado, tol = 1e-4) {
  obtido.forEach((v, i) => {
    const ok = Math.abs(v - esperado[i]) <= tol * Math.max(1, Math.abs(esperado[i]));
    if (!ok) { falhas++; console.log(`FALHOU ${nome}[${i}]: ${v} (esperado ${esperado[i]})`); }
  });
  console.log(`${nome}: ok`);
}

perto('curva de esquecimento',
  [[0, 1], [1, 2], [2, 3], [3, 4], [4, 4], [5, 2]].map(([t, s]) => F.forgettingCurve(t, s)),
  [1.0, 0.9403443, 0.9253786, 0.9185229, 0.9, 0.8261359]);

perto('intervalo com retenção 0,9 = estabilidade', [1, 2, 5, 121.01552].map(s => F.nextInterval(s, 0.9)), [1, 2, 5, 121.01552]);

perto('estabilidade inicial', [1, 2, 3, 4].map(r => F.initStability(r)), F.W.slice(0, 4));

perto('dificuldade seguinte (com volta à média)', [1, 2, 3, 4].map(r => nextDifficulty(5, r)),
  [8.341763, 6.6659956, 4.990228, 3.3144615]);

perto('estabilidade depois de lembrar',
  [[1, 0.9], [2, 0.8], [3, 0.7], [4, 0.6]].map(([r, R]) => stabilityAfterSuccess(5, r, R, r)),
  [25.602541, 28.226582, 58.656002, 127.226685]);

perto('estabilidade depois de esquecer',
  [[1, 0.9], [2, 0.8], [3, 0.7], [4, 0.6]].map(([d, R]) => stabilityAfterFailure(5, d, R)),
  [1.0525396, 1.1894329, 1.3680838, 1.584989]);

perto('estabilidade no mesmo dia', [1, 2, 3, 4].map(r => stabilityShortTerm(5, r)), [1.596818, 5.0, 5.0, 8.12961]);

// Sanidade da história de um cartão: novo → Lembrei → 2 dias depois Lembrei → cresce.
const a = F.step(null, 3, 0);
const b = F.step(a, 3, Math.round(F.nextInterval(a.s, 0.9)));
console.log(`cartão novo + Lembrei: s=${a.s.toFixed(2)} d=${a.d.toFixed(2)} → revisão seguinte s=${b.s.toFixed(2)}`);
if (!(b.s > a.s)) { falhas++; console.log('FALHOU: estabilidade não cresceu'); }

console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo bate com o fsrs-rs 6.6.2.');
process.exit(falhas ? 1 : 0);
