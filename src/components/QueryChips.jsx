import { describeFilters } from "../lib/filters.js";
import { queryLabel } from "../lib/query.js";
import { describeFollowers } from "../lib/sequence.js";
import { corpusColor } from "../nav.js";
import { Chip } from "./ui.jsx";

/**
 * A search as one line of chips: corpus, what it looks for, following words,
 * sentence limit, filters. The one summary used on Home and in lists.
 */
export function QueryChips({ q, corpus = true }) {
  if (!q) return null;
  return (
    <div className="row" style={{ gap: 6 }}>
      {corpus && <Chip dot={corpusColor(q.corpus)}>{q.corpus}</Chip>}
      <Chip>{queryLabel(q)}</Chip>
      {!q.manual && describeFollowers(q).map((d) => <Chip key={d}>{d}</Chip>)}
      {!q.manual && q.sentence_only && <Chip>within s</Chip>}
      {describeFilters(q).map((d) => <Chip key={d} tone="warn">{d}</Chip>)}
    </div>
  );
}
