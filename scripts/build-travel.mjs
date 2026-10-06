import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { geoIdentity, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const topologyPath = require.resolve('us-atlas/states-albers-10m.json');
const topology = JSON.parse(await readFile(topologyPath, 'utf8'));
const collection = feature(topology, topology.objects.states);
const projection = geoIdentity().fitExtent([[22, 18], [938, 582]], collection);
const pathFor = geoPath(projection);

const fipsToCode = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT',
  '10': 'DE', '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN',
  '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA',
  '26': 'MI', '27': 'MN', '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV',
  '33': 'NH', '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH',
  '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD', '47': 'TN',
  '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI', '56': 'WY'
};

const mapStates = collection.features
  .filter(state => fipsToCode[state.id])
  .map(state => ({
    code: fipsToCode[state.id],
    name: state.properties.name,
    path: pathFor(state),
    center: pathFor.centroid(state)
  }))
  .sort((a, b) => a.code.localeCompare(b.code));

const travelSource = JSON.parse(await readFile(path.join(root, 'travel-data.json'), 'utf8'));
const extensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg']);
const travelStates = {};
const timeZoneFolders = ['Pacific', 'Mountain', 'Central', 'Eastern', 'Alaska', 'Hawaii'];
const stateNames = Object.fromEntries(mapStates.map(state => [state.code, state.name]));
const stateSource = { ...travelSource.states };

for (const zone of timeZoneFolders) {
  const zonePath = path.join(root, 'docs', 'travel', 'photos', zone);
  let folders = [];
  try {
    folders = await readdir(zonePath, { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const folder of folders.filter(entry => entry.isDirectory())) {
    const code = folder.name.toUpperCase();
    if (!stateNames[code] || stateSource[code]) continue;
    const stateFolder = path.join(zonePath, folder.name);
    const files = await readdir(stateFolder, { withFileTypes: true });
    const hasPhotos = files.some(file => file.isFile() && extensions.has(path.extname(file.name).toLowerCase()));
    if (hasPhotos) {
      stateSource[code] = {
        name: stateNames[code],
        timeZoneFolder: zone,
        subtitle: `${stateNames[code]} photo album`,
        places: [],
        note: 'Add places and a personal note for this state in travel-data.json.'
      };
    }
  }
}

for (const [code, state] of Object.entries(stateSource).sort(([a], [b]) => a.localeCompare(b))) {
  const folder = path.join(root, 'docs', 'travel', 'photos', state.timeZoneFolder, code);
  let files = [];
  try {
    files = await readdir(folder, { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const memories = files
    .filter(file => file.isFile() && extensions.has(path.extname(file.name).toLowerCase()))
    .map(file => file.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map(file => {
      const demo = /(^|[-_.])demo([-_.]|$)/i.test(file);
      const base = path.basename(file, path.extname(file)).replace(/^\d+[-_. ]*/, '').replace(/[-_.]+/g, ' ').trim();
      const caption = demo ? 'Sample artwork · replace with your photo' : (base || `${state.name} memory`);
      const alt = demo
        ? `Sample placeholder artwork for ${state.name}; replace with your own photo`
        : `${state.name} travel photo${base ? `: ${base}` : ''}`;
      return {
        src: `./photos/${state.timeZoneFolder}/${code}/${encodeURIComponent(file)}`,
        alt,
        caption,
        demo
      };
    });

  travelStates[code] = {
    name: state.name,
    timeZoneFolder: state.timeZoneFolder,
    subtitle: state.subtitle,
    places: state.places,
    note: state.note,
    memories
  };
}

const travelDir = path.join(root, 'docs', 'travel');
await mkdir(travelDir, { recursive: true });
const docsAssets = path.join(root, 'docs', 'assets');
await mkdir(path.join(docsAssets, 'generated'), { recursive: true });
for (const asset of ['mika-typing-banner.svg', 'mika-about-light.svg', 'mika-about-dark.svg']) {
  await cp(path.join(root, 'assets', asset), path.join(docsAssets, asset));
}
for (const theme of ['light', 'dark']) {
  const source = path.join(root, 'assets', 'generated', `profile-${theme}.svg`);
  await cp(source, path.join(docsAssets, 'generated', `profile-${theme}.svg`));
}
await writeFile(path.join(travelDir, 'state-paths.json'), `${JSON.stringify(mapStates)}\n`);
await writeFile(path.join(travelDir, 'travel-data.json'), `${JSON.stringify(travelStates, null, 2)}\n`);
await writeFile(path.join(travelDir, 'travel-data.js'), `window.TRAVEL_DATA = ${JSON.stringify(travelStates, null, 2)};\n`);
console.log(`Built a ${mapStates.length}-state map and photo manifest for ${Object.keys(travelStates).length} demo states.`);
