import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SKILLS = ["caveman", "caveman-compress"];

for (const skillName of SKILLS) {
  test(`skill ${skillName} has valid SKILL.md and frontmatter`, () => {
    const skillPath = join("skills", skillName, "SKILL.md");
    assert.ok(existsSync(skillPath), `${skillPath} must exist`);
    const content = readFileSync(skillPath, "utf-8").replace(/\r\n/g, "\n");
    assert.match(content, /^---\nname:\s*\S+/, "must have frontmatter with name");
    assert.match(content, /\ndescription:\s*/, "must have frontmatter with description");
  });
}
