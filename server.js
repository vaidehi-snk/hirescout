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

// ---- one function per SerpApi engine ----
async function getJobs({ company, role, location, fresher }) {
  const q = [role, fresher ? "fresher" : "", company ? `at ${company}` : ""].filter(Boolean).join(" ");
  const { data, cached } = await serp({ engine: "google_jobs", q, location, gl: "in", hl: "en" });
  const items = (data.jobs_results || []).slice(0, 10).map((j) => ({
    title: j.title,
    company: j.company_name,
    location: j.location,
    via: j.via,
    posted: j.detected_extensions?.posted_at,
    type: j.detected_extensions?.schedule_type,
    snippet: (j.description || "").slice(0, 240),
    link: j.apply_options?.[0]?.link || j.share_link,
  }));
  return { items, cached };
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

// ---- API ----
app.get("/api/brief", async (req, res) => {
  const company = (req.query.company || "").toString().trim();
  const role = (req.query.role || "software engineer").toString().trim();
  const location = (req.query.location || "India").toString().trim();
  const fresher = req.query.fresher !== "0";
  if (!company) return res.status(400).json({ error: "Enter a company name." });

  const [jobs, news, insights] = await Promise.allSettled([
    getJobs({ company, role, location, fresher }),
    getNews({ company }),
    getInsights({ company, role }),
  ]);
  const pack = (r) => (r.status === "fulfilled" ? r.value : { error: r.reason.message, items: [] });
  res.json({ company, role, location, jobs: pack(jobs), news: pack(news), insights: pack(insights) });
});

app.use(express.static(path.join(__dirname, "public")));
app.listen(PORT, () => console.log(`HireScout running on http://localhost:${PORT}`));
