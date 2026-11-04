/**
 * Suggested inflected forms of an English word, for corpora without a lemma
 * index (Brown, LOB, FLOB, Frown). Rule-based with a table of common irregular
 * forms, so it can over-generate: the interface shows every form for review
 * before anything is searched.
 */
const IRREGULAR = {
  // pronouns: grammatical case and reflexive
  i: ["I", "me", "my", "mine", "myself"],
  you: ["you", "your", "yours", "yourself", "yourselves"],
  he: ["he", "him", "his", "himself"],
  she: ["she", "her", "hers", "herself"],
  it: ["it", "its", "itself"],
  we: ["we", "us", "our", "ours", "ourselves"],
  they: ["they", "them", "their", "theirs", "themselves"],
  // adjectives / adverbs
  good: ["good", "better", "best"], well: ["well", "better", "best"], bad: ["bad", "worse", "worst"],
  far: ["far", "farther", "farthest", "further", "furthest"], little: ["little", "less", "least"],
  much: ["much", "more", "most"], many: ["many", "more", "most"], old: ["old", "older", "oldest", "elder", "eldest"],
  // nouns
  man: ["man", "men", "man's", "men's"], woman: ["woman", "women", "woman's", "women's"],
  child: ["child", "children", "child's", "children's"], person: ["person", "people", "persons"],
  foot: ["foot", "feet"], tooth: ["tooth", "teeth"], mouse: ["mouse", "mice"], goose: ["goose", "geese"],
  // verbs
  be: ["be", "am", "is", "are", "was", "were", "been", "being"],
  have: ["have", "has", "had", "having"], do: ["do", "does", "did", "done", "doing"],
  go: ["go", "goes", "went", "gone", "going"], say: ["say", "says", "said", "saying"],
  get: ["get", "gets", "got", "gotten", "getting"], make: ["make", "makes", "made", "making"],
  know: ["know", "knows", "knew", "known", "knowing"], think: ["think", "thinks", "thought", "thinking"],
  take: ["take", "takes", "took", "taken", "taking"], see: ["see", "sees", "saw", "seen", "seeing"],
  come: ["come", "comes", "came", "coming"], give: ["give", "gives", "gave", "given", "giving"],
  find: ["find", "finds", "found", "finding"], tell: ["tell", "tells", "told", "telling"],
  become: ["become", "becomes", "became", "becoming"], leave: ["leave", "leaves", "left", "leaving"],
  feel: ["feel", "feels", "felt", "feeling"], bring: ["bring", "brings", "brought", "bringing"],
  begin: ["begin", "begins", "began", "begun", "beginning"], keep: ["keep", "keeps", "kept", "keeping"],
  hold: ["hold", "holds", "held", "holding"], write: ["write", "writes", "wrote", "written", "writing"],
  stand: ["stand", "stands", "stood", "standing"], hear: ["hear", "hears", "heard", "hearing"],
  mean: ["mean", "means", "meant", "meaning"], meet: ["meet", "meets", "met", "meeting"],
  run: ["run", "runs", "ran", "running"], pay: ["pay", "pays", "paid", "paying"],
  sit: ["sit", "sits", "sat", "sitting"], speak: ["speak", "speaks", "spoke", "spoken", "speaking"],
  read: ["read", "reads", "reading"], grow: ["grow", "grows", "grew", "grown", "growing"],
  lose: ["lose", "loses", "lost", "losing"], fall: ["fall", "falls", "fell", "fallen", "falling"],
  send: ["send", "sends", "sent", "sending"], build: ["build", "builds", "built", "building"],
  buy: ["buy", "buys", "bought", "buying"], eat: ["eat", "eats", "ate", "eaten", "eating"],
  drink: ["drink", "drinks", "drank", "drunk", "drinking"], drive: ["drive", "drives", "drove", "driven", "driving"],
  choose: ["choose", "chooses", "chose", "chosen", "choosing"], break: ["break", "breaks", "broke", "broken", "breaking"],
  teach: ["teach", "teaches", "taught", "teaching"], catch: ["catch", "catches", "caught", "catching"],
  fight: ["fight", "fights", "fought", "fighting"], win: ["win", "wins", "won", "winning"],
  sell: ["sell", "sells", "sold", "selling"], sing: ["sing", "sings", "sang", "sung", "singing"],
  swim: ["swim", "swims", "swam", "swum", "swimming"], fly: ["fly", "flies", "flew", "flown", "flying"],
  forget: ["forget", "forgets", "forgot", "forgotten", "forgetting"], sleep: ["sleep", "sleeps", "slept", "sleeping"],
  throw: ["throw", "throws", "threw", "thrown", "throwing"], wear: ["wear", "wears", "wore", "worn", "wearing"],
  understand: ["understand", "understands", "understood", "understanding"], spend: ["spend", "spends", "spent", "spending"],
  lie: ["lie", "lies", "lay", "lain", "lied", "lying"], lead: ["lead", "leads", "led", "leading"],
  put: ["put", "puts", "putting"], set: ["set", "sets", "setting"], let: ["let", "lets", "letting"], cut: ["cut", "cuts", "cutting"],
};

