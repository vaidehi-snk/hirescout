import express from "express";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const KEY = process.env.SERPAPI_KEY;

// ---- tiny disk-backed cache: the free SerpApi plan is only 250 searches/month ----
const TTL = 6 * 60 * 60 * 1000;
const CACHE_FILE = path.join(__dirname, ".cache.json");
let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); } catch {}
const saveCache = () => { try { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); } catch {} };

async function serp(params) {
  if (!KEY) throw new Error("SERPAPI_KEY is missing. Add it to your .env file.");
  const id = new URLSearchParams(params).toString();
  const hit = cache[id];
  if (hit && Date.now() - hit.t < TTL) return { data: hit.d, cached: true };
  const qs = new URLSearchParams({ ...params, api_key: KEY });
  const r = await fetch(`https://serpapi.com/search.json?${qs}`);
  const d = await r.json();
  if (d.error && /hasn't returned any results/i.test(d.error)) return { data: {}, cached: false };
  if (!r.ok || d.error) throw new Error(d.error || `SerpApi returned HTTP ${r.status}`);
  cache[id] = { t: Date.now(), d };
  saveCache();
  return { data: d, cached: false };
}

// ---- analysis helpers ----
const SKILLS = {
  "Java": /\bjava\b/i, "Spring Boot": /spring ?boot/i, "Python": /\bpython\b/i, "JavaScript": /javascript/i,
  "TypeScript": /typescript/i, "React": /\breact(\.?js)?\b/i, "Node.js": /node\.?js/i, "Angular": /angular/i,
  "SQL": /\bsql\b|mysql|postgres/i, "MongoDB": /mongo ?db/i, "AWS": /\baws\b|amazon web services/i,
  "Azure": /azure/i, "GCP": /\bgcp\b|google cloud/i, "Docker": /docker/i, "Kubernetes": /kubernetes|\bk8s\b/i,
  "Git": /\bgit\b/i, "CI/CD": /ci\/cd|jenkins|github actions/i, "REST APIs": /rest(ful)? ?apis?/i,
  "Microservices": /microservice/i, ".NET / C#": /\.net\b|c#/i, "C++": /c\+\+/i, "Golang": /golang/i,
  "Machine Learning": /machine learning|\bml\b/i, "DSA": /data structures|algorithms/i,
  "Testing / QA": /selenium|automation testing|\bqa\b|\bsdet\b/i, "Data / ETL": /\bspark\b|\betl\b|snowflake|tableau|power ?bi/i,
  "Linux": /linux/i, "Agile": /agile|scrum/i, "FastAPI / Django": /fastapi|flask|django/i, "GenAI / LLM": /\bllm\b|generative ai|genai/i,
};
const FRESHER = /\b(intern|internship|fresher|graduate|entry[- ]level|trainee|junior|early[- ]career|0-?[12] years?)\b/i;
const GOOD = /\b(hiring|hires|expands?|expansion|funding|raises|record|growth|wins?|bags|secures|acquires?|acquisition|launch(es)?)\b/i;
const BAD = /\b(layoffs?|lay-offs?|lawsuit|fraud|probe|penalty|shutdown|resigns?|salary delay|job cuts?|raid|scam|fined)\b/i;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// ---- one function per SerpApi engine ----
async function getJobs({ company, role, location, fresher }) {
  const q = [role, fresher ? "fresher" : "", company ? `at ${company}` : ""].filter(Boolean).join(" ");
  const { data, cached } = await serp({ engine: "google_jobs", q, location, gl: "in", hl: "en" });
  const all = data.jobs_results || [];
  const counts = {};
  let fresh = 0;
  for (const j of all) {
    const text = `${j.title} ${j.description || ""}`;
    if (FRESHER.test(text)) fresh++;
    for (const [name, re] of Object.entries(SKILLS)) if (re.test(text)) counts[name] = (counts[name] || 0) + 1;
  }
  const skills = Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 12);
  const items = all.slice(0, 10).map((j) => ({
    title: j.title,
    company: j.company_name,
    location: j.location,
    via: j.via,
    posted: j.detected_extensions?.posted_at,
    type: j.detected_extensions?.schedule_type,
    snippet: (j.description || "").slice(0, 240),
    link: j.apply_options?.[0]?.link || j.share_link,
  }));
  return { items, cached, stats: { count: all.length, fresherShare: all.length ? fresh / all.length : 0, skills } };
}

