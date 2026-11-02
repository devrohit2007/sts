// Deterministic sentence building. No AI, no guessing: it only joins the words
// that were actually recognised.
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const ended = (s) => /[.?!]$/.test(s);

export function appendWord(text, word) {
  const t = text.trim();
  if (!t) return cap(word);
  return ended(t) ? `${t} ${cap(word)}` : `${t} ${word}`;
}

export function finishSentence(text) {
  const t = text.trim();
  return !t || ended(t) ? t : t + '.';
}
