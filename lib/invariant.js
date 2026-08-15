//#region src/invariant.ts
const name = "dsh-whale-companion-invariant";
const inject = ["invariants"];
const install = () => {};
const apply = (ctx) => Promise.resolve(ctx.invariants.register("@dsh-external/dsh-whale-companion", install));
//#endregion
export { apply, inject, name };
