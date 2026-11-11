import { PageHeader, resetGuides } from "../components/PageHeader.jsx";
import { ShortcutTable } from "../components/Dialogs.jsx";
import { RefreshCw } from "lucide-react";
import { Button, Card, Kbd } from "../components/ui.jsx";
import { useApp } from "../state/store.jsx";
import { openExternal } from "../lib/ipc.js";
import { modKey } from "../lib/platform.js";

export default function Help() {
  const { info, toast, setGuideOpen } = useApp();
  return (
    <div className="page">
      <PageHeader aside="read before citing" />
      <div className="grid grid--split" style={{ alignItems: "start" }}>
        <Card>
          <div className="prose">
            <h3>What the numbers mean</h3>
            <p><strong>Matches</strong> are matching token spans, not documents and not distinct word types. A two-token pattern is one match.</p>
            <p><strong>Per million</strong> rates divide by all <em>indexed tokens</em> of the corpus, which include punctuation. On the Search screen this stays the whole corpus even with filters. <strong>Compare corpora</strong> and <strong>Spread across texts</strong> divide by the size of the filtered part instead, measured from the region boundaries of the filter attributes; when the filters sit on differently divided attributes (text and utterance, say) that size cannot be measured and the app says so.</p>
            <p><strong>Per million words</strong>: select any “per million” label or a corpus size to switch from tokens to words and back. Words are tokens containing at least one letter or digit, so punctuation is left out; each corpus's word count is measured once on the server (from its word list with frequencies) and kept on this computer. For a filtered part or a group in Spread across texts, only the token size is measured, so its word count is estimated from the whole corpus's share of words and shown with ≈. Log-likelihood in Compare corpora always uses token counts.</p>
            <h3>Document filters</h3>
            <p>Each filter restricts matches to regions whose attribute has the given value. Several filters must all hold (AND); several values in one filter mean any of them (OR). <em>Is not</em> excludes values. A year range matches values that begin with a year in the range, so ranges like “1985-1993” count as their first year and values without a year never match.</p>
            <h3>All forms of a word</h3>
            <p>Where a corpus has a lemma index (BNC, BNC-BABY, BNC2014-S, CLMET, EFCAM), <strong>All forms (lexeme)</strong> finds every inflected form exactly. Brown, LOB, FLOB and Frown have none; there <strong>All forms</strong> proposes forms by rule (big → bigger, biggest; stop → stops, stopped, stopping) plus a table of common irregular words and pronoun case forms (I → me, my, mine, myself). Review the list: rules can produce non-words, and rare irregular forms may be missing.</p>
            <p><strong>Timings</strong> are client wall-clock time: SSH round trip, remote CQP and parsing. They are not backend benchmarks.</p>
            <h3>Phrases and alternatives</h3>
            <p>Use <strong>Add word</strong> to search a sequence of up to nine words, for example <em>you</em> → <em>and</em> → <em>I|me</em>. Each word can sit <strong>right after</strong> the previous one or <strong>within N words</strong> of it, and can be <strong>optional</strong> (except the last). A <code>|</code> separates alternatives, so <code>I|me</code> matches either; everything else is matched literally. Ignore case applies to every word.</p>
            <h3>Sorting, distribution and comparison</h3>
            <p><strong>Sort</strong> (Search results) reorders the whole result on the server — by the matched words, the word before or the word after — so paging and “Export up to 5,000” follow that order. Corpus order is the default.</p>
            <p><strong>Spread across texts</strong> (Analyse results) counts matches per metadata value and divides by <em>that value's own token count</em>, so a small genre is not hidden by a large one. Very small groups give unstable rates and are dimmed. In Brown, LOB, FLOB and Frown the file ids are rolled up into the standard A–R genre categories. Results with more than 200,000 matches are assigned from the first 200,000.</p>
            <p><strong>Compare corpora</strong> runs the same search — including multi-word sequences — in 2–6 corpora. Log-likelihood (G²) against the first corpus is shown with the usual thresholds (3.84 / 6.63 / 10.83 for p &lt; .05 / .01 / .001). It treats every token as independent, which overstates certainty for clustered phenomena; treat it as a screening measure, not proof.</p>
            <h3>Words, lemmas and lexemes</h3>
            <p><strong>Written word</strong> matches the exact form. <strong>All forms (lexeme)</strong> uses the corpus's headword index: <code>hw</code> in BNC/BNC-BABY, <code>lemma</code> elsewhere. In the BNC, <code>lemma</code> holds labels like <code>go_VERB</code> — searching it for <code>go</code> finds nothing.</p>
            <p>Tagsets differ: BNC uses C5, BNC2014 CLAWS7, the Brown family Brown-style tags, CLMET and EFCAM Penn-style tags. An ambiguity tag such as <code>VVG-AJ0</code> means “preferably an -ing verb, possibly an adjective”.</p>
            <h3>Combine searches</h3>
            <p>Union, intersection and difference compare <strong>exact matched spans</strong>. They are not sentence- or document-level joins. Empty intermediate results are handled safely and shown as zero.</p>
            <h3>Samples and neighbours</h3>
            <p>Random samples shuffle the <strong>whole</strong> result with a stored seed before taking N, so the same seed gives the same sample. Neighbouring-word counts use the first N matches in corpus order. They are raw positional counts, not association statistics.</p>
            <h3>Data and privacy</h3>
            <p>All access is read-only over your own SSH login. Exports and notebooks are written only on this computer, with a <code>_provenance.json</code> describing the exact query. EFCAM and BNC2014 include learner and speaker metadata — follow the university licence before sharing any export.</p>
            <h3>Updates</h3>
            <p>At start-up Hapax checks GitHub once for a newer release. If there is one, a notice lists what changed and offers <strong>Install and restart</strong>. Each release is signed, and the app refuses any download whose signature does not match the key built into it. On Linux the package manager asks for your system password to install the update.</p>
            <h3>Stopping a request</h3>
            <p><strong>Stop</strong> closes the SSH channel. The server-side process may take a moment to end, so avoid starting many heavy queries at once on the shared server.</p>
          </div>
        </Card>
        <div className="stack">
        <Card title="About" sub={`Hapax ${info?.version || ""}`}
          actions={<>
            <Button variant="ghost" onClick={() => { resetGuides(); setGuideOpen(true); toast("Guides are shown on every page until you close one (Ctrl+/ or the Guide button).", "neutral", 5000); }}>Show page guides</Button>
            <Button icon={RefreshCw} onClick={() => window.dispatchEvent(new Event("hapax:check-updates"))}>Check for updates</Button>
          </>}>
          <div className="prose" style={{ fontSize: "var(--fs-small)" }}>
            <p>Source, issues and release notes: <a href="https://github.com/Versuessen/hapax" onClick={(e) => { e.preventDefault(); openExternal("https://github.com/Versuessen/hapax"); }}>github.com/Versuessen/hapax</a>.</p>
          </div>
        </Card>
        <Card title="Keyboard shortcuts" sub="The same list opens anywhere with ? · Ctrl+K runs any command by name">
          <ShortcutTable />
        </Card>
        </div>
      </div>
    </div>
  );
}
