// The correction rules, applied to Mux's auto-generated subtitles on the fly.
// Mirrors the pass that produced transcripts-corrected/ so the two stay in step.

const GENUINE_CALM = new Set(['and','to','really','feel','feels','felt','stay','stayed',
  'staying','remain','keep','kept','so','very','more','quite','being','be','nice','breath','breathe','deep','staying','sound','sounds']);

// "coming" that genuinely means arriving or a thank-you.
const LEAVE = [
  /(?:thanks?|thank you)[^.]{0,40}\bfor coming\b/i,
  /\bfor coming\b/i,
  /\b(?:it|that|this|something|christmas|winter|summer|spring|autumn)(?:'s| is| was)?\s+coming\b/i,
  /\b(?:people|clients?|subs?|men|guys|regulars?|customers?|everyone|someone|anyone|nobody|anybody|they|them|he|she|you)\s+(?:are |is |keep |keeps |kept |were |was )?coming\b/i,
  /\bcoming\s+(?:back|up|in|into|to|from|through|out|along|across|towards?|down|at|over|around|online|home|here|there|off|onto)\b/i,
];

// "coming" that is really the job.
const CAMMING = [
  /\bcoming full time\b/i,
  /\b(?:start|started|starting|stop|stopped|quit|quitting)\s+coming\b/i,
  /\b(?:styles?|type|kind|way|ways)\s+of\s+coming\b/i,
  /\b(?:about|throughout|since|during|with|at|to|of|in)\s+coming\b/i,
  /\b(?:i'm|you're|we're|they're|i am|you are|we are)\s+coming\b(?!\s+(?:back|up|in|to|from|out|through|along|down|over|online))/i,
  /\bbeen coming\b(?!\s+(?:back|up|in|to|from|out|through|along|down|over|online))/i,
  /\bday one coming\b/i,
];

// Judgement calls, keyed to surrounding words rather than position.
const KEYS = ["also coming on this site","same as coming","going to be coming with",
 "normal life and coming","we have coming for fun money","carry on coming for fun money",
 "for their coming set","start coming again","supporter of me coming","back into coming again",
 "we're still coming","who's coming styles","been coming for two weeks",
 "are just coming with a little","about women coming","neurospicy web coming",
 "mentor around coming","i was coming a lot","just coming anywhere",
 "you're coming, you know, to see how much","done with coming so far",
 "in work is like, you know, coming","not only coming with us","probably coming with more girls",
 "they're only coming","enjoy coming with","love coming with my partner",
 "bother coming with this woman","might be coming and you've got no profile",
 "if you're not coming","when you're coming with","just cozy coming","be coming all the time",
 "in the coming industry","feel good coming","if i was coming","if i wasn't coming",
 "i love coming and i'll"];


// Proper nouns and brand names. These run last, after calm->cam and
// coming->camming, because some of them only exist once those have applied
// ("ethical calm community" -> "ethical cam community" -> "Ethical Cam Community").
const NOUNS = [
  [/\bethical cam community\b/gi, 'Ethical Cam Community'],
  [/\bethical cam\b(?! community)/gi, 'Ethical Cam'],
  [/\badult ?work\b/gi, 'AdultWork'],
  [/\blove ends\b/gi, 'Lovense'],
  [/\bJOHI\b/gi, 'JOI'],
  [/\bJOH\b/gi, 'JOI'],
  [/\bJUI\b/g, 'JOI'],
  [/\bJecoth\b/gi, 'Jerk-off'],
  [/\bCampbell\b/gi, 'Kambo'],
  [/\bonly ?fans\b/gi, 'OnlyFans'],
  [/\btwitter\b/gi, 'Twitter'],
  [/\bzoom\b(?!\s+(?:in|out|into))/gi, 'Zoom'],   // "zoom in" stays a verb
  [/\bwhats ?app\b/gi, 'WhatsApp'],
  [/\binstagram\b/gi, 'Instagram'],
  [/\btik ?tok\b/gi, 'TikTok'],
  [/\bpay ?pal\b/gi, 'PayPal'],
  [/\bsnap ?chat\b/gi, 'Snapchat'],
];

const TS = /\d+\s+\d{2}:\d{2}:\d{2}\.\d+\s*-->\s*\d{2}:\d{2}:\d{2}\.\d+/g;

function matchCase(src, repl) {
  if (src === src.toUpperCase() && /[A-Z]/.test(src)) return repl.toUpperCase();
  if (src[0] === src[0].toUpperCase()) return repl[0].toUpperCase() + repl.slice(1);
  return repl;
}

export function correct(vtt) {
  let t = vtt;
  const counts = {};
  const bump = (k) => { counts[k] = (counts[k] || 0) + 1; };

  t = t.replace(/\bCrohn\b(?!'s)/gi, (m) => { bump('Crohn'); return matchCase(m, 'Crone'); });
  t = t.replace(/\bFX\b/g, () => { bump('FX'); return 'ethics'; });
  t = t.replace(/\bweb ?camp\b/gi, (m) => { bump('webcam'); return matchCase(m, 'webcam'); });
  t = t.replace(/\bweb cam\b/gi, (m) => { bump('webcam'); return matchCase(m, 'webcam'); });
  t = t.replace(/\bcam+ing\b/gi, (m) =>
    m.toLowerCase() === 'camming' ? m : (bump('Caming'), matchCase(m, 'camming')));
  // "sob"/"sobs" is always a mis-hear of dom/sub vocabulary in this library.
  // Checked all 169 transcripts: no genuine sobbing anywhere. Whisper sometimes
  // capitalises it as an acronym ("your SOB"), so force lower case unless the
  // source was sentence-initial.
  t = t.replace(/\bsob(s?)\b(?!\s+(?:story|stories))/gi, (m, plural) => {
    bump('sob');
    const word = 'sub' + (plural ? 's' : '');
    const initialCapOnly = m[0] === m[0].toUpperCase() && m.slice(1) === m.slice(1).toLowerCase();
    return initialCapOnly ? word[0].toUpperCase() + word.slice(1) : word;
  });

  t = t.replace(/\bpay effects?\b/gi, (m) => { bump('payEffect'); return matchCase(m, 'perfect'); });

  // calm -> cam unless a genuine-calm cue precedes or follows it.
  // The trailing guard catches "take a deep breath, calm down", where the
  // preceding word is punctuation and the leading whitelist can't help.
  t = t.replace(/(\b[\w']+[\s,;:-]+)?\b(calm)\b(?!\s+(?:down|yourself|myself|himself|herself|themselves))/gi, (m, prev, word) => {
    if (prev && GENUINE_CALM.has(prev.trim().replace(/[^\w']/g, '').toLowerCase())) return m;
    bump('calm');
    return (prev || '') + matchCase(word, 'cam');
  });

  // coming -> camming, context by context
  t = t.replace(/\bcoming\b/gi, (m, off, whole) => {
    const win  = whole.slice(Math.max(0, off - 60), off + m.length + 40).replace(TS, ' ');
    const near = whole.slice(Math.max(0, off - 35), off + m.length + 25).replace(TS, ' ');
    const flat = win.replace(/\s+/g, ' ').toLowerCase();
    const keyed = KEYS.some((k) => flat.includes(k));
    if (!keyed && LEAVE.some((rx) => rx.test(win))) return m;
    if (CAMMING.some((rx) => rx.test(near)) || keyed) { bump('coming'); return matchCase(m, 'camming'); }
    return m;
  });

  // two phrasings that read badly once corrected
  t = t.replace(/\bcam-in\b/gi, (m) => matchCase(m, 'camming'));
  t = t.replace(/having\s+cam,\s*cam\s+confidence/gi, 'having cam confidence');

  for (const [rx, repl] of NOUNS) {
    t = t.replace(rx, (m) => { if (m !== repl) bump(repl); return repl; });
  }

  return { text: t, counts };
}
