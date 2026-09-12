#!/usr/bin/env node
/**
 * scripts/generate-sdk.mjs — Generate client SDKs from openapi.json
 *
 * Produces ready-to-use API clients for every language a developer might use.
 * Uses @openapitools/openapi-generator-cli (no install required — runs via npx).
 *
 * Usage:
 *   node scripts/generate-sdk.mjs              # all languages
 *   node scripts/generate-sdk.mjs python        # Python only
 *   node scripts/generate-sdk.mjs javascript    # TypeScript/JS only
 *   node scripts/generate-sdk.mjs java          # Java only
 *
 * Output:
 *   sdk/python/      — requests-based Python client
 *   sdk/typescript/  — axios-based TypeScript client (for non-Expo consumers)
 *   sdk/java/        — OkHttp-based Java/Kotlin client
 *   sdk/go/          — net/http Go client
 *   sdk/swift/       — URLSession Swift 5 client
 *   sdk/kotlin/      — OkHttp Kotlin client
 *   sdk/ruby/        — net/http Ruby client
 *   sdk/php/         — cURL PHP client
 *
 * All clients use JWT bearer auth — pass your token in Authorization header.
 * Get a token from POST /api/auth/login → { token: "eyJ..." }
 */

import { execSync } from 'child_process';
import { mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const SPEC      = path.join(ROOT, 'openapi.json');
const OUT_DIR   = path.join(ROOT, 'sdk');

const GENERATORS = {
  python:     { generator: 'python',              dir: 'python',     lang: 'Python 3' },
  typescript: { generator: 'typescript-axios',    dir: 'typescript', lang: 'TypeScript/Axios' },
  javascript: { generator: 'javascript',           dir: 'javascript', lang: 'JavaScript' },
  java:       { generator: 'java',                 dir: 'java',       lang: 'Java 11+' },
  go:         { generator: 'go',                   dir: 'go',         lang: 'Go 1.18+' },
  swift:      { generator: 'swift5',               dir: 'swift',      lang: 'Swift 5' },
  kotlin:     { generator: 'kotlin',               dir: 'kotlin',     lang: 'Kotlin' },
  ruby:       { generator: 'ruby',                 dir: 'ruby',       lang: 'Ruby 3+' },
  php:        { generator: 'php',                  dir: 'php',        lang: 'PHP 8+' },
  csharp:     { generator: 'csharp',               dir: 'csharp',     lang: 'C# / .NET' },
  rust:       { generator: 'rust',                 dir: 'rust',       lang: 'Rust' },
  dart:       { generator: 'dart',                 dir: 'dart',       lang: 'Dart / Flutter' },
};

const requested = process.argv[2];
const toGenerate = requested
  ? Object.fromEntries(Object.entries(GENERATORS).filter(([k]) => k === requested))
  : GENERATORS;

if (requested && !GENERATORS[requested]) {
  console.error(`Unknown language: ${requested}`);
  console.error(`Available: ${Object.keys(GENERATORS).join(', ')}`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

let generated = 0;
for (const [lang, { generator, dir, lang: langName }] of Object.entries(toGenerate)) {
  const outPath = path.join(OUT_DIR, dir);
  console.log(`\nGenerating ${langName} client → sdk/${dir}/`);
  try {
    execSync(
      `npx @openapitools/openapi-generator-cli generate ` +
      `  -i ${SPEC} ` +
      `  -g ${generator} ` +
      `  -o ${outPath} ` +
      `  --package-name justicegavel ` +
      `  --additional-properties=packageName=justicegavel,projectName=justice-gavel-client `,
      { stdio: 'inherit', cwd: ROOT }
    );
    console.log(`  ✅ ${langName} → sdk/${dir}/`);
    generated++;
  } catch (e) {
    console.error(`  ❌ ${langName} failed: ${e.message?.slice(0, 80)}`);
  }
}

console.log(`\n${'─'.repeat(60)}`);
console.log(`Generated ${generated}/${Object.keys(toGenerate).length} SDK clients`);
console.log(`\nQuick start (Python):`);
console.log(`  pip install ./sdk/python`);
console.log(`  python3 -c "from justicegavel import ApiClient; ..."`);
console.log(`\nQuick start (TypeScript):`);
console.log(`  cd sdk/typescript && npm install && npm run build`);
console.log(`\nAll clients use Bearer token auth:`);
console.log(`  POST https://api.justicegavel.app/api/auth/login`);
console.log(`  → { token: "eyJ..." }  # use as Authorization: Bearer <token>`);
