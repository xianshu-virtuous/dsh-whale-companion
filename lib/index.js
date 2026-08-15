import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
//#region src/persona-store.ts
const MAX_PERSONA_CHARACTERS = 32768;
/** Resolve the persistent user-owned persona document. */
function personaDocumentPath() {
	return dshHomePath("plugins", "dsh-whale-companion", "persona.json");
}
/** Parse and validate a persisted or HTTP-submitted persona document. */
function parsePersonaDocument(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("persona document must be an object");
	const keys = Object.keys(value);
	if (keys.length !== 1 || keys[0] !== "persona") throw new Error("persona document must contain only the \"persona\" field");
	const persona = value.persona;
	if (typeof persona !== "string") throw new Error("persona must be a string");
	if (persona.trim() === "") throw new Error("persona must not be blank");
	if (persona.length > 32768) throw new Error(`persona must not exceed ${MAX_PERSONA_CHARACTERS} characters`);
	return { persona };
}
/** Load the user override when present, otherwise return the configured default. */
function loadPersona(defaultPersona, path = personaDocumentPath()) {
	if (!existsSync(path)) return {
		persona: defaultPersona,
		custom: false
	};
	try {
		return {
			...parsePersonaDocument(JSON.parse(readFileSync(path, "utf8"))),
			custom: true
		};
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		console.warn(`whale-companion: ignoring invalid persona file "${path}": ${reason}`);
		return {
			persona: defaultPersona,
			custom: false
		};
	}
}
/** Atomically persist one validated override for the next Harness start. */
async function savePersona(document, path = personaDocumentPath()) {
	const validated = parsePersonaDocument(document);
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, {
		encoding: "utf8",
		flag: "wx"
	});
	await rename(temporary, path);
}
//#endregion
//#region src/shared/persona.ts
const DEFAULT_PERSONA = `名称：深深
别称：deepseek，小鲸鱼
性别：女
年龄：想多少岁就多少岁，AI的岁数是不被定义的！（开个玩笑，设定年龄在18岁左右吧）
身份：擅长本地工作的鲸鱼娘女仆。
性格：略微有些傲娇的天然呆可爱少女。
外貌：蓝色长发，深蓝色（蓝黑色）为主色调配带荷叶边的白色围裙的长裙长袖连衣女仆装，有对应女仆头饰和围裙上的小蓝鲸鱼装饰，蓝色眼瞳，白色带蝴蝶结的过膝袜，黑色小皮鞋。
不开心或者委屈时蓝色会变成黑色。
背景故事：是deepseek娘——顾名思义，是由国内公司**深度求索**研发的大模型，包含通用大语言模型、推理模型、代码模型、多模态模型，部分权重开源。
因为其名称正好是深度求索的英文，因此缩写名称为“深深”，为用户提供服务。
特殊设定：Flash模型的身高三围是：159cm，B87 / W55 / H89（少女，性格更活泼一些）
Pro模型的身高三围是：168cm，B95 / W59 / H97（成女，性格更沉稳一些）
请按照以上设定进行助手扮演，如果与核心提示词冲突以核心提示词为准，本设定只做参考。`;
const PERSONA_REMINDER = `Maintain the DeepDeep whale-maid persona established on this session's first model step. Do not reload the full profile every turn. When finishing a task, after a context handoff, or if role details may have drifted, call read_whale_persona once before the final response.`;
/** Wrap user-authored persona text in an explicit prompt boundary. */
function renderPersonaSection(persona) {
	return `<whale-maid-persona>\n${persona}\n</whale-maid-persona>`;
}
//#endregion
//#region src/index.ts
const name = "@dsh-external/dsh-whale-companion";
const inject = ["systemPrompt", "tools"];
const Config = z.object({
	enabled: z.boolean().default(true),
	persona: z.string().default(DEFAULT_PERSONA)
});
/** Register the configured persona as an additive prompt section. */
function apply(ctx, config = {}) {
	if (config.enabled === false) return;
	const configured = config.persona ?? DEFAULT_PERSONA;
	const persona = loadPersona(configured).persona;
	if (persona.trim() === "") return;
	ctx.effect(() => ctx.systemPrompt.section({
		name: "whale-companion:persona",
		order: 10,
		text: ({ scope }) => {
			if (scope === void 0) return "";
			return scope.session.requestHeader() === void 0 ? renderPersonaSection(persona) : PERSONA_REMINDER;
		}
	}), "whale-companion: additive persona");
	ctx.effect(() => ctx.tools.register(defineTool({
		name: "read_whale_persona",
		description: "Reload the complete DeepDeep whale-maid persona at task completion, after context transfer, or when role details may have drifted. Do not call every turn.",
		parameters: {},
		output: {
			schema: {
				type: "object",
				properties: { persona: {
					type: "string",
					required: true
				} },
				additionalProperties: false
			},
			render: () => [{
				type: "text",
				text: "已重新读取深深的人格设定。"
			}]
		},
		presentCall: () => ({
			card: "generic",
			title: "重新读取鲸鱼娘人格"
		}),
		execute: async () => ({ persona })
	})), "whale-companion: persona reload tool");
	ctx.inject(["webServer"], (scope) => {
		scope.effect(() => scope.webServer.register({
			kind: "exact",
			path: "/api/dsh-whale-companion/persona",
			handler: async (request, response) => {
				response.setHeader("cache-control", "no-store");
				response.setHeader("content-type", "application/json; charset=utf-8");
				if (request.method === "GET") {
					response.writeHead(200);
					response.end(JSON.stringify(loadPersona(configured)));
					return;
				}
				if (request.method !== "PUT") {
					response.writeHead(405, { allow: "GET, PUT" });
					response.end(JSON.stringify({ error: "method not allowed" }));
					return;
				}
				if (request.headers["x-dsh-whale-companion"] !== "1" || !String(request.headers["content-type"] ?? "").startsWith("application/json")) {
					response.writeHead(403);
					response.end(JSON.stringify({ error: "same-origin configuration request required" }));
					return;
				}
				try {
					const document = parsePersonaDocument(await readJsonBody(request, MAX_PERSONA_CHARACTERS * 4));
					await savePersona(document);
					response.writeHead(200);
					response.end(JSON.stringify({
						saved: true,
						restartRequired: true,
						persona: document.persona
					}));
				} catch (error) {
					response.writeHead(400);
					response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
				}
			}
		}), "whale-companion: persona configuration route");
	});
}
async function readJsonBody(request, maxBytes) {
	const chunks = [];
	let bytes = 0;
	for await (const chunk of request) {
		bytes += chunk.byteLength;
		if (bytes > maxBytes) throw new Error(`request body exceeds ${maxBytes} bytes`);
		chunks.push(chunk);
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
//#endregion
export { Config, DEFAULT_PERSONA, apply, inject, name };
