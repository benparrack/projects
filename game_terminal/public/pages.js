// Static info pages: /terms, /privacy, /rules, /about, /credits.
// Standalone on purpose: hub.js wires them in with
//   const page = INFO_PAGES[location.pathname];
//   if (page) { els.screenPage.replaceChildren(page.render()); document.title = `${page.title} — Game Terminal`; }
// Templates, not legal advice.
import { h } from './ui.js';

// Bump when Terms/Privacy change materially; sign-up stores it so users get re-prompted.
export const TERMS_VERSION = '2026-10-11';
export const CONTACT_EMAIL = 'benparrack@gmail.com';
const GOVERNING_LAW = 'the Commonwealth of Virginia, USA';

const mail = () => h('a', { href: `mailto:${CONTACT_EMAIL}` }, CONTACT_EMAIL);
const link = (href, text) => h('a', { href, 'data-link': true }, text);
const ext = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text || href);
const sec = (title, ...body) => h('section', h('h2', title), ...body);
const p = (...c) => h('p', ...c);
const ul = (...items) => h('ul', items.map((i) => h('li', i)));

function page(title, intro, ...sections) {
  return h('article.info-page',
    h('h1', title),
    intro && h('p.muted', intro),
    ...sections,
    h('nav.info-footer', footerLinks()));
}

// Also usable as the site-wide footer on non-game screens.
export function footerLinks() {
  return [
    link('/terms', 'Terms'), ' · ', link('/privacy', 'Privacy'), ' · ', link('/rules', 'Rules'),
    ' · ', link('/about', 'About'), ' · ', link('/credits', 'Credits'), ' · ',
    h('a', { href: `mailto:${CONTACT_EMAIL}` }, 'Contact'),
  ];
}

const terms = () => page('TERMS OF SERVICE', `Version ${TERMS_VERSION}`,
  sec('1. Who can use Game Terminal',
    p('You must be at least 13 years old to create an account. If you are under the age of digital consent where you live (16 in some EU countries), you need a parent or guardian\'s permission. Guests can play without an account.')),
  sec('2. Your account',
    p('You are responsible for your account and for keeping your sign-in secure. Usernames must follow the ', link('/rules', 'Community Guidelines'), '. We may rename an account whose name breaks them.')),
  sec('3. Acceptable use', p('Don\'t:'),
    ul('cheat, script, bot, or exploit bugs to gain an advantage over other players;',
      'harass, threaten, or impersonate anyone, or post hateful, sexual, or illegal content;',
      'spam chat, post links to malware or scams, or advertise;',
      'try to break, overload, or get unauthorised access to the service or other accounts;',
      'scrape the site or collect other users\' data.'),
    p('If you find a bug or security issue, please tell us at ', mail(), ' instead of exploiting it.')),
  sec('4. Chat',
    p('Chat is filtered automatically, but you are responsible for what you write. Messages can be reported; reported messages are kept so a moderator can review them. Don\'t share personal information (address, phone number, passwords) in chat.')),
  sec('5. Moderation and termination',
    p('We may mute, suspend, or delete accounts that break these Terms or the Community Guidelines, with or without warning, depending on how serious the problem is. You can delete your account at any time from your account settings or by emailing ', mail(), '.')),
  sec('6. Content',
    p('Drawings, chat messages, and other things you create in games stay yours, but you give us permission to display them to other players as part of the game. The games\' bundled third-party content is listed on the ', link('/credits', 'Credits'), ' page under its own licenses.')),
  sec('7. No warranty',
    p('Game Terminal is a free hobby project provided "as is" and "as available", without warranties of any kind. Games may change, reset, or disappear; stats and leaderboards may be wiped. To the maximum extent the law allows, we are not liable for any indirect or consequential loss arising from your use of the service.')),
  sec('8. Changes',
    p('We may update these Terms. If a change is significant, we\'ll ask you to accept the new version the next time you sign in.')),
  sec('9. Governing law',
    p(`These Terms are governed by the laws of ${GOVERNING_LAW}. Nothing here limits rights you have under mandatory consumer protection law where you live.`)),
  sec('10. Contact', p('Questions: ', mail(), '.')));

