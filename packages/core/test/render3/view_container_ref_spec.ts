/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Component, Directive, TemplateRef, ViewContainerRef} from '../../src/core';
import {defineComponent, defineDirective, injectTemplateRef, injectViewContainerRef} from '../../src/render3/index';
import {bind, container, containerRefreshEnd, containerRefreshStart, embeddedViewStart, embeddedViewEnd, interpolation1, load, loadDirective, text, textBinding, elementStart, elementEnd, elementProperty, detectChanges, projection, projectionDef, store, tick} from '../../src/render3/instructions';

import {containerEl, renderComponent, renderToHtml, toHtml} from './render_util';

import {createTemplateRef, getOrCreateTemplateRef, getOrCreateNodeInjectorForNode, createComponentFactory} from '../../src/render3/di';

describe('ViewContainerRef', () => {
  it('should add embedded view into container', () => {
    class TestDirective {
      constructor(public viewContainer: ViewContainerRef, public template: TemplateRef<any>, ) {}
  
      static ngDirectiveDef = defineDirective({
        type: TestDirective,
        factory: () => new TestDirective(injectViewContainerRef(), injectTemplateRef(), ),
      });
    }
  
    class TestComponent {
      testDir: TestDirective;
  
      static ngComponentDef = defineComponent({
        type: TestComponent,
        tag: 'test-cmp',
        factory: () => new TestComponent(),
        template: (cmp: TestComponent, cm: boolean) => {
          if (cm) {
            const subTemplate = (ctx: any, cm: boolean) => {
              if (cm) {
                text(0);
              }
              textBinding(0, bind(ctx.$implicit));
            };
            container(0, [TestDirective], subTemplate);
          }
          containerRefreshStart(0);
          cmp.testDir = loadDirective<TestDirective>(0);
          containerRefreshEnd();
        },
      });
    }

    const testCmp = renderComponent(TestComponent);
    expect(toHtml(testCmp)).toEqual('');
    const dir = testCmp.testDir;
    const childCtx = {$implicit: 'works'};
    const viewRef = dir.viewContainer.createEmbeddedView(dir.template, childCtx);
    expect(toHtml(testCmp)).toEqual('works');
  });

  @Directive({
    selector: '[vcref]'
  })
  class DirectiveVCRef {
    vcref: TemplateRef<any>;
    name: string;
    constructor(public viewContainer: ViewContainerRef) {}

    ngOnInit() {
      this.viewContainer.createEmbeddedView(this.vcref, this);
    }

    static ngDirectiveDef = defineDirective({
      type: DirectiveVCRef,
      factory: () => new DirectiveVCRef(injectViewContainerRef()),
      inputs: {
        vcref: 'vcref',
        name: 'name'
      }
    });
  }

  describe('API', () => {
    let directiveInstance: DirectiveWithVCRef|null;

    beforeEach(() => {
      directiveInstance = null;
    })

    class DirectiveWithVCRef {
      tplRef = createTemplateRef((ctx: any, cm: boolean) => {
        if (cm) {
          text(0);
        }
        textBinding(0, ctx.name);
      });
      static ngDirectiveDef = defineDirective({
        type: DirectiveWithVCRef,
        factory: () => directiveInstance = new DirectiveWithVCRef(injectViewContainerRef())
      });

      constructor(public vcref: ViewContainerRef) {}
    }

    function create(s: string, index?: number) {
      directiveInstance!.vcref.createEmbeddedView(directiveInstance!.tplRef, {name: s}, index);
    }

    describe('createEmbeddedView (incl. insert)', () => {
      it('should work on elements', () => {
        function template(context: any, cm: boolean) {
          if (cm) {
            elementStart(0, 'header', null, [DirectiveWithVCRef]);
            elementEnd();
            elementStart(1, 'footer');
            elementEnd()
          }
        }

        expect(renderToHtml(template, {})).toEqual('<header></header><footer></footer>');

        create('A');
        expect(renderToHtml(template, {})).toEqual('<header></header>A<footer></footer>');

        create('B');
        create('C');
        expect(renderToHtml(template, {})).toEqual('<header></header>ABC<footer></footer>');

        create('Y', 0);
        expect(renderToHtml(template, {})).toEqual('<header></header>YABC<footer></footer>');

        expect(() => {create('Z', -1)}).toThrow();
        expect(() => {create('Z', 5)}).toThrow();
      });

      it('should work on components', () => {
        class HeaderComponent {
          static ngComponentDef = defineComponent({
            type: HeaderComponent,
            tag: 'header-cmp',
            factory: () => new HeaderComponent(),
            template: (cmp: HeaderComponent, cm: boolean) => {
            }
          });
        }

        function template(context: any, cm: boolean) {
          if (cm) {
            elementStart(0, HeaderComponent, null, [DirectiveWithVCRef]);
            elementEnd();
            elementStart(1, 'footer');
            elementEnd();
          }
        }

        expect(renderToHtml(template, {})).toEqual('<header-cmp></header-cmp><footer></footer>');

        create('A');
        expect(renderToHtml(template, {})).toEqual('<header-cmp></header-cmp>A<footer></footer>');

        create('B');
        create('C');
        expect(renderToHtml(template, {})).toEqual('<header-cmp></header-cmp>ABC<footer></footer>');

        create('Y', 0);
        expect(renderToHtml(template, {})).toEqual('<header-cmp></header-cmp>YABC<footer></footer>');

        expect(() => {create('Z', -1)}).toThrow();
        expect(() => {create('Z', 5)}).toThrow();
      });

      it('should work on containers', () => {
        class HeaderComponent {
          static ngComponentDef = defineComponent({
            type: HeaderComponent,
            tag: 'header-cmp',
            factory: () => new HeaderComponent(),
            template: (cmp: HeaderComponent, cm: boolean) => {
            }
          });
        }

        function template(context: any, cm: boolean) {
          if (cm) {
            container(0, [DirectiveWithVCRef]);
            elementStart(1, 'footer');
            elementEnd();
          }
          containerRefreshStart(0);
          if (embeddedViewStart(1)) {
            elementStart(0, 'header');
            elementEnd();
          }
          embeddedViewEnd();
          containerRefreshEnd();
        }

        expect(renderToHtml(template, {})).toEqual('<header></header><footer></footer>');

        create('A');
        expect(renderToHtml(template, {})).toEqual('<header></header>A<footer></footer>');

        create('B');
        create('C');
        expect(renderToHtml(template, {})).toEqual('<header></header>ABC<footer></footer>');

        create('Y', 0);
        expect(renderToHtml(template, {})).toEqual('<header></header>YABC<footer></footer>');

        expect(() => {create('Z', -1)}).toThrow();
        expect(() => {create('Z', 5)}).toThrow();
      });
    });

    xdescribe('createComponent', () => {
      it('should work', () => {
        class EmbeddedComponent {
          static ngComponentDef = defineComponent({
            type: EmbeddedComponent,
            tag: 'embedded-cmp',
            factory: () => new EmbeddedComponent(),
            template: (cmp: EmbeddedComponent, cm: boolean) => {
              text(0, 'foo')
            }
          });
        }

        function template(context: any, cm: boolean) {
          if (cm) {
            elementStart(0, 'header', null, [DirectiveWithVCRef]);
            elementEnd();
            elementStart(1, 'footer');
            elementEnd()
          }
        }

        expect(renderToHtml(template, {})).toEqual('<header></header><footer></footer>');

        directiveInstance!.vcref.createComponent(createComponentFactory(EmbeddedComponent));
        expect(renderToHtml(template, {})).toEqual('<header></header><embedded-cmp>foo</embedded-cmp><footer></footer>');
      });
    });

    describe('detach, remove and clear', () => {
      it('should detach the right embedded view when an index is specified', () => {
        function template(context: any, cm: boolean) {
          if (cm) {
            elementStart(0, 'p', null, [DirectiveWithVCRef]);
            elementEnd();
          }
        }

        renderToHtml(template, {});
        create('A');
        create('B');
        create('C');
        create('D');
        create('E');
        expect(renderToHtml(template, {})).toEqual('<p></p>ABCDE');

        directiveInstance!.vcref.detach(3);
        expect(renderToHtml(template, {})).toEqual('<p></p>ABCE');

        directiveInstance!.vcref.detach(0);
        expect(renderToHtml(template, {})).toEqual('<p></p>BCE');

        expect(() => {directiveInstance!.vcref.detach(-1)}).toThrow();
        expect(() => {directiveInstance!.vcref.detach(42)}).toThrow();
      });

      it('should detach the last embedded view when no index is specified', () => {
        function template(context: any, cm: boolean) {
          if (cm) {
            elementStart(0, 'p', null, [DirectiveWithVCRef]);
            elementEnd();
          }
        }

        renderToHtml(template, {});
        create('A');
        create('B');
        create('C');
        create('D');
        create('E');
        expect(renderToHtml(template, {})).toEqual('<p></p>ABCDE');

        directiveInstance!.vcref.detach();
        expect(renderToHtml(template, {})).toEqual('<p></p>ABCD');
      });

      it('should remove the right embedded view when an index is specified', () => {
        //TODO: check the destroy part
        function template(context: any, cm: boolean) {
          if (cm) {
            elementStart(0, 'p', null, [DirectiveWithVCRef]);
            elementEnd();
          }
        }

        renderToHtml(template, {});
        create('A');
        create('B');
        create('C');
        create('D');
        create('E');
        expect(renderToHtml(template, {})).toEqual('<p></p>ABCDE');

        directiveInstance!.vcref.remove(3);
        expect(renderToHtml(template, {})).toEqual('<p></p>ABCE');

        directiveInstance!.vcref.remove(0);
        expect(renderToHtml(template, {})).toEqual('<p></p>BCE');

        expect(() => {directiveInstance!.vcref.remove(-1)}).toThrow();
        expect(() => {directiveInstance!.vcref.remove(42)}).toThrow();
      });

      it('should remove the last embedded view when no index is specified', () => {
        //TODO: check the destroy part
        function template(context: any, cm: boolean) {
          if (cm) {
            elementStart(0, 'p', null, [DirectiveWithVCRef]);
            elementEnd();
          }
        }

        renderToHtml(template, {});
        create('A');
        create('B');
        create('C');
        create('D');
        create('E');
        expect(renderToHtml(template, {})).toEqual('<p></p>ABCDE');

        directiveInstance!.vcref.remove();
        expect(renderToHtml(template, {})).toEqual('<p></p>ABCD');
      });

      it('should clear all embedded views', () => {
        //TODO: check the destroy part
        function template(context: any, cm: boolean) {
          if (cm) {
            elementStart(0, 'p', null, [DirectiveWithVCRef]);
            elementEnd();
          }
        }

        renderToHtml(template, {});
        create('A');
        create('B');
        create('C');
        create('D');
        create('E');
        expect(renderToHtml(template, {})).toEqual('<p></p>ABCDE');

        directiveInstance!.vcref.clear();
        expect(renderToHtml(template, {})).toEqual('<p></p>');

        expect(() => {directiveInstance!.vcref.clear()}).not.toThrow();
      });
    });

    describe('length', () => {
      it('should return the number of embedded views', () => {
        function template(context: any, cm: boolean) {
          if (cm) {
            elementStart(0, 'p', null, [DirectiveWithVCRef]);
            elementEnd();
          }
        }

        renderToHtml(template, {});
        expect(directiveInstance!.vcref.length).toEqual(0);

        create('A');
        create('B');
        create('C');
        renderToHtml(template, {});
        expect(directiveInstance!.vcref.length).toEqual(3);

        directiveInstance!.vcref.remove(1);
        renderToHtml(template, {});
        expect(directiveInstance!.vcref.length).toEqual(2);

        directiveInstance!.vcref.clear();
        renderToHtml(template, {});
        expect(directiveInstance!.vcref.length).toEqual(0);
      });
    });

    describe('get and indexOf', () => {
      it('should work', () => {
        function template(context: any, cm: boolean) {
          if (cm) {
            elementStart(0, 'p', null, [DirectiveWithVCRef]);
            elementEnd();
          }
        }

        renderToHtml(template, {});
        create('A');
        create('B');
        create('C');
        renderToHtml(template, {});
        
        let viewRef = directiveInstance!.vcref.get(0);
        expect(directiveInstance!.vcref.indexOf(viewRef!)).toEqual(0);

        viewRef = directiveInstance!.vcref.get(1);
        expect(directiveInstance!.vcref.indexOf(viewRef!)).toEqual(1);

        viewRef = directiveInstance!.vcref.get(2);
        expect(directiveInstance!.vcref.indexOf(viewRef!)).toEqual(2);
      });

      it('should handle out of bounds cases', () => {
        function template(context: any, cm: boolean) {
          if (cm) {
            elementStart(0, 'p', null, [DirectiveWithVCRef]);
            elementEnd();
          }
        }

        renderToHtml(template, {});
        create('A');
        renderToHtml(template, {});
        
        expect(directiveInstance!.vcref.get(-1)).toBeNull();
        expect(directiveInstance!.vcref.get(42)).toBeNull();

        const viewRef = directiveInstance!.vcref.get(0);
        directiveInstance!.vcref.remove(0);
        expect(directiveInstance!.vcref.indexOf(viewRef!)).toEqual(-1);
      });
    });

    describe('move', () => {
      it('should work', () => {
        function template(context: any, cm: boolean) {
          if (cm) {
            elementStart(0, 'p', null, [DirectiveWithVCRef]);
            elementEnd();
          }
        }

        renderToHtml(template, {});
        create('A');
        create('B');
        create('C');
        renderToHtml(template, {});
        containerEl.childNodes[1].nodeValue = '**A**'
        
        let viewRef = directiveInstance!.vcref.get(0);
        directiveInstance!.vcref.move(viewRef!, 2)
        expect(renderToHtml(template, {})).toEqual('<p></p>BC**A**');

        directiveInstance!.vcref.move(viewRef!, 0)
        expect(renderToHtml(template, {})).toEqual('<p></p>**A**BC');

        directiveInstance!.vcref.move(viewRef!, 1)
        expect(renderToHtml(template, {})).toEqual('<p></p>B**A**C');

        expect(() => {directiveInstance!.vcref.move(viewRef!, -1)}).toThrow();
        expect(() => {directiveInstance!.vcref.move(viewRef!, 42)}).toThrow();
      });
    });
  });

  it('should insert embedded view in the right location (on an element)', () => {
    @Component({
      template: `
        <ng-template #foo>
          <span>{{name}}</span>
        </ng-template>
        <header [vcref]="foo" [name]="name">blah</header>
        <footer></footer>
      `
    })
    class SomeComponent {
      name: string = 'bar';
      static ngComponentDef = defineComponent({
        type: SomeComponent,
        tag: 'some-cmp',
        factory: () => new SomeComponent(),
        template: (cmp: SomeComponent, cm: boolean) => {
          if (cm) {
            store(0, createTemplateRef((ctx: any, cm: boolean) => {
              if (cm) {
                elementStart(0, 'span');
                  text(1);
                elementEnd();
              }
              textBinding(1, ctx.name);
            }));
            elementStart(1, 'header', null, [DirectiveVCRef]);
              text(2, 'blah');
            elementEnd();
            elementStart(3, 'footer');
            elementEnd();
            
          }
          const foo = load(0);
          elementProperty(1, 'vcref', bind(foo));
          elementProperty(1, 'name', bind(cmp.name));
        }
      });
    }

    const someCmp = renderComponent(SomeComponent);
    expect(toHtml(someCmp)).toEqual('<header>blah</header><span>bar</span><footer></footer>');

    someCmp.name = 'baz';
    tick(someCmp);
    expect(toHtml(someCmp)).toEqual('<header>blah</header><span>baz</span><footer></footer>');
  });

  it('should insert embedded view in the right location (on an component)', () => {
    @Component({
      selector: 'child',
      template: `
        <p>{{name}}</p>
      `
    })
    class ChildComponent {
      name: string = 'bar';
      static ngComponentDef = defineComponent({
        type: ChildComponent,
        tag: 'child',
        factory: () => new ChildComponent(),
        template: (cmp: ChildComponent, cm: boolean) => {
          if (cm) {
            elementStart(0, 'p');
              text(1);
            elementEnd();
          }
          textBinding(1, interpolation1('', cmp.name, ''));
        },
        inputs: {name: 'name'}
      });
    }

    @Component({
      template: `
        <ng-template #foo>
          <span>{{name}}</span>
        </ng-template>
        <child [vcref]="foo" [name]="name"></child>
        <child [name]="name"></child>
      `
    })
    class SomeComponent {
      name: string = 'bar';
      static ngComponentDef = defineComponent({
        type: SomeComponent,
        tag: 'some-cmp',
        factory: () => new SomeComponent(),
        template: (cmp: SomeComponent, cm: boolean) => {
          if (cm) {
            store(0, createTemplateRef((ctx: any, cm: boolean) => {
              if (cm) {
                elementStart(0, 'span');
                  text(1);
                elementEnd();
              }
              textBinding(1, ctx.name);
            }));
            elementStart(1, ChildComponent, null, [DirectiveVCRef]);
            elementEnd();
            elementStart(2, ChildComponent);
            elementEnd();
          }
          const foo = load(0);
          elementProperty(1, 'vcref', bind(foo));
          elementProperty(1, 'name', bind(cmp.name));
          elementProperty(2, 'name', bind(cmp.name));
        }
      });
    }

    const someCmp = renderComponent(SomeComponent);
    expect(toHtml(someCmp)).toEqual('<child><p>bar</p></child><span>bar</span><child><p>bar</p></child>');

    someCmp.name = 'baz';
    tick(someCmp);
    expect(toHtml(someCmp)).toEqual('<child><p>baz</p></child><span>baz</span><child><p>baz</p></child>');
  });

  describe('projection', () => {
    @Component({
      selector: 'child',
      template: '<div><ng-content></ng-content></div>'
    })
    class Child {
      static ngComponentDef = defineComponent({
        type: Child,
        tag: 'child',
        factory: () => new Child(),
        template: (cmp: Child, cm: boolean) => {
          if (cm) {
            projectionDef(0);
            elementStart(1, 'div');
            { projection(2, 0); }
            elementEnd();
          }
        }
      });
    }

    @Component({
      selector: 'child-with-selector',
      template: `
        <first><ng-content select="header"></ng-content></first>
        <second><ng-content select="header"></ng-content></second>`
    })
    class ChildWithSelector {
      static ngComponentDef = defineComponent({
        type: ChildWithSelector,
        tag: 'child-with-selector',
        factory: () => new ChildWithSelector(),
        template: (cmp: ChildWithSelector, cm: boolean) => {
          if (cm) {
            projectionDef(0, [[[['header'], null]]], ['header']);
            elementStart(1, 'first');
            { projection(2, 0, 1); }
            elementEnd();
            elementStart(3, 'second');
            { projection(4, 0); }
            elementEnd();
          }
        }
      });
    }

    it('should project the ViewContainerRef content along its host', () => {
      @Component({
        selector: 'parent',
        template: `
          <ng-template #foo>
              <span>{{name}}</span>
            </ng-template>
          <child><header [vcref]="foo" [name]="name">blah</header></child>`
      })
      class Parent {
        name: string = 'bar';
        static ngComponentDef = defineComponent({
          type: Parent,
          tag: 'parent',
          factory: () => new Parent(),
          template: (cmp: Parent, cm: boolean) => {
            if (cm) {
              store(0, createTemplateRef((ctx: any, cm: boolean) => {
                if (cm) {
                  elementStart(0, 'span');
                    text(1);
                  elementEnd();
                }
                textBinding(1, ctx.name);
              }));
              elementStart(1, Child);
                elementStart(2, 'header', null, [DirectiveVCRef]);
                  text(3, 'blah');
                elementEnd();
              elementEnd();
            }
            const foo = load(0);
            elementProperty(2, 'vcref', bind(foo));
            elementProperty(2, 'name', bind(cmp.name));
          }
        });
      }

      const parent = renderComponent(Parent);
      expect(toHtml(parent)).toEqual('<child><div><header>blah</header><span>bar</span></div></child>');
    });

    it('should project the ViewContainerRef content along its host, when there is a matching selector', () => {
      @Component({
        selector: 'parent',
        template: `
          <ng-template #foo>
              <span>{{name}}</span>
            </ng-template>
          <child-with-selector><header [vcref]="foo" [name]="name">blah</header></child-with-selector>`
      })
      class Parent {
        name: string = 'bar';
        static ngComponentDef = defineComponent({
          type: Parent,
          tag: 'parent',
          factory: () => new Parent(),
          template: (cmp: Parent, cm: boolean) => {
            if (cm) {
              store(0, createTemplateRef((ctx: any, cm: boolean) => {
                if (cm) {
                  elementStart(0, 'span');
                    text(1);
                  elementEnd();
                }
                textBinding(1, ctx.name);
              }));
              elementStart(1, ChildWithSelector);
                elementStart(2, 'header', null, [DirectiveVCRef]);
                  text(3, 'blah');
                elementEnd();
              elementEnd();
            }
            const foo = load(0);
            elementProperty(2, 'vcref', bind(foo));
            elementProperty(2, 'name', bind(cmp.name));
          }
        });
      }

      const parent = renderComponent(Parent);
      expect(toHtml(parent)).toEqual('<child-with-selector><first><header>blah</header><span>bar</span></first><second></second></child-with-selector>');
    });

    it('should not project the ViewContainerRef content, when there is no matching selector', () => {
      @Component({
        selector: 'parent',
        template: `
          <ng-template #foo>
              <span>{{name}}</span>
            </ng-template>
          <child-with-selector><footer [vcref]="foo" [name]="name">blah</footer></child-with-selector>`
      })
      class Parent {
        name: string = 'bar';
        static ngComponentDef = defineComponent({
          type: Parent,
          tag: 'parent',
          factory: () => new Parent(),
          template: (cmp: Parent, cm: boolean) => {
            if (cm) {
              store(0, createTemplateRef((ctx: any, cm: boolean) => {
                if (cm) {
                  elementStart(0, 'span');
                    text(1);
                  elementEnd();
                }
                textBinding(1, ctx.name);
              }));
              elementStart(1, ChildWithSelector);
                elementStart(2, 'footer', null, [DirectiveVCRef]);
                  text(3, 'blah');
                elementEnd();
              elementEnd();
            }
            const foo = load(0);
            elementProperty(2, 'vcref', bind(foo));
            elementProperty(2, 'name', bind(cmp.name));
          }
        });
      }

      const parent = renderComponent(Parent);
      expect(toHtml(parent)).toEqual('<child-with-selector><first></first><second><footer>blah</footer><span>bar</span></second></child-with-selector>');
    });
  });

  describe('Pawel', () => {
    it('should add embedded view into a view container on elements', () => {

      let directiveInstance: Directive;
  
      class Directive {
        static ngDirectiveDef = defineDirective({
          type: Directive,
          factory: () => directiveInstance = new Directive(injectViewContainerRef()),
          inputs: {tpl: 'tpl'}
        });
  
        tpl: TemplateRef<{}>;
  
        constructor(private _vcRef: ViewContainerRef) {}
  
        insertTpl(ctx?: {}) {
          this._vcRef.createEmbeddedView(this.tpl, ctx);
        }
  
        clear() {
          this._vcRef.clear();
        }
      }
  
      function EmbeddedTemplate(ctx: any, cm: boolean) {
        if (cm) {
          text(0, 'From a template.');
        }
      }
  
      /**
       * <ng-template #tpl>From a template<ng-template>
       * before
       * <div directive [tpl]="tpl"></div>
       * after
       */
      function Template(ctx: any, cm: boolean) {
        if (cm) {
           container(0, [], EmbeddedTemplate);
           text(1, 'before');
           elementStart(2, 'div', null, [Directive]);
           elementEnd();
           text(3, 'after');
        }
        const tpl = getOrCreateTemplateRef(getOrCreateNodeInjectorForNode(load(0))); // TODO(pk): we need proper design / spec for this
        elementProperty(2, 'tpl', bind(tpl));
      }
  
      expect(renderToHtml(Template, {})).toEqual('before<div></div>after');
  
      directiveInstance!.insertTpl();
      expect(renderToHtml(Template, {})).toEqual('before<div></div>From a template.after');
  
      directiveInstance!.insertTpl();
      expect(renderToHtml(Template, {})).toEqual('before<div></div>From a template.From a template.after');
  
      directiveInstance!.clear();
      expect(renderToHtml(Template, {})).toEqual('before<div></div>after');
    });
  
    it('should add embedded view into a view container on ng-template', () => {
      let directiveInstance: Directive;
  
      class Directive {
        static ngDirectiveDef = defineDirective({
          type: Directive,
          factory: () => directiveInstance = new Directive(injectViewContainerRef(), injectTemplateRef())
        });
  
        constructor(private _vcRef: ViewContainerRef, private _tplRef: TemplateRef<{}>) {}
  
        insertTpl(ctx: {}) {
          this._vcRef.createEmbeddedView(this._tplRef, ctx);
        }
  
        remove(index?: number) {
          this._vcRef.remove(index);
        }
      }
  
      function EmbeddedTemplate(ctx: any, cm: boolean) {
        if (cm) {
          text(0);
        }
        textBinding(0, interpolation1('Hello, ', ctx.name, ''));
      }
  
      /**
       * before|<ng-template directive>Hello, {{name}}<ng-template>|after
       */
      function Template(ctx: any, cm: boolean) {
        if (cm) {
           text(0, 'before|');
           container(1, [Directive], EmbeddedTemplate);
           text(2, '|after');
        }
      }
  
      expect(renderToHtml(Template, {})).toEqual('before||after');
  
      directiveInstance!.insertTpl({name: 'World'});
      expect(renderToHtml(Template, {})).toEqual('before|Hello, World|after');
  
      directiveInstance!.remove(0);
      expect(renderToHtml(Template, {})).toEqual('before||after');
    });
  });

  describe('life cycle hooks', () => {
    const log: string[] = [];
    it('should work with embedded views', () => {
      @Component({
        selector: 'hooks',
        template: `{{name}}`
      })
      class ComponentWithHooks {
        name: string;
        ngDoCheck() {
          log.push(this.name);
        }

        static ngComponentDef = defineComponent({
          type: ComponentWithHooks,
          tag: 'hooks',
          factory: () => new ComponentWithHooks(),
          template: (cmp: ComponentWithHooks, cm: boolean) => {
            if (cm) {
              text(0);
            }
            textBinding(0, interpolation1('', cmp.name, ''))
          },
          inputs: {name: 'name'}
        });
      }

      @Component({
        template: `
          <ng-template #foo>
            <hooks [name]="'C'"></hooks>
          </ng-template>
          <hooks [vcref]="foo" [name]="'A'"></hooks>
          <hooks [name]="'B'"></hooks>
        `
      })
      class SomeComponent {
        static ngComponentDef = defineComponent({
          type: SomeComponent,
          tag: 'some-cmp',
          factory: () => new SomeComponent(),
          template: (cmp: SomeComponent, cm: boolean) => {
            if (cm) {
              store(0, createTemplateRef((ctx: any, cm: boolean) => {
                if (cm) {
                  elementStart(0, ComponentWithHooks);
                  elementEnd();
                }
                elementProperty(0, 'name', bind('C'));
              }));
              elementStart(1, ComponentWithHooks, null, [DirectiveVCRef]);
              elementEnd();
              elementStart(2, ComponentWithHooks);
              elementEnd();
              
            }
            const foo = load(0);
            elementProperty(1, 'vcref', bind(foo));
            elementProperty(1, 'name', bind('A'));
            elementProperty(2, 'name', bind('B'));
          }
        });
      }
  
      const someCmp = renderComponent(SomeComponent);
      expect(toHtml(someCmp)).toEqual('<hooks>A</hooks><hooks>C</hooks><hooks>B</hooks>');
      expect(log).toEqual(['A', 'B', 'C']);

      tick(someCmp);
      expect(log).toEqual(['A', 'B', 'C', 'A', 'B', 'C']);
    });
  });
});
