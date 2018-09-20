/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

// We are temporarily importing the existing viewEngine_from core so we can be sure we are
// correctly implementing its interfaces for backwards compatibility.

import {ChangeDetectorRef as viewEngine_ChangeDetectorRef} from '../change_detection/change_detector_ref';
import {getInjectableDef, getInjectorDef} from '../di/defs';
import {resolveForwardRef} from '../di/forward_ref';
import {InjectionToken} from '../di/injection_token';
import {InjectFlags, Injector, NullInjector, injectFromRoot, setInjectImplementation} from '../di/injector';
import {Provider} from '../di/provider';
import {isTypeProvider, providerToFactory} from '../di/r3_injector';
import {ComponentFactory as viewEngine_ComponentFactory, ComponentRef as viewEngine_ComponentRef} from '../linker/component_factory';
import {ComponentFactoryResolver as viewEngine_ComponentFactoryResolver} from '../linker/component_factory_resolver';
import {ElementRef as viewEngine_ElementRef} from '../linker/element_ref';
import {NgModuleRef as viewEngine_NgModuleRef} from '../linker/ng_module_factory';
import {TemplateRef as viewEngine_TemplateRef} from '../linker/template_ref';
import {ViewContainerRef as viewEngine_ViewContainerRef} from '../linker/view_container_ref';
import {EmbeddedViewRef as viewEngine_EmbeddedViewRef, ViewRef as viewEngine_ViewRef} from '../linker/view_ref';
import {Renderer2} from '../render';
import {Type} from '../type';
import {stringify} from '../util';

import {assertDefined, assertGreaterThan, assertLessThan} from './assert';
import {ComponentFactoryResolver} from './component_ref';
import {getComponentDef, getDirectiveDef, getPipeDef} from './definition';
import {_getViewData, addToViewTree, assertPreviousIsParent, createEmbeddedViewAndNode, createLContainer, createLNodeObject, createTNode, getPreviousOrParentNode, getPreviousOrParentTNode, getRenderer, loadElement, renderEmbeddedTemplate, resolveDirective} from './instructions';
import {LContainer, RENDER_PARENT, VIEWS} from './interfaces/container';
import {ComponentDefInternal, DirectiveDefInternal, InjectableDefList, RenderFlags} from './interfaces/definition';
import {LInjector} from './interfaces/injector';
import {AttributeMarker, LContainerNode, LElementContainerNode, LElementNode, LNode, TContainerNode, TElementContainerNode, TElementNode, TNode, TNodeFlags, TNodeProviderIndexes, TNodeType, TViewNode} from './interfaces/node';
import {LQueries, QueryReadType} from './interfaces/query';
import {Renderer3, isProceduralRenderer} from './interfaces/renderer';
import {CONTEXT, HOST_NODE, INJECTABLES, INJECTOR, LViewData, PARENT, QUERIES, RENDERER, TVIEW, TView} from './interfaces/view';
import {assertNodeOfPossibleTypes, assertNodeType} from './node_assert';
import {addRemoveViewFromContainer, appendChild, detachView, findComponentView, getBeforeNodeForView, getHostElementNode, getParentLNode, getParentOrContainerNode, getRenderParent, insertView, removeView} from './node_manipulation';
import {getLNode, isComponent} from './util';
import {ViewRef} from './view_ref';



/**
 * If a directive is diPublic, bloomAdd sets a property on the type with this constant as
 * the key and the directive's unique ID as the value. This allows us to map directives to their
 * bloom filter bit for DI.
 */
const NG_ELEMENT_ID = '__NG_ELEMENT_ID__';

/**
 * The number of slots in each bloom filter (used by DI). The larger this number, the fewer
 * directives that will share slots, and thus, the fewer false positives when checking for
 * the existence of a directive.
 */
const BLOOM_SIZE = 256;
const BLOOM_MASK = BLOOM_SIZE - 1;

/** Counter used to generate unique IDs for directives. */
let nextNgElementId = 0;

/**
 * Registers this directive as present in its node's injector by flipping the directive's
 * corresponding bit in the injector's bloom filter.
 *
 * @param injector The node injector in which the directive should be registered
 * @param type The directive to register
 */
export function bloomAdd(injector: LInjector, type: Type<any>| InjectionToken<any>): void {
  let id: number|undefined = (type as any)[NG_ELEMENT_ID];

  // Set a unique ID on the directive type, so if something tries to inject the directive,
  // we can easily retrieve the ID and hash it into the bloom bit that should be checked.
  if (id == null) {
    id = (type as any)[NG_ELEMENT_ID] = nextNgElementId++;
  }

  // We only have BLOOM_SIZE (256) slots in our bloom filter (8 buckets * 32 bits each),
  // so all unique IDs must be modulo-ed into a number from 0 - 255 to fit into the filter.
  const bloomBit = id & BLOOM_MASK;

  // Create a mask that targets the specific bit associated with the directive.
  // JS bit operations are 32 bits, so this will be a number between 2^0 and 2^31, corresponding
  // to bit positions 0 - 31 in a 32 bit integer.
  const mask = 1 << bloomBit;

  // Use the raw bloomBit number to determine which bloom filter bucket we should check
  // e.g: bf0 = [0 - 31], bf1 = [32 - 63], bf2 = [64 - 95], bf3 = [96 - 127], etc
  const b7 = bloomBit & 0x80;
  const b6 = bloomBit & 0x40;
  const b5 = bloomBit & 0x20;

  if (b7) {
    b6 ? (b5 ? (injector.bf7 |= mask) : (injector.bf6 |= mask)) :
         (b5 ? (injector.bf5 |= mask) : (injector.bf4 |= mask));
  } else {
    b6 ? (b5 ? (injector.bf3 |= mask) : (injector.bf2 |= mask)) :
         (b5 ? (injector.bf1 |= mask) : (injector.bf0 |= mask));
  }
}

export function getOrCreateNodeInjector(): LInjector {
  ngDevMode && assertPreviousIsParent();
  return getOrCreateNodeInjectorForNode(
      getPreviousOrParentNode() as LElementNode | LElementContainerNode | LContainerNode,
      getPreviousOrParentTNode() as TElementNode | TElementContainerNode | TContainerNode,
      _getViewData());
}

/**
 * Creates (or gets an existing) injector for a given element or container.
 *
 * @param node for which an injector should be retrieved / created.
 * @param tNode for which an injector should be retrieved / created.
 * @param hostView View where the node is stored
 * @returns Node injector
 */
