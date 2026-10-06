import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [config, travel, statePaths] = await Promise.all([
  readFile(path.join(root, 'profile.config.json'), 'utf8').then(JSON.parse),
  readFile(path.join(root, 'docs/travel/travel-data.json'), 'utf8').then(JSON.parse),
  readFile(path.join(root, 'docs/travel/state-paths.json'), 'utf8').then(JSON.parse)
]);

const token = process.env.GITHUB_TOKEN;
const login = process.env.GITHUB_LOGIN || config.login;
const metrics = { ...config.sampleMetrics };

async function graphql(query, variables) {
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'mika-profile-cards'
    },
    body: JSON.stringify({ query, variables })
  });
  if (!response.ok) throw new Error(`GitHub API returned ${response.status}: ${await response.text()}`);
  const payload = await response.json();
  if (payload.errors?.length) throw new Error(payload.errors.map(error => error.message).join('; '));
  return payload.data;
}

if (token) {
  const to = new Date();
  const from = new Date(to.getTime() - 365 * 24 * 60 * 60 * 1000);
  const metricsQuery = `query($login:String!,$from:DateTime!,$to:DateTime!){
    user(login:$login){
      contributionsCollection(from:$from,to:$to){
        totalCommitContributions
        totalIssueContributions
        totalPullRequestContributions
        totalRepositoryContributions
        contributionCalendar{weeks{contributionDays{date contributionCount}}}
      }
    }
  }`;
  const [profileData, repoPages] = await Promise.all([
    graphql(metricsQuery, { login, from: from.toISOString(), to: to.toISOString() }),
    (async () => {
      const starQuery = `query($login:String!,$after:String){
        user(login:$login){repositories(first:100,after:$after,ownerAffiliations:OWNER,privacy:PUBLIC){
          pageInfo{hasNextPage endCursor} nodes{stargazerCount}
        }}
      }`;
      let after = null;
      let stars = 0;
      do {
        const page = await graphql(starQuery, { login, after });
        const connection = page.user?.repositories;
        if (!connection) throw new Error(`GitHub user not found: ${login}`);
        stars += connection.nodes.reduce((sum, repo) => sum + repo.stargazerCount, 0);
        after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
      } while (after);
      return stars;
    })()
  ]);

  const user = profileData.user;
  if (!user) throw new Error(`GitHub user not found: ${login}`);
  const collection = user.contributionsCollection;
  const days = collection.contributionCalendar.weeks
    .flatMap(week => week.contributionDays)
    .sort((a, b) => a.date.localeCompare(b.date));

  let run = 0;
  let longest = 0;
  for (const day of days) {
    run = day.contributionCount ? run + 1 : 0;
    longest = Math.max(longest, run);
  }

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const latestActive = [...days].reverse().find(day => day.contributionCount > 0)?.date;
  let current = 0;
  if (latestActive === today || latestActive === yesterday) {
    let expected = new Date(`${latestActive}T00:00:00Z`);
    for (const day of [...days].reverse()) {
      if (day.date !== expected.toISOString().slice(0, 10) || !day.contributionCount) break;
      current++;
      expected = new Date(expected.getTime() - 86400000);
    }
  }

  Object.assign(metrics, {
    stars: repoPages,
    commits: collection.totalCommitContributions,
    pullRequests: collection.totalPullRequestContributions,
    issues: collection.totalIssueContributions,
    repositories: collection.totalRepositoryContributions,
    contributions: days.reduce((sum, day) => sum + day.contributionCount, 0),
    currentStreak: current,
    longestStreak: longest
  });
}

const escapeXml = value => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

function icon(name, x, y, color) {
  const common = `fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"`;
  const paths = {
    star: '<path d="m12 2.8 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3.1-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9z"/>',
    commits: '<path d="M7 5a2.5 2.5 0 1 0 0 .1M7 5v14m0-7h5a5 5 0 0 0 5-5V5m-3 3 3-3 3 3M7 19a2.5 2.5 0 1 0 0 .1"/>',
    pullRequests: '<circle cx="7" cy="6" r="2.2"/><circle cx="17" cy="18" r="2.2"/><path d="M7 8v10m10-2V8a3 3 0 0 0-3-3h-2m2-3 3 3-3 3"/>',
    issues: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/>',
    repositories: '<path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H20v17H7.5A2.5 2.5 0 0 0 5 21.5zm0 0v17M9 6h7M9 10h7"/>'
  };
  return `<svg x="${x}" y="${y}" width="22" height="22" viewBox="0 0 24 24" ${common}>${paths[name]}</svg>`;
}

