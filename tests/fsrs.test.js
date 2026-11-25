// Checks fsrs.js against the expected values in the reference implementation's own tests (fsrs-rs v6.6.2, src/model.rs).
// Run: node tests/fsrs.test.js
const F = require('../fsrs.js');
const { nextDifficulty, stabilityAfterSuccess, stabilityAfterFailure, stabilityShortTerm } = F._internal;

let failures = 0;
function close(name, got, expected, tol = 1e-4) {
  got.forEach((v, i) => {
    const ok = Math.abs(v - expected[i]) <= tol * Math.max(1, Math.abs(expected[i]));
    if (!ok) { failures++; console.log(`FAILED ${name}[${i}]: ${v} (expected ${expected[i]})`); }
  });
  console.log(`ok     ${name}`);
}

close('forgetting curve',
  [[0, 1], [1, 2], [2, 3], [3, 4], [4, 4], [5, 2]].map(([t, s]) => F.forgettingCurve(t, s)),
  [1.0, 0.9403443, 0.9253786, 0.9185229, 0.9, 0.8261359]);

close('interval at 90% retention equals stability', [1, 2, 5, 121.01552].map(s => F.nextInterval(s, 0.9)), [1, 2, 5, 121.01552]);

close('initial stability', [1, 2, 3, 4].map(r => F.initStability(r)), F.W.slice(0, 4));

close('next difficulty (with mean reversion)', [1, 2, 3, 4].map(r => nextDifficulty(5, r)),
  [8.341763, 6.6659956, 4.990228, 3.3144615]);

close('stability after recall',
  [[1, 0.9], [2, 0.8], [3, 0.7], [4, 0.6]].map(([r, R]) => stabilityAfterSuccess(5, r, R, r)),
  [25.602541, 28.226582, 58.656002, 127.226685]);

close('stability after a lapse',
  [[1, 0.9], [2, 0.8], [3, 0.7], [4, 0.6]].map(([d, R]) => stabilityAfterFailure(5, d, R)),
  [1.0525396, 1.1894329, 1.3680838, 1.584989]);

close('same-day stability', [1, 2, 3, 4].map(r => stabilityShortTerm(5, r)), [1.596818, 5.0, 5.0, 8.12961]);

// Sanity check of a card's life: new → Good → Good again when due → stability grows.
const a = F.step(null, 3, 0);
const b = F.step(a, 3, Math.round(F.nextInterval(a.s, 0.9)));
console.log(`new card + Good: s=${a.s.toFixed(2)} d=${a.d.toFixed(2)} → next review s=${b.s.toFixed(2)}`);
if (!(b.s > a.s)) { failures++; console.log('FAILED: stability did not grow'); }

console.log(failures ? `\n${failures} failure(s)` : '\nMatches fsrs-rs 6.6.2.');
process.exit(failures ? 1 : 0);
