// Store policies: one markdown file, one section per "## " heading. The agent
// searches them with a tool and cites them by id.
export type Policy = { id: string; title: string; body: string };

export function parsePolicies(markdown: string): Policy[] {
  return markdown
    .split(/^## /m)
    .slice(1)
    .map((part) => {
      const [title, ...rest] = part.split("\n");
      return {
        id: title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        title: title.trim(),
        body: rest.join(" ").replace(/\s+/g, " ").trim(),
      };
    });
}

const STOP = new Set(
  "the and for you your our are was with this that have has not but from what when how any all can will would could just about into they them their then than there here also been".split(" "),
);

// Crude stemming, enough for "refunded" to meet "refunds" and "shipping" to meet "ships".
function stem(word: string) {
  return word.replace(/(ing|ed|es|s|e)$/, "").replace(/([b-df-hj-np-tv-z])\1$/, "$1");
}

function terms(text: string) {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w)).map(stem);
}

// ponytail: keyword scoring (term frequency x inverse document frequency) over a
// handful of sections; move to PostgreSQL full-text search or embeddings when the
// policy set grows past what fits in memory.
export function searchPolicies(policies: Policy[], query: string, limit = 3): Policy[] {
  const wanted = [...new Set(terms(query))];
  if (!wanted.length) return [];
  const docs = policies.map((p) => ({ p, title: terms(p.title), body: terms(p.body) }));
  const idf = (t: string) => Math.log(1 + docs.length / (1 + docs.filter((d) => d.title.includes(t) || d.body.includes(t)).length));
  return docs
    .map(({ p, title, body }) => ({
      p,
      score: wanted.reduce((sum, t) => sum + idf(t) * (3 * title.filter((w) => w === t).length + body.filter((w) => w === t).length), 0),
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.p);
}
