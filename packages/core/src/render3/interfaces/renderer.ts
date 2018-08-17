/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

/**
 * The goal here is to make sure that the browser DOM API is the Renderer.
 * We do this by defining a subset of DOM API to be the renderer and than
 * use that time for rendering.
 *
 * At runtime we can than use the DOM api directly, in server or web-worker
 * it will be easy to implement such API.
 */

import {Renderer2, RendererFactory2, RendererStyleFlags2, RendererType2} from '../../render/api';

/** Subset of API needed for appending elements and text nodes. */
export interface RNode {
  removeChild(oldChild: RNode): void;

  /**
   * Insert a child node.
   *
   * Used exclusively for adding View root nodes into ViewAnchor location.
   */
  insertBefore(newChild: RNode, refChild: RNode|null, isViewRoot: boolean): void;

  /**
   * Append a child node.
   *
   * Used exclusively for building up DOM which are static (ie not View roots)
   */
  appendChild(newChild: RNode): RNode;
}

/**
 * Subset of API needed for writing attributes, properties, and setting up
 * listeners on Element.
 */
export interface RElement extends RNode {
  style: RCssStyleDeclaration;
  classList: RDomTokenList;
  className: string;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  setAttributeNS(namespaceURI: string, qualifiedName: string, value: string): void;
  removeAttributeNS(namespace: string, name: string): void;
  addEventListener(type: string, listener: EventListener, useCapture?: boolean): void;
  removeEventListener(type: string, listener?: EventListener, options?: boolean): void;

  setProperty?(name: string, value: any): void;
}

export interface RCssStyleDeclaration {
  removeProperty(propertyName: string): string;
  setProperty(propertyName: string, value: string|null, priority?: string): void;
}

export interface RDomTokenList {
  add(token: string): void;
  remove(token: string): void;
}

export interface RText extends RNode { textContent: string|null; }

export interface RComment extends RNode {}

// Note: This hack is necessary so we don't erroneously get a circular dependency
// failure based on types.
export const unusedValueExportToPlacateAjd = 1;

export const ivyDomRendererFactory: RendererFactory2 = {
  createRenderer: (hostElement: any, type: RendererType2|null): Renderer2 => ivyDomRenderer,

  begin: () => {},
  end: () => {}
}

const NAMESPACE_URIS: {[ns: string]: string} = {
  'svg': 'http://www.w3.org/2000/svg',
  'xhtml': 'http://www.w3.org/1999/xhtml',
  'xlink': 'http://www.w3.org/1999/xlink',
  'xml': 'http://www.w3.org/XML/1998/namespace',
  'xmlns': 'http://www.w3.org/2000/xmlns/',
};

export const ivyDomRenderer: Renderer2 = {
  data: {},
  destroyNode: null,

  destroy: () => {},

  createElement: (name: string, namespace?: string|null): RElement => {
    if (namespace == null) {
      return document.createElement(name);
    } else {
      return document.createElementNS(namespace, name) as any as RElement;
    }
  },

  createComment: (value: string): RComment => document.createComment(value),

  createText: (value: string): RText => document.createTextNode(value),

  appendChild: (parent: RElement, newChild: RNode): void => { parent.appendChild(newChild); },

  insertBefore: (parent: RElement, newChild: RNode, refChild: RNode): void => {
    parent.insertBefore(newChild, refChild, true);
  },

  removeChild: (parent: RElement, oldChild: RNode): void => { parent.removeChild(oldChild); },

  selectRootElement: (selectorOrNode: string|RNode): RNode|null => {
    return typeof selectorOrNode === 'string' ? document.querySelector(selectorOrNode) :
                                                selectorOrNode;
  },

  parentNode: (node: RNode): RNode|null => (node as any).parentNode,

  nextSibling: (node: RNode): RNode|null => (node as any).nextSibling,

  setAttribute: (el: RElement, name: string, value: string, namespace?: string): void => {
    if (namespace) {
      const namespaceUri = NAMESPACE_URIS[namespace];
      if (namespaceUri) {
        el.setAttributeNS(namespaceUri, `${namespace}:${name}`, value);
      } else {
        //Unknown namespace, in that case we assume that namespace is in fact an URI and that the attribute is already prefixed
        el.setAttributeNS(namespace, name, value);
      }
    } else {
      el.setAttribute(name, value);
    }
  },

  removeAttribute: (el: RElement, name: string, namespace?: string): void => {
    if (namespace) {
      const namespaceUri = NAMESPACE_URIS[namespace];
      if (namespaceUri) {
        el.removeAttributeNS(namespaceUri, name);
      } else {
        el.removeAttribute(`${namespace}:${name}`);
      }
    } else {
      el.removeAttribute(name);
    }
  },

  addClass: (el: RElement, name: string) => { el.classList.add(name); },

  removeClass: (el: RElement, name: string) => { el.classList.remove(name); },

  setStyle: (el: RElement, style: string, value: any, flags: RendererStyleFlags2): void => {
    if (flags & RendererStyleFlags2.DashCase) {
      el.style.setProperty(
          style, value, !!(flags & RendererStyleFlags2.Important) ? 'important' : '');
    } else {
      (el as any).style[style] = value;
    }
  },

  removeStyle: (el: RElement, style: string, flags: RendererStyleFlags2): void => {
    if (flags & RendererStyleFlags2.DashCase) {
      el.style.removeProperty(style);
    } else {
      // IE requires '' instead of null
      // see https://github.com/angular/angular/issues/7916
      (el as any).style[style] = '';
    }
  },

  setProperty: (el: RNode, name: string, value: any): void => { (el as any)[name] = value; },

  setValue: (node: any, value: string): void => { node.nodeValue = value; },

  listen: (
      target: 'window'|'document'|'body'|RElement, eventName: string,
      callback: (event: any) => boolean | void): () => void => {
    if (typeof target !== 'string') {
      target.addEventListener(eventName, callback, false);
      return () => target.removeEventListener(eventName, callback, false);
    } else {
      throw new Error(
          `Renderer2Adapter.listen doesn't support event target as a string, use an element instead.`);
    }
  }
};