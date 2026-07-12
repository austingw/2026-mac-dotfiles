import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type Decision = "allow" | "ask" | "deny";
type AgentType = "agent" | "subagent";
type PermissionRules = Record<string, unknown>;

type AgentProfile = {
	shortName?: string;
	displayName?: string;
	tabColor?: string;
	type: AgentType;
	provider?: string;
	model?: string;
	thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
	tools?: string[];
	prompt?: string;
	promptFile?: string;
	permissions?: PermissionRules | { permission?: PermissionRules };
};

type AgentsConfig = {
	defaultAgent?: string;
	agents: Record<string, AgentProfile>;
};

type ChildResult = {
	agent: string;
	model: string;
	output: string;
	exitCode: number;
	stderr: string;
};

const CONFIG_PATH = resolve(getAgentDir(), "agents.jsonc");
const DECISIONS = new Set<Decision>(["allow", "ask", "deny"]);
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const MAX_PARALLEL = 4;

let cachedMtimeMs = -1;
let cachedConfig: AgentsConfig | undefined;
let cachedError: string | undefined;
let activeAgentId: string | undefined;

function parseJsonc(source: string): unknown {
	let output = "";
	let inString = false;
	let escaped = false;

	for (let i = 0; i < source.length; i++) {
		const char = source[i];
		const next = source[i + 1];
		if (inString) {
			output += char;
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === '"') inString = false;
			continue;
		}
		if (char === '"') {
			inString = true;
			output += char;
		} else if (char === "/" && next === "/") {
			while (i < source.length && source[i] !== "\n") i++;
			output += "\n";
		} else if (char === "/" && next === "*") {
			i += 2;
			while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
			i++;
		} else {
			output += char;
		}
	}
	return JSON.parse(output.replace(/,(\s*[}\]])/g, "$1"));
}

