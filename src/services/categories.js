/** Channel category classification from names / M3U groups */

const RULES = [
  [
    "Local Broadcast",
    /\b(wcbs|wnbc|wnyw|wabc|wpix|wwor|wxtv|wfut|wnju|wnet|wliw|wlny|wmbc|wpxn|wrnn|wjlp|wasa|wnye|njtv)\b|\b(cbs|nbc|fox|abc|cw|pbs|ion|telemundo|univision|unimas|metv)\b.*\b(new york|newark|paterson|riverhead|middletown|long island)\b/i,
  ],
  [
    "Local News",
    /\b(news\s*12|ny1|spectrum news|pix11|abc7|eyewitness|nbc new york|njtv news|cuny|mnn|nyc tv|legislative)\b/i,
  ],
  [
    "News",
    /\b(cnn|msnbc|ms now|fox news|fox weather|cnbc|bloomberg|newsnation|newsmax|newsy|hln|bbc world|al jazeera|i24|c[- ]?span|cheddar|weather channel|jbs|jewish broadcasting)\b/i,
  ],
  [
    "Sports",
    /\b(espn|fs1|fs2|fox sports|nfl|nba|mlb|nhl|golf|tennis|sec network|acc network|big ten|outdoor channel|bein|willow|mavtv|racer|motor trend|redzone|cbs sports|msg|yes network|sny|fanduel|espnu|espnews)\b/i,
  ],
  [
    "Kids",
    /\b(disney|nick|cartoon|boomerang|pbs kids|universal kids|baby first|discovery family|teen nick|nicktoons|nick jr)\b/i,
  ],
  ["Music", /\b(mtv|vh1|cmt|bet jams|bet soul|fuse|revolt|axs|nickmusic|music choice|classic)\b/i],
  [
    "Movies",
    /\b(hbo|cinemax|showtime|starz|mgm|tmc|movie channel|tcm|fxm|hdnet movies|indieplex|movieplex|retroplex|hallmark movies|hallmark drama|lmn|lifetime movie)\b/i,
  ],
  [
    "Documentary",
    /\b(discovery|history|nat geo|national geographic|smithsonian|science|animal planet|id\b|investigation|military|american heroes|destination america|crime.?investigation|fyi|travel channel|tlc)\b/i,
  ],
  [
    "Lifestyle",
    /\b(hgtv|food network|cooking|diy|magnolia|own|discovery life|we tv|oxygen|bravo|e!|freeform|lifetime|hallmark)\b/i,
  ],
  ["Shopping", /\b(qvc|hsn|jewelry|shop lc|gem shopping)\b/i],
  [
    "Religious",
    /\b(ewtn|tbn|daystar|insp|impact network|word network|sonlife|catholic|byu|trinity)\b/i,
  ],
  [
    "Spanish",
    /\b(univision|unimas|telemundo|estrella|telexitos|en espa[nñ]ol|latino)\b/i,
  ],
  [
    "Entertainment",
    /\b(a&e|amc|bbc america|bet|comedy central|fx|fxx|paramount|syfy|usa|tbs|tnt|trutv|tv land|tv one|vh1|vice|ifc|sundance|logo|pop tv|buzzr|cozi|start tv|game show|great american|aspire|cleo|reelz|bounce|antenna|get tv|heroes|africa channel|up\b|wgn|fusion|all arts|create|world channel|nhk|me.?tv)\b/i,
  ],
];

export const CATEGORIES = [
  "Local Broadcast",
  "Local News",
  "News",
  "Sports",
  "Kids",
  "Music",
  "Movies",
  "Documentary",
  "Lifestyle",
  "Shopping",
  "Religious",
  "Spanish",
  "Entertainment",
  "Other",
];

const GROUP_MAP = {
  sports: "Sports",
  news: "News",
  kids: "Kids",
  animation: "Kids",
  movies: "Movies",
  music: "Music",
  religious: "Religious",
  shopping: "Shopping",
  documentary: "Documentary",
  entertainment: "Entertainment",
  comedy: "Entertainment",
  lifestyle: "Lifestyle",
  education: "Documentary",
  local: "Local Broadcast",
};

export function classifyCategory(name, fallbackGroup = "") {
  const text = name || "";
  for (const [category, pattern] of RULES) {
    if (pattern.test(text)) return category;
  }
  const g = (fallbackGroup || "").split(";")[0].trim();
  if (g && !["undefined", "other", "general", "n/a", "null", ""].includes(g.toLowerCase())) {
    const low = g.toLowerCase();
    for (const [key, cat] of Object.entries(GROUP_MAP)) {
      if (low.includes(key)) return cat;
    }
    return g.slice(0, 48);
  }
  return "Other";
}

export function categoryFromSourceGroup(group) {
  const g = (group || "").split(";")[0].trim();
  if (!g || ["undefined", "other", "general", "n/a", "null"].includes(g.toLowerCase())) {
    return "Other";
  }
  return g.slice(0, 48);
}
