#!/usr/bin/env node
// Verifies every relative markdown link in the course resolves to a real file,
// and that every in-page anchor target exists. A course is a graph of
// cross-references; a broken one silently strands a reader.
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SKIP_DIRS = new Set(["node_modules", ".git"]);

async function markdownFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await markdownFiles(full));
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

// [text](target) — ignores images' leading ! only for reporting purposes
const LINK_RE = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

// Code is not prose: `handlers[job.name](job.data)` is not a link. Strip fenced
// and inline code before scanning, keeping newlines so headings stay aligned.
const stripCode = (content) =>
  content
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length));

const slugify = (heading) =>
  heading
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

const anchorsFor = (content) =>
  new Set(
    content
      .split("\n")
      .filter((l) => /^#{1,6}\s/.test(l))
      .map((l) => slugify(l.replace(/^#{1,6}\s+/, "")))
  );

const failures = [];
const files = await markdownFiles(ROOT);

for (const file of files) {
  const content = await readFile(file, "utf8");
  const prose = stripCode(content);
  const rel = path.relative(ROOT, file);

  for (const [, target] of prose.matchAll(LINK_RE)) {
    if (/^(https?:|mailto:|tel:)/.test(target)) continue; // external: not our job

    const [pathPart, anchor] = target.split("#");

    if (pathPart === "") {
      // pure in-page anchor
      if (anchor && !anchorsFor(content).has(anchor)) {
        failures.push(`${rel}: missing in-page anchor #${anchor}`);
      }
      continue;
    }

    const resolved = path.resolve(path.dirname(file), pathPart);
    if (!existsSync(resolved)) {
      failures.push(`${rel}: broken link → ${target}`);
      continue;
    }
    if (anchor && resolved.endsWith(".md")) {
      const targetAnchors = anchorsFor(await readFile(resolved, "utf8"));
      if (!targetAnchors.has(anchor)) {
        failures.push(`${rel}: missing anchor ${target}`);
      }
    }
  }
}

console.log(`checked ${files.length} markdown files`);
if (failures.length > 0) {
  console.error(`\n${failures.length} broken link(s):`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log("all relative links resolve ✓");