export function getOrCreateNodeInjectorForNode(
    node: LElementNode | LElementContainerNode | LContainerNode,
    tNode: TElementNode | TContainerNode | TElementContainerNode, hostView: LViewData): LInjector {
  // TODO: remove LNode arg when nodeInjector refactor is done
  const nodeInjector = node.nodeInjector;
  const parentLNode = getParentOrContainerNode(tNode, hostView);
  const parentInjector = parentLNode && parentLNode.nodeInjector;
  if (nodeInjector != parentInjector) {
    return nodeInjector !;
  }
  return node.nodeInjector = {
    parent: parentInjector,
    tNode: tNode,
    view: hostView,
    bf0: 0,
    bf1: 0,
    bf2: 0,
    bf3: 0,
    bf4: 0,
    bf5: 0,
    bf6: 0,
    bf7: 0,
    cbf0: parentInjector == null ? 0 : parentInjector.cbf0 | parentInjector.bf0,
    cbf1: parentInjector == null ? 0 : parentInjector.cbf1 | parentInjector.bf1,
    cbf2: parentInjector == null ? 0 : parentInjector.cbf2 | parentInjector.bf2,
    cbf3: parentInjector == null ? 0 : parentInjector.cbf3 | parentInjector.bf3,
    cbf4: parentInjector == null ? 0 : parentInjector.cbf4 | parentInjector.bf4,
    cbf5: parentInjector == null ? 0 : parentInjector.cbf5 | parentInjector.bf5,
    cbf6: parentInjector == null ? 0 : parentInjector.cbf6 | parentInjector.bf6,
    cbf7: parentInjector == null ? 0 : parentInjector.cbf7 | parentInjector.bf7,
    templateRef: null,
    viewContainerRef: null,
    elementRef: null,
    changeDetectorRef: null,
  };
}


/**
 * Makes a type or an injection token public to the DI system by adding it to an
 * injector's bloom filter.
 *
 * @param di The node injector in which a directive will be added
 * @param def The type, injection token, or definition of the directive to be made public
 */
function diPublicInInjector(di: LInjector, def: InjectionToken<any>| Type<any>): void {
  bloomAdd(di, def);
}

/**
 * Makes a directive, a type or an injection token public to the DI system by adding it to an
 * injector's bloom filter.
 *
 * @param def The type, injection token, or definition of the directive to be made public
 */
export function diPublic(def: DirectiveDefInternal<any>): void {
  diPublicInInjector(getOrCreateNodeInjector(), def.type);
}

/**
 * Resolves the providers which are defined in the DirectiveDef.
 *
 * When inserting the tokens and the factories in their respective arrays, we can assume that
 * this method is called first for the component (if any), and then for other directives on the same node.
 * As a consequence,the providers are always processed in that order:
 * 1) The providers of the component
 * 2) The view providers of the component
 * 3) The providers of the other directives
 * This matches the structure of the injectables arrays of a view (for each node).
 * So the tokens and the factories can be pushed at the end of the arrays, except
 * in one case for multi providers.
 *
 * @param def the directive definition
 * @return the updated list of injectables
 */
export function providersResolver<T>(
    def: DirectiveDefInternal<T>, providers: Provider[], viewProviders: Provider[]) {
  // Because at least one directive has providers, those providers may have `inject` so we need to
  // redirect it to `directiveInject`
  setInjectImplementation(directiveInject);

  const previousOrParentTNode = getPreviousOrParentTNode();
  const viewData = _getViewData();
  const tView = viewData[TVIEW];
  const lInjectables = viewData[INJECTABLES] || (viewData[INJECTABLES] = []);
  const tInjectables: InjectableDefList = tView.injectables || (tView.injectables = []);
  const isComponent = isComponentDef(def);
  // The list of providers is processed first, and the flags are updated
  const providerCount = resolveProvider(providers, tInjectables, lInjectables, isComponent, false);
  previousOrParentTNode.flags += TNodeFlags.DirectiveIndexShifter * providerCount;
  if (isComponent) {
    previousOrParentTNode.providerIndexes +=
        TNodeProviderIndexes.CptProvidersCountShifter * providerCount;
  }

  // Then, the list of view providers is processed, and the flags are updated
  const viewProviderCount =
      resolveProvider(viewProviders, tInjectables, lInjectables, isComponent, true);
  previousOrParentTNode.flags += TNodeFlags.DirectiveIndexShifter * viewProviderCount;
  previousOrParentTNode.providerIndexes +=
      TNodeProviderIndexes.CptViewProvidersCountShifter * viewProviderCount;
}

function isComponentDef<T>(def: DirectiveDefInternal<T>): def is ComponentDefInternal<T> {
  return (def as ComponentDefInternal<T>).template !== null;
}

/**
 * Resolves a provider and publishes it to the DI system.
 *
 * @return the number of injectables inserted in the arrays.
 */
function resolveProvider(
    provider: Provider, tInjectables: InjectableDefList, lInjectables: any[], isComponent: boolean,
    isViewProvider: boolean): number {
  provider = resolveForwardRef(provider);
  if (Array.isArray(provider)) {
    // Recursively call `resolveProvider`
    // Recursion is OK in this case because this code will not be in hot-path once we implement
    // cloning of the initial state.
    let shift = 0;
    for (let i = 0; i < provider.length; i++) {
      shift +=
          resolveProvider(provider[i], tInjectables, lInjectables, isComponent, isViewProvider);
    }
    return shift;
  }
  let token: any = isTypeProvider(provider) ? provider : resolveForwardRef(provider.provide);
  let factory: NodeInjectorFactory|(() => any) = providerToFactory(provider);
  if (isTypeProvider(provider) || !provider.multi) {
    // Single provider case: the factory is created and pushed immediately
    factory = new NodeInjectorFactory(factory, isViewProvider);
  } else {
    // Multi provider case:
    // We create a special multi factory which is going to aggregate all the values.
    // Since the output of such a factory depends on content or view injection,
    // we create two of them in fact, which are linked together.
    //
    // The first one (for providers) is always in the first block of the injectables array,
    // and the second one (for view providers) is always in the second block.
    // This is important because view providers have higher priority. When a multi token
    // is being looked up, the view providers should be found first.
    // Note that it is not possible to have a special multi factory in the third block.
    //
    // The algorithm to process multi providers is as follows:
    // 1) The multi provider comes from the providers of the component:
    //   a) If the special providers factory doesn't exist, it is created and pushed.
    //   b) Else, the multi provider is added to the existing one.
    // 2) The multi provider comes from the view providers of the component:
    //   a) If the special view providers factory doesn't exist, it is created and pushed.
    //   b) Else, the multi provider is added to the existing one.
    // 3) The multi providers comes from the providers of the other directives
    //   a) If the special providers factory doesn't exist, it is created and
    //     i) If a special view providers exists, it is inserted in the first block and linked
    //     ii) Else, it is pushed in the third block
    //   b) Else, the multi provider is added to the existing one.
    const previousOrParentTNode = getPreviousOrParentTNode();
    const beginIndex =
        previousOrParentTNode.providerIndexes & TNodeProviderIndexes.ProvidersStartIndexMask;
    const endIndex = beginIndex +
        (previousOrParentTNode.providerIndexes >> TNodeProviderIndexes.CptProvidersCountShift);
    const existingProvidersFactoryIndex = indexOf(token, tInjectables, beginIndex, endIndex);
    const existingViewProvidersFactoryIndex =
        indexOf(token, tInjectables, endIndex, tInjectables.length);
    const doesProvidersFactoryExist = existingProvidersFactoryIndex >= 0;
    const doesViewProvidersFactoryExist = existingViewProvidersFactoryIndex >= 0;
    if (isComponent && (!isViewProvider && !doesProvidersFactoryExist ||
                        isViewProvider && !doesViewProvidersFactoryExist) ||
        !isComponent && !doesProvidersFactoryExist) {
      // Cases 1.a, 2.a, 3.a.i and 3.a.ii
      factory = multiFactory(
          isViewProvider ? multiViewProvidersFactoryResolver : multiProvidersFactoryResolver,
          !isComponent && doesViewProvidersFactoryExist ? endIndex : lInjectables.length,
          isViewProvider,
          !doesProvidersFactoryExist ? null : lInjectables[existingProvidersFactoryIndex], factory);
      if (!isComponent && doesViewProvidersFactoryExist) {
        // Special insertion logic for case 3.a.i
        lInjectables ![existingViewProvidersFactoryIndex].providerFactory = factory;
        tInjectables.splice(endIndex, 0, token);
        lInjectables.splice(endIndex, 0, factory);
        previousOrParentTNode.providerIndexes += TNodeProviderIndexes.CptProvidersCountShifter;
        diPublicInInjector(getOrCreateNodeInjector(), token);
        return 1;
      }
    } else {
      // Cases 1.b, 2.b and 3.b
      multiFactoryAdd(
          lInjectables ![isViewProvider ? existingViewProvidersFactoryIndex : existingProvidersFactoryIndex],
          factory);
      return 0;
    }
  }
  // Insertion logic for single providers and multi providers (all cases but 3.a.i)
  tInjectables.push(token);
  lInjectables.push(factory);
  diPublicInInjector(getOrCreateNodeInjector(), token);
  return 1;
}

