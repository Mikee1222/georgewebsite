#!/usr/bin/env node
/**
 * Prints which required env vars are set (boolean only). No secrets.
 * Reads .env.local and .env from project root (next to package.json).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REQUIRED = ['AIRTABLE_TOKEN', 'AIRTABLE_BASE_ID', 'SESSION_SECRET', 'AIRTABLE_TABLE_USERS'];

function parseEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const envLocal = parseEnvFile(path.join(ROOT, '.env.local'));
const env = parseEnvFile(path.join(ROOT, '.env'));
const merged = { ...env, ...envLocal };

console.log('Env file check (project root: .env.local, .env). Values never printed.\n');
for (const key of REQUIRED) {
  const value = merged[key] ?? process.env[key];
  const set = Boolean(value && String(value).trim());
  console.log(`  ${key}: ${set ? 'true' : 'false'}`);
}
