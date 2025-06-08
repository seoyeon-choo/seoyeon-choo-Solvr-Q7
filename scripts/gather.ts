import fetch from 'node-fetch';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { parseISO, formatISO, startOfWeek, startOfDay, getYear } from 'date-fns';


type Release = { published_at: string };
type Stats = Record<string, number>;

async function fetchReleases(owner: string, repo: string): Promise<Release[]> {
  const releases: Release[] = [];
  let page = 1;
  while (true) {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=100&page=${page}`);
    if (!res.ok) throw new Error(`Failed to fetch ${repo} (page ${page})`);
    const rawData = await res.json();
if (!Array.isArray(rawData)) throw new Error('Expected array from GitHub API');
const data: Release[] = rawData;

    if (data.length === 0) break;
    releases.push(...data);
    page++;
  }
  return releases;
}

function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function aggregate(dates: string[]): { daily: Stats; weekly: Stats; yearly: Stats } {
  const daily: Stats = {};
  const weekly: Stats = {};
  const yearly: Stats = {};

  for (const d of dates) {
    const dt = parseISO(d);
    if (isWeekend(dt)) {
      continue;
    }

    const dayKey = formatISO(startOfDay(dt), { representation: 'date' });
    const weekKey = formatISO(startOfWeek(dt, { weekStartsOn: 1 }), { representation: 'date' });
    const yearKey = String(getYear(dt));

    daily[dayKey] = (daily[dayKey] || 0) + 1;
    weekly[weekKey] = (weekly[weekKey] || 0) + 1;
    yearly[yearKey] = (yearly[yearKey] || 0) + 1;
  }

  return { daily, weekly, yearly };
}



function toCSV(stat: Stats, label: string): string {
  const lines = [`${label},count`];
  for (const [key, value] of Object.entries(stat).sort()) {
    lines.push(`${key},${value}`);
  }
  return lines.join('\n');
}

(async () => {
  const repos = [
    { owner: 'daangn', repo: 'stackflow' },
    { owner: 'daangn', repo: 'seed-design' },
  ];
  const resultLines = [];

  for (const { owner, repo } of repos) {
    const releases = await fetchReleases(owner, repo);
    const dates = releases.map(r => r.published_at).filter(Boolean);
    const stats = aggregate(dates);

    resultLines.push(`# Repo: ${repo}`);
    resultLines.push(`## Yearly`);
    resultLines.push(toCSV(stats.yearly, 'year'));
    resultLines.push(`## Weekly`);
    resultLines.push(toCSV(stats.weekly, 'week_start'));
    resultLines.push(`## Daily`);
    resultLines.push(toCSV(stats.daily, 'day'));
    resultLines.push('');
  }

  const output = resultLines.join('\n');
  const outputPath = join(__dirname, '../release-stats.csv');
  writeFileSync(outputPath, output);
  console.log(`✅ CSV 파일이 생성되었습니다: ${outputPath}`);
})();