function loadConfig(): AgentsConfig | undefined {
	try {
		const mtimeMs = statSync(CONFIG_PATH).mtimeMs;
		if (cachedConfig && mtimeMs === cachedMtimeMs) return cachedConfig;
		const parsed = parseJsonc(readFileSync(CONFIG_PATH, "utf8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("top-level value must be an object");
		const config = parsed as Partial<AgentsConfig>;
		if (!config.agents || typeof config.agents !== "object" || Array.isArray(config.agents)) {
			throw new Error('missing required "agents" object');
		}
		for (const [id, profile] of Object.entries(config.agents)) validateProfile(id, profile);
		cachedConfig = config as AgentsConfig;
		cachedMtimeMs = mtimeMs;
		cachedError = undefined;
		return cachedConfig;
	} catch (error) {
		cachedConfig = undefined;
		cachedMtimeMs = -1;
		cachedError = error instanceof Error ? error.message : String(error);
		return undefined;
	}
}

function validateProfile(id: string, profile: unknown): asserts profile is AgentProfile {
	if (!profile || typeof profile !== "object" || Array.isArray(profile)) throw new Error(`agent "${id}" must be an object`);
	const value = profile as Record<string, unknown>;
	if (value.type !== "agent" && value.type !== "subagent") throw new Error(`agent "${id}" has invalid type`);
	if (value.shortName !== undefined && (typeof value.shortName !== "string" || !/^[A-Za-z0-9_-]{1,5}$/.test(value.shortName))) {
		throw new Error(`agent "${id}" shortName must be 1-5 letters, numbers, underscores, or hyphens`);
	}
	if (value.tabColor !== undefined && (typeof value.tabColor !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(value.tabColor))) {
		throw new Error(`agent "${id}" tabColor must be a #RRGGBB value`);
	}
	if (value.thinkingLevel !== undefined && (typeof value.thinkingLevel !== "string" || !THINKING_LEVELS.has(value.thinkingLevel))) {
		throw new Error(`agent "${id}" has an invalid thinkingLevel`);
	}
	if (value.tools !== undefined && (!Array.isArray(value.tools) || value.tools.some((tool) => typeof tool !== "string"))) {
		throw new Error(`agent "${id}" tools must be an array of strings`);
	}
	if (value.prompt !== undefined && typeof value.prompt !== "string") throw new Error(`agent "${id}" prompt must be a string`);
	if (value.promptFile !== undefined && typeof value.promptFile !== "string") throw new Error(`agent "${id}" promptFile must be a string`);
}

function getProfile(id = activeAgentId): AgentProfile | undefined {
	if (!id) return undefined;
	return loadConfig()?.agents[id];
}

function chooseDefaultAgent(config: AgentsConfig): string | undefined {
	if (config.defaultAgent && config.agents[config.defaultAgent]?.type === "agent") return config.defaultAgent;
	return Object.entries(config.agents).find(([, profile]) => profile.type === "agent")?.[0];
}

function getPrompt(profile: AgentProfile): string {
	const parts: string[] = [];
	if (profile.prompt) parts.push(profile.prompt.trim());
	if (profile.promptFile) {
		try {
			const promptPath = resolve(dirname(CONFIG_PATH), profile.promptFile);
			parts.push(readFileSync(promptPath, "utf8").trim());
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			parts.push(`[Could not load agent prompt file "${profile.promptFile}": ${message}]`);
		}
	}
	return parts.filter(Boolean).join("\n\n");
}

function displayName(id: string, profile: AgentProfile): string {
	return profile.displayName ?? id;
}

function shortName(id: string, profile: AgentProfile): string {
	return profile.shortName ?? id.slice(0, 5).toUpperCase();
}

function isDecision(value: unknown): value is Decision {
	return typeof value === "string" && DECISIONS.has(value as Decision);
}

function globMatches(pattern: string, value: string): boolean {
	let expression = "^";
	for (const char of pattern.replace(/\\/g, "/")) {
		if (char === "*") expression += ".*";
		else if (char === "?") expression += ".";
		else expression += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
	}
	return new RegExp(`${expression}$`).test(value.replace(/\\/g, "/"));
}

function evaluateRule(rule: unknown, candidates: string[]): Decision | undefined {
	if (isDecision(rule)) return rule;
	if (!rule || typeof rule !== "object" || Array.isArray(rule)) return undefined;
	let result: Decision | undefined;
	for (const [pattern, value] of Object.entries(rule)) {
		if (isDecision(value) && candidates.some((candidate) => globMatches(pattern, candidate))) result = value;
	}
	return result;
}

function getPermissionRules(profile: AgentProfile | undefined): PermissionRules | undefined {
	const permissions = profile?.permissions;
	if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) return undefined;
	const wrapped = permissions as { permission?: unknown };
	if (wrapped.permission && typeof wrapped.permission === "object" && !Array.isArray(wrapped.permission)) {
		return wrapped.permission as PermissionRules;
	}
	return permissions as PermissionRules;
}

function getTarget(toolName: string, input: Record<string, unknown>, cwd: string): { display?: string; candidates: string[]; external: boolean } {
	const raw = typeof input.command === "string"
		? input.command
		: typeof input.path === "string"
			? input.path
			: typeof input.url === "string"
				? input.url
				: undefined;
	if (!raw) return { candidates: [], external: false };
	if (toolName === "bash" || typeof input.path !== "string") return { display: raw, candidates: [raw], external: false };
	const path = raw.startsWith("@") ? raw.slice(1) : raw;
	const absolute = resolve(cwd, path);
	const fromCwd = relative(cwd, absolute);
	return {
		display: raw,
		candidates: [path, fromCwd || ".", absolute],
		external: fromCwd === ".." || fromCwd.startsWith("../") || isAbsolute(fromCwd),
	};
}

function mostRestrictive(...values: Array<Decision | undefined>): Decision {
	if (values.includes("deny")) return "deny";
	if (values.includes("ask")) return "ask";
	if (values.includes("allow")) return "allow";
	return "ask"; // Missing rules fail safely.
}

function permissionDecision(profile: AgentProfile | undefined, toolName: string, input: Record<string, unknown>, cwd: string) {
	const rules = getPermissionRules(profile);
	const target = getTarget(toolName, input, cwd);
	if (!rules) return { decision: "ask" as const, target: target.display };
	const global = evaluateRule(rules["*"], target.candidates);
	const tool = evaluateRule(rules[toolName], target.candidates);
	const external = target.external ? evaluateRule(rules.external_directory, target.candidates) : undefined;
	return { decision: mostRestrictive(global, tool, external), target: target.display };
}

function childInvocation(args: string[]): { command: string; args: string[] } {
	const script = process.argv[1];
	if (script && !script.startsWith("/$bunfs/") && script !== "[eval]" && !script.includes("node_modules/.bin/")) {
		return { command: process.execPath, args: [script, ...args] };
	}
	return { command: "pi", args };
}

function finalAssistantText(messages: Array<Record<string, unknown>>): string {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
		for (const part of message.content) {
			if (part && typeof part === "object" && (part as { type?: unknown }).type === "text") {
				const text = (part as { text?: unknown }).text;
				if (typeof text === "string") return text;
			}
		}
	}
	return "";
}

