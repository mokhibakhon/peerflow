#!/usr/bin/env node
/* Puts supabase/migrate-2026-08.sql back in step with the migration files it
 * is made of.
 *
 *     node dev/sync-paste.js          # rewrite it
 *     node dev/sync-paste.js --check  # exit 1 if it is out of step
 *
 * The combined paste exists so the user runs one file instead of eleven, and
 * its own header already says "if you edit a migration, rebuild this from the
 * originals rather than editing it here". Nothing rebuilt it, so the sentence
 * was advice rather than a mechanism — and the drift it warns about happened
 * within a day of the file being written: a policy was fixed in
 * migration-safety.sql, dev/sql-tests.sh loaded the combined paste, and the
 * test went on failing against a copy of the old policy for long enough to
 * look like the fix was wrong.
 *
 * This does not regenerate the file. It walks the
 *
 *     -- BEGIN <name>
 *     ...
 *     -- ---------- END <name> ----------
 *
 * markers that are already in there and replaces what sits between each pair
 * with the current contents of supabase/<name>. Order, header and the section
 * banners are left exactly as they are, so adding a new migration to the paste
 * is still a deliberate act — this only stops the copies rotting.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const paste = path.join(root, 'supabase', 'migrate-2026-08.sql');
const check = process.argv.includes('--check');

const before = fs.readFileSync(paste, 'utf8');

/* Each section is [banner line, body, end marker]. The body is everything
   between the banner that names the file and the end marker that names it
   again — matching on the name at both ends means a missing or misspelled
   end marker fails loudly here rather than silently swallowing the next
   section. */
const re = /(^-- BEGIN (\S+)\n-- =+\n)([\s\S]*?)(^-- -+ END \2 -+\n)/gm;

/* Every folded migration opens with a SUPERSEDED banner telling a reader not
   to run that file, because its contents are already in the combined paste.
   That banner is true of the standalone copy and nonsense inside the paste
   itself: copied through verbatim it puts fourteen "do not run this file"
   notices into the one file everybody is told to run, and it makes --check
   report drift for ever, since the sources carry something the paste can
   never contain.
   
   So the banner is stripped on the way in. It is metadata about the file, not
   part of the migration, and the paste is the one place it must not appear. */
function stripBanner(text) {
  const m = text.match(/^-- =+\n-- SUPERSEDED[\s\S]*?\n-- =+\n+/);
  return m ? text.slice(m[0].length) : text;
}

const seen = [];
const after = before.replace(re, (whole, head, name, body, tail) => {
  const src = path.join(root, 'supabase', name);
  if (!fs.existsSync(src)) {
    console.error('no such migration: supabase/' + name);
    process.exit(2);
  }
  seen.push(name);
  return head + '\n' + stripBanner(fs.readFileSync(src, 'utf8')).trim() + '\n\n' + tail;
});

if (!seen.length) {
  console.error('found no BEGIN/END sections — has the marker format changed?');
  process.exit(2);
}

if (after === before) {
  console.log(seen.length + ' section(s) already in step');
  process.exit(0);
}

if (check) {
  console.error('supabase/migrate-2026-08.sql is out of step with its sources.');
  console.error('Run: node dev/sync-paste.js');
  process.exit(1);
}

fs.writeFileSync(paste, after);
console.log('rewrote ' + seen.length + ' section(s): ' + seen.join(', '));