const statRows = [
  { icon: 'star', value: metrics.stars, x: 24, y: 56 },
  { icon: 'commits', value: metrics.commits, x: 172, y: 56 },
  { icon: 'pullRequests', value: metrics.pullRequests, x: 24, y: 113 },
  { icon: 'issues', value: metrics.issues, x: 172, y: 113 },
  { icon: 'repositories', value: metrics.repositories, x: 24, y: 170 }
];

function card(theme) {
  const colors = config.cardTheme[theme];
  const visited = new Set(Object.keys(travel));
  const visitedPalette = [colors.pink, colors.accent, '#a9b5ed', '#d2a8df'];
  const text = (x, y, value, size, fill = colors.foreground, weight = 500, anchor = 'start') =>
    `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="${fill}" font-family="ui-rounded,system-ui,-apple-system,'Segoe UI',sans-serif" font-size="${size}" font-weight="${weight}">${escapeXml(value)}</text>`;
  const panels = [
    `<rect x="0" y="8" width="348" height="260" rx="25" fill="${colors.background}" stroke="${colors.stroke}"/>`,
    `<rect x="362" y="8" width="298" height="260" rx="25" fill="${colors.background}" stroke="${colors.stroke}"/>`,
    `<rect x="674" y="8" width="526" height="260" rx="25" fill="${colors.background}" stroke="${colors.stroke}"/>`
  ].join('');
  const statContent = statRows.map(row =>
    `${icon(row.icon, row.x, row.y, colors.accent)}${text(row.x + 31, row.y + 18, row.value, 22, colors.foreground, 720)}`
  ).join('');
  const gradeRing = `<circle cx="282" cy="137" r="42" fill="none" stroke="${colors.stroke}" stroke-width="9"/><circle cx="282" cy="137" r="42" fill="none" stroke="${colors.pink}" stroke-width="9" stroke-dasharray="197 264" stroke-linecap="round" transform="rotate(-90 282 137)"/>${text(282, 147, config.profileGrade, 27, colors.foreground, 730, 'middle')}`;
  const contributions = text(511, 64, metrics.contributions, 43, colors.foreground, 740, 'middle')
    + text(511, 87, 'contributions', 14, colors.accent, 500, 'middle');
  const streakRing = `<circle cx="511" cy="153" r="38" fill="none" stroke="${colors.stroke}" stroke-width="8"/><circle cx="511" cy="153" r="38" fill="none" stroke="${colors.pink}" stroke-width="8" stroke-dasharray="196 239" stroke-linecap="round" transform="rotate(-90 511 153)"/>${text(511, 162, metrics.currentStreak, 29, colors.foreground, 730, 'middle')}`;
  const streakLabels = text(511, 211, 'current streak', 14, colors.pink, 680, 'middle')
    + text(511, 239, `longest · ${metrics.longestStreak}`, 13, colors.muted, 520, 'middle');
  const mapPaths = statePaths.map((state, index) => {
    const active = visited.has(state.code);
    const fill = active ? visitedPalette[index % visitedPalette.length] : colors.unvisited;
    return `<path d="${state.path}" fill="${fill}" stroke="${colors.background}" stroke-width="4" stroke-linejoin="round"><title>${escapeXml(state.name)}${active ? ' · demo visited state' : ''}</title></path>`;
  }).join('');
  const stateCount = Object.keys(travel).length;
  const mapContent = `${text(701, 39, "where I've been ♡", 20, colors.pink, 720)}<g transform="translate(800 48) scale(.31)">${mapPaths}</g>${text(937, 247, `${stateCount} / 50 states · click to explore`, 13, colors.muted, 520, 'middle')}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="276" viewBox="0 0 1200 276" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(config.displayName)}’s profile cards</title>
  <desc id="desc">Compact contribution icons and numbers, a current streak ring, and a map of sample US travel states.</desc>
  ${panels}${statContent}${gradeRing}${contributions}${streakRing}${streakLabels}${mapContent}
</svg>`;
}

const output = path.join(root, 'assets/generated');
const docsOutput = path.join(root, 'docs/assets/generated');
await mkdir(output, { recursive: true });
await mkdir(docsOutput, { recursive: true });
for (const theme of ['light', 'dark']) {
  const filename = `profile-${theme}.svg`;
  await writeFile(path.join(output, filename), card(theme));
  await cp(path.join(output, filename), path.join(docsOutput, filename));
}
console.log(token
  ? `Generated live profile cards for ${login}.`
  : `Generated demo profile cards for ${login}; add GITHUB_TOKEN to fetch live statistics.`);
