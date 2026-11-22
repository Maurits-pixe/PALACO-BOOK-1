#!/usr/bin/env node
// Fail closed when CI relies on mutable third-party Action references.
// This checker is deliberately scoped to this repository's CI workflow.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function checkCiActionPins(workflow) {
  if (typeof workflow !== 'string' || !workflow.trim()) {
    return ['Missing GitHub Actions workflow'];
  }
  const errors = [];
  const refs = [...workflow.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((match) => match[1]);
  if (refs.length === 0) errors.push('Workflow must invoke pinned actions');
  for (const ref of refs) {
    if (!/^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*@[a-f0-9]{40}$/.test(ref)) {
      errors.push(`Unpinned or unexpected action reference: ${ref}`);
    }
  }
  const checkout = workflow.match(/^\s*-\s*uses:\s*actions\/checkout@[a-f0-9]{40}[^\n]*\n\s*with:\s*\n(?:\s+[^\n]*\n)*?\s+persist-credentials:\s*false\s*$/m);
  if (!checkout) errors.push('Checkout must set persist-credentials: false');
  if (!/^permissions:\s*\n\s*contents:\s*read\s*$/m.test(workflow)) {
    errors.push('Global permissions must remain contents: read');
  }
  return errors;
}

export function main() {
  let workflow;
  try {
    workflow = readFileSync(resolve('.github/workflows/ci.yml'), 'utf8');
  } catch {
    console.error('CI action pin check FAILED: unreadable workflow');
    return 2;
  }
  const errors = checkCiActionPins(workflow);
  for (const error of errors) console.error(`CI action pin check FAILED: ${error}`);
  if (errors.length) return 1;
  console.log('CI action pin check PASS (immutable action refs, no persisted checkout token)');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
