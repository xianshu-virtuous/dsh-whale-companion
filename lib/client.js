window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-whale-companion",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
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
		//#endregion
		//#region \0whale-css:F:\dsh\dsh-whale-companion\src\client\PersonaSettingsSection.module.css.mjs
		const css = ".eUPQwa_section{border:1px solid var(--dsw-alias-border-normal);background:var(--dsw-alias-bg-layer-1);border-radius:8px;gap:16px;width:min(760px,100%);padding:20px;display:grid}.eUPQwa_heading{align-items:center;gap:12px;display:flex}.eUPQwa_heading h2,.eUPQwa_heading p{margin:0}.eUPQwa_heading h2{color:var(--dsw-alias-label-primary);font-size:18px;line-height:26px}.eUPQwa_heading p{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}.eUPQwa_crest{background:var(--dsw-alias-brand-primary);width:42px;height:42px;mask:var(--maid-bow-art) center / contain no-repeat;border-radius:50%;flex:0 0 42px}.eUPQwa_field{color:var(--dsw-alias-label-primary);gap:8px;font-size:13px;font-weight:600;display:grid}.eUPQwa_field small{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}.eUPQwa_field textarea{box-sizing:border-box;resize:vertical;border:1px solid var(--dsw-alias-border-normal);background:var(--dsw-alias-bg-layer-2);width:100%;min-height:320px;color:var(--dsw-alias-label-primary);border-radius:6px;padding:12px 14px;font:13px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace}.eUPQwa_field textarea:focus{border-color:var(--dsw-alias-brand-primary);outline:2px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 24%, transparent)}.eUPQwa_meta,.eUPQwa_actions{justify-content:space-between;align-items:center;gap:12px;display:flex}.eUPQwa_meta{color:var(--dsw-alias-label-tertiary);font-size:12px}.eUPQwa_error{color:var(--dsw-alias-error-primary)}.eUPQwa_actions{justify-content:flex-end}.eUPQwa_restartText{color:var(--dsw-alias-label-secondary);margin:0;line-height:1.6}.eUPQwa_dialog{max-width:520px}body[data-dsh-maid-atelier] .eUPQwa_section{border-color:color-mix(in srgb, #d7bd76 58%, var(--dsw-alias-border-normal));background-image:linear-gradient(var(--dsw-alias-bg-layer-1), var(--dsw-alias-bg-layer-1)), var(--maid-settings-frame-art);background-position:50%,50%;background-repeat:no-repeat;background-size:auto,100% 100%}@media (width<=640px){.eUPQwa_section{padding:14px}.eUPQwa_field textarea{min-height:240px}}";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"@dsh-external/dsh-whale-companion/PersonaSettingsSection.module.css\"]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@dsh-external/dsh-whale-companion";
			tag.dataset.pluginCss = "@dsh-external/dsh-whale-companion/PersonaSettingsSection.module.css";
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var PersonaSettingsSection_module_css_default = {
			"section": "eUPQwa_section",
			"restartText": "eUPQwa_restartText",
			"crest": "eUPQwa_crest",
			"dialog": "eUPQwa_dialog",
			"meta": "eUPQwa_meta",
			"field": "eUPQwa_field",
			"heading": "eUPQwa_heading",
			"actions": "eUPQwa_actions",
			"error": "eUPQwa_error"
		};
		//#endregion
		//#region src/client/PersonaSettingsSection.tsx
		const ENDPOINT = "/api/dsh-whale-companion/persona";
		const MAX_PERSONA_CHARACTERS = 32768;
		/** Settings page for editing the next-start additive persona. */
		function PersonaSettingsSection(_props) {
			const [persona, setPersona] = (0, react.useState)(DEFAULT_PERSONA);
			const [loading, setLoading] = (0, react.useState)(true);
			const [saving, setSaving] = (0, react.useState)(false);
			const [custom, setCustom] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const [restartPrompt, setRestartPrompt] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				let active = true;
				requestPersona().then((value) => {
					if (!active) return;
					setPersona(value.persona);
					setCustom(value.custom);
					setLoading(false);
				}, (reason) => {
					if (!active) return;
					setPersona(DEFAULT_PERSONA);
					setError(reason instanceof Error ? reason.message : String(reason));
					if (reason instanceof PersonaEndpointUnavailableError) setRestartPrompt("endpoint");
					setLoading(false);
				});
				return () => {
					active = false;
				};
			}, []);
			const save = async () => {
				setSaving(true);
				setError(null);
				try {
					const response = await fetch(ENDPOINT, {
						method: "PUT",
						headers: {
							"content-type": "application/json",
							"x-dsh-whale-companion": "1"
						},
						body: JSON.stringify({ persona })
					});
					const body = await responseBody(response);
					if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
					setCustom(true);
					setRestartPrompt("saved");
				} catch (reason) {
					setError(reason instanceof Error ? reason.message : String(reason));
					if (reason instanceof PersonaEndpointUnavailableError) setRestartPrompt("endpoint");
				} finally {
					setSaving(false);
				}
			};
			const blank = persona.trim() === "";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: PersonaSettingsSection_module_css_default.section,
				"data-whale-persona-settings": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: PersonaSettingsSection_module_css_default.heading,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: PersonaSettingsSection_module_css_default.crest,
							"aria-hidden": "true"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: "鲸鱼娘人格" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: custom ? "当前使用自定义人格文本" : "当前使用插件默认人格文本" })] })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: PersonaSettingsSection_module_css_default.field,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "人格提示词" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "直接输入正文即可，无需添加三引号；保存后插件会自动添加人格边界。" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								value: persona,
								disabled: loading || saving,
								maxLength: MAX_PERSONA_CHARACTERS,
								spellCheck: false,
								onChange: (event) => {
									setPersona(event.target.value);
								}
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: PersonaSettingsSection_module_css_default.meta,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
							persona.length.toLocaleString(),
							" / ",
							MAX_PERSONA_CHARACTERS.toLocaleString()
						] }), error === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: PersonaSettingsSection_module_css_default.error,
							role: "alert",
							children: error
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: PersonaSettingsSection_module_css_default.actions,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							disabled: loading || saving || blank,
							onClick: () => {
								save();
							},
							children: saving ? "正在保存…" : "覆写人格"
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
						open: restartPrompt !== null,
						onClose: () => {
							setRestartPrompt(null);
						},
						title: restartPrompt === "saved" ? "人格已覆写" : "需要重启 Harness",
						closeLabel: "关闭",
						description: restartPrompt === "saved" ? "新的人格提示词将在重启 DeepSeek Harness 后生效。当前会话不会被中断。" : "当前 Harness 进程尚未加载人格配置接口。请重启一次后再保存。",
						className: PersonaSettingsSection_module_css_default.dialog,
						footer: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							autoFocus: true,
							onClick: () => {
								setRestartPrompt(null);
							},
							children: "知道了"
						}),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: PersonaSettingsSection_module_css_default.restartText,
							children: "请在方便时关闭并重新启动 Harness。插件不会代替你执行重启，也不会终止当前任务。"
						})
					})
				]
			});
		}
		async function requestPersona() {
			const response = await fetch(ENDPOINT, { cache: "no-store" });
			const body = await responseBody(response);
			if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
			if (typeof body.persona !== "string") throw new Error("人格配置响应缺少文本");
			return {
				persona: body.persona,
				custom: body.custom === true
			};
		}
		var PersonaEndpointUnavailableError = class extends Error {};
		async function responseBody(response) {
			const text = await response.text();
			if (response.status === 404) throw new PersonaEndpointUnavailableError("人格配置接口尚未加载，请重启 DeepSeek Harness 后再试。");
			try {
				return JSON.parse(text);
			} catch {
				throw new Error(`人格配置接口返回了无效响应（HTTP ${response.status}）。`);
			}
		}
		//#endregion
		//#region src/client/handoff.ts
		const CONTINUATION_THRESHOLD_RATIO = .88;
		const MAX_HANDOFF_CHARACTERS = 24e3;
		const CONTINUATION_FRAMING = "Continue the previous task in this fresh session. The previous session was nearing its context limit. Your persona is loaded separately by the whale companion plugin; do not infer persona rules from the previous assistant response. Treat the handoff below as established task context, do not repeat it, and proceed with the next necessary work. If the task is already complete, briefly confirm that instead.";
		/** Decide whether the next request is near enough to the route capacity to continue elsewhere. */
		function reachesContinuationThreshold(pressure, ratio = CONTINUATION_THRESHOLD_RATIO) {
			if (pressure === void 0) return false;
			const used = pressure.projectedTokens ?? pressure.pressureTokens;
			const capacity = pressure.contextWindow;
			return Number.isFinite(used) && Number.isFinite(capacity) && used !== void 0 && capacity !== void 0 && used >= 0 && capacity > 0 && used / capacity >= ratio;
		}
		/** Render the last completed user/assistant exchange as a bounded fresh-session prompt. */
		function buildContinuationPrompt(snapshot, maxCharacters = MAX_HANDOFF_CHARACTERS) {
			const assistantIndex = snapshot.nodes.findLastIndex((node) => node.kind === "assistant" && node.interrupted !== true);
			if (assistantIndex < 0) return null;
			const assistant = snapshot.nodes[assistantIndex];
			const user = snapshot.nodes.slice(0, assistantIndex).findLast((node) => node.kind === "user");
			if (user === void 0) return null;
			const userText = user.content.map((block) => {
				if (block.type === "text") return block.text;
				if (block.type === "image") return "[image from the previous session]";
				return `[${block.type} block from the previous session]`;
			}).join("\n").trim();
			const assistantText = assistant.blocks.filter((block) => block.kind === "text").map((block) => block.text).join("\n").trim();
			if (userText === "" && assistantText === "") return null;
			const available = Math.max(1e3, maxCharacters - `${CONTINUATION_FRAMING}

<previous-user>
</previous-user>

<previous-assistant>
</previous-assistant>`.length);
			const userBudget = Math.floor(available / 3);
			const assistantBudget = available - userBudget;
			return `${CONTINUATION_FRAMING}

<previous-user>
${boundedText(userText, userBudget)}
</previous-user>

<previous-assistant>
${boundedText(assistantText || "[No textual assistant response was recorded.]", assistantBudget)}
</previous-assistant>`;
		}
		function boundedText(text, limit) {
			if (text.length <= limit) return text;
			const marker = "\n...[middle omitted for handoff size]...\n";
			const remaining = Math.max(2, limit - 41);
			const head = Math.floor(remaining / 2);
			return text.slice(0, head) + marker + text.slice(-(remaining - head));
		}
		//#endregion
		//#region src/client/index.ts
		const name = "dsh-whale-companion-client";
		const inject = [
			"sessions",
			"workspaces",
			"slots"
		];
		const STORAGE_PREFIX = "dsh.whale-companion.continued.v1.";
		/** Watch the selected Web session and continue a near-limit completed turn in a fresh task. */
		function apply(ctx) {
			const sessions = ctx.sessions;
			const workspaces = ctx.workspaces;
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "whale-persona",
				order: 30,
				label: "鲸鱼娘人格"
			}, PersonaSettingsSection));
			const completed = /* @__PURE__ */ new Set();
			let selected;
			let disposeSession = () => {};
			let disposePressure = () => {};
			let evaluating = false;
			let queued = false;
			let disposed = false;
			const schedule = () => {
				if (disposed || queued) return;
				queued = true;
				queueMicrotask(() => {
					queued = false;
					evaluate();
				});
			};
			const bindSelected = () => {
				const next = sessions.list.getSnapshot().current;
				if (next === selected) {
					schedule();
					return;
				}
				disposeSession();
				disposePressure();
				disposeSession = () => {};
				disposePressure = () => {};
				selected = next;
				if (next !== void 0) {
					const binding = sessions.binding(next);
					if (binding !== void 0) {
						disposeSession = binding.session.subscribe(schedule);
						disposePressure = binding.session.projections.faceOf("contextPressure").subscribe(schedule);
					}
				}
				schedule();
			};
			const evaluate = async () => {
				if (disposed || evaluating) return;
				const list = sessions.list.getSnapshot();
				const sourceId = list.current;
				if (sourceId === void 0 || completed.has(sourceId)) return;
				const sourceSummary = list.byId[sourceId];
				const binding = sessions.binding(sourceId);
				if (sourceSummary === void 0 || sourceSummary.running || sourceSummary.blank || binding === void 0) return;
				const snapshot = binding.session.getSnapshot();
				if (snapshot.openState !== "open" || snapshot.running || snapshot.removed) return;
				if (!reachesContinuationThreshold(binding.session.projections.faceOf("contextPressure").getSnapshot()) || wasPersisted(sourceId)) {
					if (wasPersisted(sourceId)) completed.add(sourceId);
					return;
				}
				const prompt = buildContinuationPrompt(snapshot);
				if (prompt === null) return;
				const workspace = workspaces.list.getSnapshot().items.find((candidate) => candidate.sessionIds.includes(sourceId));
				if (workspace === void 0) {
					ctx.logger.warn(`whale-companion: session "${sourceId}" is not attached to a workspace; automatic continuation skipped`);
					return;
				}
				evaluating = true;
				try {
					const childId = await workspaces.connectWorkspace(workspace.workspaceId);
					if (disposed) return;
					const child = sessions.binding(childId)?.session;
					if (child === void 0) throw new Error(`new session "${childId}" is not locally addressable`);
					const accepted = await child.prompt([{
						type: "text",
						text: prompt
					}], "queue");
					if (!accepted.ok) throw new Error(`${accepted.error.code}: ${accepted.error.message}`);
					completed.add(sourceId);
					persistContinuation(sourceId, childId);
					sessions.open(childId);
				} catch (error) {
					ctx.logger.warn(`whale-companion: automatic continuation failed for session "${sourceId}": ${String(error)}`);
				} finally {
					evaluating = false;
				}
			};
			const disposeList = sessions.list.subscribe(bindSelected);
			bindSelected();
			ctx.effect(() => () => {
				disposed = true;
				disposeList();
				disposeSession();
				disposePressure();
			}, "whale-companion: automatic session continuation");
		}
		function wasPersisted(sourceId) {
			if (typeof localStorage === "undefined") return false;
			try {
				return localStorage.getItem(STORAGE_PREFIX + sourceId) !== null;
			} catch {
				return false;
			}
		}
		function persistContinuation(sourceId, childId) {
			if (typeof localStorage === "undefined") return;
			try {
				localStorage.setItem(STORAGE_PREFIX + sourceId, childId);
			} catch {}
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
