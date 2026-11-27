'use strict';
/*
 * Romaji → kana (Hepburn-style input), used to fill a card's small "reading line".
 * It is a typing aid, not a dictionary: particles (wa/は, e/へ, o/を) and loanwords still need a human eye,
 * so the result always lands in an editable field.
 *
 *   toKana('tomodachi')        → 'ともだち'
 *   toKana('sumaho', true)     → 'スマホ'
 *   toKana('gakkou')           → 'がっこう'
 */
(function (root) {
  const H = {
    a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お',
    ka: 'か', ki: 'き', ku: 'く', ke: 'け', ko: 'こ', kya: 'きゃ', kyu: 'きゅ', kyo: 'きょ',
    ga: 'が', gi: 'ぎ', gu: 'ぐ', ge: 'げ', go: 'ご', gya: 'ぎゃ', gyu: 'ぎゅ', gyo: 'ぎょ',
    sa: 'さ', shi: 'し', si: 'し', su: 'す', se: 'せ', so: 'そ',
    sha: 'しゃ', shu: 'しゅ', sho: 'しょ', she: 'しぇ', sya: 'しゃ', syu: 'しゅ', syo: 'しょ',
    za: 'ざ', ji: 'じ', zi: 'じ', zu: 'ず', ze: 'ぜ', zo: 'ぞ',
    ja: 'じゃ', ju: 'じゅ', jo: 'じょ', je: 'じぇ', jya: 'じゃ', jyu: 'じゅ', jyo: 'じょ', zya: 'じゃ', zyu: 'じゅ', zyo: 'じょ',
    ta: 'た', chi: 'ち', ti: 'ち', tsu: 'つ', tu: 'つ', te: 'て', to: 'と',
    cha: 'ちゃ', chu: 'ちゅ', cho: 'ちょ', che: 'ちぇ', tya: 'ちゃ', tyu: 'ちゅ', tyo: 'ちょ',
    da: 'だ', di: 'ぢ', du: 'づ', de: 'で', do: 'ど', dya: 'ぢゃ', dyu: 'ぢゅ', dyo: 'ぢょ',
    na: 'な', ni: 'に', nu: 'ぬ', ne: 'ね', no: 'の', nya: 'にゃ', nyu: 'にゅ', nyo: 'にょ',
    ha: 'は', hi: 'ひ', fu: 'ふ', hu: 'ふ', he: 'へ', ho: 'ほ', hya: 'ひゃ', hyu: 'ひゅ', hyo: 'ひょ',
    fa: 'ふぁ', fi: 'ふぃ', fe: 'ふぇ', fo: 'ふぉ',
    ba: 'ば', bi: 'び', bu: 'ぶ', be: 'べ', bo: 'ぼ', bya: 'びゃ', byu: 'びゅ', byo: 'びょ',
    pa: 'ぱ', pi: 'ぴ', pu: 'ぷ', pe: 'ぺ', po: 'ぽ', pya: 'ぴゃ', pyu: 'ぴゅ', pyo: 'ぴょ',
    ma: 'ま', mi: 'み', mu: 'む', me: 'め', mo: 'も', mya: 'みゃ', myu: 'みゅ', myo: 'みょ',
    ya: 'や', yu: 'ゆ', yo: 'よ',
    ra: 'ら', ri: 'り', ru: 'る', re: 'れ', ro: 'ろ', rya: 'りゃ', ryu: 'りゅ', ryo: 'りょ',
    wa: 'わ', wo: 'を', vu: 'ゔ',
  };
  const VOWELS = 'aiueo';
  const MACRONS = { ā: 'a', ī: 'i', ū: 'u', ē: 'e', ō: 'o', â: 'a', î: 'i', û: 'u', ê: 'e', ô: 'o' };

  function toKana(text, katakana = false) {
    let s = String(text || '').toLowerCase();
    // Long vowels written with a macron: ō → ou (hiragana) or オー (katakana)
    s = s.replace(/[āīūēōâîûêô]/g, m => {
      const v = MACRONS[m];
      return katakana ? v + '-' : v + (v === 'o' ? 'u' : v);
    });
    let out = '';
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      const next = s[i + 1] || '';
      // n is ん before an apostrophe (kan'i), before a consonant other than y, or at the end.
      // "nn" + vowel (konnichiwa, onna): the first n is ん and the second starts the next syllable.
      if (c === 'n') {
        if (next === "'") { out += 'ん'; i += 2; continue; }
        if (!next || (!VOWELS.includes(next) && next !== 'y')) { out += 'ん'; i += 1; continue; } // ''.includes is always true: check end first
      }
      // doubled consonant → small tsu (gakkou, chotto); "tch" (matcha) too
      if (/[bcdfghjkmpqrstvwxyz]/.test(c) && (next === c || (c === 't' && next === 'c' && s[i + 2] === 'h'))) {
        out += 'っ'; i += 1; continue;
      }
      let matched = false;
      for (const len of [3, 2, 1]) {
        const chunk = s.slice(i, i + len);
        if (H[chunk]) { out += H[chunk]; i += len; matched = true; break; }
      }
      if (matched) continue;
      if (c === '-') { out += 'ー'; i += 1; continue; }
      out += c; // anything else (spaces, punctuation, kana already typed) passes through
      i += 1;
    }
    if (katakana) out = out.replace(/[ぁ-ゖ]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60));
    return out;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { toKana };
  else root.toKana = toKana;
})(typeof self !== 'undefined' ? self : this);
