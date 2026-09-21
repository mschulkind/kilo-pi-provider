import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { KILO_PROJECT_HEADER, resolveProjectId, withProjectHeader } from "../src/project.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function repo(): string {
	const directory = mkdtempSync(join(tmpdir(), "kilo-project-test-"));
	temporaryDirectories.push(directory);
	return directory;
}

function writeProjectConfig(directory: string, relative: string, id: string): void {
	const path = join(directory, relative);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify({ project: { id } }));
}

function writeGitConfig(directory: string, body: string): void {
	mkdirSync(join(directory, ".git"), { recursive: true });
	writeFileSync(join(directory, ".git", "config"), body);
}

test("reads the explicit project id from .kilo/config.json", () => {
	const directory = repo();
	writeProjectConfig(directory, ".kilo/config.json", "my-project");
	expect(resolveProjectId(directory)).toBe("my-project");
});

test("falls back to the legacy .kilocode/config.json", () => {
	const directory = repo();
	writeProjectConfig(directory, ".kilocode/config.json", "legacy-project");
	expect(resolveProjectId(directory)).toBe("legacy-project");
});

test("prefers .kilo over the legacy path", () => {
	const directory = repo();
	writeProjectConfig(directory, ".kilo/config.json", "current");
	writeProjectConfig(directory, ".kilocode/config.json", "legacy");
	expect(resolveProjectId(directory)).toBe("current");
});

test("derives the repo name from the origin remote", () => {
	const directory = repo();
	writeGitConfig(directory, '[remote "origin"]\n\turl = git@github.com:someone/example-repo.git\n');
	expect(resolveProjectId(directory)).toBe("example-repo");
});

test("derives the repo name from an https origin without .git", () => {
	const directory = repo();
	writeGitConfig(directory, '[remote "origin"]\n\turl = https://github.com/someone/plain-name\n');
	expect(resolveProjectId(directory)).toBe("plain-name");
});

test("ignores a url under a non-origin remote", () => {
	const directory = repo();
	writeGitConfig(
		directory,
		'[remote "upstream"]\n\turl = git@github.com:upstream/wrong-project.git\n',
	);
	expect(resolveProjectId(directory)).toBeUndefined();
});

test("reads another remote alongside origin without confusing them", () => {
	const directory = repo();
	writeGitConfig(
		directory,
		'[remote "upstream"]\n\turl = git@github.com:upstream/wrong.git\n\n[remote "origin"]\n\turl = git@github.com:someone/right.git\n',
	);
	expect(resolveProjectId(directory)).toBe("right");
});

test("follows a worktree .git file to the real repo", () => {
	const directory = repo();
	const gitDir = join(directory, "real-git-dir");
	mkdirSync(gitDir, { recursive: true });
	writeFileSync(join(gitDir, "config"), '[remote "origin"]\n\turl = git@github.com:someone/worktree-repo.git\n');
	const worktree = join(directory, "worktree");
	mkdirSync(worktree, { recursive: true });
	writeFileSync(join(worktree, ".git"), `gitdir: ${gitDir}\n`);
	expect(resolveProjectId(worktree)).toBe("worktree-repo");
});

test("the explicit config wins over the git remote", () => {
	const directory = repo();
	writeProjectConfig(directory, ".kilo/config.json", "explicit");
	writeGitConfig(directory, '[remote "origin"]\n\turl = git@github.com:someone/from-git.git\n');
	expect(resolveProjectId(directory)).toBe("explicit");
});

test("returns undefined when nothing can be resolved", () => {
	expect(resolveProjectId(repo())).toBeUndefined();
});

test("a malformed project config falls through to the remote rather than throwing", () => {
	const directory = repo();
	mkdirSync(join(directory, ".kilo"), { recursive: true });
	writeFileSync(join(directory, ".kilo", "config.json"), "{ not json");
	writeGitConfig(directory, '[remote "origin"]\n\turl = git@github.com:someone/fallback.git\n');
	expect(resolveProjectId(directory)).toBe("fallback");
});

test("an empty project id is treated as absent", () => {
	const directory = repo();
	writeProjectConfig(directory, ".kilo/config.json", "   ");
	expect(resolveProjectId(directory)).toBeUndefined();
});

test("withProjectHeader adds the header only when there is an id", () => {
	const base = { "X-KILOCODE-EDITORNAME": "Pi" };
	expect(withProjectHeader(base, "my-project")).toEqual({
		"X-KILOCODE-EDITORNAME": "Pi",
		[KILO_PROJECT_HEADER]: "my-project",
	});
	expect(withProjectHeader(base, undefined)).toEqual(base);
});