/**
 * Add a factory in a nulti factory.
 */
function multiFactoryAdd(multiFactory: NodeInjectorFactory, factory: () => any): void {
  multiFactory.multi !.push(factory);
}

/**
 * Returns the index of item in the array, but only in the begin to end range.
 */
function indexOf(item: any, arr: any[], begin: number, end: number) {
  for (let i = begin; i < end; i++) {
    if (arr[i] === item) return i;
  }
  return -1;
}

/**
 * Use this with `multi` `providers`.
 */
function multiProvidersFactoryResolver(
    this: NodeInjectorFactory, tData: any[], data: any[]): any[] {
  return multiResolve(this.multi !, []);
}

/**
 * Use this with `multi` `viewProviders`.
 *
 * This factory knows how to concatenate itself with the existing `multi` `providers`.
 */
function multiViewProvidersFactoryResolver(
    this: NodeInjectorFactory, tData: any[], lData: any[]): any[] {
  const factories = this.multi !;
  const componentCount = this.componentProviders !;
  const multiProviders = getNodeInjectable(tData, lData, this.providerFactory !.index !);
  // Copy the section of the array which contains `multi` `providers` from the component
  let result: any[] = multiProviders.slice(0, componentCount);
  // Insert the `viewProvider` instances.
  multiResolve(factories, result);
  // Copy the section of the array which contains `multi` `providers` from other directives
  for (let i = componentCount; i < multiProviders.length; i++) {
    result.push(multiProviders[i]);
  }
  return result;
}

/**
 * Maps an array of factories into an array of values.
 */
function multiResolve(factories: Array<() => any>, result: any[]): any[] {
  for (let i = 0; i < factories.length; i++) {
    const factory = factories[i] !as() => null;
    result.push(factory());
  }
  return result;
}


/**
 * Retrieve or instantiate the injectable from the `lData` at particular `index`.
 *
 * This function checks to see if the value has already been instantiated and if so returns the
 * cached `injectable`. Otherwise if it detects that the value is still a factory it
 * instantiate the `injectable` and caches the value.
 */
function getNodeInjectable(tData: any[], lData: any[], index: number): any {
  let value = lData[index];
  if (isFactory(value)) {
    if (value.resolving) {
      throw new Error(`Circular dep for ${stringify(tData[index])}`);
    }
    const previousIncludeViewProviders = includeViewProviders;
    includeViewProviders = value.isViewProvider;
    value.resolving = true;
    try {
      value = lData[index] = value.factory(tData, lData);
    } catch (e) {
      value.resolving = false;
      throw e;
    } finally {
      includeViewProviders = previousIncludeViewProviders;
    }
  }
  return value;
}

/**
 * Creates a muli factory.
 */
function multiFactory(
    factoryFn: (this: NodeInjectorFactory, tData: any[], lData: any[]) => any, index: number,
    isViewProvider: boolean, providerFactory: NodeInjectorFactory | null,
    f: () => any): NodeInjectorFactory {
  const factory = new NodeInjectorFactory(factoryFn, isViewProvider);
  factory.multi = [];
  factory.index = index;
  factory.componentProviders = providerFactory ? providerFactory.multi !.length : 0;
  factory.providerFactory = providerFactory;
  multiFactoryAdd(factory, f);
  return factory;
}

/**
 * Factory for creating instances of injectors in the NodeInjector.
 *
 * This factory is complicated by the fact that it can resolve `multi` factories as well.
 *
 * NOTE: Some of the fields are optional which means that this class has two hidden classes.
 * - One without `multi` support (most common)
 * - One with `multi` values, (rare).
 *
 * Since VMs can cache up to 4 inline hidden classes this is OK.
 *
 * - Single factory: Only `resolving` and `factory` is define.
 * - `providers` factory: `componentCount` is a number and `index = -1`.
 * - `viewProviders` factory: `componentCount` is a number and `index` points to `providers`.
 */
class NodeInjectorFactory {
  /**
   * Marker set to true during factory invocation to see if we get into recursive loop.
   * Recursive loop causes an error to be displayed.
   */
  resolving = false;

  /**
   * Marks that the token can see other Tokens declared on `viewProviders`.
   */
  isViewProvider: boolean;

  /**
   * An array of factories to use in case of `multi` provider.
   */
  multi?: Array<() => any>;

