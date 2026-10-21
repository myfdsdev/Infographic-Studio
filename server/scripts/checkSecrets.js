#!/usr/bin/env node
// Scan the deliverable files for secrets: every file git would ship (tracked
// or new, not ignored) plus the built client bundle (client/dist).
//
//   npm run check:secrets          (from server/, after `npm run build`)
//
// It looks for:
//   - the actual values of secret variables in server/.env and
//     server/.env.live-test, when those local files exist
//   - generic credential shapes (private keys, AWS key ids, database URIs
//     with a password, provider-style secret keys)
// Findings print the file and the variable or pattern NAME, never the value.
// Exit code 1 when anything is found.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SECRET_NAME = /(SECRET|PASSWORD|PASS|TOKEN|API_KEY|ACCESS_KEY|ENCRYPTION_KEY|PRIVATE)/i;
const BINARY = /\.(png|jpe?g|webp|gif|ico|woff2?|ttf|mp4|mp3|wav|zip|gz|pdf)$/i;

const GENERIC = [
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['AWS access key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['database URI with a password', /mongodb(?:\+srv)?:\/\/[^:\s/"'`]+:([^@\s"'`]+)@/],
  ['secret-key style token', /\b(?:sk|rk)_(?:live|prod)_[A-Za-z0-9]{16,}\b/],
];
// Placeholders in docs, examples and tests are not secrets.
const PLACEHOLDER = /<|\$\{|example|placeholder|changeme|your[-_]|xxxx|\*\*\*|user:p@|u:p@|USER|PASSWORD/i;

function secretValues() {
  const values = [];
  for (const file of ['server/.env', 'server/.env.live-test']) {
    const full = path.join(repoRoot, file);
    if (!fs.existsSync(full)) continue;
    const parsed = dotenv.parse(fs.readFileSync(full));
    for (const [name, raw] of Object.entries(parsed)) {
      const value = String(raw || '').trim();
      if (value.length < 8) continue;
      if (SECRET_NAME.test(name)) values.push({ name: `${file}:${name}`, value });
      if (name === 'MONGODB_URI') {
        const password = value.match(/:\/\/[^:]+:([^@]+)@/)?.[1];
        if (password && password.length >= 6) values.push({ name: `${file}:MONGODB_URI password`, value: password });
      }
    }
  }
  return values;
}

function filesToScan() {
  const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  const dist = path.join(repoRoot, 'client', 'dist');
  const built = [];
  if (fs.existsSync(dist)) {
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else built.push(path.relative(repoRoot, full));
      }
    };
    walk(dist);
  }
  return { files: [...new Set([...listed, ...built])].filter((file) => !BINARY.test(file)), bundle: built.length };
}

const values = secretValues();
const { files, bundle } = filesToScan();
const findings = [];
for (const file of files) {
  const full = path.join(repoRoot, file);
  if (!fs.existsSync(full) || fs.statSync(full).size > 5 * 1024 * 1024) continue;
  const text = fs.readFileSync(full, 'utf8');
  for (const { name, value } of values) {
    if (text.includes(value)) findings.push({ file, what: name });
  }
  if (file.startsWith('server/tests/')) continue;
  for (const [label, pattern] of GENERIC) {
    const match = text.match(pattern);
    if (match && !PLACEHOLDER.test(match[0])) findings.push({ file, what: label });
  }
}

const tracked = execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' }).split('\n');
const trackedEnv = tracked.filter((file) => /(^|\/)\.env(\.|$)/.test(file) && !file.endsWith('.env.example'));
for (const file of trackedEnv) findings.push({ file, what: 'environment file is tracked by git' });

console.log(`Scanned ${files.length} files (${bundle} in client/dist) for ${values.length} secret value(s) from local .env files and ${GENERIC.length} credential patterns.`);
if (findings.length === 0) {
  console.log('No secrets found.');
  process.exit(0);
}
for (const finding of findings) console.log(`FOUND ${finding.what} in ${finding.file}`);
process.exit(1);
