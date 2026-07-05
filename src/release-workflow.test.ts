import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/release.yml", "utf8");

describe("release workflow", () => {
  test("publishes GitHub Releases from main and master pushes", () => {
    expect(workflow).toContain("branches: [main, master]");
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain("bun run build:standalone");
    expect(workflow).toContain("./dist/ssh-agent --help");
    expect(workflow).toContain("dist/ssh-agent.sha256");
    expect(workflow).toContain("gh release create");
    expect(workflow).toContain("secrets.GITHUB_TOKEN");
  });
});