  /**
   * Number of `multi`-providers which belong to the component.
   *
   * This is needed because the when multiple components and directives declare the `multi` provider
   * they have to be concatenated in the correct order.
   *
   * Example:
   *
   * If we have a component and directive active an a single element as declared here
   * ```
   * component:
   *   provides: [ {provide: String, useValue: 'component', multi: true} ],
   *   viewProvides: [ {provide: String, useValue: 'componentView', multi: true} ],
   *
   * directive:
   *   provides: [ {provide: String, useValue: 'directive', multi: true} ],
   * ```
   *
   * Then the expected results are:
   *
   * ```
   * providers: ['component', 'directive']
   * viewProviders: ['component', 'componentView', 'directive']
   * ```
   *
   * The way to think about it is that the `viewProviders` have been inserted after the component
   * but before the directives, which is why we need to know how many `multi`s have been declared by
   * the component.
   */
  componentProviders?: number;

  /**
   * Current index of the Factory in the `data`. Needed for `viewProviders` and `providers` merging.
   * See `providerFactory`.
   */
  index?: number;

  /**
   * Because the same `multi` provider can be declared in `provides` and `viewProvides` it is
   * possible for `viewProvides` to shadow the `provides`. For this reason we store the
   * `provideFactory` of the `providers` so that `providers` can be extended with `viewProviders`.
   *
   * Example:
   *
   * Given:
   * ```
   * provides: [ {provide: String, useValue: 'both', multi: true} ],
   * viewProvides: [ {provide: String, useValue: 'viewOnly', multi: true} ],
   * ```
   *
   * We have to return `['all']` in case of content injection, but `['all', 'viewOnly']` in case
   * of view injection. We further have to make sure that the shared instances (in our case
   * `all`) are the exact same instance in both the content as well as the view injection. (We
   * have to make sure that we don't double instantiate.) For this reason the `viewProvides`
   * `Factory` has a pointer to the shadowed `provides` factory so that it can instantiate the
   * `providers` (`['all']`) and than extend it with `viewProviders` (`['all'] + ['viewOnly'] =
   * ['all', 'viewOnly']`).
   */
  providerFactory?: NodeInjectorFactory|null;


  constructor(
      /**
       * Factory to invoke in order to create a new instance.
       */
      public factory:
          (this: NodeInjectorFactory,
           /**
            * array where injectables tokens are stored. This is used in
            * case of an error reporting to produce friendlier errors.
            */
           tData: any[],
           /**
            * array where existing instances of injectables are stored. This is used in case
            * of multi shadow is needed. See `multi` field documentation.
            */
           lData: any[]) => any,
      /**
       * Set to `true` if the token is declared in `viewProviders` (or if it is component).
       */
      isViewProvider: boolean) {
    this.isViewProvider = isViewProvider;
  }
}
const FactoryPrototype = NodeInjectorFactory.prototype;
function isFactory(obj: any): obj is NodeInjectorFactory {
  // See: https://jsperf.com/instanceof-vs-getprototypeof
  return typeof obj == 'object' && Object.getPrototypeOf(obj) == FactoryPrototype;
}

/**
 * Returns the value associated to the given token from the injectors.
 *
 * `directiveInject` is intended to be used for directive, component and pipe factories.
 *  All other injection use `inject` which does not walk the node injector tree.
 *
 * Usage example (in factory function):
 *
 * class SomeDirective {
 *   constructor(directive: DirectiveA) {}
 *
 *   static ngDirectiveDef = defineDirective({
 *     type: SomeDirective,
 *     factory: () => new SomeDirective(directiveInject(DirectiveA))
 *   });
 * }
 *
 * @param token the type or token to inject
 * @param flags Injection flags
 * @returns the value from the injector or `null` when not found
 */
export function directiveInject<T>(token: Type<T>| InjectionToken<T>): T;
export function directiveInject<T>(token: Type<T>| InjectionToken<T>, flags: InjectFlags): T;
export function directiveInject<T>(
    token: Type<T>| InjectionToken<T>, flags = InjectFlags.Default): T|null {
  return getOrCreateInjectable<T>(getOrCreateNodeInjector(), token, flags);
}

/**
 * Creates an ElementRef and stores it on the injector.
 * Or, if the ElementRef already exists, retrieves the existing ElementRef.
 *
 * @returns The ElementRef instance to use
 */
export function injectElementRef(): viewEngine_ElementRef {
  return getOrCreateElementRef(getOrCreateNodeInjector());
}

/**
 * Creates a TemplateRef and stores it on the injector. Or, if the TemplateRef already
 * exists, retrieves the existing TemplateRef.
 *
 * @returns The TemplateRef instance to use
 */
export function injectTemplateRef<T>(): viewEngine_TemplateRef<T> {
  return getOrCreateTemplateRef<T>(getOrCreateNodeInjector());
}

/**
 * Creates a ViewContainerRef and stores it on the injector. Or, if the ViewContainerRef
 * already exists, retrieves the existing ViewContainerRef.
 *
 * @returns The ViewContainerRef instance to use
 */
export function injectViewContainerRef(): viewEngine_ViewContainerRef {
  return getOrCreateContainerRef(getOrCreateNodeInjector());
}

/** Returns a ChangeDetectorRef (a.k.a. a ViewRef) */
export function injectChangeDetectorRef(): viewEngine_ChangeDetectorRef {
  return getOrCreateChangeDetectorRef(getOrCreateNodeInjector(), null);
}

/**
 * Creates a ComponentFactoryResolver and stores it on the injector. Or, if the
 * ComponentFactoryResolver
 * already exists, retrieves the existing ComponentFactoryResolver.
 *
 * @returns The ComponentFactoryResolver instance to use
 */
export function injectComponentFactoryResolver(): viewEngine_ComponentFactoryResolver {
  return componentFactoryResolver;
}
const componentFactoryResolver: ComponentFactoryResolver = new ComponentFactoryResolver();


export function injectRenderer2(): Renderer2 {
  return getOrCreateRenderer2(getOrCreateNodeInjector());
}
/**
 * Inject static attribute value into directive constructor.
 *
 * This method is used with `factory` functions which are generated as part of
 * `defineDirective` or `defineComponent`. The method retrieves the static value
 * of an attribute. (Dynamic attributes are not supported since they are not resolved
 *  at the time of injection and can change over time.)
 *
 * # Example
 * Given:
 * ```
 * @Component(...)
 * class MyComponent {
 *   constructor(@Attribute('title') title: string) { ... }
 * }
 * ```
 * When instantiated with
 * ```
 * <my-component title="Hello"></my-component>
 * ```
 *
 * Then factory method generated is:
 * ```
 * MyComponent.ngComponentDef = defineComponent({
 *   factory: () => new MyComponent(injectAttribute('title'))
 *   ...
 * })
 * ```
 *
 * @experimental
 */
export function injectAttribute(attrNameToInject: string): string|undefined {
  const tNode = getPreviousOrParentTNode();
  ngDevMode && assertNodeOfPossibleTypes(
                   tNode, TNodeType.Container, TNodeType.Element, TNodeType.ElementContainer);
  ngDevMode && assertDefined(tNode, 'expecting tNode');
  const attrs = tNode.attrs;
  if (attrs) {
    for (let i = 0; i < attrs.length; i = i + 2) {
      const attrName = attrs[i];
      if (attrName === AttributeMarker.SelectOnly) break;
      if (attrName == attrNameToInject) {
        return attrs[i + 1] as string;
      }
    }
  }
  return undefined;
}