function writeRpc(proc: ChildProcessWithoutNullStreams, value: Record<string, unknown>): void {
	if (!proc.stdin.destroyed) proc.stdin.write(`${JSON.stringify(value)}\n`);
}

async function runSubagent(
	parentCtx: ExtensionContext,
	id: string,
	profile: AgentProfile,
	task: string,
	cwd?: string,
): Promise<ChildResult> {
	const args = ["--mode", "rpc", "--no-session"];
	if (profile.provider) args.push("--provider", profile.provider);
	if (profile.model) args.push("--model", profile.model);
	if (profile.thinkingLevel) args.push("--thinking", profile.thinkingLevel);
	if (profile.tools?.length) args.push("--tools", profile.tools.join(","));
	const invocation = childInvocation(args);
	const proc = spawn(invocation.command, invocation.args, {
		cwd: cwd ?? parentCtx.cwd,
		shell: false,
		stdio: ["pipe", "pipe", "pipe"],
		env: { ...process.env, PI_AGENT_PROFILE: id, PI_AGENT_PARENT: "1" },
	});
	const messages: Array<Record<string, unknown>> = [];
	let stderr = "";
	let buffer = "";
	let settled = false;
	let resolveResult: ((value: ChildResult) => void) | undefined;
	const modelName = [profile.provider, profile.model].filter(Boolean).join("/") || "default model";
	const result = new Promise<ChildResult>((resolveResultValue) => {
		resolveResult = resolveResultValue;
	});
	const finish = (exitCode: number) => {
		if (settled) return;
		settled = true;
		resolveResult?.({ agent: id, model: modelName, output: finalAssistantText(messages), exitCode, stderr });
		if (!proc.killed) proc.kill("SIGTERM");
	};
	let approvalTail = Promise.resolve();
	const relayUiRequest = (request: Record<string, unknown>) => {
		approvalTail = approvalTail.then(async () => {
			const requestId = request.id;
			if (typeof requestId !== "string") return;
			if (!['confirm', 'select', 'input', 'editor'].includes(String(request.method))) return;
			if (!parentCtx.hasUI) {
				writeRpc(proc, { type: "extension_ui_response", id: requestId, confirmed: false, cancelled: true });
				return;
			}
			const label = `[${shortName(id, profile)}] ${String(request.title ?? "Permission required")}`;
			if (request.method === "confirm") {
				const approved = await parentCtx.ui.confirm(label, String(request.message ?? "Allow this action?"));
				writeRpc(proc, { type: "extension_ui_response", id: requestId, confirmed: approved });
				return;
			}
			if (request.method === "select" && Array.isArray(request.options)) {
				const choice = await parentCtx.ui.select(label, request.options.filter((item): item is string => typeof item === "string"));
				writeRpc(proc, choice === undefined
					? { type: "extension_ui_response", id: requestId, cancelled: true }
					: { type: "extension_ui_response", id: requestId, value: choice });
				return;
			}
			// Only permission confirmations are expected. Fail closed for other dialog types.
			writeRpc(proc, { type: "extension_ui_response", id: requestId, cancelled: true });
		}).catch(() => undefined);
	};
	const processLine = (line: string) => {
		if (!line.trim()) return;
		let event: Record<string, unknown>;
		try {
			event = JSON.parse(line) as Record<string, unknown>;
		} catch {
			return;
		}
		if (event.type === "extension_ui_request") relayUiRequest(event);
		if (event.type === "message_end" && event.message && typeof event.message === "object") {
			messages.push(event.message as Record<string, unknown>);
		}
		if (event.type === "agent_settled") finish(0);
		if (event.type === "response" && event.success === false) finish(1);
	};
	proc.stdout.on("data", (chunk: Buffer) => {
		buffer += chunk.toString();
		while (true) {
			const newline = buffer.indexOf("\n");
			if (newline < 0) break;
			const line = buffer.slice(0, newline).replace(/\r$/, "");
			buffer = buffer.slice(newline + 1);
			processLine(line);
		}
	});
	proc.stderr.on("data", (chunk: Buffer) => {
		stderr += chunk.toString();
	});
	proc.on("error", () => finish(1));
	proc.on("close", (code) => {
		if (buffer.trim()) processLine(buffer.replace(/\r$/, ""));
		finish(code ?? 0);
	});
	if (parentCtx.signal) {
		const abort = () => {
			if (!proc.killed) proc.kill("SIGTERM");
			setTimeout(() => {
				if (!settled && !proc.killed) proc.kill("SIGKILL");
			}, 5000);
		};
		if (parentCtx.signal.aborted) abort();
		else parentCtx.signal.addEventListener("abort", abort, { once: true });
	}
	writeRpc(proc, { type: "prompt", message: `Task: ${task}` });
	return result;
}

