/** Version-pinned, optional primary action for the published DSH InputBar.
 * Keeps the native editor, styles and submit logic. Fixture builds stay unchanged.
 */
export function extendNativeInput(source: string): string {
  const replace = (before: string, after: string) => {
    if (source.split(before).length !== 2) throw new Error('DSH InputBar extension no longer matches 0.2.0-rc.1')
    source = source.replace(before, after)
  }
  replace('function InputBar({ useSession,', 'function InputBar({ primaryAction, useSession,')
  replace('const primaryStops = running && subagent === null && (empty || blocked !== void 0);',
    'const primaryStops = primaryAction !== void 0 || running && subagent === null && (empty || blocked !== void 0);')
  replace('const primaryDisabled = primaryStops ? stop === void 0 : empty || disabled || machineBusy || uploadsPending;',
    'const primaryDisabled = primaryAction !== void 0 ? primaryAction.disabled === true : primaryStops ? stop === void 0 : empty || disabled || machineBusy || uploadsPending;')
  replace('const primaryLabel = primaryStops ? t("input.stop")', 'const primaryLabel = primaryAction !== void 0 ? primaryAction.label : primaryStops ? t("input.stop")')
  replace('const onPrimary = () => {', 'const onPrimary = () => {\nif (primaryAction !== void 0) { primaryAction.onClick(); return; }')
  // Only the primary Stop glyph; the separate running interruption action is untouched.
  const primary = source.indexOf('"aria-label": primaryLabel,')
  const glyph = source.indexOf('children: (0, react_jsx_runtime.jsx)("rect", {', primary)
  if (primary < 0 || glyph < 0) throw new Error('DSH primary action glyph is missing')
  source = source.slice(0, glyph) + source.slice(glyph).replace('children: (0, react_jsx_runtime.jsx)("rect", {',
    'children: primaryAction?.icon ?? (0, react_jsx_runtime.jsx)("rect", {')
  return source
}