/**
 * Creates a ViewRef and stores it on the injector as ChangeDetectorRef (public alias).
 * Or, if it already exists, retrieves the existing instance.
 *
 * @returns The ChangeDetectorRef to use
 */
export function getOrCreateChangeDetectorRef(
    di: LInjector, context: any): viewEngine_ChangeDetectorRef {
  if (di.changeDetectorRef) return di.changeDetectorRef;

  const currentTNode = di.tNode;
  if (isComponent(currentTNode)) {
    return di.changeDetectorRef =
               new ViewRef(getLNode(currentTNode, di.view).data as LViewData, context);
  } else if (currentTNode.type === TNodeType.Element) {
    return di.changeDetectorRef = getOrCreateHostChangeDetector(di.view);
  }
  return null !;
}

/** Gets or creates ChangeDetectorRef for the closest host component */
function getOrCreateHostChangeDetector(currentView: LViewData): viewEngine_ChangeDetectorRef {
  const hostComponentView = findComponentView(currentView);
  const hostNode = getHostElementNode(hostComponentView) !;
  const hostInjector = hostNode.nodeInjector;
  const existingRef = hostInjector && hostInjector.changeDetectorRef;

  return existingRef ? existingRef : new ViewRef(hostComponentView, hostComponentView[CONTEXT]);
}

function getOrCreateRenderer2(di: LInjector): Renderer2 {
  const renderer = di.view[RENDERER];
  if (isProceduralRenderer(renderer)) {
    return renderer as Renderer2;
  } else {
    throw new Error('Cannot inject Renderer2 when the application uses Renderer3!');
  }
}

/**
 * Determines if the `tView` is a root view of a component (vs an embedded-view).
 *
 * @param tView `TView` to examine.
 */
function isTViewAComponentView(tView: TView): boolean {
  // TODO(misko): Refactor `TView` for performance so that it has `flags` so that we can directly
  // determine if it is a ComponentView (vs EmbeddedView) without looking at `TNode`;
  return tView.node !.type == TNodeType.Element;
}

/**
 * Determines if a given location in a `TNode` tree should include the `viewProviders`.
 *
 * When an injector is searching for a type in a `TNode` tree, it needs to determine if a given
 * `TNode` should have `viewProviders` visible. The basic rules which make the `viewProviders`
 * visible are:
 * - If `instantiatingComponent` component is true. This is a special case
 *
 * @param currentTNode Current `TNode` where we are looking for the injectable.
 * @param previousTNode Previous `TNode` where we looked for injectable (or `null` if it is at the
 * beginning of search.)
 * @param invokedFromComponent True if we are trying to resolved tokens for `Component`. This is
 * because `Component` can see into the `viewProviders`.
 */
function areViewProvidersVisible(
    currentTView: TView, previousTView: TView | null, invokedFromComponent: boolean): boolean {
  if (previousTView === null) {
    // This only happens on the initial `NodeInjector` query before we start walking up the tree.
    if (invokedFromComponent) {
      // If we are instantiating a token which is needed form `Component` than we have to make
      // `viewProviders` visible to the `Component`.
      return true;
    } else {
      // The token was declared in `providers` and therefore should not see `viewProviders`.
      return false;
    }
  } else {
    // Check to see if `TView` transition has occurred, which means that `currentTNode` is a
    // component.
    if (currentTView !== previousTView && isTViewAComponentView(previousTView)) {
      // `TView` transition has occurred therefor if we have just crossed from a component view into
      // parent than the `viewProviders` should be included.
      return true;
    } else {
      // `TView` transition has not occurred therefor we know that `viewProviders` should not be
      // visible.
      return false;
    }
  }
}

/**
 * Defines if the call to `inject` should include `viewProviders` in its resolution.
 *
 * This is set to true when we try to instantiate a component. This value is reset in
 * `getNodeInjectable` to value which matches the declaration location of the token about to be
 * instantiated. This is done so that if we are injecting a token which was declared outside of
 * `viewProviders` we don't accidentally pull `viewProviders` in.
 *
 * Example:
 *
 * ```
 * @Injectable()
 * class Service {
 *   constructor(public value: String) {}
 * }
 *
 * @Component({
 *   providers: [
 *     MyService,
 *     {provide: String, value: 'providers' }
 *   ]
 *   viewProviders: [
 *     {provide: String, value: 'viewProviders'}
 *   ]
 * })
 * class MyComponent {
 *   constructor(myService: MyService, value: String) {
 *     // We expect that Component can see into `viewProviders`.
 *     expect(value).toEqual('viewProviders');
 *     // `MyService` was not declared in `viewProviders` hence it can't see it.
 *     expect(myService.value).toEqual('providers');
 *   }
 * }
 *
 * ```
 */
let includeViewProviders = false;

/**
 * Returns the value associated to the given token from the injectors.
 *
 * Look for the injector providing the token by walking up the node injector tree and then
 * the module injector tree.
 *
 * @param nodeInjector Node injector where the search should start
 * @param token The token to look for
 * @param flags Injection flags
 * @returns the value from the injector or `null` when not found
 */
