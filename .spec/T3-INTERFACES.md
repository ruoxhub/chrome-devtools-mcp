# T3 ScriptManager interfaces (context pointer for T4)

Source: `src/ScriptManager.ts` on `ticket/t3-script-manager`, final tip
`24c0b9c`. Merged via the T3 merger.

```text
constructor(source: ScriptManagerSource)
listScripts(options?: ListScriptsOptions): ScriptListResult
getScriptSource(options: GetScriptSourceOptions): Promise<ScriptSourceResult>
searchInScripts(options: SearchInScriptsOptions): Promise<ScriptSearchResult>
```

Exported types: `ScriptManagerSource`, `ScriptSummary`, `ListScriptsOptions`,
`ScriptListResult`, `ScriptPreviewLine`, `GetScriptSourceOptions`,
`ScriptSourceResult`, `ScriptSearchMatch`, `SearchInScriptsOptions`,
`ScriptSearchResult`, `DebuggerModelLike`, `ScriptLike`, `SearchMatch`.

Export semantics (bounded responses, `docs/design-principles.md`):

- `getScriptSource({filePath})` writes the full script source, or the selected
  1-based line range when one is given. The response contains only the file
  path, line/byte counts, and at most five preview lines.
- `searchInScripts({filePath})` writes the full JSON match list. The response
  contains only the file path and count/truncation summary; the `matches`
  field is omitted entirely (enforced by a union result type).
- Without `filePath`, both methods return bounded inline results.
- Filesystem write failures preserve the underlying error.

`filePath` is validated by T4's `verifyFilesSchema` before it reaches
`ScriptManager`; `ScriptManager` receives an absolute path.

T4 must read the merged source before wiring handlers; do not invent method
names or option fields. See `.spec/T4-NOTES.md`.
