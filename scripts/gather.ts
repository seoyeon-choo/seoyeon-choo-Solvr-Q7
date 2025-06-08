import fetch from 'node-fetch';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import {
  parseISO,
  differenceInDays,
  getDay,
  getHours,
  getYear,
  startOfWeek,
  startOfDay,
} from 'date-fns';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const HEADERS = process.env.GITHUB_TOKEN
  ? { Authorization: `token ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' }
  : { Accept: 'application/vnd.github.v3+json' };

type RawRelease = any;

type Release = {
  id: number;
  tag_name: string;
  name: string;
  draft: boolean;
  prerelease: boolean;
  author_login: string;
  created_at: string;
  published_at: string;
  body_length: number;
  num_assets: number;
  total_asset_size: number;
  total_asset_downloads: number;
  target_commitish: string;

  days_to_publish: number;
  release_day_of_week: number;
  release_hour: number;
  first_release_flag: boolean;

  is_major_release: boolean;
  is_minor_release: boolean;
  is_patch_release: boolean;

  num_commits_since_last_release: number | null;
  num_issues_closed: number | null;
  num_pull_requests: number | null;
};

function parseVersionTag(tag: string): number[] | null {
  const matches = tag.match(/v?(\d+)\.(\d+)\.(\d+)/);
  if (!matches) return null;
  return matches.slice(1).map(Number);
}

function computeReleaseFlags(currTag: string, prevTag: string | null) {
  if (!currTag) return { is_major_release: false, is_minor_release: false, is_patch_release: false };
  const curr = parseVersionTag(currTag);
  if (!curr) return { is_major_release: false, is_minor_release: false, is_patch_release: false };
  if (!prevTag) {
    return { is_major_release: true, is_minor_release: false, is_patch_release: false };
  }
  const prev = parseVersionTag(prevTag);
  if (!prev) return { is_major_release: false, is_minor_release: false, is_patch_release: false };

  if (curr[0] !== prev[0]) return { is_major_release: true, is_minor_release: false, is_patch_release: false };
  if (curr[1] !== prev[1]) return { is_major_release: false, is_minor_release: true, is_patch_release: false };
  if (curr[2] !== prev[2]) return { is_major_release: false, is_minor_release: false, is_patch_release: true };
  return { is_major_release: false, is_minor_release: false, is_patch_release: false };
}

async function fetchReleases(owner: string, repo: string): Promise<RawRelease[]> {
  const releases: RawRelease[] = [];
  let page = 1;
  while (true) {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=100&page=${page}`, { headers: HEADERS });
    if (!res.ok) throw new Error(`Failed to fetch releases for ${owner}/${repo} page ${page}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Expected array from GitHub API');
    if (data.length === 0) break;
    releases.push(...data);
    page++;
  }
  return releases;
}

async function fetchCommitCount(owner: string, repo: string, base: string, head: string): Promise<number> {
  if (!base || !head) return 0;
  const url = `https://api.github.com/repos/${owner}/${repo}/compare/${base}...${head}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    console.warn(`Warning: Failed to fetch commit count compare ${base}...${head}`);
    return 0;
  }
  const data = await res.json();
  return data.total_commits ?? 0;
}

async function fetchClosedCount(owner: string, repo: string, start: string, end: string, type: 'issue' | 'pr'): Promise<number> {
  const query = `repo:${owner}/${repo} is:${type} closed:${start}..${end}`;
  const url = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    const errorBody = await res.text();
    console.warn(`Warning: Failed to fetch closed ${type} count ${start}..${end} - Status: ${res.status}, Body: ${errorBody}`);
    return 0;
  }
  const data = await res.json();
  return data.total_count ?? 0;
}