export function getOrCreateInjectable<T>(
    nodeInjector: LInjector, token: Type<T>| InjectionToken<T>,
    flags: InjectFlags = InjectFlags.Default): T|null {
  const bloomHash = bloomHashBit(token);
  // If the token has a bloom hash, then it is a directive that is public to the injection system
  // (diPublic) otherwise fall back to the module injector.
  if (bloomHash !== null) {
    let injector: LInjector|null = nodeInjector;
    let previousTView: TView|null = null;
    while (injector) {
      // Get the closest potential matching injector (upwards in the injector tree) that
      // *potentially* has the token.
      injector = bloomFindPossibleInjector(injector, bloomHash, flags);

      // If no injector is found, we *know* that there is no ancestor injector that contains the
      // token, so we abort.
      if (!injector) {
        break;
      }

      // At this point, we have an injector which *may* contain the token, so we step through the
      // providers and directives associated with the injector's corresponding node to get the
      // instance.
      const currentTNode = injector.tNode;
      const injectorView = injector.view;
      const currentTView = injectorView[TVIEW];
      const nodeFlags = currentTNode.flags;
      const nodeProviderIndexes = currentTNode.providerIndexes;
      const tInjectables = currentTView.injectables !;
      // First, we step through providers
      // A node can access view providers on a given element injector if:
      // - they don't belong to the same "component view"
      // - or the node belong to the root "component view"
      const canAccessViewProviders =
          areViewProvidersVisible(currentTView, previousTView, includeViewProviders);
      const startInjectables = nodeProviderIndexes & TNodeProviderIndexes.ProvidersStartIndexMask;
      const startDirectives = nodeFlags >> TNodeFlags.DirectiveStartingIndexShift;
      const cptProvidersCount = nodeProviderIndexes >> TNodeProviderIndexes.CptProvidersCountShift;
      const cptViewProvidersCount =
          (nodeProviderIndexes & TNodeProviderIndexes.CptViewProvidersCountMask) >>
          TNodeProviderIndexes.CptViewProvidersCountShift;
      const lInjectables = injectorView[INJECTABLES] !;
      for (let i = startDirectives - 1; i >= startInjectables; i--) {
        const isViewProvider = i >= (startInjectables + cptProvidersCount) &&
            i < (startInjectables + cptProvidersCount + cptViewProvidersCount);
        const providerToken = tInjectables[i] as InjectionToken<any>| Type<any>;
        if (token === providerToken &&
            (!isViewProvider || isViewProvider && canAccessViewProviders)) {
          const value = getNodeInjectable(tInjectables, lInjectables, i);
          return value;
        }
      }

      // Then, we step through directives
      const count = nodeFlags & TNodeFlags.DirectiveCountMask;
      if (count !== 0) {
        for (let i = startDirectives; i < startDirectives + count; i++) {
          // Get the definition for the directive at this index and, if it is injectable (diPublic),
          // and matches the given token, return the directive instance.
          const directiveDef = tInjectables[i] as DirectiveDefInternal<any>;
          if (directiveDef.type === token && directiveDef.diPublic) {
            return injectorView[INJECTABLES] ![i];
          }
        }
      }

      // If we *didn't* find the directive for the token and we are searching the current node's
      // injector, it's possible the directive is on this node and hasn't been created yet.
      let instance: T|null;
      if (injector === nodeInjector &&
          (instance = searchMatchesQueuedForCreation<T>(token, injectorView[TVIEW]))) {
        return instance;
      }

      // The def wasn't found anywhere on this node, so it was a false positive.
      // If flags permit, traverse up the tree and continue searching.
      if (flags & InjectFlags.Self || flags & InjectFlags.Host && !sameHostView(injector)) {
        injector = null;
      } else {
        injector = injector.parent;
      }
      previousTView = currentTView;
    }
  }

  const moduleInjector = nodeInjector.view[INJECTOR];
  if (moduleInjector) {
    return moduleInjector.get(token, flags);
  } else {
    return injectFromRoot(token, flags);
  }
}

function searchMatchesQueuedForCreation<T>(token: any, hostTView: TView): T|null {
  const matches = hostTView.currentMatches;
  if (matches) {
    for (let i = 0; i < matches.length; i += 2) {
      const def = matches[i] as DirectiveDefInternal<any>;
      if (def.type === token) {
        return resolveDirective(def, i + 1, matches, hostTView);
      }
    }
  }
  return null;
}

/**
 * Returns the bit in an injector's bloom filter that should be used to determine whether or not
 * the directive might be provided by the injector.
 *
 * When a directive is public, it is added to the bloom filter and given a unique ID that can be
 * retrieved on the Type. When the directive isn't public or the token is not a directive `null`
 * is returned as the node injector can not possibly provide that token.
 *
 * @param token the injection token
 * @returns the matching bit to check in the bloom filter or `null` if the token is not known.
 */
function bloomHashBit(token: Type<any>| InjectionToken<any>): number|null {
  let id: number|undefined = (token as any)[NG_ELEMENT_ID];
  return typeof id === 'number' ? id & BLOOM_MASK : null;
}

/**
 * Finds the closest injector that might have a certain directive.
 *
 * Each directive corresponds to a bit in an injector's bloom filter. Given the bloom bit to
 * check and a starting injector, this function traverses up injectors until it finds an
 * injector that contains a 1 for that bit in its bloom filter. A 1 indicates that the
 * injector may have that directive. It only *may* have the directive because directives begin
 * to share bloom filter bits after the BLOOM_SIZE is reached, and it could correspond to a
 * different directive sharing the bit.
 *
 * Note: We can skip checking further injectors up the tree if an injector's cbf structure
 * has a 0 for that bloom bit. Since cbf contains the merged value of all the parent
 * injectors, a 0 in the bloom bit indicates that the parents definitely do not contain
 * the directive and do not need to be checked.
 *
 * @param injector The starting node injector to check
 * @param  bloomBit The bit to check in each injector's bloom filter
 * @param  flags The injection flags for this injection site (e.g. Optional or SkipSelf)
 * @returns An injector that might have the directive
 */
export function bloomFindPossibleInjector(
    startInjector: LInjector, bloomBit: number, flags: InjectFlags): LInjector|null {
  // Create a mask that targets the specific bit associated with the directive we're looking for.
  // JS bit operations are 32 bits, so this will be a number between 2^0 and 2^31, corresponding
  // to bit positions 0 - 31 in a 32 bit integer.
  const mask = 1 << bloomBit;
  const b7 = bloomBit & 0x80;
  const b6 = bloomBit & 0x40;
  const b5 = bloomBit & 0x20;

  // Traverse up the injector tree until we find a potential match or until we know there *isn't* a
  // match.
  let injector: LInjector|null =
      flags & InjectFlags.SkipSelf ? startInjector.parent : startInjector;

  while (injector) {
    // Our bloom filter size is 256 bits, which is eight 32-bit bloom filter buckets:
    // bf0 = [0 - 31], bf1 = [32 - 63], bf2 = [64 - 95], bf3 = [96 - 127], etc.
    // Get the bloom filter value from the appropriate bucket based on the directive's bloomBit.
    let value: number;

    if (b7) {
      value = b6 ? (b5 ? injector.bf7 : injector.bf6) : (b5 ? injector.bf5 : injector.bf4);
    } else {
      value = b6 ? (b5 ? injector.bf3 : injector.bf2) : (b5 ? injector.bf1 : injector.bf0);
    }

    // If the bloom filter value has the bit corresponding to the directive's bloomBit flipped on,
    // this injector is a potential match.
    if (value & mask) {
      return injector;
    }

    if (flags & InjectFlags.Self || flags & InjectFlags.Host && !sameHostView(injector)) {
      return null;
    }

    // If the current injector does not have the directive, check the bloom filters for the ancestor
    // injectors (cbf0 - cbf7). These filters capture *all* ancestor injectors.
    if (b7) {
      value = b6 ? (b5 ? injector.cbf7 : injector.cbf6) : (b5 ? injector.cbf5 : injector.cbf4);
    } else {
      value = b6 ? (b5 ? injector.cbf3 : injector.cbf2) : (b5 ? injector.cbf1 : injector.cbf0);
    }

    // If the ancestor bloom filter value has the bit corresponding to the directive, traverse up to
    // find the specific injector. If the ancestor bloom filter does not have the bit, we can abort.
    if (value & mask) {
      injector = injector.parent;
    } else {
      return null;
    }
  }

  return null;
}

