#!/usr/bin/env node

const { execSync } = require('node:child_process');

try {
  // Get the porcelain status for the migrations directory.
  // Each line begins with a two-character status code, e.g. " M", "A ", "??".
  const output = execSync('git status --porcelain=1 apps/api/migrations', {
    encoding: 'utf8',
  });

  const lines = output.split('\n').filter(Boolean);

  // Collect lines representing modifications or deletions of tracked files.
  const modified = lines.filter((line) => {
    const status = line.slice(0, 2);
    return (
      status === ' M' || // modified, unstaged
      status === 'MM' || // modified, staged & unstaged
      status === 'D ' || // deleted, staged
      status === ' D' || // deleted, unstaged
      status === 'MD'    // modified and deleted
    );
  });

  if (modified.length > 0) {
    console.error('ERROR: Do not edit existing migration files.  Create a new migration instead.');
    modified.forEach((line) => console.error('  ', line));
    process.exit(1);
  }
} catch (err) {
  console.error('Failed to check migration modifications.');
  console.error(err.message || err);
  process.exit(1);
}