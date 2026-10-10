# HireScout

Research a company before you apply. Enter a company, role and city, and HireScout builds a brief from live Google data via **SerpApi**:

| Section | SerpApi engine | What it shows |
|---|---|---|
| Open roles | `google_jobs` | Current openings, fresher filter, apply links |
| Latest news | `google_news` | Recent headlines about the company |
| Interview process and pay | `google` (organic results and "People also ask") | What candidates say about interviews and salary |

## How SerpApi is used
SerpApi is the only data source. Every result on screen comes from one of the three engines above, called in parallel from the Express backend (`server.js`). Responses are cached for 6 hours so the free plan (250 searches per month) goes further.

## Run it
```bash
npm install
cp .env.example .env     # put your SerpApi key in .env
npm start                # http://localhost:3000
```
Requires Node 18+.

## Stack
Node.js, Express, plain HTML/CSS/JS. No frontend build step.