/**
 * Checks whether the current injector and its parent are in the same host view.
 *
 * This is necessary to support @Host() decorators. If @Host() is set, we should stop searching once
 * the injector and its parent view don't match because it means we'd cross the view boundary.
 */
function sameHostView(injector: LInjector): boolean {
  return !!injector.parent && injector.parent.view === injector.view;
}

export class ReadFromInjectorFn<T> {
  constructor(readonly read: (injector: LInjector, tNode: TNode, directiveIndex?: number) => T) {}
}

/**
 * Creates an ElementRef for a given node injector and stores it on the injector.
 * Or, if the ElementRef already exists, retrieves the existing ElementRef.
 *
 * @param di The node injector where we should store a created ElementRef
 * @returns The ElementRef instance to use
 */
export function getOrCreateElementRef(di: LInjector): viewEngine_ElementRef {
  return di.elementRef || (di.elementRef = new ElementRef(getLNode(di.tNode, di.view).native));
}

export const QUERY_READ_TEMPLATE_REF = <QueryReadType<viewEngine_TemplateRef<any>>>(
    new ReadFromInjectorFn<viewEngine_TemplateRef<any>>(
        (injector: LInjector) => getOrCreateTemplateRef(injector)) as any);

export const QUERY_READ_CONTAINER_REF = <QueryReadType<viewEngine_ViewContainerRef>>(
    new ReadFromInjectorFn<viewEngine_ViewContainerRef>(
        (injector: LInjector) => getOrCreateContainerRef(injector)) as any);

export const QUERY_READ_ELEMENT_REF =
    <QueryReadType<viewEngine_ElementRef>>(new ReadFromInjectorFn<viewEngine_ElementRef>(
        (injector: LInjector) => getOrCreateElementRef(injector)) as any);

export const QUERY_READ_FROM_NODE =
    (new ReadFromInjectorFn<any>((injector: LInjector, tNode: TNode, directiveIdx: number) => {
      ngDevMode && assertNodeOfPossibleTypes(
                       tNode, TNodeType.Container, TNodeType.Element, TNodeType.ElementContainer);
      if (directiveIdx > -1) {
        return injector.view[INJECTABLES] ![directiveIdx];
      }
      if (tNode.type === TNodeType.Element || tNode.type === TNodeType.ElementContainer) {
        return getOrCreateElementRef(injector);
      }
      if (tNode.type === TNodeType.Container) {
        return getOrCreateTemplateRef(injector);
      }
      if (ngDevMode) {
        // should never happen
        throw new Error(`Unexpected node type: ${tNode.type}`);
      }
    }) as any as QueryReadType<any>);

/** A ref to a node's native element. */
class ElementRef extends viewEngine_ElementRef {}

/**
 * Creates a ViewContainerRef and stores it on the injector. Or, if the ViewContainerRef
 * already exists, retrieves the existing ViewContainerRef.
 *
 * @returns The ViewContainerRef instance to use
 */
export function getOrCreateContainerRef(di: LInjector): viewEngine_ViewContainerRef {
  if (!di.viewContainerRef) {
    const hostLNode =
        getPreviousOrParentNode() as LElementNode | LContainerNode | LElementContainerNode;
    const hostTNode = getPreviousOrParentTNode() as TElementNode | TContainerNode;
    ngDevMode && assertNodeOfPossibleTypes(
                     hostTNode, TNodeType.Container, TNodeType.Element, TNodeType.ElementContainer);

    const hostView = di.view;
    const lContainer = createLContainer(hostView, true);
    const comment = hostView[RENDERER].createComment(ngDevMode ? 'container' : '');
    const lContainerNode: LContainerNode =
        createLNodeObject(TNodeType.Container, hostLNode.nodeInjector, comment, lContainer);

    lContainer[RENDER_PARENT] = getRenderParent(hostTNode, hostView);

    appendChild(comment, hostTNode, hostView);

    if (!hostTNode.dynamicContainerNode) {
      hostTNode.dynamicContainerNode =
          createTNode(TNodeType.Container, -1, null, null, hostTNode, null);
    }

    hostLNode.dynamicLContainerNode = lContainerNode;
    addToViewTree(hostView, hostTNode.index as number, lContainer);

    di.viewContainerRef = new ViewContainerRef(
        lContainer, hostTNode.dynamicContainerNode as TContainerNode, hostTNode, hostView);
  }

  return di.viewContainerRef;
}

export class NodeInjector implements Injector {
  constructor(private _lInjector: LInjector) {}

  get(token: any): any {
    if (token === viewEngine_TemplateRef) {
      return getOrCreateTemplateRef(this._lInjector);
    }
    if (token === viewEngine_ViewContainerRef) {
      return getOrCreateContainerRef(this._lInjector);
    }
    if (token === viewEngine_ElementRef) {
      return getOrCreateElementRef(this._lInjector);
    }
    if (token === viewEngine_ChangeDetectorRef) {
      return getOrCreateChangeDetectorRef(this._lInjector, null);
    }
    if (token === Renderer2) {
      return getOrCreateRenderer2(this._lInjector);
    }

    return getOrCreateInjectable(this._lInjector, token);
  }
}

/**
 * A ref to a container that enables adding and removing views from that container
 * imperatively.
 */
class ViewContainerRef extends viewEngine_ViewContainerRef {
  private _viewRefs: viewEngine_ViewRef[] = [];

  constructor(
      private _lContainer: LContainer, private _tContainerNode: TContainerNode,
      private _hostTNode: TElementNode|TContainerNode|TElementContainerNode,
      private _hostView: LViewData) {
    super();
  }

  get element(): ElementRef {
    // TODO: Remove LNode lookup when removing LNode.nodeInjector
    const injector =
        getOrCreateNodeInjectorForNode(this._getHostNode(), this._hostTNode, this._hostView);
    return getOrCreateElementRef(injector);
  }

  get injector(): Injector {
    // TODO: Remove LNode lookup when removing LNode.nodeInjector
    const injector =
        getOrCreateNodeInjectorForNode(this._getHostNode(), this._hostTNode, this._hostView);
    return new NodeInjector(injector);
  }

  /** @deprecated No replacement */
  get parentInjector(): Injector {
    const parentLInjector = getParentLNode(this._hostTNode, this._hostView) !.nodeInjector;
    return parentLInjector ? new NodeInjector(parentLInjector) : new NullInjector();
  }

  clear(): void {
    while (this._lContainer[VIEWS].length) {
      this.remove(0);
    }
  }

  get(index: number): viewEngine_ViewRef|null { return this._viewRefs[index] || null; }

  get length(): number { return this._lContainer[VIEWS].length; }

