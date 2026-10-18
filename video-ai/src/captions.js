// Textvorschläge pro Plattform – freundlich, bodenständig, je Kanal passend.
// Läuft komplett lokal über Vorlagen (keine Kosten). Jeder Aufruf mischt die
// Bausteine neu, so liefert „Neue Vorschläge“ jedes Mal eine andere Variante.

const CATEGORIES = {
  automat: {
    label: 'Automatenbefüllung',
    emoji: '🥪',
    hooks: [
      'Frisch nachgefüllt!',
      'So kommt das Frühstück in den Automaten.',
      'Volle Fächer, gute Laune.',
      'Heute wieder unterwegs für eure Pause.',
    ],
    stories: [
      'Unsere Fahrer sind jeden Tag früh unterwegs, damit die Automaten bei unseren Kunden voll und frisch sind.',
      'Bevor die erste Pause beginnt, ist bei uns schon alles nachgefüllt – frisch, kontrolliert und mit einem Lächeln.',
      'Fach für Fach, Produkt für Produkt: So sieht ein ganz normaler Morgen auf Tour aus.',
    ],
    tags: ['Automat', 'Verpflegung', 'Frühstück', 'Snacks', 'Pausenverpflegung'],
  },
  kunde: {
    label: 'Kundentermin',
    emoji: '🤝',
    hooks: [
      'Zu Besuch bei unseren Kunden.',
      'Gute Verpflegung beginnt mit einem guten Gespräch.',
      'Heute vor Ort beim Kunden.',
    ],
    stories: [
      'Wir hören zu, schauen genau hin und finden gemeinsam die Verpflegung, die zum Betrieb passt.',
      'Jeder Betrieb ist anders – darum schauen wir uns vor Ort an, was die Mannschaft wirklich braucht.',
      'Ein Termin, ein Handschlag, eine Lösung: So arbeiten wir mit unseren Kunden.',
    ],
    tags: ['Betriebsverpflegung', 'Kunden', 'Partnerschaft', 'Mitarbeiterverpflegung'],
  },
  produktion: {
    label: 'Produktion',
    emoji: '👩‍🍳',
    hooks: [
      'Ein Blick in unsere Küche.',
      'Hier entsteht eure Jause.',
      'Frisch gemacht – jeden Tag.',
    ],
    stories: [
      'In unserer Produktion wird jeden Tag frisch belegt, gekocht und verpackt – mit guten Zutaten und viel Handarbeit.',
      'Was später im Automaten landet, entsteht hier: frisch, sorgfältig und mit Liebe zum Detail.',
      'Unser Team in der Produktion sorgt dafür, dass jede Pause ein bisschen besser schmeckt.',
    ],
    tags: ['Frischküche', 'Produktion', 'Handarbeit', 'Regional', 'Jause'],
  },
  lager: {
    label: 'Lager & Logistik',
    emoji: '📦',
    hooks: [
      'Ordnung muss sein.',
      'Hinter den Kulissen im Lager.',
      'Damit alles pünktlich ankommt.',
    ],
    stories: [
      'Bevor etwas in den Automaten kommt, wird es bei uns im Lager kommissioniert, kontrolliert und tourfertig gemacht.',
      'Gute Verpflegung braucht gute Logistik – unser Lagerteam macht das jeden Tag möglich.',
      'Kühlkette, Tourplanung, Ordnung: Das passiert, bevor unsere Fahrer losstarten.',
    ],
    tags: ['Logistik', 'Lager', 'Teamwork', 'Kühlkette'],
  },
  technik: {
    label: 'Technik & Service',
    emoji: '🔧',
    hooks: [
      'Service, der läuft.',
      'Unsere Technik im Einsatz.',
      'Kurz geschraubt, schon läuft’s wieder.',
    ],
    stories: [
      'Wenn ein Automat zickt, sind unsere Techniker schnell vor Ort – damit die Pause nicht ausfällt.',
      'Wartung, Reparatur, Kontrolle: Unser Serviceteam hält die Automaten in Schuss.',
    ],
    tags: ['Service', 'Technik', 'Wartung', 'Automat'],
  },
  team: {
    label: 'Team',
    emoji: '💚',
    hooks: [
      'Das sind wir.',
      'Gesichter hinter GR·EAT.',
      'Ein starkes Team.',
    ],
    stories: [
      'Hinter jeder vollen Pause steckt ein Team, das anpackt – heute stellen wir euch ein Stück davon vor.',
      'Wir sind ein bodenständiges Team mit einem Ziel: gute Verpflegung für jeden Betrieb.',
    ],
    tags: ['Team', 'Arbeitgeber', 'Mitarbeiter', 'Teamwork'],
  },
  sonstiges: {
    label: 'Sonstiges',
    emoji: '✨',
    hooks: ['Ein Tag bei GR·EAT.', 'Neues von GR·EAT.', 'Aus unserem Alltag.'],
    stories: [
      'Ein kleiner Einblick in unseren Alltag bei GR·EAT Betriebsverpflegung.',
      'So sieht es bei uns hinter den Kulissen aus.',
    ],
    tags: ['Alltag', 'BehindTheScenes'],
  },
};

