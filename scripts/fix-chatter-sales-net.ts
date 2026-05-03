/**
 * One-time migration: legacy chatter_sales stored OnlyFans **gross** in amount_usd.
 * New behavior stores **net** (gross × 0.80). This script converts old rows.
 *
 * Skips rows whose notes already contain `GROSS:` (new format) or `MIGRATED_NET:` (already migrated).
 *
 * Usage:
 *   npx tsx scripts/fix-chatter-sales-net.ts --dry-run
 *   npx tsx scripts/fix-chatter-sales-net.ts
 *
 * Requires .env.local (or env) with AIRTABLE_TOKEN, AIRTABLE_BASE_ID (same as the app).
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { listMonthlyMemberBasis, updateMonthlyMemberBasis } from '../lib/airtable';

/** Run from project root (folder containing package.json): `npx tsx scripts/fix-chatter-sales-net.ts` */
const ROOT = resolve(process.cwd());
const OF_NET = 0.8;

function loadDotEnvLocal(): void {
  const p = resolve(ROOT, '.env.local');
  if (!existsSync(p)) return;
  const content = readFileSync(p, 'utf8');
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] == null || process.env[k] === '') process.env[k] = v;
  }
}

function shouldSkip(notes: string): boolean {
  const n = notes ?? '';
  return n.includes('GROSS:') || n.includes('MIGRATED_NET:');
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  loadDotEnvLocal();

  if (!process.env.AIRTABLE_TOKEN?.trim() || !process.env.AIRTABLE_BASE_ID?.trim()) {
    console.error('Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID (.env.local or environment).');
    process.exit(1);
  }

  const records = await listMonthlyMemberBasis({ basis_type: 'chatter_sales' });
  console.log(`Found ${records.length} chatter_sales rows.\n`);

  let updated = 0;
  let skipped = 0;

  for (const r of records) {
    const notes = String(r.fields.notes ?? '');
    if (shouldSkip(notes)) {
      skipped++;
      console.log(`SKIP ${r.id} (already has GROSS: or MIGRATED_NET:)`);
      continue;
    }

    const oldUsd = typeof r.fields.amount_usd === 'number' ? r.fields.amount_usd : 0;
    const newUsd = Math.round(oldUsd * OF_NET * 100) / 100;
    const newNotes = `${notes.trim()}${notes.trim() ? '\n' : ''}MIGRATED_NET:true`.trim();

    console.log(`UPDATE ${r.id}: amount_usd ${oldUsd} -> ${newUsd}${dryRun ? ' (dry-run)' : ''}`);

    if (!dryRun) {
      await updateMonthlyMemberBasis(r.id, {
        amount_usd: newUsd,
        notes: newNotes,
      });
    }
    updated++;
  }

  console.log(`\nDone. ${dryRun ? 'Would update' : 'Updated'}: ${updated}, skipped: ${skipped}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
