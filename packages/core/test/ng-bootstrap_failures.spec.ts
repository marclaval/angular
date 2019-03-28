/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Component, ComponentFactoryResolver, ElementRef, Injector, OnInit, Renderer2, TemplateRef, ViewChild, ViewContainerRef} from '@angular/core';
import {NgModule} from '@angular/core/src/core';
import {TestBed} from '@angular/core/testing';

// These tests pass in View Engine, but fail in Ivy
fdescribe('ng-bootstrap failures in Ivy -', () => {
  it('DOM manipulation through Renderer2 are not registered on the debug elements', () => {

    @Component({selector: 'test-component', template: `foo`})
    class TestComponent implements OnInit {
      count = 0;
      constructor(private renderer: Renderer2, private elementRef: ElementRef) {}

      ngOnInit() {
        this.renderer.listen(this.elementRef.nativeElement, 'click', () => { this.count++; });
      }
    }

    TestBed.configureTestingModule({declarations: [TestComponent]});
    const fixture = TestBed.createComponent(TestComponent);
    fixture.detectChanges();

    fixture.debugElement.triggerEventHandler('click', {});

    expect(fixture.componentInstance.count).toEqual(1);
  });

  it('entry component issue', () => {
    @Component({selector: 'other-component', template: `bar`})
    class OtherComponent {
    }

    @NgModule({
      declarations: [OtherComponent],
      exports: [OtherComponent],
      entryComponents: [OtherComponent]
    })
    class OtherModule {
    }

    @Component({selector: 'test_component', template: `foo`, entryComponents: [OtherComponent]})
    class TestComponent {
    }

    // Throws `Error: Component OtherComponent is not part of any NgModule or the module has not
    // been imported into your module`
    expect(() => {
      TestBed.configureTestingModule({declarations: [TestComponent], imports: [OtherModule]});
      TestBed.createComponent(TestComponent);
    }).not.toThrow();
  });

  !isNode && it('select/option issue', () => {
    @Component({
      selector: 'test-component',
      template: `
    <select [value]="index">
      <option *ngFor="let i of [0,1,2,3,4,5,6,7,8,9]" [value]="i"></option>
    </select>`
    })
    class TestComponent {
      index = 7;
    }

    TestBed.configureTestingModule({declarations: [TestComponent]});
    const fixture = TestBed.createComponent(TestComponent);
    fixture.detectChanges();

    // In Ivy: Expected '0' to equal '7'
    // Because the value binding on <select> is applied before the <option> elements are created
    expect(fixture.debugElement.nativeElement.firstChild.value).toEqual('7');
  });

  it('ViewContainerRef issue', () => {
    @Component({
      selector: 'dynamic-component',
      template: `
    <span>Dynamic</span>
    <div><ng-content></ng-content></div>`
    })
    class DynamicComponent {
    }

    @Component({
      selector: 'test-component',
      template: `
    <ng-template #t>Hello!</ng-template>
    <span>Root</span>`
    })
    class TestComponent implements OnInit {
      @ViewChild('t', {static: true}) tpl: TemplateRef<any>|null = null;

      constructor(
          private vcref: ViewContainerRef, private cfr: ComponentFactoryResolver,
          private injector: Injector) {}

      ngOnInit() {
        if (this.tpl) {
          const viewRef = this.vcref.createEmbeddedView(this.tpl);
          this.vcref.createComponent(
              this.cfr.resolveComponentFactory(DynamicComponent), 0, this.injector,
              [viewRef.rootNodes]);
        }
      }
    }

    @NgModule({
      declarations: [TestComponent, DynamicComponent],
      entryComponents: [TestComponent, DynamicComponent]
    })
    class RootModule {
    }

    TestBed.configureTestingModule({imports: [RootModule]});
    const fixture = TestBed.createComponent(TestComponent);
    fixture.detectChanges();

    // In Ivy: Error: Failed to execute 'insertBefore' on 'Node': The node before which the new node
    // is to be inserted is not a child of this node.
    // ViewContainerRef.createComponent() is failing because the native nodes of the embedded view
    // have been moved in the DOM through projection.
    expect(fixture.nativeElement.parentElement.innerHTML)
        .toContain(
            '<div id="root0" ng-version="0.0.0-PLACEHOLDER"><!----><span>Root</span></div><dynamic-component><span>Dynamic</span><div>Hello!</div></dynamic-component>');
  });

});