import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const repoDir = path.join(root, 'repo');
const backendData = path.join(repoDir, 'backend', 'data');
const dbPath = path.join(backendData, 'providers.sqlite');
const pipelineDir = path.join(repoDir, 'data-pipeline');

const hasGoogle = !!process.env.GOOGLE_PLACES_KEY;
const hasYelp = !!process.env.YELP_API_KEY;

if (!hasGoogle || !hasYelp) {
  console.log('ℹ️  Live refresh skipped (missing GOOGLE_PLACES_KEY or YELP_API_KEY). Using bundled dataset.');
  process.exit(0);
}

console.log('🔄 Running live data refresh (Google + Yelp)');
await fs.promises.mkdir(path.join(pipelineDir, 'data'), { recursive: true });

const pkg = path.join(pipelineDir, 'package.json');
if (!fs.existsSync(pkg)) {
  const pkgJson = {
    name: "justice-gavel-data-pipeline",
    private: true,
    type: "module",
    dependencies: { "axios": "^1.7.2", "yargs": "^17.7.2", "sqlite3": "^5.1.7", "dotenv": "^16.4.5" }
  };
  await fs.promises.writeFile(pkg, JSON.stringify(pkgJson, null, 2));
}
spawnSync('npm', ['i'], { cwd: pipelineDir, stdio: 'inherit' });

const cities = ["Memphis, TN","Atlanta, GA","Detroit, MI","Baltimore, MD","Kansas City, MO","Milwaukee, WI","Albuquerque, NM","Houston, TX","Nashville, TN","Denver, CO"];

await fs.promises.writeFile(path.join(pipelineDir,'fetch_google.js'), `
import 'dotenv/config';
import axios from 'axios';
import fs from 'fs';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const PLACES = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
const DETAILS = 'https://maps.googleapis.com/maps/api/place/details/json';
const key = process.env.GOOGLE_PLACES_KEY;
if(!key){ console.error('Missing GOOGLE_PLACES_KEY'); process.exit(1); }

const argv = yargs(hideBin(process.argv)).option('city',{type:'string', demandOption:true}).argv;
function sleep(ms){ return new Promise(res=>setTimeout(res, ms)); }
async function searchAll(query, city){
  let url = PLACES; let params = { query: query + ' in ' + city, key }; let out = [];
  while(true){ const r = await axios.get(url, { params }); if(r.data.results) out = out.concat(r.data.results);
    const next = r.data.next_page_token; if(!next) break; await sleep(2000); params = { pagetoken: next, key }; }
  return out;
}
async function details(place_id){
  const r = await axios.get(DETAILS, { params: { place_id, key, fields: 'place_id,name,formatted_address,formatted_phone_number,geometry,website,rating,user_ratings_total' } });
  return r.data.result;
}
async function run(){
  const city = argv.city; const queries = ['criminal defense lawyer','bail bonds']; const all = [];
  for(const q of queries){ const res = await searchAll(q, city);
    for(const p of res){ try{ const d = await details(p.place_id); all.push({ city, query:q, ...d }); await sleep(100); }catch{} } }
  const fn = 'data/google_' + city.replace(/[^a-z0-9]+/ig,'_').toLowerCase() + '.json'; await fs.promises.writeFile(fn, JSON.stringify(all, null, 2));
  console.log('Google saved:', fn, all.length);
}
run();
`);

await fs.promises.writeFile(path.join(pipelineDir,'fetch_yelp.js'), `
import 'dotenv/config';
import axios from 'axios';
import fs from 'fs';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
const key = process.env.YELP_API_KEY;
if(!key){ console.error('Missing YELP_API_KEY'); process.exit(1); }
const Y = axios.create({ baseURL:'https://api.yelp.com/v3', headers:{ Authorization:'Bearer '+key }});
const argv = yargs(hideBin(process.argv)).option('city',{ type:'string', demandOption:true }).argv;

async function search(term, city){
  const out = []; let offset = 0;
  while(offset < 1000){
    const { data } = await Y.get('/businesses/search',{ params:{ term, location: city, limit:50, offset } });
    out.push(...data.businesses); if(data.businesses.length < 50) break; offset += 50;
  }
  return out;
}
async function run(){
  const city = argv.city;
  const lawyers = await search('criminal defense lawyer', city);
  const bail = await search('bail bonds', city);
  const fn = 'data/yelp_' + city.replace(/[^a-z0-9]+/ig,'_').toLowerCase() + '.json';
  await fs.promises.writeFile(fn, JSON.stringify({ lawyers, bail }, null, 2));
  console.log('Yelp saved:', fn, lawyers.length + bail.length);
}
run();
`);