export default function (pi: ExtensionAPI) {
	const applyProfile = async (id: string, profile: AgentProfile, ctx: any) => {
		activeAgentId = id;
		if (profile.provider && profile.model) {
			const model = ctx.modelRegistry.find(profile.provider, profile.model);
			if (model) await pi.setModel(model);
			else if (ctx.hasUI) ctx.ui.notify(`Agent ${id}: model ${profile.provider}/${profile.model} is unavailable`, "warning");
		}
		if (profile.thinkingLevel) pi.setThinkingLevel(profile.thinkingLevel);
		if (profile.tools) {
			const available = new Set(pi.getAllTools().map((tool) => tool.name));
			pi.setActiveTools(profile.tools.filter((tool) => available.has(tool)));
		}
		if (ctx.hasUI) {
			ctx.ui.setStatus("agents", `${shortName(id, profile)} · ${displayName(id, profile)}`);
			ctx.ui.setTitle(`pi · ${shortName(id, profile)}`);
		}
	};

	pi.on("session_start", async (_event, ctx) => {
		const config = loadConfig();
		if (!config) {
			if (ctx.hasUI) ctx.ui.notify(`Agents config error (${CONFIG_PATH}): ${cachedError}`, "warning");
			return;
		}
		const requested = process.env.PI_AGENT_PROFILE;
		const id = requested && config.agents[requested] ? requested : chooseDefaultAgent(config);
		if (!id) {
			if (ctx.hasUI) ctx.ui.notify(`No top-level agent is configured in ${CONFIG_PATH}`, "warning");
			return;
		}
		await applyProfile(id, config.agents[id], ctx);
	});

	pi.on("before_agent_start", (event) => {
		const profile = getProfile();
		if (!profile || !activeAgentId) return undefined;
		const prompt = getPrompt(profile);
		const config = loadConfig();
		const subagents = profile.type === "agent"
			? Object.entries(config?.agents ?? {})
				.filter(([, candidate]) => candidate.type === "subagent")
				.map(([id, candidate]) => `- ${id} (${shortName(id, candidate)}): ${candidate.displayName ?? id}`)
				.join("\n")
			: "";
		let addition = `\n\n## Active Agent\nYou are ${displayName(activeAgentId, profile)} (${shortName(activeAgentId, profile)}).`;
		if (prompt) addition += `\n\n${prompt}`;
		if (subagents) addition += `\n\n## Available Subagents\nDelegate isolated tasks with the subagent tool:\n${subagents}`;
		return { systemPrompt: event.systemPrompt + addition };
	});

	pi.on("tool_call", async (event, ctx) => {
		const input = (event.input && typeof event.input === "object" ? event.input : {}) as Record<string, unknown>;
		const profile = getProfile();
		const result = permissionDecision(profile, event.toolName, input, ctx.cwd);
		if (result.decision === "allow") return undefined;
		if (result.decision === "deny") return { block: true, reason: `Denied by ${activeAgentId ?? "unknown"} agent profile` };
		if (!ctx.hasUI) return { block: true, reason: `Permission required for ${event.toolName}, but this mode cannot prompt` };
		const subject = result.target ? `\n\n${result.target}` : "";
		const allowed = await ctx.ui.confirm(
			`[${profile && activeAgentId ? shortName(activeAgentId, profile) : "AGENT"}] Permission required`,
			`Allow ${event.toolName}?${subject}`,
		);
		return allowed ? undefined : { block: true, reason: "Permission denied by user" };
	});

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: "Delegate an isolated task to a configured subagent. Subagent permission requests are relayed to the parent UI.",
		parameters: Type.Object({
			agent: Type.Optional(Type.String({ description: "Configured subagent id" })),
			task: Type.Optional(Type.String({ description: "Task for a single subagent" })),
			tasks: Type.Optional(Type.Array(Type.Object({ agent: Type.String(), task: Type.String() }))),
			chain: Type.Optional(Type.Array(Type.Object({ agent: Type.String(), task: Type.String() }))),
			cwd: Type.Optional(Type.String({ description: "Working directory for a single subagent" })),
		}),
		async execute(_toolCallId, params, _signal, onUpdate, ctx) {
			const config = loadConfig();
			if (!config) return { content: [{ type: "text", text: `Agents config error: ${cachedError}` }], details: {} };
			const single = Boolean(params.agent && params.task);
			const parallel = (params.tasks?.length ?? 0) > 0;
			const chain = (params.chain?.length ?? 0) > 0;
			if (Number(single) + Number(parallel) + Number(chain) !== 1) {
				return { content: [{ type: "text", text: "Provide exactly one of agent + task, tasks, or chain." }], details: {} };
			}
			const run = async (agentId: string, task: string, cwd?: string) => {
				const profile = config.agents[agentId];
				if (!profile || profile.type !== "subagent") throw new Error(`Unknown subagent: ${agentId}`);
				onUpdate?.({ content: [{ type: "text", text: `[${shortName(agentId, profile)}] running…` }], details: {} });
				return runSubagent(ctx, agentId, profile, task, cwd);
			};
			try {
				if (single) {
					const result = await run(params.agent!, params.task!, params.cwd);
					return {
						content: [{ type: "text", text: result.output || result.stderr || "(subagent returned no text)" }],
						details: { mode: "single", results: [result] },
					};
				}
				if (parallel) {
					if (params.tasks!.length > MAX_PARALLEL) throw new Error(`At most ${MAX_PARALLEL} subagents can run in parallel`);
					const results = await Promise.all(params.tasks!.map((item) => run(item.agent, item.task)));
					return {
						content: [{ type: "text", text: results.map((result) => `### ${result.agent}\n${result.output || result.stderr || "(no output)"}`).join("\n\n") }],
						details: { mode: "parallel", results },
					};
				}
				const results: ChildResult[] = [];
				let previous = "";
				for (const item of params.chain!) {
					const result = await run(item.agent, item.task.replace(/\{previous\}/g, previous));
					results.push(result);
					if (result.exitCode !== 0) break;
					previous = result.output;
				}
				return {
					content: [{ type: "text", text: results[results.length - 1]?.output || results[results.length - 1]?.stderr || "(no output)" }],
					details: { mode: "chain", results },
				};
			} catch (error) {
				throw new Error(error instanceof Error ? error.message : String(error));
			}
		},
	});

	pi.registerCommand("agents", {
		description: "List configured agent profiles",
		handler: async (_args, ctx) => {
			const config = loadConfig();
			if (!config) return ctx.ui.notify(`Agents config error: ${cachedError}`, "warning");
			const list = Object.entries(config.agents)
				.map(([id, profile]) => `${id} [${shortName(id, profile)}] · ${profile.type} · ${profile.provider ?? "default"}/${profile.model ?? "default"}`)
				.join("\n");
			ctx.ui.notify(`Configured agents:\n${list}\n\nConfig: ${CONFIG_PATH}`, "info");
		},
	});

	pi.registerCommand("agent", {
		description: "Switch the top-level agent profile: /agent <id>",
		handler: async (args, ctx) => {
			const config = loadConfig();
			if (!config) return ctx.ui.notify(`Agents config error: ${cachedError}`, "warning");
			let id = args.trim();
			if (!id && ctx.hasUI) {
				const choices = Object.entries(config.agents).filter(([, profile]) => profile.type === "agent").map(([name]) => name);
				id = (await ctx.ui.select("Switch agent", choices)) ?? "";
			}
			const profile = config.agents[id];
			if (!profile || profile.type !== "agent") {
				return ctx.ui.notify(`Unknown top-level agent: ${id || "(none)"}`, "warning");
			}
			await applyProfile(id, profile, ctx);
			ctx.ui.notify(`Active agent: ${displayName(id, profile)} [${shortName(id, profile)}]`, "info");
		},
	});
}
