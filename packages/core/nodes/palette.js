export function buildPalette(registry = []) {
  return registry
    .map((definition, index) => ({ definition, index }))
    .filter(({ definition }) => !definition.hidden)
    .sort((left, right) => {
      const leftOrder = left.definition.paletteOrder ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.definition.paletteOrder ?? Number.MAX_SAFE_INTEGER;

      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      return left.index - right.index;
    })
    .map(({ definition }) => ({
      type: definition.type,
      label: definition.label,
      description: definition.description,
      category: definition.category,
      icon: definition.icon,
      color: definition.color,
      layout: definition.layout,
      inputs: definition.inputs,
      outputs: definition.outputs,
      controlPorts: definition.controlPorts,
      hasParam: definition.hasParam,
      hidden: definition.hidden,
      deprecated: definition.deprecated,
      paletteOrder: definition.paletteOrder,
    }));
}
