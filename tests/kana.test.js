// Checks the romaji → kana helper. Run: node tests/kana.test.js
const { toKana } = require('../kana.js');

const cases = [
  ['tomodachi', 'ともだち'],
  ['sumaho', 'スマホ', true],
  ['gakkou', 'がっこう'],
  ['chotto', 'ちょっと'],
  ['matcha', 'まっちゃ'],
  ['konnichiwa', 'こんにちわ'], // the particle は is a human edit, by design
  ['onna', 'おんな'],
  ['shinbun', 'しんぶん'],
  ["kan'i", 'かんい'],
  ['kani', 'かに'],
  ['kyou', 'きょう'],
  ['Tōkyō', 'とうきょう'],
  ['tōkyō', 'トーキョー', true],
  ['koohii', 'コオヒイ', true],
  ['kōhī', 'コーヒー', true],
  ['watashi', 'わたし'],
  ['arigatou gozaimasu', 'ありがとう ございます'],
  ['fujisan', 'ふじさん'],
  ['tsukue', 'つくえ'],
  ['ryokou', 'りょこう'],
  ['kippu', 'きっぷ'],
  ['', ''],
];

let failures = 0;
for (const [input, expected, katakana] of cases) {
  const got = toKana(input, !!katakana);
  const ok = got === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'ok    ' : 'FAILED'} ${input || '(empty)'} → ${got}${ok ? '' : ` (expected ${expected})`}`);
}
console.log(failures ? `\n${failures} failure(s)` : '\nAll conversions match.');
process.exit(failures ? 1 : 0);
