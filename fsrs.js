/*
 * FSRS-6 (Free Spaced Repetition Scheduler), reescrito em JavaScript a partir das fórmulas publicadas.
 * Fonte das fórmulas e dos parâmetros: open-spaced-repetition/fsrs-rs, tag v6.6.2, src/model.rs e src/inference.rs.
 *
 * Notas: 1 = Esqueci (Again), 2 = Difícil (Hard), 3 = Lembrei (Good), 4 = Fácil (Easy).
 * Memória de um cartão: s = estabilidade (em dias, quanto tempo até a chance de lembrar cair para 90%),
 *                       d = dificuldade (1 a 10).
 */
(function (root) {
  'use strict';

  // Parâmetros padrão do FSRS-6 ("ajustados ao hábito de estudo da pessoa média").
  const W = [
    0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796,
    1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
  ];
  const S_MIN = 0.001, S_MAX = 36500, D_MIN = 1, D_MAX = 10;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

  // Chance de lembrar depois de t dias, para estabilidade s.
  function forgettingCurve(t, s, w = W) {
    const decay = -w[20];
    const factor = Math.pow(0.9, 1 / decay) - 1;
    return Math.pow((t / s) * factor + 1, decay);
  }

  // Quantos dias esperar para a chance de lembrar cair até `retention`.
  function nextInterval(s, retention, w = W) {
    const decay = -w[20];
    const factor = Math.pow(0.9, 1 / decay) - 1;
    return (s / factor) * (Math.pow(retention, 1 / decay) - 1);
  }

  const initStability = (r, w = W) => w[clamp(r, 1, 4) - 1];
  const initDifficulty = (r, w = W) => w[4] - Math.exp(w[5] * (clamp(r, 1, 4) - 1)) + 1;

  function nextDifficulty(d, r, w = W) {
    const delta = -w[6] * (r - 3);
    const damped = d + ((10 - d) * delta) / 9; // amortecimento linear
    return w[7] * (initDifficulty(4, w) - damped) + damped; // volta lenta à média
  }

  function stabilityAfterSuccess(s, d, R, r, w = W) {
    const hard = r === 2 ? w[15] : 1;
    const easy = r === 4 ? w[16] : 1;
    return s * (Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) * (Math.exp((1 - R) * w[10]) - 1) * hard * easy + 1);
  }

  function stabilityAfterFailure(s, d, R, w = W) {
    const ns = w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp((1 - R) * w[14]);
    return Math.min(ns, s / Math.exp(w[17] * w[18]));
  }

  // Revisão no mesmo dia (delta_t = 0): é o que substitui os "passos de aprendizagem".
  function stabilityShortTerm(s, r, w = W) {
    const sinc = Math.exp(w[17] * (r - 3 + w[18])) * Math.pow(s, -w[19]);
    return s * (r >= 2 ? Math.max(sinc, 1) : sinc);
  }

  /**
   * Um passo do modelo.
   * @param {{s:number,d:number}|null} state  memória atual (null = cartão nunca visto)
   * @param {1|2|3|4} r                       nota dada
   * @param {number} deltaT                   dias inteiros desde a última revisão
   * @returns {{s:number,d:number}}
   */
  function step(state, r, deltaT, w = W) {
    if (!state || !state.s) {
      return { s: clamp(initStability(r, w), S_MIN, S_MAX), d: clamp(initDifficulty(r, w), D_MIN, D_MAX) };
    }
    const s = clamp(state.s, S_MIN, S_MAX);
    const d = clamp(state.d, D_MIN, D_MAX);
    const R = forgettingCurve(deltaT, s, w);
    let ns;
    if (deltaT === 0) ns = stabilityShortTerm(s, r, w);
    else if (r === 1) ns = stabilityAfterFailure(s, d, R, w);
    else ns = stabilityAfterSuccess(s, d, R, r, w);
    const nd = clamp(nextDifficulty(d, r, w), D_MIN, D_MAX);
    return { s: clamp(ns, S_MIN, S_MAX), d: nd };
  }

  const FSRS = {
    W, step, nextInterval, forgettingCurve, initStability, initDifficulty, S_MAX,
    // expostas só para o teste contra os valores do fsrs-rs (teste/fsrs.test.js)
    _interno: { nextDifficulty, stabilityAfterSuccess, stabilityAfterFailure, stabilityShortTerm },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = FSRS;
  else root.FSRS = FSRS;
})(typeof self !== 'undefined' ? self : this);
