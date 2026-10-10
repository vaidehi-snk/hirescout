# HireScout

Research a company before you apply. Enter a company, role and city, and HireScout turns live Google data from **SerpApi** into a decision brief for job seekers.

## What you get
| Feature | SerpApi engine | What it does |
|---|---|---|
| Scout Score (0-100) | all of the below | Transparent heuristic: hiring activity, fresher-friendliness, office rating, news momentum. Green and red flags link to the source |
| Open roles | `google_jobs` | Current openings with apply links and a fresher filter |
| Skills employers ask for | `google_jobs` | Counts skills across full job descriptions. Enter your skills to see your match % and what to learn next |
| Latest news | `google_news` | Recent headlines, scanned for growth and risk signals |
| Office and employee voice | `google_maps`, `google_maps_reviews` | Office locations, ratings and recent written reviews |
| Interview process and pay | `google` (organic and "People also ask") | What candidates say online |
| Head to head | all of the above | Compare two companies side by side |
| Credits left | Account API | Shows remaining searches (this call is free) |

## How SerpApi is used
SerpApi is the only data source. Each lookup runs five SerpApi calls in parallel from the Express backend (`server.js`). The Scout Score, the flags and the skills analysis are all computed from those responses, so nothing on screen is invented. Responses are cached for 6 hours so the free plan (250 searches per month) goes further.

## Run it
```bash
npm install
cp .env.example .env     # put your SerpApi key in .env
npm start                # http://localhost:3000
```
Requires Node 18+.

## Stack
Node.js, Express, plain HTML/CSS/JS. No frontend build step.
