#!/usr/bin/env python3
"""Pre-generate Spelling Bee pronunciation audio.

Every word in server/games/data/spellingbee_words.json gets two clips: the
word on its own and its example sentence. Files are named by random IDs and
the word -> ID map lives server-side (server/games/data/spellingbee_audio.json),
so the client can play a word without ever being sent its spelling.

Setup (once, any venv):
  pip install piper-tts            # plus faster-whisper "av<19" for --verify
  python -m piper.download_voices en_US-lessac-high   # or fetch the .onnx/.json
Run from game_terminal/:
  python scripts/spellingbee-audio.py --voice path/to/en_US-lessac-high.onnx
  python scripts/spellingbee-audio.py --verify   # whisper round-trip report
Existing IDs are kept, so re-running only adds clips for new words
(--force regenerates every clip in place).
"""
import argparse, json, os, re, secrets, subprocess, sys, tempfile, wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORDS = os.path.join(ROOT, 'server/games/data/spellingbee_words.json')
MANIFEST = os.path.join(ROOT, 'server/games/data/spellingbee_audio.json')
OUT = os.path.join(ROOT, 'public/games/spellingbee/audio')

# espeak-ng (piper's phonemizer) gets these wrong; hand-checked US IPA.
IPA = {
    'though': 'ðˈoʊ',
    'medieval': 'mˌɛdiˈiːvəl',
    'handkerchief': 'hˈæŋkɚtʃɪf',
    'sesquipedalian': 'sˌɛskwɪpɪdˈeɪliən',
    'dachshund': 'dˈɑːkshʊnd',
    'diphtheria': 'dɪfθˈɪɹiə',
    'pterodactyl': 'tˌɛɹədˈæktəl',
    'bouillon': 'bˈʊljɑːn',
    'chiaroscuro': 'kiˌɑːɹəskˈʊɹoʊ',
    'daguerreotype': 'dəɡˈɛɹoʊtˌaɪp',
    'flibbertigibbet': 'flˈɪbɚɾiˌdʒɪbɪt',
    'gubernatorial': 'ɡˌuːbɚnətˈɔːɹiəl',
    'idiosyncrasy': 'ˌɪdiəsˈɪŋkɹəsi',
    'jodhpurs': 'dʒˈɑːdpɚz',
    'potpourri': 'pˌoʊpʊɹˈiː',
    'schadenfreude': 'ʃˈɑːdənfɹˌɔɪdə',
    'vichyssoise': 'vˌɪʃiswˈɑːz',
    'appoggiatura': 'əpˌɑːdʒətˈʊɹə',
    'bivouac': 'bˈɪvuːˌæk',
    'chlorophyll': 'klˈɔːɹəfˌɪl',
    'curmudgeon': 'kɚmˈʌdʒən',
    'cynosure': 'sˈaɪnəʃˌʊɹ',
    'eleemosynary': 'ˌɛləmˈɑːsənˌɛɹi',
    'logorrhea': 'lˌɔːɡəɹˈiːə',
    'persnickety': 'pɚsnˈɪkəɾi',
    'rapprochement': 'ɹˌæpɹoʊʃmˈɑːn',
    'staphylococcus': 'stˌæfələkˈɑːkəs',
    'succedaneum': 'sˌʌksɪdˈeɪniəm',
    'synecdoche': 'sɪnˈɛkdəki',
    'terpsichorean': 'tˌɜːpsɪkəɹˈiːən',
    'verisimilitude': 'vˌɛɹəsɪmˈɪlɪtˌuːd',
}


def spoken(entry, text):
    ipa = IPA.get(entry['w'])
    if not ipa:
        return text
    return re.sub(r'\b%s\b' % re.escape(entry['w']), '[[ %s ]]' % ipa, text, flags=re.I)


def entries():
    data = json.load(open(WORDS))
    return [e for tier in data.values() for e in tier]


def load_manifest():
    return json.load(open(MANIFEST)) if os.path.exists(MANIFEST) else {}


def generate(args):
    from piper import PiperVoice, SynthesisConfig
    voice = PiperVoice.load(args.voice)
    manifest = load_manifest()
    os.makedirs(OUT, exist_ok=True)
    words = entries()
    for i, e in enumerate(words):
        ids = manifest.setdefault(e['w'], {})
        for kind, text, scale in (('w', e['w'] + '.', 1.15), ('s', e['s'], 1.0)):
            ids.setdefault(kind, secrets.token_hex(8))
            path = os.path.join(OUT, ids[kind] + '.mp3')
            if os.path.exists(path) and not args.force:
                continue
            with tempfile.NamedTemporaryFile(suffix='.wav') as tmp:
                with wave.open(tmp.name, 'wb') as wf:
                    voice.synthesize_wav(spoken(e, text), wf, syn_config=SynthesisConfig(length_scale=scale))
                subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', tmp.name, '-ac', '1',
                                '-codec:a', 'libmp3lame', '-b:a', '40k', path], check=True)
        print('\r%d/%d %s' % (i + 1, len(words), e['w'].ljust(24)), end='', flush=True)
    # drop clips for words no longer in the list
    keep = {e['w'] for e in words}
    for w in [w for w in manifest if w not in keep]:
        for fid in manifest.pop(w).values():
            p = os.path.join(OUT, fid + '.mp3')
            if os.path.exists(p):
                os.remove(p)
    with open(MANIFEST, 'w') as f:  # one word per line keeps diffs readable
        f.write('{\n' + ',\n'.join('%s:%s' % (json.dumps(w), json.dumps(manifest[w], separators=(',', ':'))) for w in sorted(manifest)) + '\n}\n')
    print('\nwrote %d words to %s' % (len(manifest), os.path.relpath(MANIFEST, ROOT)))


def verify(args):
    from faster_whisper import WhisperModel
    model = WhisperModel(args.model, device='cpu', compute_type='int8')
    manifest = load_manifest()
    bad = 0
    for e in entries():
        path = os.path.join(OUT, manifest[e['w']]['w'] + '.mp3')
        segs, _ = model.transcribe(path, language='en', beam_size=5)
        heard = re.sub(r'[^a-z]', '', ''.join(s.text for s in segs).lower())
        ok = heard == e['w'] or heard in e.get('a', [])
        if not ok:
            bad += 1
            print('%-18s heard %r' % (e['w'], heard))
    print('%d mismatches (rare words often mis-transcribe even when spoken right; review those by ear/IPA)' % bad)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--voice', default='en_US-lessac-high.onnx')
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--verify', action='store_true')
    ap.add_argument('--model', default='large-v3-turbo')
    a = ap.parse_args()
    (verify if a.verify else generate)(a)
