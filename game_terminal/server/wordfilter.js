// Small profanity/slur filter for usernames and chat. Normalises common evasions (leetspeak,
// repeated letters, separators) before matching. Deliberately conservative: it catches the
// obvious stuff; the report button and admin tools handle the rest.
// shortcut: hand-kept English list; swap for a maintained list if the site grows past English.

const WORDS = [
  'fuck', 'shit', 'cunt', 'bitch', 'whore', 'slut', 'dick', 'cock', 'pussy', 'asshole', 'bastard',
  'wank', 'twat', 'prick', 'jizz', 'cum', 'porn', 'rape', 'rapist', 'nazi', 'hitler',
  'nigger', 'nigga', 'faggot', 'fag', 'retard', 'tranny', 'chink', 'spic', 'kike', 'gook', 'wetback',
  'dyke', 'coon', 'paki', 'raghead', 'beaner',
];
// Words short enough to appear inside innocent ones ("Scunthorpe", "cocktail", "classic") only
// match as whole words; the rest also match as substrings of usernames like "xxfuckerxx".
const WHOLE_ONLY = new Set(['cum', 'fag', 'coon', 'paki', 'dick', 'cock', 'spic', 'gook', 'prick', 'rape']);

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'i' };

function normalise(s) {
  return String(s).toLowerCase().replace(/[013457@$!|8]/g, (c) => LEET[c] || c).replace(/(.)\1+/g, '$1');
}

const squash = (w) => w.replace(/(.)\1+/g, '$1');
const SUBSTR = WORDS.filter((w) => !WHOLE_ONLY.has(w)).map(squash);
const WHOLE = new RegExp(`\\b(${WORDS.map(squash).join('|')})(s|es|ed|er|ers|ing)?\\b`, 'i');

// True when a username contains a banned word anywhere (usernames get no benefit of the doubt).
function isOffensiveName(name) {
  const n = normalise(name).replace(/[^a-z]/g, '');
  return SUBSTR.some((w) => n.includes(w)) || WHOLE.test(normalise(name).replace(/_/g, ' '));
}

// Masks banned words in chat text, keeping the first letter: "f***".
function maskText(text) {
  return String(text).replace(/[A-Za-z0-9@$!|]+/g, (tok) => {
    const n = normalise(tok);
    return WHOLE.test(n) || SUBSTR.some((w) => w.length >= 5 && n.includes(w)) ? tok[0] + '*'.repeat(tok.length - 1) : tok;
  });
}

module.exports = { isOffensiveName, maskText };