const BRAND_TAGS = ['GREAT', 'GREATBetriebsverpflegung', 'Betriebsverpflegung'];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5);
const hashtags = (tags) => [...new Set(tags)].map((t) => `#${t.replace(/[^\p{L}\p{N}]/gu, '')}`).join(' ');

const cleanSentence = (s) => {
  s = (s || '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  s = s[0].toUpperCase() + s.slice(1);
  return /[.!?…]$/.test(s) ? s : `${s}.`;
};

// Ein kurzes, gut klingendes Zitat aus dem Gesprochenen (falls vorhanden).
function quoteFromTranscript(segments = []) {
  const sentences = segments
    .map((s) => s.text.trim())
    .join(' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.split(' ').length >= 4 && s.length <= 140);
  return sentences[0] || '';
}

function generateTexts({ category = 'sonstiges', note = '', location = '', transcript } = {}) {
  const c = CATEGORIES[category] || CATEGORIES.sonstiges;
  const hook = pick(c.hooks);
  const story = pick(c.stories);
  const detail = cleanSentence(note);
  const quote = quoteFromTranscript(transcript?.segments);
  const where = location ? ` bei ${location}` : '';
  const tags = shuffle(c.tags);

  const instagram = [
    `${hook} ${c.emoji}`,
    '',
    detail || story,
    quote ? `\n„${quote}“` : '',
    '',
    pick(['Was ist euer Pausen-Favorit? Schreibt’s in die Kommentare 👇', 'Folgt uns für mehr Einblicke hinter die Kulissen 💚', 'Wer freut sich schon auf die nächste Pause? 🙋']),
    '',
    hashtags([...BRAND_TAGS, ...tags, 'Reels', 'Österreich', 'Pause']),
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');

  const facebook = [
    `${hook}${where ? ` Heute${where}.` : ''} ${c.emoji}`,
    '',
    [detail, story].filter(Boolean).join(' '),
    quote ? `\nWie unser Kollege so schön sagt: „${quote}“` : '',
    '',
    pick(['Wie schaut bei euch die Pause aus? Wir sind gespannt!', 'Danke an unser Team für den Einsatz – ihr seid spitze!', 'Habt ihr Fragen zur Verpflegung in eurem Betrieb? Meldet euch gern bei uns.']),
    '',
    hashtags([...BRAND_TAGS.slice(0, 2), tags[0]]),
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');

  const linkedin = [
    `${hook.replace(/!$/, '.')} ${pick(['Ein Einblick in unseren Arbeitsalltag.', 'Ein Blick hinter die Kulissen.', 'So sieht Betriebsverpflegung in der Praxis aus.'])}`,
    '',
    [detail, story].filter(Boolean).join(' '),
    quote ? `\n„${quote}“` : '',
    '',
    pick([
      'Gute Verpflegung ist mehr als ein Automat: Sie zeigt Wertschätzung für die Menschen, die jeden Tag im Betrieb arbeiten.',
      'Zufriedene Mitarbeiter beginnen oft bei den kleinen Dingen – zum Beispiel bei einer guten Pause.',
      'Danke an unser Team, das das jeden Tag möglich macht.',
    ]),
    '',
    pick(['Sie möchten Ihre Mitarbeiterverpflegung verbessern? Sprechen Sie uns an.', 'Wir suchen laufend Verstärkung – schauen Sie gern bei uns vorbei.', 'Mehr über GR·EAT Betriebsverpflegung auf unserer Website.']),
    '',
    hashtags(['Betriebsverpflegung', 'Mitarbeiterverpflegung', tags[0], tags[1] || 'Teamwork', 'Arbeitgeber']),
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');

  const ytTitle = `${hook.replace(/[.!]$/, '')} – ${c.label} bei GR·EAT #Shorts`.slice(0, 100);
  const youtube = {
    title: ytTitle,
    description: [
      [detail, story].filter(Boolean).join(' '),
      quote ? `\n„${quote}“` : '',
      '',
      'GR·EAT Betriebsverpflegung – frische Verpflegung für Betriebe, jeden Tag.',
      'Abonniert uns für mehr Einblicke hinter die Kulissen!',
      '',
      hashtags(['Shorts', ...BRAND_TAGS.slice(0, 2), ...tags.slice(0, 2)]),
    ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n'),
  };

  const tiktok = [
    `${pick([hook, `POV: ${c.label.toLowerCase()} bei GR·EAT`, `Ein ganz normaler Tag: ${c.label}`])} ${c.emoji}`,
    detail && detail.length < 120 ? detail : '',
    hashtags(['GREAT', ...tags.slice(0, 2), 'BehindTheScenes', 'Arbeitsalltag', 'FoodTok']),
  ].filter(Boolean).join('\n');

  return {
    instagram: { caption: instagram },
    facebook: { caption: facebook },
    linkedin: { caption: linkedin },
    youtube,
    tiktok: { caption: tiktok.slice(0, 2200) },
  };
}

module.exports = { generateTexts, CATEGORIES };