const privacy = () => page('PRIVACY POLICY', `Version ${TERMS_VERSION}`,
  sec('The short version',
    p('We collect only what the games need to work. There are no ads, no analytics, no tracking cookies, and we never sell your data.')),
  sec('What we collect',
    ul('Guests: nothing is stored. A temporary connection ID and your chosen nickname exist only while you\'re connected.',
      'Accounts: your email address and sign-in provider (handled by Firebase Authentication), your username, avatar, settings, and the date you accepted the Terms.',
      'Game data: stats, match history, ratings, achievements, and leaderboard entries for games you play while signed in.',
      'Games by turns: the board, whose move it is, and both players\' usernames for a game you play by turns with a friend, until either of you removes it or deletes their account.',
      'Social: your friends list and friend requests, and the last 50 direct messages per conversation.',
      'Chat: the most recent 100 global chat messages are saved so chat survives a server restart; older ones are deleted as new ones arrive. Room and party chat are held in server memory only and gone when the room or party ends. A message someone reports is copied, with the chat around it, into the moderation queue (see Retention below). Deleting your account deletes your messages and DM conversations.',
      'Reports and moderation actions (mutes, bans) linked to your account.',
      'Server logs: IP addresses and request info, kept briefly by our host for security and abuse prevention. If the site hits a bug in your browser, it sends the error message, the page you were on and your browser version to these logs so we can fix it. Nothing that identifies you is attached.')),
  sec('Why we use it',
    p('To run your account and the games (contract), and to keep the service safe from abuse and cheating (legitimate interest). We don\'t use your data for advertising or profiling.')),
  sec('Who processes it',
    ul(['Google Firebase (Authentication and Firestore database), Google LLC. ', ext('https://firebase.google.com/support/privacy', 'Firebase privacy')],
      ['Render (web hosting), Render Services, Inc. ', ext('https://render.com/privacy', 'Render privacy')],
      'Google Fonts serves the site\'s pixel font, so your browser requests it from Google.'),
    p('These providers may process data outside your country, including in the United States, under standard contractual clauses.')),
  h('section#storage', h('h2', 'Cookies and local storage'),
    p('We only use storage that\'s strictly necessary: Firebase\'s sign-in session, your settings (sound, controls, chat layout), and the room you\'re in so a refresh puts you back, all in your browser\'s local storage. No consent banner is needed because there are no analytics or advertising cookies. If that ever changes, we\'ll ask first.')),
  sec('How long we keep it',
    p('Account data is kept until you delete your account. Deleting it removes your profile, stats, match history, games by turns, friends, and messages; your username is freed. Shared records (for example, a head-to-head match against you on someone else\'s history) are anonymised. Resolved reports may be kept for up to 12 months to handle repeat abuse.')),
  sec('Your rights',
    p('Under the GDPR and similar laws you can access, export, correct, or delete your data, object to processing, and complain to your local data protection authority. Most of this you can do from your account settings; for anything else email ', mail(), ' and we\'ll reply within 30 days.')),
  sec('Children',
    p('Accounts are for people 13 and over. If you believe a child under 13 has made an account, email ', mail(), ' and we\'ll delete it.')),
  sec('Changes',
    p('If we change this policy significantly, we\'ll ask you to review it the next time you sign in.')));

const rules = () => page('COMMUNITY GUIDELINES', 'Keep it fun for everyone.',
  sec('Be decent',
    ul('No harassment, bullying, threats, or hate speech of any kind.',
      'No sexual content, and nothing involving minors, ever.',
      'Trash talk about the game is fine. Attacks on the person aren\'t.')),
  sec('Play fair',
    ul('No cheats, scripts, macros, or exploiting bugs.',
      'Don\'t throw games or win-trade to farm stats or leaderboard spots.',
      'Don\'t quit on purpose just to deny someone a win.')),
  sec('Keep chat clean',
    ul('No spam, flooding, ads, or links to scams or malware.',
      'Don\'t share anyone\'s personal info, including your own.',
      'Don\'t impersonate other players, moderators, or the developer.')),
  sec('Names and drawings',
    p('Usernames, avatars, and drawings in drawing games follow the same rules. Offensive names get renamed.')),
  sec('Reporting',
    p('Use the report button on a chat message or profile. Reports are reviewed by a person. False or spammy reports are themselves against the rules.')),
  sec('What happens',
    p('Depending on how serious it is: a warning, a chat mute, a temporary ban, or a permanent ban. Severe cases (threats, sexual content involving minors) are permanent on the first offence. See the ', link('/terms', 'Terms of Service'), '.')),
  sec('If we act on your account',
    p('Decisions are made by a person, not automatically. You get a notice saying what we did, which rule it was for, and for how long. If you think we got it wrong, email ', mail(), ' within 6 months with your username and we\'ll review it again.')));

const FAQ = [
  ['Is it free?', 'Yes. No ads, no payments, no premium tier.'],
  ['Do I need an account?', 'No. Guests can play every game. An account adds stats, leaderboards, friends, global chat, and match history.'],
  ['How do I play with friends?', 'Create a room and share the room code or invite link. Friends join from the menu or by opening the link. Signed in, you can also challenge a friend to a game by turns (chess, checkers, four in a row and more) and each move whenever you\'re on.'],
  ['Can I play alone?', 'Most games have bots at several difficulty levels, and some have solo modes.'],
  ['Does it work on my phone?', 'Most games do. A few (the 3D and Game Boy games) are best on a computer with a keyboard.'],
  ['Someone is being abusive. What do I do?', ['Report them with the report button and read the ', link('/rules', 'Community Guidelines'), '.']],
  ['How do I delete my account?', ['From your account settings, or email ', mail(), '.']],
  ['I found a bug.', ['Thanks. Email ', mail(), ' with the game and what happened.']],
];