const VOWEL = /[aeiou]/;
/** Short words ending consonant-vowel-consonant double the final consonant (big → bigger, stop → stopped). */
const doubles = (w) => w.length <= 4 && /[^aeiou][aeiou][bdfgklmnprt]$/.test(w);

const syllables = (w) => (w.toLowerCase().match(/[aeiouy]+/g) || []).length;

function regular(w, cls) {
  const out = new Set([w]);
  const yStem = /[^aeiou]y$/.test(w) ? w.slice(0, -1) : null;
  const dbl = doubles(w) ? w + w.slice(-1) : null;
  if (cls === "noun") {
    out.add(/(s|x|z|ch|sh)$/.test(w) ? `${w}es` : yStem ? `${yStem}ies` : `${w}s`);
    out.add(`${w}'s`);
  } else if (cls === "verb") {
    out.add(/(s|x|z|ch|sh|o)$/.test(w) ? `${w}es` : yStem ? `${yStem}ies` : `${w}s`);
    if (w.endsWith("e")) { out.add(`${w}d`); out.add(`${w.slice(0, -1)}ing`); }
    else if (yStem) { out.add(`${yStem}ied`); out.add(`${w}ing`); }
    else if (dbl) { out.add(`${dbl}ed`); out.add(`${dbl}ing`); }
    else { out.add(`${w}ed`); out.add(`${w}ing`); }
  } else if (cls === "adjective") {
    // Only short adjectives inflect; longer ones use "more"/"most", which are separate words.
    if (syllables(w) <= 2) {
      if (w.endsWith("e")) { out.add(`${w}r`); out.add(`${w}st`); }
      else if (yStem) { out.add(`${yStem}ier`); out.add(`${yStem}iest`); }
      else if (dbl) { out.add(`${dbl}er`); out.add(`${dbl}est`); }
      else { out.add(`${w}er`); out.add(`${w}est`); }
    }
  }
  return [...out];
}

export const WORD_CLASSES = [["adjective", "Adjective"], ["verb", "Verb"], ["noun", "Noun"]];

/** Forms of one base word as a given word class. Irregular words (and pronouns)
 *  use the table whatever the class. Returns [] for phrases or patterns. */
export function wordForms(base, cls = "adjective") {
  const w = String(base || "").trim();
  if (!w || /[\s|.*+?()[\]{}\\^$]/.test(w)) return [];
  const lower = w.toLowerCase();
  return IRREGULAR[lower] ? [...IRREGULAR[lower]] : regular(lower, cls);
}

export const hasIrregular = (base) => !!IRREGULAR[String(base || "").trim().toLowerCase()];