function processReleases(rawReleases: RawRelease[], owner: string, repo: string): Release[] {
  const processed: Release[] = [];
  for (let i = 0; i < rawReleases.length; i++) {
    const r = rawReleases[i];
    const prev = i > 0 ? rawReleases[i - 1] : null;

    const createdAt = new Date(r.created_at);
    const publishedAt = new Date(r.published_at);

    const daysToPublish = differenceInDays(publishedAt, createdAt);
    const releaseDayOfWeek = getDay(publishedAt);
    const releaseHour = getHours(publishedAt);
    const firstReleaseFlag = i === 0;

    const { is_major_release, is_minor_release, is_patch_release } = computeReleaseFlags(
      r.tag_name,
      prev?.tag_name ?? null
    );

    const assets = r.assets || [];
    const totalAssetSize = assets.reduce((acc: number, a: any) => acc + (a.size ?? 0), 0);
    const totalAssetDownloads = assets.reduce((acc: number, a: any) => acc + (a.download_count ?? 0), 0);

    processed.push({
      id: r.id,
      tag_name: r.tag_name,
      name: r.name ?? '',
      draft: r.draft ?? false,
      prerelease: r.prerelease ?? false,
      author_login: r.author?.login ?? '',
      created_at: r.created_at,
      published_at: r.published_at,
      body_length: r.body ? r.body.length : 0,
      num_assets: assets.length,
      total_asset_size: totalAssetSize,
      total_asset_downloads: totalAssetDownloads,
      target_commitish: r.target_commitish ?? '',

      days_to_publish: daysToPublish,
      release_day_of_week: releaseDayOfWeek,
      release_hour: releaseHour,
      first_release_flag: firstReleaseFlag,

      is_major_release,
      is_minor_release,
      is_patch_release,

      num_commits_since_last_release: null,
      num_issues_closed: null,
      num_pull_requests: null,
    });
  }
  return processed;
}

function toCSV(releases: Release[]): string {
  const headers = [
    'id',
    'tag_name',
    'name',
    'draft',
    'prerelease',
    'author_login',
    'created_at',
    'published_at',
    'body_length',
    'num_assets',
    'total_asset_size',
    'total_asset_downloads',
    'target_commitish',
    'days_to_publish',
    'release_day_of_week',
    'release_hour',
    'first_release_flag',
    'is_major_release',
    'is_minor_release',
    'is_patch_release',
    'num_commits_since_last_release',
    'num_issues_closed',
    'num_pull_requests',
  ];
  const lines = [headers.join(',')];
  for (const r of releases) {
    const line = headers
      .map((h) => {
        let v = (r as any)[h];
        if (typeof v === 'string') v = `"${v.replace(/"/g, '""')}"`;
        if (v === undefined || v === null) v = '';
        return v;
      })
      .join(',');
    lines.push(line);
  }
  return lines.join('\n');
}

async function enrichReleaseDetails(releases: Release[], owner: string, repo: string): Promise<Release[]> {
  for (let i = 0; i < releases.length; i++) {
    const curr = releases[i];
    const prev = i > 0 ? releases[i - 1] : null;

    const baseCommit = prev ? prev.target_commitish : curr.target_commitish;
    const headCommit = curr.target_commitish;

    let startDate = prev ? prev.published_at.slice(0, 10) : curr.published_at.slice(0, 10);
    const endDate = curr.published_at.slice(0, 10);

    // 날짜 역전 방지
    if (new Date(startDate) > new Date(endDate)) {
      startDate = endDate;
    }

    curr.num_commits_since_last_release = await fetchCommitCount(owner, repo, baseCommit, headCommit);
    curr.num_issues_closed = await fetchClosedCount(owner, repo, startDate, endDate, 'issue');
    curr.num_pull_requests = await fetchClosedCount(owner, repo, startDate, endDate, 'pr');

    await new Promise((r) => setTimeout(r, 600));
  }
  return releases;
}

(async () => {
  const repos = [
    { owner: 'daangn', repo: 'stackflow' },
    { owner: 'daangn', repo: 'seed-design' },
  ];

  let allReleases: Release[] = [];

  for (const { owner, repo } of repos) {
    console.log(`🔍 Fetching releases for ${owner}/${repo}...`);
    const rawReleases = await fetchReleases(owner, repo);
    console.log(`✅ Fetched ${rawReleases.length} releases.`);

    let releases = processReleases(rawReleases, owner, repo);

    releases.sort((a, b) => new Date(a.published_at).getTime() - new Date(b.published_at).getTime());

    console.log(`⏳ Enriching releases with commit and issue/PR data for ${owner}/${repo}...`);
    releases = await enrichReleaseDetails(releases, owner, repo);

    allReleases.push(...releases);
  }

  // 전체 릴리즈 데이터를 하나의 CSV로 저장
  const outputPath = join(__dirname, '../release-stats.csv');
  const csv = toCSV(allReleases);
  writeFileSync(outputPath, csv);
  console.log(`✅ CSV 파일이 생성되었습니다: ${outputPath}`);
})();