const about = () => page('ABOUT', null,
  p('Game Terminal is a free collection of 50+ multiplayer browser games: board games, card games, word games, party games, arcade games, and a Game Boy with homebrew titles. No downloads, no ads. Open it, make a room, and play with friends.'),
  p('It\'s a hobby project built by Ben Parrack, with a lot of help from Claude.'),
  sec('FAQ', ...FAQ.map(([q, a]) => h('div.faq', h('h3', q), p(a)))));

// [name, author/notice, license, source]
const CREDITS = [
  ['Three.js', 'Copyright 2010–2021 Three.js Authors', 'MIT', 'https://github.com/mrdoob/three.js'],
  ['Firebase JS SDK', 'Google LLC', 'Apache-2.0', 'https://github.com/firebase/firebase-js-sdk'],
  ['VT323 font', 'Peter Hull', 'SIL Open Font License 1.1', 'https://fonts.google.com/specimen/VT323'],
  ['ENABLE word list', 'Alan Beale, M. Cooper', 'Public domain', 'https://github.com/dolph/dictionary'],
  ['google-10000-english (no swears)', 'Josh Kaufman', 'MIT (derived from Google Web Trillion Word Corpus)', 'https://github.com/first20hours/google-10000-english'],
  ['SCOWL / american-english word list', 'Kevin Atkinson and contributors', 'SCOWL license (permissive)', 'http://wordlist.aspell.net/'],
];
// Game Boy room homebrew, from public/games/gameboy/roms/README.txt (license files ship next to the ROMs).
const ROMS = [
  ['µCity v1.3', 'Antonio Niño Díaz', 'GPL-3.0', 'https://github.com/AntonioND/ucity'],
  ['Geometrix', 'Antonio Niño Díaz', 'GPL-3.0', 'https://github.com/AntonioND/geometrix'],
  ['Libbet and the Magic Floor v0.08', 'Damian Yerrick', 'zlib', 'https://github.com/pinobatch/libbet'],
  ['Big2Small v1.0.0', 'Matthew D. Steele', 'GPL-3.0', 'https://github.com/mdsteele/big2small'],
  ['Tobu Tobu Girl Deluxe', '2017 Tangram Games', 'Code MIT; assets CC BY 4.0', 'https://github.com/SimonLarsen/tobutobugirl-dx'],
  ['Porklike GB', '2021 Ben Smith (binji)', 'MIT', 'https://github.com/binji/porklike.gb'],
  ['Shock Lobster', '2021 Dave VanEe (tbsp)', 'zlib', 'https://github.com/tbsp/shock-lobster'],
  ['Adjustris v1.1', 'Dave VanEe (tbsp)', 'CC0 1.0', 'https://github.com/tbsp/Adjustris'],
  ['2048-gb', '2014 Sanqui', 'zlib', 'https://github.com/Sanqui/2048-gb'],
  ['Link Cycles', '2026 Ben Parrack', 'MIT', null],
];
const creditList = (rows) => h('ul.credits', rows.map(([name, by, lic, src]) =>
  h('li', h('strong', name), ` · © ${by}. ${lic}.`, src && [' ', ext(src, 'Source')])));

const credits = () => page('CREDITS & LICENSES', 'Game Terminal stands on the work of these people and projects. Thank you.',
  sec('Libraries, fonts, and data', creditList(CREDITS)),
  sec('Game Boy homebrew', p('Bundled unmodified. Full license texts ship alongside the ROMs in ',
    ext('/games/gameboy/roms/README.txt', 'games/gameboy/roms/'), '.'), creditList(ROMS)),
  sec('Classic games', p('Chess, checkers, backgammon, mancala and the other traditional games are in the public domain. Our other games are original takes on common game mechanics and aren\'t affiliated with or endorsed by any game, toy or app maker. Game Boy is a trademark of Nintendo; the emulator plays freely licensed homebrew and isn\'t affiliated with Nintendo.')));

export const INFO_PAGES = {
  '/terms': { title: 'Terms of Service', render: terms },
  '/privacy': { title: 'Privacy Policy', render: privacy },
  '/rules': { title: 'Community Guidelines', render: rules },
  '/about': { title: 'About & FAQ', render: about },
  '/credits': { title: 'Credits', render: credits },
};