  createEmbeddedView<C>(templateRef: viewEngine_TemplateRef<C>, context?: C, index?: number):
      viewEngine_EmbeddedViewRef<C> {
    const adjustedIdx = this._adjustIndex(index);
    const viewRef = (templateRef as TemplateRef<C>)
                        .createEmbeddedView(
                            context || <any>{}, this._lContainer, this._tContainerNode,
                            this._hostView, adjustedIdx);
    (viewRef as ViewRef<any>).attachToViewContainerRef(this);
    this._viewRefs.splice(adjustedIdx, 0, viewRef);
    return viewRef;
  }

  createComponent<C>(
      componentFactory: viewEngine_ComponentFactory<C>, index?: number|undefined,
      injector?: Injector|undefined, projectableNodes?: any[][]|undefined,
      ngModuleRef?: viewEngine_NgModuleRef<any>|undefined): viewEngine_ComponentRef<C> {
    const contextInjector = injector || this.parentInjector;
    if (!ngModuleRef && contextInjector) {
      ngModuleRef = contextInjector.get(viewEngine_NgModuleRef, null);
    }

    const componentRef =
        componentFactory.create(contextInjector, projectableNodes, undefined, ngModuleRef);
    this.insert(componentRef.hostView, index);
    return componentRef;
  }

  insert(viewRef: viewEngine_ViewRef, index?: number): viewEngine_ViewRef {
    if (viewRef.destroyed) {
      throw new Error('Cannot insert a destroyed View in a ViewContainer!');
    }
    const lView = (viewRef as ViewRef<any>)._view !;
    const adjustedIdx = this._adjustIndex(index);

    insertView(
        lView, this._lContainer, this._hostView, adjustedIdx, this._tContainerNode.parent !.index);

    const container = this._getHostNode().dynamicLContainerNode !;
    const beforeNode = getBeforeNodeForView(adjustedIdx, this._lContainer[VIEWS], container);
    addRemoveViewFromContainer(lView, true, beforeNode);

    (viewRef as ViewRef<any>).attachToViewContainerRef(this);
    this._viewRefs.splice(adjustedIdx, 0, viewRef);

    return viewRef;
  }

  move(viewRef: viewEngine_ViewRef, newIndex: number): viewEngine_ViewRef {
    const index = this.indexOf(viewRef);
    this.detach(index);
    this.insert(viewRef, this._adjustIndex(newIndex));
    return viewRef;
  }

  indexOf(viewRef: viewEngine_ViewRef): number { return this._viewRefs.indexOf(viewRef); }

  remove(index?: number): void {
    const adjustedIdx = this._adjustIndex(index, -1);
    removeView(this._lContainer, this._tContainerNode as TContainerNode, adjustedIdx);
    this._viewRefs.splice(adjustedIdx, 1);
  }

  detach(index?: number): viewEngine_ViewRef|null {
    const adjustedIdx = this._adjustIndex(index, -1);
    detachView(this._lContainer, adjustedIdx, !!this._tContainerNode.detached);
    return this._viewRefs.splice(adjustedIdx, 1)[0] || null;
  }

  private _adjustIndex(index?: number, shift: number = 0) {
    if (index == null) {
      return this._lContainer[VIEWS].length + shift;
    }
    if (ngDevMode) {
      assertGreaterThan(index, -1, 'index must be positive');
      // +1 because it's legal to insert at the end.
      assertLessThan(index, this._lContainer[VIEWS].length + 1 + shift, 'index');
    }
    return index;
  }

  private _getHostNode() { return getLNode(this._hostTNode, this._hostView); }
}

/**
 * Creates a TemplateRef and stores it on the injector. Or, if the TemplateRef already
 * exists, retrieves the existing TemplateRef.
 *
 * @param di The node injector where we should store a created TemplateRef
 * @returns The TemplateRef instance to use
 */
export function getOrCreateTemplateRef<T>(di: LInjector): viewEngine_TemplateRef<T> {
  if (!di.templateRef) {
    const hostNode = getPreviousOrParentNode() as LContainerNode;
    const hostTNode = getPreviousOrParentTNode() as TContainerNode;
    ngDevMode && assertNodeType(hostTNode, TNodeType.Container);
    ngDevMode && assertDefined(hostTNode.tViews, 'TView must be allocated');
    di.templateRef = new TemplateRef<any>(
        di.view, getOrCreateElementRef(di), hostTNode.tViews as TView, getRenderer(),
        hostNode.data ![QUERIES]);
  }
  return di.templateRef;
}

export function getFactoryOf<T>(type: Type<any>): ((type?: Type<T>) => T)|null {
  const typeAny = type as any;
  const def = getComponentDef<T>(typeAny) || getDirectiveDef<T>(typeAny) ||
      getPipeDef<T>(typeAny) || getInjectableDef<T>(typeAny) || getInjectorDef<T>(typeAny);
  if (!def || def.factory === undefined) {
    return null;
  }
  return def.factory;
}

export function getInheritedFactory<T>(type: Type<any>): (type: Type<T>) => T {
  const proto = Object.getPrototypeOf(type.prototype).constructor as Type<any>;
  const factory = getFactoryOf<T>(proto);
  if (factory !== null) {
    return factory;
  } else {
    // There is no factory defined. Either this was improper usage of inheritance
    // (no Angular decorator on the superclass) or there is no constructor at all
    // in the inheritance chain. Since the two cases cannot be distinguished, the
    // latter has to be assumed.
    return (t) => new t();
  }
}

class TemplateRef<T> extends viewEngine_TemplateRef<T> {
  constructor(
      private _declarationParentView: LViewData, readonly elementRef: viewEngine_ElementRef,
      private _tView: TView, private _renderer: Renderer3, private _queries: LQueries|null) {
    super();
  }

  createEmbeddedView(
      context: T, container?: LContainer, tContainerNode?: TContainerNode, hostView?: LViewData,
      index?: number): viewEngine_EmbeddedViewRef<T> {
    const lView = createEmbeddedViewAndNode(
        this._tView, context, this._declarationParentView, this._renderer, this._queries);
    if (container) {
      insertView(lView, container, hostView !, index !, tContainerNode !.parent !.index);
    }
    renderEmbeddedTemplate(lView, this._tView, context, RenderFlags.Create);
    const viewRef = new ViewRef(lView, context);
    viewRef._tViewNode = lView[HOST_NODE] as TViewNode;
    return viewRef;
  }
}

/**
 * Retrieves `TemplateRef` instance from `Injector` when a local reference is placed on the
 * `<ng-template>` element.
 */
export function templateRefExtractor(tNode: TContainerNode, currentView: LViewData) {
  // TODO: remove this lookup with removing LNode.nodeInjector
  const lNode = getLNode(tNode, currentView) as LContainerNode;
  return getOrCreateTemplateRef(getOrCreateNodeInjectorForNode(lNode, tNode, currentView));
}