async function getOffice({ company, location }) {
  const m = await serp({ engine: "google_maps", q: `${company} office ${location}`, type: "search", hl: "en", gl: "in" });
  const raw = m.data.local_results || (m.data.place_results ? [m.data.place_results] : []);
  const places = raw.slice(0, 4).map((p) => ({
    name: p.title, address: p.address, rating: p.rating, reviews: p.reviews, dataId: p.data_id,
    link: p.gps_coordinates ? `https://www.google.com/maps/search/?api=1&query=${p.gps_coordinates.latitude},${p.gps_coordinates.longitude}` : null,
  }));
  let reviews = [], cached = m.cached;
  const top = places.find((p) => p.dataId);
  if (top) {
    try {
      const r = await serp({ engine: "google_maps_reviews", data_id: top.dataId, hl: "en", sort_by: "newestFirst" });
      cached = cached && r.cached;
      reviews = (r.data.reviews || []).filter((x) => x.snippet).slice(0, 5)
        .map((x) => ({ user: x.user?.name, rating: x.rating, date: x.date, text: x.snippet.slice(0, 300) }));
    } catch {}
  }
  return { items: places, reviews, cached };
}

async function getNews({ company }) {
  const { data, cached } = await serp({ engine: "google_news", q: company, gl: "in", hl: "en" });
  const items = (data.news_results || []).slice(0, 8).map((n) => ({
    title: n.title || n.stories?.[0]?.title,
    link: n.link || n.stories?.[0]?.link,
    source: typeof n.source === "string" ? n.source : n.source?.name || n.stories?.[0]?.source?.name,
    date: n.date || n.stories?.[0]?.date,
  })).filter((n) => n.title && n.link);
  return { items, cached };
}

async function getInsights({ company, role }) {
  const q = `${company} ${role || ""} interview process salary fresher experience`.replace(/\s+/g, " ").trim();
  const { data, cached } = await serp({ engine: "google", q, gl: "in", hl: "en", google_domain: "google.co.in", num: "10" });
  return {
    items: (data.organic_results || []).slice(0, 6).map((o) => ({
      title: o.title, link: o.link, source: o.displayed_link, snippet: o.snippet,
    })),
    questions: (data.related_questions || []).slice(0, 5).map((r) => ({
      question: r.question, answer: r.snippet || r.list?.join("; "), link: r.link,
    })),
    cached,
  };
}

// ---- scoring: transparent heuristic, every point is traceable to a SerpApi result ----
function scoreCompany(jobs, news, office) {
  const rating = office.items?.[0]?.rating;
  const greens = (news.items || []).filter((n) => GOOD.test(n.title) && !BAD.test(n.title));
  const reds = (news.items || []).filter((n) => BAD.test(n.title));
  const parts = {
    hiring: Math.round((Math.min(jobs.stats?.count || 0, 10) / 10) * 35),
    fresher: Math.round((jobs.stats?.fresherShare || 0) * 25),
    office: rating ? Math.round((rating / 5) * 20) : 10,
    news: clamp(10 + 3 * greens.length - 6 * reds.length, 0, 20),
  };
  const total = parts.hiring + parts.fresher + parts.office + parts.news;
  const green = greens.slice(0, 3).map((n) => ({ text: n.title, link: n.link }));
  const red = reds.slice(0, 3).map((n) => ({ text: n.title, link: n.link }));
  if (rating && rating < 3.5) red.push({ text: `Office rated ${rating}/5 on Google Maps` });
  if (rating && rating >= 4) green.push({ text: `Office rated ${rating}/5 on Google Maps` });
  if ((jobs.stats?.fresherShare || 0) >= 0.4) green.push({ text: "Many openings mention interns, freshers or entry-level" });
  const label = total >= 70 ? "Strong signals" : total >= 45 ? "Mixed signals" : "Thin signals";
  return { total, label, parts, green, red, rating: rating || null };
}

// ---- API ----
app.get("/api/brief", async (req, res) => {
  const company = (req.query.company || "").toString().trim();
  const role = (req.query.role || "software engineer").toString().trim();
  const location = (req.query.location || "India").toString().trim();
  const fresher = req.query.fresher !== "0";
  if (!company) return res.status(400).json({ error: "Enter a company name." });

  const [jobs, news, insights, office] = await Promise.allSettled([
    getJobs({ company, role, location, fresher }),
    getNews({ company }),
    getInsights({ company, role }),
    getOffice({ company, location }),
  ]);
  const pack = (r) => (r.status === "fulfilled" ? r.value : { error: r.reason.message, items: [] });
  const J = pack(jobs), N = pack(news), I = pack(insights), O = pack(office);
  const score = scoreCompany(J, N, O);
  score.partial = [J, N, O].some((x) => x.error);
  res.json({ company, role, location, score, skills: J.stats?.skills || [], jobs: J, news: N, insights: I, office: O });
});

// remaining SerpApi credits (the Account API does not use up searches)
app.get("/api/credits", async (_req, res) => {
  try {
    const r = await fetch(`https://serpapi.com/account?api_key=${KEY}`);
    const d = await r.json();
    res.json({ left: d.total_searches_left ?? d.plan_searches_left ?? null });
  } catch { res.json({ left: null }); }
});

app.use(express.static(path.join(__dirname, "public")));
app.listen(PORT, () => console.log(`HireScout running on http://localhost:${PORT}`));
