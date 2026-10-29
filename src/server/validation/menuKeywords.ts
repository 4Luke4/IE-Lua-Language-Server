// Keywords of the Infinity Engine MENU format. Pure data: no LSP or `vscode` imports.
//
// Source: IESDP, "MENU file format", section Keywords
// (https://gibberlings3.github.io/iesdp/file_formats/ie_formats/menu_v1.htm, commit 38e7532),
// which was checked against the executables of BGEE, BG2EE and IWDEE 2.6.6.0 and 2.7.3.0.
// The engine's table has 124 entries for these 122 distinct words; the spelling is the engine's.

/** Every MENU keyword, spelled as in the engine. */
export const MENU_KEYWORDS: readonly string[] = [
  'action', 'actionalt', 'actionbar', 'actiondbl', 'actiondrag', 'actionenter', 'actionexit', 'actionHold',
  'actionScroll', 'actionsimpledrag', 'actionsimpledrop', 'actionUpdate', 'align', 'area', 'areamap',
  'background', 'bam', 'bitmap', 'bottom', 'button', 'center', 'clickable', 'clunkyScroll', 'color',
  'colordisplay', 'column', 'count', 'dynamic', 'edit', 'enabled', 'encumbrance', 'fill', 'font', 'force',
  'frame', 'frameTimes', 'full', 'func', 'glow', 'greyscale', 'handle', 'hide', 'hidehighlight', 'highlight',
  'highlightgroup', 'icon', 'ignoreEsc', 'ignoreEvents', 'label', 'left', 'list', 'loop', 'lower', 'lua',
  'map', 'maxchars', 'maxlines', 'memorizedSpellInfo', 'menu', 'modal', 'mosaic', 'movie', 'name', 'offset',
  'on', 'onclose', 'onopen', 'opacity', 'overlayTint', 'pad', 'palette', 'panel', 'paperdoll', 'placeholder',
  'point', 'portrait', 'position', 'progressbar', 'pulse', 'queuedMovie', 'rectangle', 'res',
  'respectClipping', 'respectConstraints', 'right', 'rowbackground', 'rowheight', 'rowwidth', 'scaleToClip',
  'scrollbar', 'seperator', 'sequence', 'sequenceonce', 'settings', 'shadow', 'size', 'skipReset', 'slider',
  'sliderBackground', 'slot', 'slotinfo', 'sound', 'spellInfo', 'state', 'style', 'subtitle', 'table',
  'template', 'text', 'tint', 'toggle', 'tooltip', 'top', 'transparent', 'upper', 'usages', 'usealpha',
  'useFontZoom', 'useOverlayTint', 'var', 'width', 'worldmap',
];

const LOWER_CASE: ReadonlySet<string> = new Set(MENU_KEYWORDS.map((keyword) => keyword.toLowerCase()));

/**
 * The keyword `word` stands for, in lower case, or `undefined` if it is not a
 * keyword. The engine compares keywords case-insensitively.
 */
export function menuKeyword(word: string): string | undefined {
  const lower = word.toLowerCase();
  return LOWER_CASE.has(lower) ? lower : undefined;
}