await fs.promises.writeFile(path.join(pipelineDir,'merge_and_import.js'), `
import fs from 'fs';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

function readJSON(path){ try { return JSON.parse(fs.readFileSync(path,'utf-8')); } catch { return null; } }
function normalizePhone(s=''){ const d=(''+s).replace(/\D+/g,''); return d.length ? d : null; }
function toGoogleRows(city, a){
  if(!Array.isArray(a)) return [];
  return a.map(rec => {
    const phone = normalizePhone(rec.formatted_phone_number);
    const lat = rec.geometry?.location?.lat ?? null;
    const lng = rec.geometry?.location?.lng ?? null;
    const base = [city, rec.name||'', phone, rec.formatted_address||'', lat, lng, rec.website||null, 'google', rec.place_id||'', rec.rating||null, rec.user_ratings_total||null];
    const isBail = (rec.query||'').includes('bail');
    return { type: isBail ? 'bail' : 'law', base };
  });
}
function toYelpRows(city, obj){
  const out = [];
  const push = (arr, type)=>{
    for(const b of arr||[]){
      const phone = normalizePhone(b.phone || b.display_phone);
      const address = (b.location?.display_address||[]).join(', ');
      const lat = b.coordinates?.latitude ?? null;
      const lng = b.coordinates?.longitude ?? null;
      const base = [city, b.name||'', phone, address, lat, lng, b.url||null, 'yelp', b.id||'', b.rating||null, b.review_count||null];
      out.push({ type, base });
    }
  };
  push(obj?.lawyers, 'law'); push(obj?.bail, 'bail'); return out;
}
function dedupe(rows){
  const map = new Map();
  for(const r of rows){
    const [city,name,phone,address] = r.base;
    const key = (phone||'') + '|' + city + '|' + name.toLowerCase();
    if(!map.has(key)) map.set(key, r);
  }
  return Array.from(map.values());
}
async function run(){
  const db = await open({ filename: process.argv[2], driver: sqlite3.Database });
  await db.exec(`CREATE TABLE IF NOT EXISTS lawyers (id INTEGER PRIMARY KEY AUTOINCREMENT, city TEXT, name TEXT, phone TEXT, address TEXT, lat REAL, lng REAL, website TEXT, source TEXT, source_id TEXT UNIQUE, rating REAL, reviews INTEGER);`);
  await db.exec(`CREATE TABLE IF NOT EXISTS bail_agents (id INTEGER PRIMARY KEY AUTOINCREMENT, city TEXT, name TEXT, phone TEXT, address TEXT, lat REAL, lng REAL, website TEXT, source TEXT, source_id TEXT UNIQUE, rating REAL, reviews INTEGER);`);
  const files = fs.readdirSync('data').filter(f => f.endsWith('.json'));
  const rows = [];
  for(const f of files){
    if(f.startsWith('google_')){
      const city = f.replace(/^google_/, '').replace(/\.json$/, '').replace(/_/g, ' ').replace(/\b([a-z])/g, s=>s.toUpperCase());
      const data = readJSON('data/'+f) || [];
      rows.push(...toGoogleRows(city, data));
    } else if(f.startsWith('yelp_')){
      const city = f.replace(/^yelp_/, '').replace(/\.json$/, '').replace(/_/g, ' ').replace(/\b([a-z])/g, s=>s.toUpperCase());
      const data = readJSON('data/'+f) || {};
      rows.push(...toYelpRows(city, data));
    }
  }
  const deduped = dedupe(rows);
  let lc=0, bc=0;
  for(const r of deduped){
    const [city,name,phone,address,lat,lng,website,source,source_id,rating,reviews] = r.base;
    if(r.type === 'law'){
      await db.run(`INSERT OR IGNORE INTO lawyers (city,name,phone,address,lat,lng,website,source,source_id,rating,reviews) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [city,name,phone,address,lat,lng,website,source,source_id,rating,reviews]); lc++;
    }else{
      await db.run(`INSERT OR IGNORE INTO bail_agents (city,name,phone,address,lat,lng,website,source,source_id,rating,reviews) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [city,name,phone,address,lat,lng,website,source,source_id,rating,reviews]); bc++;
    }
  }
  console.log('Imported rows -> lawyers:', lc, 'bail_agents:', bc);
}
run();
`);

for (const city of cities) {
  console.log('🌆 City:', city);
  spawnSync('node', ['fetch_google.js', '--city', city], { cwd: pipelineDir, stdio: 'inherit' });
  spawnSync('node', ['fetch_yelp.js', '--city', city], { cwd: pipelineDir, stdio: 'inherit' });
}
await fs.promises.mkdir(backendData, { recursive: true });
spawnSync('node', ['merge_and_import.js', dbPath], { cwd: pipelineDir, stdio: 'inherit' });
console.log('✅ Live data refreshed into', dbPath);
