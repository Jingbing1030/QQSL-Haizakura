// DEMO new file (Satori-adapter shaped): depends on EXISTING bundle code, so the
// insertion point must be where those names are already initialised.
function satoriServerAdapterDescribe(): string {
  return `width=${UIN_SLOT_WIDTH} labelCount=${Object.keys(LEVEL_LABEL).length}`;
}
process.stdout.write(`[satori-adapter] ${satoriServerAdapterDescribe()}\n`);
