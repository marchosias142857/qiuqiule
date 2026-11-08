// Minimal SVG tree used by the scene tests. Attribute values and child order
// are observable so assertions inspect the same paths as the browser fixture.
export function createSvgNode(namespace, tag) {
  const attrs = new Map();
  let text = '';
  const node = {
    tag, namespaceURI: namespace, children: [], parentNode: null, style: {}, listeners: new Map(),
    setAttribute(name, value) { attrs.set(name, String(value)); },
    getAttribute(name) { return attrs.get(name) ?? null; },
    removeAttribute(name) { attrs.delete(name); },
    insertBefore(child, next) {
      if (child === next) return child;
      child.remove();
      const index = next == null ? this.children.length : this.children.indexOf(next);
      if (index < 0) throw new Error('Reference is not a child');
      this.children.splice(index, 0, child);
      child.parentNode = this;
      return child;
    },
    append(...children) { for (const child of children) this.insertBefore(child, null); },
    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index < 0) throw new Error('Node is not a child');
      this.children.splice(index, 1);
      child.parentNode = null;
      return child;
    },
    remove() { this.parentNode?.removeChild(this); },
    replaceChildren(...children) {
      for (const child of this.children) child.parentNode = null;
      this.children.length = 0;
      text = '';
      this.append(...children);
    },
    querySelectorAll(selector) {
      const [, name, attr] = /^(\w+)(?:\[(\w+)\])?$/.exec(selector) || [];
      return this.children.flatMap(child => [
        ...(child.tag === name && (!attr || child.getAttribute(attr) !== null) ? [child] : []),
        ...child.querySelectorAll(selector),
      ]);
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; },
    get firstElementChild() { return this.children[0] ?? null; },
    get lastElementChild() { return this.children.at(-1) ?? null; },
    get textContent() { return text + this.children.map(child => child.textContent).join(''); },
    set textContent(value) { this.replaceChildren(); text = String(value); },
    get innerHTML() { return text + this.children.map(child => child.outerHTML).join(''); },
    set innerHTML(markup) {
      this.replaceChildren();
      const stack = [this];
      for (const token of markup.match(/<[^>]+>|[^<]+/g) || []) {
        if (token.startsWith('</')) { stack.pop(); continue; }
        const parent = stack.at(-1);
        if (!token.startsWith('<')) { parent.textContent = token; continue; }
        const child = createSvgNode(namespace, /^<(\w+)/.exec(token)[1]);
        for (const [, name, value] of token.matchAll(/([^\s=]+)="([^"]*)"/g)) child.setAttribute(name, value);
        parent.append(child);
        if (!token.endsWith('/>')) stack.push(child);
      }
    },
    get outerHTML() {
      const attributes = Array.from(attrs, ([name, value]) => ` ${name}="${value}"`).join('');
      return `<${tag}${attributes}>${this.innerHTML}</${tag}>`;
    },
  };
  return node;
}

export const isSvgMount = selector => ['#ui-star-trails', '#wardrobe-showroom', '#level-orbs', '#level-return'].includes(selector);
