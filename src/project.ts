/**
 * Project identity for Kilo's usage attribution.
 *
 * Kilo's dashboard groups spend by project, and the project travels in the
 * X-KILOCODE-PROJECTID header. Kilo's own clients derive it in two ways, in this
 * order:
 *
 *   1. .kilo/config.json  ->  {"project": {"id": "my-project"}}   (explicit)
 *   2. .git/config        ->  the `origin` remote's repository name
 *
 * This extension did neither, so every request was unattributed and the
 * dashboard column stayed empty.
 *
 * Nothing is sent when neither resolves. An unattributed request is better than
 * a wrong one: guessing a name would file real spend under a project the user
 * does not have, and empty cells are self-correcting while misattribution is not.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";

export const KILO_PROJECT_HEADER = "X-KILOCODE-PROJECTID";

/** Config paths in precedence order: the current name, then the legacy one. */
const PROJECT_CONFIG_FILES = [".kilo/config.json", ".kilocode/config.json"];

/** The explicit override, if a project config file names one. */
function readProjectFromConfig(cwd: string): string | undefined {
	for (const relative of PROJECT_CONFIG_FILES) {
		const path = join(cwd, relative);
		if (!existsSync(path)) continue;
		try {
			const parsed = JSON.parse(readFileSync(path, "utf8")) as {
				project?: { id?: unknown };
			};
			const id = parsed?.project?.id;
			if (typeof id === "string" && id.trim().length > 0) return id.trim();
		} catch {
			// A malformed file is not worth failing a session over; fall through to
			// the git remote, which is the weaker but always-available source.
		}
	}
	return undefined;
}

/**
 * The path to the repo's git config.
 *
 * `.git` is a DIRECTORY in a normal checkout and a FILE in a worktree, holding
 * `gitdir: <path>`. Worktrees matter here rather than being theoretical: this
 * agent isolates subagents in git worktrees, so an agent's cwd is routinely a
 * worktree and a dir-only read would silently find no project.
 */
function gitConfigPath(cwd: string): string | undefined {
	const dotGit = join(cwd, ".git");
	if (!existsSync(dotGit)) return undefined;
	try {
		const stat = statSync(dotGit);
		if (stat.isDirectory()) return join(dotGit, "config");
		if (stat.isFile()) {
			const match = readFileSync(dotGit, "utf8").match(/^\s*gitdir:\s*(.+)$/m);
			if (!match) return undefined;
			const dir = match[1]!.trim();
			return join(isAbsolute(dir) ? dir : join(cwd, dir), "config");
		}
	} catch {
		return undefined;
	}
	return undefined;
}

/**
 * The repository name from the `origin` remote, matching Kilo's own clients:
 * a URL ending in `example-repo.git` yields `example-repo`.
 */
function readProjectFromGitConfig(cwd: string): string | undefined {
	const path = gitConfigPath(cwd);
	if (!path || !existsSync(path)) return undefined;
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
	// Only the origin section: a `url` under any other remote must not be used,
	// or an upstream/fork remote could file spend under the wrong project.
	const section = text.match(/\[remote "origin"\]([\s\S]*?)(?=\n\[|$)/);
	if (!section) return undefined;
	const url = section[1]!.match(/^\s*url\s*=\s*(.+)$/m)?.[1]?.trim();
	if (!url) return undefined;
	const name = basename(url.replace(/\/+$/, "")).replace(/\.git$/, "");
	return name.length > 0 ? name : undefined;
}

/** The project id to report, or undefined when nothing can be resolved. */
export function resolveProjectId(cwd: string): string | undefined {
	return readProjectFromConfig(cwd) ?? readProjectFromGitConfig(cwd);
}

export function withProjectHeader(
	headers: Record<string, string>,
	projectId?: string,
): Record<string, string> {
	if (!projectId) return headers;
	return { ...headers, [KILO_PROJECT_HEADER]: projectId };
}
