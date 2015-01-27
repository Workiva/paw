"format register";
(function(global) {

  var defined = {};

  // indexOf polyfill for IE8
  var indexOf = Array.prototype.indexOf || function(item) {
    for (var i = 0, l = this.length; i < l; i++)
      if (this[i] === item)
        return i;
    return -1;
  }

  function dedupe(deps) {
    var newDeps = [];
    for (var i = 0, l = deps.length; i < l; i++)
      if (indexOf.call(newDeps, deps[i]) == -1)
        newDeps.push(deps[i])
    return newDeps;
  }

  function register(name, deps, declare, execute) {
    if (typeof name != 'string')
      throw "System.register provided no module name";
    
    var entry;

    // dynamic
    if (typeof declare == 'boolean') {
      entry = {
        declarative: false,
        deps: deps,
        execute: execute,
        executingRequire: declare
      };
    }
    else {
      // ES6 declarative
      entry = {
        declarative: true,
        deps: deps,
        declare: declare
      };
    }

    entry.name = name;
    
    // we never overwrite an existing define
    if (!defined[name])
      defined[name] = entry; 

    entry.deps = dedupe(entry.deps);

    // we have to normalize dependencies
    // (assume dependencies are normalized for now)
    // entry.normalizedDeps = entry.deps.map(normalize);
    entry.normalizedDeps = entry.deps;
  }

  function buildGroups(entry, groups) {
    groups[entry.groupIndex] = groups[entry.groupIndex] || [];

    if (indexOf.call(groups[entry.groupIndex], entry) != -1)
      return;

    groups[entry.groupIndex].push(entry);

    for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
      var depName = entry.normalizedDeps[i];
      var depEntry = defined[depName];
      
      // not in the registry means already linked / ES6
      if (!depEntry || depEntry.evaluated)
        continue;
      
      // now we know the entry is in our unlinked linkage group
      var depGroupIndex = entry.groupIndex + (depEntry.declarative != entry.declarative);

      // the group index of an entry is always the maximum
      if (depEntry.groupIndex === undefined || depEntry.groupIndex < depGroupIndex) {
        
        // if already in a group, remove from the old group
        if (depEntry.groupIndex) {
          groups[depEntry.groupIndex].splice(indexOf.call(groups[depEntry.groupIndex], depEntry), 1);

          // if the old group is empty, then we have a mixed depndency cycle
          if (groups[depEntry.groupIndex].length == 0)
            throw new TypeError("Mixed dependency cycle detected");
        }

        depEntry.groupIndex = depGroupIndex;
      }

      buildGroups(depEntry, groups);
    }
  }

  function link(name) {
    var startEntry = defined[name];

    startEntry.groupIndex = 0;

    var groups = [];

    buildGroups(startEntry, groups);

    var curGroupDeclarative = !!startEntry.declarative == groups.length % 2;
    for (var i = groups.length - 1; i >= 0; i--) {
      var group = groups[i];
      for (var j = 0; j < group.length; j++) {
        var entry = group[j];

        // link each group
        if (curGroupDeclarative)
          linkDeclarativeModule(entry);
        else
          linkDynamicModule(entry);
      }
      curGroupDeclarative = !curGroupDeclarative; 
    }
  }

  // module binding records
  var moduleRecords = {};
  function getOrCreateModuleRecord(name) {
    return moduleRecords[name] || (moduleRecords[name] = {
      name: name,
      dependencies: [],
      exports: {}, // start from an empty module and extend
      importers: []
    })
  }

  function linkDeclarativeModule(entry) {
    // only link if already not already started linking (stops at circular)
    if (entry.module)
      return;

    var module = entry.module = getOrCreateModuleRecord(entry.name);
    var exports = entry.module.exports;

    var declaration = entry.declare.call(global, function(name, value) {
      module.locked = true;
      exports[name] = value;

      for (var i = 0, l = module.importers.length; i < l; i++) {
        var importerModule = module.importers[i];
        if (!importerModule.locked) {
          var importerIndex = indexOf.call(importerModule.dependencies, module);
          importerModule.setters[importerIndex](exports);
        }
      }

      module.locked = false;
      return value;
    });
    
    module.setters = declaration.setters;
    module.execute = declaration.execute;

    if (!module.setters || !module.execute)
      throw new TypeError("Invalid System.register form for " + entry.name);

    // now link all the module dependencies
    for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
      var depName = entry.normalizedDeps[i];
      var depEntry = defined[depName];
      var depModule = moduleRecords[depName];

      // work out how to set depExports based on scenarios...
      var depExports;

      if (depModule) {
        depExports = depModule.exports;
      }
      else if (depEntry && !depEntry.declarative) {
        depExports = { 'default': depEntry.module.exports, __useDefault: true };
      }
      // in the module registry
      else if (!depEntry) {
        depExports = load(depName);
      }
      // we have an entry -> link
      else {
        linkDeclarativeModule(depEntry);
        depModule = depEntry.module;
        depExports = depModule.exports;
      }

      // only declarative modules have dynamic bindings
      if (depModule && depModule.importers) {
        depModule.importers.push(module);
        module.dependencies.push(depModule);
      }
      else
        module.dependencies.push(null);

      // run the setter for this dependency
      if (module.setters[i])
        module.setters[i](depExports);
    }
  }

  // An analog to loader.get covering execution of all three layers (real declarative, simulated declarative, simulated dynamic)
  function getModule(name) {
    var exports;
    var entry = defined[name];

    if (!entry) {
      exports = load(name);
      if (!exports)
        throw new Error("Unable to load dependency " + name + ".");
    }

    else {
      if (entry.declarative)
        ensureEvaluated(name, []);
    
      else if (!entry.evaluated)
        linkDynamicModule(entry);

      exports = entry.module.exports;
    }

    if ((!entry || entry.declarative) && exports && exports.__useDefault)
      return exports['default'];

    return exports;
  }

  function linkDynamicModule(entry) {
    if (entry.module)
      return;

    var exports = {};

    var module = entry.module = { exports: exports, id: entry.name };

    // AMD requires execute the tree first
    if (!entry.executingRequire) {
      for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
        var depName = entry.normalizedDeps[i];
        var depEntry = defined[depName];
        if (depEntry)
          linkDynamicModule(depEntry);
      }
    }

    // now execute
    entry.evaluated = true;
    var output = entry.execute.call(global, function(name) {
      for (var i = 0, l = entry.deps.length; i < l; i++) {
        if (entry.deps[i] != name)
          continue;
        return getModule(entry.normalizedDeps[i]);
      }
      throw new TypeError('Module ' + name + ' not declared as a dependency.');
    }, exports, module);
    
    if (output)
      module.exports = output;
  }

  /*
   * Given a module, and the list of modules for this current branch,
   *  ensure that each of the dependencies of this module is evaluated
   *  (unless one is a circular dependency already in the list of seen
   *  modules, in which case we execute it)
   *
   * Then we evaluate the module itself depth-first left to right 
   * execution to match ES6 modules
   */
  function ensureEvaluated(moduleName, seen) {
    var entry = defined[moduleName];

    // if already seen, that means it's an already-evaluated non circular dependency
    if (entry.evaluated || !entry.declarative)
      return;

    // this only applies to declarative modules which late-execute

    seen.push(moduleName);

    for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
      var depName = entry.normalizedDeps[i];
      if (indexOf.call(seen, depName) == -1) {
        if (!defined[depName])
          load(depName);
        else
          ensureEvaluated(depName, seen);
      }
    }

    if (entry.evaluated)
      return;

    entry.evaluated = true;
    entry.module.execute.call(global);
  }

  // magical execution function
  var modules = {};
  function load(name) {
    if (modules[name])
      return modules[name];

    var entry = defined[name];

    // first we check if this module has already been defined in the registry
    if (!entry)
      throw "Module " + name + " not present.";

    // recursively ensure that the module and all its 
    // dependencies are linked (with dependency group handling)
    link(name);

    // now handle dependency execution in correct order
    ensureEvaluated(name, []);

    // remove from the registry
    defined[name] = undefined;

    var module = entry.declarative ? entry.module.exports : { 'default': entry.module.exports, '__useDefault': true };

    // return the defined module object
    return modules[name] = module;
  };

  return function(main, declare) {

    var System;

    // if there's a system loader, define onto it
    if (typeof System != 'undefined' && System.register) {
      declare(System);
      System['import'](main);
    }
    // otherwise, self execute
    else {
      declare(System = {
        register: register, 
        get: load, 
        set: function(name, module) {
          modules[name] = module; 
        },
        newModule: function(module) {
          return module;
        },
        global: global 
      });
      load(main);
    }
  };

})(typeof window != 'undefined' ? window : global)
/* ('mainModule', function(System) {
  System.register(...);
}); */
('build/src/PawGlobal', function(System) {




System.register("build/src/WheelEventSimulator", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  function CustomEventPolyfill(event, params) {
    params = params || {
      bubbles: false,
      cancelable: false,
      detail: undefined
    };
    var evt = document.createEvent('CustomEvent');
    evt.initCustomEvent(event, params.bubbles, params.cancelable, params.detail);
    return evt;
  }
  function polyfillCustomEventConstructor() {
    try {
      return new CustomEvent('?');
    } catch (error) {
      CustomEventPolyfill.prototype = window.Event.prototype;
      window.CustomEvent = CustomEventPolyfill;
    }
  }
  polyfillCustomEventConstructor();
  var defaultDependencies = {window: window};
  function detectMouseWheelEvent(document) {
    if ('onwheel' in document || document.documentMode >= 9) {
      return 'wheel';
    } else if ('onmousewheel' in document) {
      return 'mousewheel';
    } else {
      return 'DOMMouseScroll';
    }
  }
  var WheelEventSimulator = function(dependencies) {
    dependencies = dependencies || {};
    var settings = {window: dependencies.window || defaultDependencies.window};
    this.window = settings.window;
    this.eventName = detectMouseWheelEvent(settings.window.document);
  };
  WheelEventSimulator.prototype = {dispatch: function(targetOrPoint, options) {
      options = options || {};
      var settings = {
        deltaX: options.deltaX || 0,
        deltaY: options.deltaY || 0
      };
      var evt;
      var eventName = this.eventName;
      if (eventName === 'wheel') {
        evt = new CustomEvent(eventName, {
          bubbles: true,
          cancelable: true
        });
        evt.delta = settings.deltaX || settings.deltaY;
        evt.deltaX = settings.deltaX;
        evt.deltaY = settings.deltaY;
        evt.deltaZ = 0;
        evt.deltaMode = 0x00;
      } else if (eventName === 'mousewheel') {
        evt = new CustomEvent(eventName);
        evt.wheelDelta = -(settings.deltaX || settings.deltaY);
        evt.wheelDeltaX = -settings.deltaX;
        evt.wheelDeltaY = -settings.deltaY;
      } else {
        throw new Error('Your browser is not supported by WheelEventSimulator.');
      }
      var target;
      if (targetOrPoint instanceof HTMLElement) {
        target = targetOrPoint;
      } else {
        target = document.elementFromPoint(targetOrPoint.x, targetOrPoint.y);
      }
      target.dispatchEvent(evt);
    }};
  module.exports = WheelEventSimulator;
  global.define = __define;
  return module.exports;
});



System.register("build/src/ViewportRelative", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var supportedWords = {
    'x': {
      'left': 0,
      'right': 1,
      'center': 0.5
    },
    'y': {
      'top': 0,
      'bottom': 1,
      'center': 0.5
    }
  };
  function normalizePoint(point) {
    if (!point) {
      point = {
        x: 'center',
        y: 'center'
      };
    }
    if (typeof(point) === 'string') {
      var pointSplit = point.trim().split(/\s+/g);
      point = {
        x: (pointSplit[0]).toLowerCase(),
        y: (pointSplit[1] || '').toLowerCase()
      };
      point.y = point.y || 'center';
    }
    return point;
  }
  function isOrderReversed(point) {
    var xVal = supportedWords.x[point.x];
    var yVal = supportedWords.y[point.y];
    var yRevVal = supportedWords.y[point.x];
    var xRevVal = supportedWords.x[point.y];
    var xIsX = xVal === 1 || xVal === 0;
    var yIsY = yVal === 1 || yVal === 0;
    var xIsY = yRevVal === 1 || yRevVal === 0;
    var yIsX = xRevVal === 1 || xRevVal === 0;
    if (xVal === 0.5) {
      xIsX = null;
    }
    if (yVal === 0.5) {
      yIsY = null;
    }
    if (xRevVal === 0.5) {
      yIsX = null;
    }
    if (yRevVal === 0.5) {
      xIsY = null;
    }
    if (xIsY === true && !yIsY) {
      return true;
    }
    if (yIsX === true && !xIsY) {
      return true;
    }
    return false;
  }
  function valueToPixels(maybeRelativeValue, axis, viewportDimensions) {
    var type = typeof(maybeRelativeValue);
    var max;
    var percent;
    var result;
    var wordMultiplier;
    if (type === 'number') {
      return maybeRelativeValue;
    }
    var num = Number(maybeRelativeValue);
    if (!isNaN(num)) {
      return num;
    }
    if (!viewportDimensions || typeof viewportDimensions !== 'object') {
      return undefined;
    }
    if (!(viewportDimensions.width >= 0 && viewportDimensions.height >= 0)) {
      return undefined;
    }
    if (!(axis === 'x' || axis === 'y')) {
      return undefined;
    }
    if (type === 'string') {
      maybeRelativeValue = maybeRelativeValue.trim().toLowerCase();
      max = axis === 'x' ? viewportDimensions.width : viewportDimensions.height;
      if (maybeRelativeValue.indexOf('%') === maybeRelativeValue.length - 1) {
        maybeRelativeValue = maybeRelativeValue.replace('%', '');
        percent = Number(maybeRelativeValue) / 100.0;
        if (isNaN(percent)) {
          return undefined;
        }
        result = Math.round(max * percent * 1000) / 1000;
      } else if (maybeRelativeValue.indexOf('px') === maybeRelativeValue.length - 2) {
        maybeRelativeValue = maybeRelativeValue.replace('px', '');
        result = Number(maybeRelativeValue);
        if (isNaN(result)) {
          return undefined;
        }
      } else {
        wordMultiplier = supportedWords[axis][maybeRelativeValue];
        if (wordMultiplier !== undefined) {
          result = wordMultiplier * max;
        } else {
          maybeRelativeValue = Number(maybeRelativeValue);
          if (!isNaN(maybeRelativeValue)) {
            result = maybeRelativeValue;
          }
        }
      }
    }
    return result;
  }
  function pointToPixels(point, viewportDimensions) {
    point = normalizePoint(point);
    var xAxis = 'x';
    var yAxis = 'y';
    var reversed = isOrderReversed(point);
    if (reversed) {
      xAxis = 'y';
      yAxis = 'x';
    }
    var xVal = valueToPixels(point.x, xAxis, viewportDimensions);
    var yVal = valueToPixels(point.y, yAxis, viewportDimensions);
    if (reversed) {
      var temp = xVal;
      xVal = yVal;
      yVal = temp;
    }
    point.x = xVal;
    point.y = yVal;
    return point;
  }
  function pointToPercent(point, viewportDimensions) {
    point = normalizePoint(point);
    point.x = (point.x / viewportDimensions.width * 100);
    point.y = (point.y / viewportDimensions.height * 100);
    point.x = (Math.round(point.x * 1000) / 1000) + '%';
    point.y = (Math.round(point.y * 1000) / 1000) + '%';
    return point;
  }
  function pointToString(point) {
    if (!point) {
      return undefined;
    }
    if (point && point.x !== null && point.x !== undefined && point.y !== null && point.y !== undefined) {
      if (typeof point.x === 'number') {
        point.x = point.x + 'px';
      }
      if (typeof point.y === 'number') {
        point.y = point.y + 'px';
      }
      return point.x + ' ' + point.y;
    }
    return point;
  }
  module.exports = {
    normalizePoint: normalizePoint,
    isOrderReversed: isOrderReversed,
    valueToPixels: valueToPixels,
    pointToPixels: pointToPixels,
    pointToPercent: pointToPercent,
    pointToString: pointToString
  };
  global.define = __define;
  return module.exports;
});



System.register("build/src/Gestures", ["build/src/WheelEventSimulator"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var WheelEventSimulator = require("build/src/WheelEventSimulator");
  var Gestures = {
    touch: function(where) {
      where = where || this.getDefaultTouchLocation();
      this.setTouches(where);
      this._triggerStart();
    },
    addTouch: function(where) {
      if (!where) {
        throw new Error('"where" parameter can not be empty when adding a touch');
      }
      where = this._buildTouches(where);
      this.touches = this.touches.concat(where);
      this._triggerStart();
    },
    removeTouch: function(fingerNumber) {
      if (!this.touches.length) {
        return;
      }
      if (fingerNumber !== 0 && !fingerNumber) {
        fingerNumber = this.touches.length - 1;
      }
      if (0 <= fingerNumber && fingerNumber < this.touches.length) {
        this.touches.splice(fingerNumber, 1);
        this.clearTouchIndicators();
        this.indicateTouches(this.touches);
      }
    },
    move: function(toWhere) {
      if (!this.touches || this.touches.length === 0) {
        throw new Error('There are no current touches to move from.');
      }
      this.setTouches(toWhere);
      this._triggerMove();
    },
    drag: function(toWhere, duration, done) {
      var self = this;
      var deltas = [];
      var deltaX;
      var deltaY;
      var interval = 16;
      var segments;
      var k = 0;
      var i = 0;
      var point;
      var len = 0;
      duration = Math.max(0, duration >= 0 ? duration : this.getDefaultDuration());
      segments = Math.floor(duration / interval);
      if (duration === 0) {
        self.setTouches(toWhere);
        self._triggerMove();
        done();
      }
      var endWhere = self._buildTouches(toWhere);
      len = self.touches.length;
      for (i = 0; i < len; i++) {
        point = self.touches[i];
        if (i < endWhere.length) {
          deltaX = (endWhere[i].x - point.x) / segments;
          deltaY = (endWhere[i].y - point.y) / segments;
          deltas.push({
            x: deltaX,
            y: deltaY
          });
        }
      }
      function eachSegment() {
        if (k >= segments) {
          self.setTouches(endWhere);
          self._triggerMove();
          done();
          return;
        } else {
          for (i = 0; i < self.touches.length; i++) {
            self.touches[i].x += deltas[i].x;
            self.touches[i].y += deltas[i].y;
          }
          self._triggerMove();
          k++;
          setTimeout(eachSegment, interval);
        }
      }
      eachSegment();
    },
    release: function() {
      this._triggerEnd();
    },
    wait: function(duration, done) {
      duration = duration || this.getDefaultDuration();
      if (typeof(duration) !== 'number') {
        throw new TypeError('duration should be a number');
      }
      var start = Date.now();
      var end = start + duration;
      function checkDone() {
        var timeLeft = (end - Date.now());
        if (timeLeft <= 1) {
          done();
        } else {
          setTimeout(checkDone, timeLeft);
        }
      }
      setTimeout(checkDone, duration);
    },
    tap: function(where) {
      where = where || this.getDefaultTouchLocation();
      if (this.isTouchSupported) {
        this.touch(where).release();
      } else {
        this.click(where);
      }
    },
    doubleTap: function(where, msBetweenTaps, done) {
      msBetweenTaps = Number(msBetweenTaps) || this.getDefaultDoubleTapDuration();
      this.tap(where).wait(msBetweenTaps).tap(where).then(done);
    },
    hold: function(where, msToHold, done) {
      msToHold = Number(msToHold) || this.getDefaultDuration();
      this.touch(where).wait(msToHold).release().then(done);
    },
    click: function(where) {
      this.setTouches(where || this.getDefaultTouchLocation());
      this._triggerClick();
    },
    gesture: function(fromWhere, toWhere, duration, done) {
      this.touch(fromWhere).drag(toWhere, duration).release().then(done);
    },
    swipeUp: function(duration, done) {
      var def = this.getDefaultSwipeLocations();
      this.touch(def[1]).drag(def[0], duration).release().then(done);
    },
    swipeDown: function(duration, done) {
      var def = this.getDefaultSwipeLocations();
      this.touch(def[0]).drag(def[1], duration).release().then(done);
    },
    pinchOut: function(duration, done) {
      var def = this.getDefaultPinchLocations();
      this.touch(def[0]).drag(def[1], duration).release().then(done);
    },
    pinchIn: function(duration, done) {
      var def = this.getDefaultPinchLocations();
      this.touch(def[1]).drag(def[0], duration).release().then(done);
    },
    then: function(func, done) {
      if (func.length > 0) {
        func(done);
      } else {
        func();
        done();
      }
    },
    wheel: function(where, deltas, done) {
      where = this._buildTouches(where);
      var simulator = new WheelEventSimulator();
      simulator.dispatch(where[0], deltas);
      done();
    }
  };
  module.exports = Gestures;
  global.define = __define;
  return module.exports;
});



System.register("npm:collections@2.0.1/shim-function", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = Function;
  Function.noop = function() {};
  Function.identity = function(value) {
    return value;
  };
  Function.by = function(by, compare) {
    compare = compare || Object.compare;
    by = by || Function.identity;
    var compareBy = function(a, b) {
      return compare(by(a), by(b));
    };
    compareBy.compare = compare;
    compareBy.by = by;
    return compareBy;
  };
  Function.get = function(key) {
    return function(object) {
      return Object.get(object, key);
    };
  };
  global.define = __define;
  return module.exports;
});



System.register("npm:collections@2.0.1/generic-collection", ["npm:collections@2.0.1/shim-array"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  "use strict";
  module.exports = GenericCollection;
  function GenericCollection() {
    throw new Error("Can't construct. GenericCollection is a mixin.");
  }
  GenericCollection.prototype.addEach = function(values) {
    if (values && Object(values) === values) {
      if (typeof values.forEach === "function") {
        values.forEach(this.add, this);
      } else if (typeof values.length === "number") {
        for (var i = 0; i < values.length; i++) {
          this.add(values[i], i);
        }
      } else {
        Object.keys(values).forEach(function(key) {
          this.add(values[key], key);
        }, this);
      }
    }
    return this;
  };
  GenericCollection.prototype.deleteEach = function(values, equals) {
    values.forEach(function(value) {
      this["delete"](value, equals);
    }, this);
    return this;
  };
  GenericCollection.prototype.forEach = function(callback) {
    var thisp = arguments[1];
    return this.reduce(function(undefined, value, key, object, depth) {
      callback.call(thisp, value, key, object, depth);
    }, undefined);
  };
  GenericCollection.prototype.map = function(callback) {
    var thisp = arguments[1];
    var result = [];
    this.reduce(function(undefined, value, key, object, depth) {
      result.push(callback.call(thisp, value, key, object, depth));
    }, undefined);
    return result;
  };
  GenericCollection.prototype.enumerate = function(start) {
    if (start == null) {
      start = 0;
    }
    var result = [];
    this.reduce(function(undefined, value) {
      result.push([start++, value]);
    }, undefined);
    return result;
  };
  GenericCollection.prototype.group = function(callback, thisp, equals) {
    equals = equals || Object.equals;
    var groups = [];
    var keys = [];
    this.forEach(function(value, key, object) {
      var key = callback.call(thisp, value, key, object);
      var index = keys.indexOf(key, equals);
      var group;
      if (index === -1) {
        group = [];
        groups.push([key, group]);
        keys.push(key);
      } else {
        group = groups[index][1];
      }
      group.push(value);
    });
    return groups;
  };
  GenericCollection.prototype.toArray = function() {
    return this.map(Function.identity);
  };
  GenericCollection.prototype.toObject = function() {
    var object = {};
    this.reduce(function(undefined, value, key) {
      object[key] = value;
    }, undefined);
    return object;
  };
  GenericCollection.prototype.filter = function(callback) {
    var thisp = arguments[1];
    var result = this.constructClone();
    this.reduce(function(undefined, value, key, object, depth) {
      if (callback.call(thisp, value, key, object, depth)) {
        result.add(value, key);
      }
    }, undefined);
    return result;
  };
  GenericCollection.prototype.every = function(callback) {
    var thisp = arguments[1];
    var iterator = this.iterate();
    while (true) {
      var iteration = iterator.next();
      if (iteration.done) {
        return true;
      } else if (!callback.call(thisp, iteration.value, iteration.index, this)) {
        return false;
      }
    }
  };
  GenericCollection.prototype.some = function(callback) {
    var thisp = arguments[1];
    var iterator = this.iterate();
    while (true) {
      var iteration = iterator.next();
      if (iteration.done) {
        return false;
      } else if (callback.call(thisp, iteration.value, iteration.index, this)) {
        return true;
      }
    }
  };
  GenericCollection.prototype.min = function(compare) {
    compare = compare || this.contentCompare || Object.compare;
    var first = true;
    return this.reduce(function(result, value) {
      if (first) {
        first = false;
        return value;
      } else {
        return compare(value, result) < 0 ? value : result;
      }
    }, undefined);
  };
  GenericCollection.prototype.max = function(compare) {
    compare = compare || this.contentCompare || Object.compare;
    var first = true;
    return this.reduce(function(result, value) {
      if (first) {
        first = false;
        return value;
      } else {
        return compare(value, result) > 0 ? value : result;
      }
    }, undefined);
  };
  GenericCollection.prototype.sum = function(zero) {
    zero = zero === undefined ? 0 : zero;
    return this.reduce(function(a, b) {
      return a + b;
    }, zero);
  };
  GenericCollection.prototype.average = function(zero) {
    var sum = zero === undefined ? 0 : zero;
    var count = zero === undefined ? 0 : zero;
    this.reduce(function(undefined, value) {
      sum += value;
      count += 1;
    }, undefined);
    return sum / count;
  };
  GenericCollection.prototype.concat = function() {
    var result = this.constructClone(this);
    for (var i = 0; i < arguments.length; i++) {
      result.addEach(arguments[i]);
    }
    return result;
  };
  GenericCollection.prototype.flatten = function() {
    var self = this;
    return this.reduce(function(result, array) {
      array.forEach(function(value) {
        this.push(value);
      }, result, self);
      return result;
    }, []);
  };
  GenericCollection.prototype.zip = function() {
    var table = Array.prototype.slice.call(arguments);
    table.unshift(this);
    return Array.unzip(table);
  };
  GenericCollection.prototype.join = function(delimiter) {
    return this.reduce(function(result, string) {
      return result + delimiter + string;
    });
  };
  GenericCollection.prototype.sorted = function(compare, by, order) {
    compare = compare || this.contentCompare || Object.compare;
    if (compare.by) {
      by = compare.by;
      compare = compare.compare || this.contentCompare || Object.compare;
    } else {
      by = by || Function.identity;
    }
    if (order === undefined)
      order = 1;
    return this.map(function(item) {
      return {
        by: by(item),
        value: item
      };
    }).sort(function(a, b) {
      return compare(a.by, b.by) * order;
    }).map(function(pair) {
      return pair.value;
    });
  };
  GenericCollection.prototype.reversed = function() {
    return this.constructClone(this).reverse();
  };
  GenericCollection.prototype.clone = function(depth, memo) {
    if (depth === undefined) {
      depth = Infinity;
    } else if (depth === 0) {
      return this;
    }
    var clone = this.constructClone();
    this.forEach(function(value, key) {
      clone.add(Object.clone(value, depth - 1, memo), key);
    }, this);
    return clone;
  };
  GenericCollection.prototype.only = function() {
    if (this.length === 1) {
      return this.one();
    }
  };
  require("npm:collections@2.0.1/shim-array");
  global.define = __define;
  return module.exports;
});



System.register("npm:weak-map@1.0.5/weak-map", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  (function WeakMapModule() {
    "use strict";
    if (typeof ses !== 'undefined' && ses.ok && !ses.ok()) {
      return;
    }
    function weakMapPermitHostObjects(map) {
      if (map.permitHostObjects___) {
        map.permitHostObjects___(weakMapPermitHostObjects);
      }
    }
    if (typeof ses !== 'undefined') {
      ses.weakMapPermitHostObjects = weakMapPermitHostObjects;
    }
    var doubleWeakMapCheckSilentFailure = false;
    if (typeof WeakMap === 'function') {
      var HostWeakMap = WeakMap;
      if (typeof navigator !== 'undefined' && /Firefox/.test(navigator.userAgent)) {} else {
        var testMap = new HostWeakMap();
        var testObject = Object.freeze({});
        testMap.set(testObject, 1);
        if (testMap.get(testObject) !== 1) {
          doubleWeakMapCheckSilentFailure = true;
        } else {
          module.exports = WeakMap;
          return;
        }
      }
    }
    var hop = Object.prototype.hasOwnProperty;
    var gopn = Object.getOwnPropertyNames;
    var defProp = Object.defineProperty;
    var isExtensible = Object.isExtensible;
    var HIDDEN_NAME_PREFIX = 'weakmap:';
    var HIDDEN_NAME = HIDDEN_NAME_PREFIX + 'ident:' + Math.random() + '___';
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function' && typeof ArrayBuffer === 'function' && typeof Uint8Array === 'function') {
      var ab = new ArrayBuffer(25);
      var u8s = new Uint8Array(ab);
      crypto.getRandomValues(u8s);
      HIDDEN_NAME = HIDDEN_NAME_PREFIX + 'rand:' + Array.prototype.map.call(u8s, function(u8) {
        return (u8 % 36).toString(36);
      }).join('') + '___';
    }
    function isNotHiddenName(name) {
      return !(name.substr(0, HIDDEN_NAME_PREFIX.length) == HIDDEN_NAME_PREFIX && name.substr(name.length - 3) === '___');
    }
    defProp(Object, 'getOwnPropertyNames', {value: function fakeGetOwnPropertyNames(obj) {
        return gopn(obj).filter(isNotHiddenName);
      }});
    if ('getPropertyNames' in Object) {
      var originalGetPropertyNames = Object.getPropertyNames;
      defProp(Object, 'getPropertyNames', {value: function fakeGetPropertyNames(obj) {
          return originalGetPropertyNames(obj).filter(isNotHiddenName);
        }});
    }
    function getHiddenRecord(key) {
      if (key !== Object(key)) {
        throw new TypeError('Not an object: ' + key);
      }
      var hiddenRecord = key[HIDDEN_NAME];
      if (hiddenRecord && hiddenRecord.key === key) {
        return hiddenRecord;
      }
      if (!isExtensible(key)) {
        return void 0;
      }
      hiddenRecord = {key: key};
      try {
        defProp(key, HIDDEN_NAME, {
          value: hiddenRecord,
          writable: false,
          enumerable: false,
          configurable: false
        });
        return hiddenRecord;
      } catch (error) {
        return void 0;
      }
    }
    (function() {
      var oldFreeze = Object.freeze;
      defProp(Object, 'freeze', {value: function identifyingFreeze(obj) {
          getHiddenRecord(obj);
          return oldFreeze(obj);
        }});
      var oldSeal = Object.seal;
      defProp(Object, 'seal', {value: function identifyingSeal(obj) {
          getHiddenRecord(obj);
          return oldSeal(obj);
        }});
      var oldPreventExtensions = Object.preventExtensions;
      defProp(Object, 'preventExtensions', {value: function identifyingPreventExtensions(obj) {
          getHiddenRecord(obj);
          return oldPreventExtensions(obj);
        }});
    })();
    function constFunc(func) {
      func.prototype = null;
      return Object.freeze(func);
    }
    var calledAsFunctionWarningDone = false;
    function calledAsFunctionWarning() {
      if (!calledAsFunctionWarningDone && typeof console !== 'undefined') {
        calledAsFunctionWarningDone = true;
        console.warn('WeakMap should be invoked as new WeakMap(), not ' + 'WeakMap(). This will be an error in the future.');
      }
    }
    var nextId = 0;
    var OurWeakMap = function() {
      if (!(this instanceof OurWeakMap)) {
        calledAsFunctionWarning();
      }
      var keys = [];
      var values = [];
      var id = nextId++;
      function get___(key, opt_default) {
        var index;
        var hiddenRecord = getHiddenRecord(key);
        if (hiddenRecord) {
          return id in hiddenRecord ? hiddenRecord[id] : opt_default;
        } else {
          index = keys.indexOf(key);
          return index >= 0 ? values[index] : opt_default;
        }
      }
      function has___(key) {
        var hiddenRecord = getHiddenRecord(key);
        if (hiddenRecord) {
          return id in hiddenRecord;
        } else {
          return keys.indexOf(key) >= 0;
        }
      }
      function set___(key, value) {
        var index;
        var hiddenRecord = getHiddenRecord(key);
        if (hiddenRecord) {
          hiddenRecord[id] = value;
        } else {
          index = keys.indexOf(key);
          if (index >= 0) {
            values[index] = value;
          } else {
            index = keys.length;
            values[index] = value;
            keys[index] = key;
          }
        }
        return this;
      }
      function delete___(key) {
        var hiddenRecord = getHiddenRecord(key);
        var index,
            lastIndex;
        if (hiddenRecord) {
          return id in hiddenRecord && delete hiddenRecord[id];
        } else {
          index = keys.indexOf(key);
          if (index < 0) {
            return false;
          }
          lastIndex = keys.length - 1;
          keys[index] = void 0;
          values[index] = values[lastIndex];
          keys[index] = keys[lastIndex];
          keys.length = lastIndex;
          values.length = lastIndex;
          return true;
        }
      }
      return Object.create(OurWeakMap.prototype, {
        get___: {value: constFunc(get___)},
        has___: {value: constFunc(has___)},
        set___: {value: constFunc(set___)},
        delete___: {value: constFunc(delete___)}
      });
    };
    OurWeakMap.prototype = Object.create(Object.prototype, {
      get: {
        value: function get(key, opt_default) {
          return this.get___(key, opt_default);
        },
        writable: true,
        configurable: true
      },
      has: {
        value: function has(key) {
          return this.has___(key);
        },
        writable: true,
        configurable: true
      },
      set: {
        value: function set(key, value) {
          return this.set___(key, value);
        },
        writable: true,
        configurable: true
      },
      'delete': {
        value: function remove(key) {
          return this.delete___(key);
        },
        writable: true,
        configurable: true
      }
    });
    if (typeof HostWeakMap === 'function') {
      (function() {
        if (doubleWeakMapCheckSilentFailure && typeof Proxy !== 'undefined') {
          Proxy = undefined;
        }
        function DoubleWeakMap() {
          if (!(this instanceof OurWeakMap)) {
            calledAsFunctionWarning();
          }
          var hmap = new HostWeakMap();
          var omap = undefined;
          var enableSwitching = false;
          function dget(key, opt_default) {
            if (omap) {
              return hmap.has(key) ? hmap.get(key) : omap.get___(key, opt_default);
            } else {
              return hmap.get(key, opt_default);
            }
          }
          function dhas(key) {
            return hmap.has(key) || (omap ? omap.has___(key) : false);
          }
          var dset;
          if (doubleWeakMapCheckSilentFailure) {
            dset = function(key, value) {
              hmap.set(key, value);
              if (!hmap.has(key)) {
                if (!omap) {
                  omap = new OurWeakMap();
                }
                omap.set(key, value);
              }
              return this;
            };
          } else {
            dset = function(key, value) {
              if (enableSwitching) {
                try {
                  hmap.set(key, value);
                } catch (e) {
                  if (!omap) {
                    omap = new OurWeakMap();
                  }
                  omap.set___(key, value);
                }
              } else {
                hmap.set(key, value);
              }
              return this;
            };
          }
          function ddelete(key) {
            var result = !!hmap['delete'](key);
            if (omap) {
              return omap.delete___(key) || result;
            }
            return result;
          }
          return Object.create(OurWeakMap.prototype, {
            get___: {value: constFunc(dget)},
            has___: {value: constFunc(dhas)},
            set___: {value: constFunc(dset)},
            delete___: {value: constFunc(ddelete)},
            permitHostObjects___: {value: constFunc(function(token) {
                if (token === weakMapPermitHostObjects) {
                  enableSwitching = true;
                } else {
                  throw new Error('bogus call to permitHostObjects___');
                }
              })}
          });
        }
        DoubleWeakMap.prototype = OurWeakMap.prototype;
        module.exports = DoubleWeakMap;
        Object.defineProperty(WeakMap.prototype, 'constructor', {
          value: WeakMap,
          enumerable: false,
          configurable: true,
          writable: true
        });
      })();
    } else {
      if (typeof Proxy !== 'undefined') {
        Proxy = undefined;
      }
      module.exports = OurWeakMap;
    }
  })();
  global.define = __define;
  return module.exports;
});



System.register("npm:collections@2.0.1/weak-map", ["npm:weak-map@1.0.5"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:weak-map@1.0.5");
  global.define = __define;
  return module.exports;
});



System.register("npm:collections@2.0.1/shim-regexp", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  "format cjs";
  if (!RegExp.escape) {
    var special = /[-[\]{}()*+?.\\^$|,#\s]/g;
    RegExp.escape = function(string) {
      return string.replace(special, "\\$&");
    };
  }
  global.define = __define;
  return module.exports;
});



System.register("github:jspm/nodelibs@0.0.8/process/index", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  "format cjs";
  var process = module.exports = {};
  process.nextTick = (function() {
    var canSetImmediate = typeof window !== 'undefined' && window.setImmediate;
    var canPost = typeof window !== 'undefined' && window.postMessage && window.addEventListener;
    ;
    if (canSetImmediate) {
      return function(f) {
        return window.setImmediate(f);
      };
    }
    if (canPost) {
      var queue = [];
      window.addEventListener('message', function(ev) {
        var source = ev.source;
        if ((source === window || source === null) && ev.data === 'process-tick') {
          ev.stopPropagation();
          if (queue.length > 0) {
            var fn = queue.shift();
            fn();
          }
        }
      }, true);
      return function nextTick(fn) {
        queue.push(fn);
        window.postMessage('process-tick', '*');
      };
    }
    return function nextTick(fn) {
      setTimeout(fn, 0);
    };
  })();
  process.title = 'browser';
  process.browser = true;
  process.env = {};
  process.argv = [];
  function noop() {}
  process.on = noop;
  process.addListener = noop;
  process.once = noop;
  process.off = noop;
  process.removeListener = noop;
  process.removeAllListeners = noop;
  process.emit = noop;
  process.binding = function(name) {
    throw new Error('process.binding is not supported');
  };
  process.cwd = function() {
    return '/';
  };
  process.chdir = function(dir) {
    throw new Error('process.chdir is not supported');
  };
  global.define = __define;
  return module.exports;
});



System.register("build/src/Paw", ["build/src/Train", "build/src/Gestures", "build/src/ViewportRelative"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var Train = require("build/src/Train");
  var Gestures = require("build/src/Gestures");
  var ViewportRelative = require("build/src/ViewportRelative");
  var POINT_REGEX = /^\s*(top|left|right|center|bottom|\d+\.?\d*(px|%))\s+(top|left|right|center|bottom|\d+\.?\d*(px|%))\s*$/i;
  if (!Array.isArray) {
    Array.isArray = function(vArg) {
      var isArray;
      isArray = vArg instanceof Array;
      return isArray;
    };
  }
  var MOUSE_EVENTS = {
    start: 'mousedown',
    move: 'mousemove',
    end: 'mouseup',
    click: 'click'
  };
  function Paw(mixins) {
    this.showTouches = true;
    this.clearTouchIndicatorsAfter = 0;
    this.touches = [];
    this.touchIndicators = [];
    this.isTouchSupported = (('ontouchstart' in window) || window.DocumentTouch && document instanceof DocumentTouch) ? true : false;
    this.hasMultiTouch = true;
    Train.mixObjectInto(this, Gestures);
    if (mixins) {
      if (!Array.isArray(mixins)) {
        mixins = [mixins];
      }
      for (var i = 0; i < mixins.length; i++) {
        if (typeof(mixins[i]) === 'object') {
          Train.mixObjectInto(this, mixins[i]);
        }
      }
    }
    this.relativePositions = {};
    this.DEFAULT_TOUCH_LOCATION = '70% center';
    this.DEFAULT_SWIPE_LOCATIONS = [['70% 45%'], ['70% 95%']];
    this.DEFAULT_PINCH_LOCATIONS = [['70% 45%', '70% 55%'], ['70% 40%', '70% 60%']];
    this.DEFAULT_DURATION = 500;
    this.DEFAULT_DOUBLE_TAP_DURATION = 120;
  }
  Paw.prototype.getDefaultTouchLocation = function() {
    return this.DEFAULT_TOUCH_LOCATION;
  };
  Paw.prototype.getDefaultSwipeLocations = function() {
    return this.DEFAULT_SWIPE_LOCATIONS;
  };
  Paw.prototype.getDefaultPinchLocations = function() {
    return this.DEFAULT_PINCH_LOCATIONS;
  };
  Paw.prototype.getDefaultDuration = function() {
    return this.DEFAULT_DURATION;
  };
  Paw.prototype.getDefaultDoubleTapDuration = function() {
    return this.DEFAULT_DOUBLE_TAP_DURATION;
  };
  Paw.prototype.setDefaultTouchLocation = function(where) {
    if (this.isPoint(where) || POINT_REGEX.test(where)) {
      this.DEFAULT_TOUCH_LOCATION = where;
    }
  };
  Paw.prototype.setDefaultSwipeLocations = function(arrayOfArrayOfPoints) {
    this.DEFAULT_SWIPE_LOCATIONS = arrayOfArrayOfPoints;
  };
  Paw.prototype.setDefaultPinchLocations = function(arrayOfArrayOfPoints) {
    this.DEFAULT_PINCH_LOCATIONS = arrayOfArrayOfPoints;
  };
  Paw.prototype.setDefaultDuration = function(duration) {
    if (duration >= 0) {
      this.DEFAULT_DURATION = duration;
    }
  };
  Paw.prototype.setDefaultDoubleTapDuration = function(duration) {
    if (duration >= 0) {
      this.DEFAULT_DOUBLE_TAP_DURATION = duration;
    }
  };
  Paw.prototype._copy = function(obj) {
    return JSON.parse(JSON.stringify(obj));
  };
  Paw.prototype.clearTouchIndicators = function() {
    for (var i = this.touchIndicators.length - 1; i >= 0; i--) {
      if (this.touchIndicators[i]) {
        this.touchIndicators[i].style.opacity = 0;
      }
    }
  };
  Paw.prototype.indicateTouches = function(touches) {
    var self = this,
        touch,
        i,
        id,
        ti,
        len;
    var cti = function() {
      self.clearTouchIndicators();
    };
    if (!this.showTouches) {
      return;
    }
    if (!touches || touches.length === 0) {
      setTimeout(cti, 60);
      return;
    }
    len = touches.length;
    for (i = 0; i < len; i++) {
      touch = touches[i];
      id = 'paw_touch_' + i;
      ti = this.touchIndicators[i];
      if (!ti) {
        ti = document.createElement('div');
        document.body.appendChild(ti);
        this.touchIndicators[i] = ti;
        ti.id = id;
        ti.className = 'finger';
        ti.style.position = 'absolute';
        ti.style.top = '0px';
        ti.style.left = '0px';
        ti.style.zIndex = '9999';
        ti.style.height = '30px';
        ti.style.width = '30px';
        ti.style.backgroundColor = 'red';
        ti.style.border = 'solid 2px #FFAAAA';
        ti.style.borderRadius = '20px';
        ti.style.pointerEvents = 'none';
      }
      if (ti.style.opacity !== '0.6') {
        ti.style.opacity = '0.6';
      }
      ti.style.transform = 'translate(' + (touch.x - 15) + 'px, ' + (touch.y - 15) + 'px)';
      if (self.clearTouchIndicatorsAfter > 0) {
        clearTimeout(ti.timeout);
        ti.timeout = setTimeout(cti, self.clearTouchIndicatorsAfter);
      }
    }
  };
  Paw.prototype._triggerClick = function() {
    this.indicateTouches(this.touches);
    this._triggerMouse('start');
    this._triggerMouse('end');
    this._triggerMouse('click');
    this.indicateTouches();
  };
  Paw.prototype._triggerStart = function() {
    this.indicateTouches(this.touches);
    this._triggerTouch('start');
  };
  Paw.prototype._triggerEnd = function() {
    this._triggerTouch('end');
    if (this.touches.length > 0) {
      var point = this.touches[0];
      var el = document.elementFromPoint(point.x, point.y);
      this.element = el;
    }
    this.setTouches();
    this.indicateTouches();
  };
  Paw.prototype._triggerMove = function() {
    this._triggerTouch('move');
    this.indicateTouches(this.touches);
  };
  Paw.prototype._createTouchList = function(points) {
    var len = points.length;
    var i = 0;
    var point;
    if (len > 0) {
      point = points[0];
      var el = document.elementFromPoint(point.x, point.y);
      this.element = el;
    }
    if (document.createTouchList) {
      var _touches = [];
      for (; i < len; ++i) {
        point = points[i];
        var touch = document.createTouch(window, this.element, i, point.x, point.y, point.x, point.y);
        _touches.push(touch);
      }
      var result = document.createTouchList.apply(document, _touches);
      return result;
    } else {
      var touchlist = [];
      for (; i < len; ++i) {
        point = points[i];
        touchlist.push({
          target: this.element,
          identifier: Date.now() + i,
          pageX: point.x,
          pageY: point.y,
          screenX: point.x,
          screenY: point.y,
          clientX: point.x,
          clientY: point.y
        });
      }
      return touchlist;
    }
  };
  Paw.prototype._triggerTouch = function(type) {
    var event = document.createEvent('Event');
    var touchlist = this._createTouchList((type === 'end' || type === 'cancel') ? [] : this.touches);
    event.initEvent('touch' + type, true, true);
    event.touches = touchlist;
    event.targetTouches = touchlist;
    event.changedTouches = touchlist;
    this.element = this.element || document.body;
    return this.element.dispatchEvent(event);
  };
  Paw.prototype._triggerMouse = function(type) {
    var touchList = this._createTouchList(this.touches);
    for (var i = 0; i < touchList.length; i++) {
      var ev = document.createEvent('MouseEvent');
      ev.initMouseEvent(MOUSE_EVENTS[type], true, true, window, 0, touchList[i].pageX, touchList[i].pageY, touchList[i].clientX, touchList[i].clientY, false, false, false, false, 0, null);
      this.element = document.elementFromPoint(touchList[i].pageX, touchList[i].pageY) || document.body;
      this.element.dispatchEvent(ev);
    }
  };
  Paw.prototype.isDOMNode = function(obj) {
    return obj && typeof obj === 'object' && obj.nodeType && obj.nodeType === 1;
  };
  Paw.prototype.isDOMNodeArray = function(obj) {
    return obj instanceof NodeList || (Array.isArray(obj) && obj.length > 0 && this.isDOMNode(obj[0]));
  };
  Paw.prototype.isPoint = function(obj) {
    return typeof obj === 'object' && obj.x !== null && obj.x !== undefined && obj.y !== null && obj.y !== undefined;
  };
  Paw.prototype._getElements = function(obj) {
    var selection;
    var selector;
    if (typeof obj === 'string') {
      selection = document.querySelectorAll(obj);
      selector = obj;
    } else if (this.isDOMNode(obj)) {
      selection = [obj];
      selector = obj;
    } else if (obj.selector && obj.each) {
      selector = obj.selector;
      selection = [];
      obj.each(function(i, el) {
        selection.push(el);
      });
    } else if (this.isDOMNodeArray(obj)) {
      selection = obj;
      selector = obj;
    }
    if (!selector || selection.length === 0) {
      throw new Error('Selector did not match anything:', selector);
    }
    return selection;
  };
  Paw.prototype._buildTouches = function(where) {
    var selection,
        i,
        k,
        wherek,
        vd;
    if (!where) {
      throw new Error('Parameter "where" is empty when building touches');
    }
    if (!Array.isArray(where)) {
      where = [where];
    }
    vd = this.getViewportDimensions();
    for (k = 0; k < where.length; k++) {
      wherek = where[k];
      if (this.isPoint(wherek) || POINT_REGEX.test(wherek)) {
        where[k] = ViewportRelative.pointToPixels(wherek, vd);
      } else {
        selection = this._getElements(wherek);
        where.splice(k, 1);
        for (i = 0; i < selection.length; i++) {
          var bounds = selection[i].getBoundingClientRect();
          where.splice(k, 0, {
            x: bounds.left + (bounds.width / 2),
            y: bounds.top + (bounds.height / 2)
          });
        }
        k = k + (selection.length - 1);
      }
    }
    return where;
  };
  Paw.prototype.setTouches = function(touches) {
    if (!touches) {
      this.touches.length = 0;
      return;
    }
    this.touches = this._copy(this._buildTouches(touches));
    return this.touches;
  };
  Paw.prototype.getViewportWidth = function() {
    if (window && window.innerWidth) {
      return window.innerWidth;
    } else if (window && window.document && window.document.body && window.document.body.offsetWidth) {
      return window.document.body.offsetWidth;
    } else {
      return 0;
    }
  };
  Paw.prototype.getViewportHeight = function() {
    if (window && window.innerHeight) {
      return window.innerHeight;
    } else if (window && window.document && window.document.body && window.document.body.offsetHeight) {
      return window.document.body.offsetHeight;
    } else {
      return 0;
    }
  };
  Paw.prototype.getViewportDimensions = function() {
    return {
      width: this.getViewportWidth(),
      height: this.getViewportHeight()
    };
  };
  module.exports = Paw;
  global.define = __define;
  return module.exports;
});



System.register("npm:weak-map@1.0.5", ["npm:weak-map@1.0.5/weak-map"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:weak-map@1.0.5/weak-map");
  global.define = __define;
  return module.exports;
});



System.register("npm:collections@2.0.1/iterator", ["npm:collections@2.0.1/weak-map", "npm:collections@2.0.1/generic-collection"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  "use strict";
  module.exports = Iterator;
  var WeakMap = require("npm:collections@2.0.1/weak-map");
  var GenericCollection = require("npm:collections@2.0.1/generic-collection");
  function Iterator(iterable, start, stop, step) {
    if (!iterable) {
      return Iterator.empty;
    } else if (iterable instanceof Iterator) {
      return iterable;
    } else if (!(this instanceof Iterator)) {
      return new Iterator(iterable, start, stop, step);
    } else if (Array.isArray(iterable) || typeof iterable === "string") {
      iterators.set(this, new IndexIterator(iterable, start, stop, step));
      return;
    }
    iterable = Object(iterable);
    if (iterable.next) {
      iterators.set(this, iterable);
    } else if (iterable.iterate) {
      iterators.set(this, iterable.iterate(start, stop, step));
    } else if (Object.prototype.toString.call(iterable) === "[object Function]") {
      this.next = iterable;
    } else {
      throw new TypeError("Can't iterate " + iterable);
    }
  }
  var iterators = new WeakMap();
  Iterator.prototype.forEach = GenericCollection.prototype.forEach;
  Iterator.prototype.map = GenericCollection.prototype.map;
  Iterator.prototype.filter = GenericCollection.prototype.filter;
  Iterator.prototype.every = GenericCollection.prototype.every;
  Iterator.prototype.some = GenericCollection.prototype.some;
  Iterator.prototype.min = GenericCollection.prototype.min;
  Iterator.prototype.max = GenericCollection.prototype.max;
  Iterator.prototype.sum = GenericCollection.prototype.sum;
  Iterator.prototype.average = GenericCollection.prototype.average;
  Iterator.prototype.flatten = GenericCollection.prototype.flatten;
  Iterator.prototype.zip = GenericCollection.prototype.zip;
  Iterator.prototype.enumerate = GenericCollection.prototype.enumerate;
  Iterator.prototype.sorted = GenericCollection.prototype.sorted;
  Iterator.prototype.group = GenericCollection.prototype.group;
  Iterator.prototype.reversed = GenericCollection.prototype.reversed;
  Iterator.prototype.toArray = GenericCollection.prototype.toArray;
  Iterator.prototype.toObject = GenericCollection.prototype.toObject;
  Iterator.prototype.constructClone = function(values) {
    var clone = [];
    clone.addEach(values);
    return clone;
  };
  Iterator.prototype.next = function() {
    var nextable = iterators.get(this);
    if (nextable) {
      return nextable.next();
    } else {
      return Iterator.done;
    }
  };
  Iterator.prototype.iterateMap = function(callback) {
    var self = Iterator(this),
        thisp = arguments[1];
    return new MapIterator(self, callback, thisp);
  };
  function MapIterator(iterator, callback, thisp) {
    this.iterator = iterator;
    this.callback = callback;
    this.thisp = thisp;
  }
  MapIterator.prototype = Object.create(Iterator.prototype);
  MapIterator.prototype.constructor = MapIterator;
  MapIterator.prototype.next = function() {
    var iteration = this.iterator.next();
    if (iteration.done) {
      return iteration;
    } else {
      return new Iteration(this.callback.call(this.thisp, iteration.value, iteration.index, this.iteration), iteration.index);
    }
  };
  Iterator.prototype.iterateFilter = function(callback) {
    var self = Iterator(this),
        thisp = arguments[1],
        index = 0;
    return new FilterIterator(self, callback, thisp);
  };
  function FilterIterator(iterator, callback, thisp) {
    this.iterator = iterator;
    this.callback = callback;
    this.thisp = thisp;
  }
  FilterIterator.prototype = Object.create(Iterator.prototype);
  FilterIterator.prototype.constructor = FilterIterator;
  FilterIterator.prototype.next = function() {
    var iteration;
    while (true) {
      iteration = this.iterator.next();
      if (iteration.done || this.callback.call(this.thisp, iteration.value, iteration.index, this.iteration)) {
        return iteration;
      }
    }
  };
  Iterator.prototype.reduce = function(callback) {
    var self = Iterator(this),
        result = arguments[1],
        thisp = arguments[2],
        iteration;
    iteration = self.next();
    if (iteration.done) {
      if (arguments.length > 1) {
        return arguments[1];
      } else {
        throw TypeError("Reduce of empty iterator with no initial value");
      }
    } else if (arguments.length > 1) {
      result = callback.call(thisp, result, iteration.value, iteration.index, self);
    } else {
      result = iteration.value;
    }
    while (true) {
      iteration = self.next();
      if (iteration.done) {
        return result;
      } else {
        result = callback.call(thisp, result, iteration.value, iteration.index, self);
      }
    }
  };
  Iterator.prototype.dropWhile = function(callback) {
    var self = Iterator(this),
        thisp = arguments[1],
        iteration;
    while (true) {
      iteration = self.next();
      if (iteration.done) {
        return Iterator.empty;
      } else if (!callback.call(thisp, iteration.value, iteration.index, self)) {
        return new DropWhileIterator(iteration, self);
      }
    }
  };
  function DropWhileIterator(iteration, iterator) {
    this.iteration = iteration;
    this.iterator = iterator;
    this.parent = null;
  }
  DropWhileIterator.prototype = Object.create(Iterator.prototype);
  DropWhileIterator.prototype.constructor = DropWhileIterator;
  DropWhileIterator.prototype.next = function() {
    var result = this.iteration;
    if (result) {
      this.iteration = null;
      return result;
    } else {
      return this.iterator.next();
    }
  };
  Iterator.prototype.takeWhile = function(callback) {
    var self = Iterator(this),
        thisp = arguments[1];
    return new TakeWhileIterator(self, callback, thisp);
  };
  function TakeWhileIterator(iterator, callback, thisp) {
    this.iterator = iterator;
    this.callback = callback;
    this.thisp = thisp;
  }
  TakeWhileIterator.prototype = Object.create(Iterator.prototype);
  TakeWhileIterator.prototype.constructor = TakeWhileIterator;
  TakeWhileIterator.prototype.next = function() {
    var iteration = this.iterator.next();
    if (iteration.done) {
      return iteration;
    } else if (this.callback.call(this.thisp, iteration.value, iteration.index, this.iterator)) {
      return iteration;
    } else {
      return Iterator.done;
    }
  };
  Iterator.prototype.iterateZip = function() {
    return Iterator.unzip(Array.prototype.concat.apply(this, arguments));
  };
  Iterator.prototype.iterateUnzip = function() {
    return Iterator.unzip(this);
  };
  Iterator.prototype.iterateEnumerate = function(start) {
    return Iterator.count(start).iterateZip(this);
  };
  Iterator.prototype.iterateConcat = function() {
    return Iterator.flatten(Array.prototype.concat.apply(this, arguments));
  };
  Iterator.prototype.iterateFlatten = function() {
    return Iterator.flatten(this);
  };
  Iterator.prototype.recount = function(start) {
    return new RecountIterator(this, start);
  };
  function RecountIterator(iterator, start) {
    this.iterator = iterator;
    this.index = start || 0;
  }
  RecountIterator.prototype = Object.create(Iterator.prototype);
  RecountIterator.prototype.constructor = RecountIterator;
  RecountIterator.prototype.next = function() {
    var iteration = this.iterator.next();
    if (iteration.done) {
      return iteration;
    } else {
      return new Iteration(iteration.value, this.index++);
    }
  };
  function IndexIterator(iterable, start, stop, step) {
    if (step == null) {
      step = 1;
    }
    if (stop == null) {
      stop = start;
      start = 0;
    }
    if (start == null) {
      start = 0;
    }
    if (step == null) {
      step = 1;
    }
    if (stop == null) {
      stop = iterable.length;
    }
    this.iterable = iterable;
    this.start = start;
    this.stop = stop;
    this.step = step;
  }
  IndexIterator.prototype.next = function() {
    if (typeof this.iterable === "object") {
      while (!(this.start in this.iterable)) {
        if (this.start >= this.stop) {
          return Iterator.done;
        } else {
          this.start += this.step;
        }
      }
    }
    if (this.start >= this.stop) {
      return Iterator.done;
    }
    var iteration = new Iteration(this.iterable[this.start], this.start);
    this.start += this.step;
    return iteration;
  };
  Iterator.cycle = function(cycle, times) {
    if (arguments.length < 2) {
      times = Infinity;
    }
    return new CycleIterator(cycle, times);
  };
  function CycleIterator(cycle, times) {
    this.cycle = cycle;
    this.times = times;
    this.iterator = Iterator.empty;
  }
  CycleIterator.prototype = Object.create(Iterator.prototype);
  CycleIterator.prototype.constructor = CycleIterator;
  CycleIterator.prototype.next = function() {
    var iteration = this.iterator.next();
    if (iteration.done) {
      if (this.times > 0) {
        this.times--;
        this.iterator = new Iterator(this.cycle);
        return this.iterator.next();
      } else {
        return iteration;
      }
    } else {
      return iteration;
    }
  };
  Iterator.concat = function() {
    return Iterator.flatten(Array.prototype.slice.call(arguments));
  };
  Iterator.flatten = function(iterators) {
    iterators = Iterator(iterators);
    return new ChainIterator(iterators);
  };
  function ChainIterator(iterators) {
    this.iterators = iterators;
    this.iterator = Iterator.empty;
  }
  ChainIterator.prototype = Object.create(Iterator.prototype);
  ChainIterator.prototype.constructor = ChainIterator;
  ChainIterator.prototype.next = function() {
    var iteration = this.iterator.next();
    if (iteration.done) {
      var iteratorIteration = this.iterators.next();
      if (iteratorIteration.done) {
        return Iterator.done;
      } else {
        this.iterator = new Iterator(iteratorIteration.value);
        return this.iterator.next();
      }
    } else {
      return iteration;
    }
  };
  Iterator.unzip = function(iterators) {
    iterators = Iterator(iterators).map(Iterator);
    if (iterators.length === 0)
      return new Iterator.empty;
    return new UnzipIterator(iterators);
  };
  function UnzipIterator(iterators) {
    this.iterators = iterators;
    this.index = 0;
  }
  UnzipIterator.prototype = Object.create(Iterator.prototype);
  UnzipIterator.prototype.constructor = UnzipIterator;
  UnzipIterator.prototype.next = function() {
    var done = false;
    var result = this.iterators.map(function(iterator) {
      var iteration = iterator.next();
      if (iteration.done) {
        done = true;
      } else {
        return iteration.value;
      }
    });
    if (done) {
      return Iterator.done;
    } else {
      return new Iteration(result, this.index++);
    }
  };
  Iterator.zip = function() {
    return Iterator.unzip(Array.prototype.slice.call(arguments));
  };
  Iterator.range = function(start, stop, step) {
    if (arguments.length < 3) {
      step = 1;
    }
    if (arguments.length < 2) {
      stop = start;
      start = 0;
    }
    start = start || 0;
    step = step || 1;
    return new RangeIterator(start, stop, step);
  };
  Iterator.count = function(start, step) {
    return Iterator.range(start, Infinity, step);
  };
  function RangeIterator(start, stop, step) {
    this.start = start;
    this.stop = stop;
    this.step = step;
    this.index = 0;
  }
  RangeIterator.prototype = Object.create(Iterator.prototype);
  RangeIterator.prototype.constructor = RangeIterator;
  RangeIterator.prototype.next = function() {
    if (this.start >= this.stop) {
      return Iterator.done;
    } else {
      var result = this.start;
      this.start += this.step;
      return new Iteration(result, this.index++);
    }
  };
  Iterator.repeat = function(value, times) {
    if (times == null) {
      times = Infinity;
    }
    return new RepeatIterator(value, times);
  };
  function RepeatIterator(value, times) {
    this.value = value;
    this.times = times;
    this.index = 0;
  }
  RepeatIterator.prototype = Object.create(Iterator.prototype);
  RepeatIterator.prototype.constructor = RepeatIterator;
  RepeatIterator.prototype.next = function() {
    if (this.index < this.times) {
      return new Iteration(this.value, this.index++);
    } else {
      return Iterator.done;
    }
  };
  Iterator.enumerate = function(values, start) {
    return Iterator.count(start).iterateZip(new Iterator(values));
  };
  function EmptyIterator() {}
  EmptyIterator.prototype = Object.create(Iterator.prototype);
  EmptyIterator.prototype.constructor = EmptyIterator;
  EmptyIterator.prototype.next = function() {
    return Iterator.done;
  };
  Iterator.empty = new EmptyIterator();
  function Iteration(value, index) {
    this.value = value;
    this.index = index;
  }
  Iteration.prototype.done = false;
  Iteration.prototype.equals = function(that, equals, memo) {
    if (!that)
      return false;
    return (equals(this.value, that.value, equals, memo) && this.index === that.index && this.done === that.done);
  };
  function DoneIteration(value) {
    Iteration.call(this, value);
    this.done = true;
  }
  DoneIteration.prototype = Object.create(Iteration.prototype);
  DoneIteration.prototype.constructor = DoneIteration;
  DoneIteration.prototype.done = true;
  Iterator.Iteration = Iteration;
  Iterator.DoneIteration = DoneIteration;
  Iterator.done = new DoneIteration();
  global.define = __define;
  return module.exports;
});



System.register("github:jspm/nodelibs@0.0.8/process", ["github:jspm/nodelibs@0.0.8/process/index"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  "format cjs";
  module.exports = System._nodeRequire ? process : require("github:jspm/nodelibs@0.0.8/process/index");
  global.define = __define;
  return module.exports;
});



System.register("npm:collections@2.0.1/shim-object", ["npm:weak-map@1.0.5"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  "use strict";
  var WeakMap = require("npm:weak-map@1.0.5");
  module.exports = Object;
  Object.empty = Object.freeze(Object.create(null));
  Object.isObject = function(object) {
    return Object(object) === object;
  };
  Object.getValueOf = function(value) {
    if (value && typeof value.valueOf === "function") {
      value = value.valueOf();
    }
    return value;
  };
  var hashMap = new WeakMap();
  Object.hash = function(object) {
    if (object && typeof object.hash === "function") {
      return "" + object.hash();
    } else if (Object.isObject(object)) {
      if (!hashMap.has(object)) {
        hashMap.set(object, Math.random().toString(36).slice(2));
      }
      return hashMap.get(object);
    } else {
      return "" + object;
    }
  };
  var owns = Object.prototype.hasOwnProperty;
  Object.owns = function(object, key) {
    return owns.call(object, key);
  };
  Object.has = function(object, key) {
    if (typeof object !== "object") {
      throw new Error("Object.has can't accept non-object: " + typeof object);
    }
    if (object && typeof object.has === "function") {
      return object.has(key);
    } else if (typeof key === "string") {
      return key in object && object[key] !== Object.prototype[key];
    } else {
      throw new Error("Key must be a string for Object.has on plain objects");
    }
  };
  Object.get = function(object, key, value) {
    if (typeof object !== "object") {
      throw new Error("Object.get can't accept non-object: " + typeof object);
    }
    if (object && typeof object.get === "function") {
      return object.get(key, value);
    } else if (Object.has(object, key)) {
      return object[key];
    } else {
      return value;
    }
  };
  Object.set = function(object, key, value) {
    if (object && typeof object.set === "function") {
      object.set(key, value);
    } else {
      object[key] = value;
    }
  };
  Object.addEach = function(target, source) {
    if (!source) {} else if (typeof source.forEach === "function" && !source.hasOwnProperty("forEach")) {
      if (typeof source.keys === "function") {
        source.forEach(function(value, key) {
          target[key] = value;
        });
      } else {
        source.forEach(function(pair) {
          target[pair[0]] = pair[1];
        });
      }
    } else {
      Object.keys(source).forEach(function(key) {
        target[key] = source[key];
      });
    }
    return target;
  };
  Object.forEach = function(object, callback, thisp) {
    Object.keys(object).forEach(function(key) {
      callback.call(thisp, object[key], key, object);
    });
  };
  Object.map = function(object, callback, thisp) {
    return Object.keys(object).map(function(key) {
      return callback.call(thisp, object[key], key, object);
    });
  };
  Object.values = function(object) {
    return Object.map(object, Function.identity);
  };
  Object.concat = function() {
    var object = {};
    for (var i = 0; i < arguments.length; i++) {
      Object.addEach(object, arguments[i]);
    }
    return object;
  };
  Object.from = Object.concat;
  Object.is = function(x, y) {
    if (x === y) {
      return x !== 0 || 1 / x === 1 / y;
    }
    return x !== x && y !== y;
  };
  Object.equals = function(a, b, equals, memo) {
    equals = equals || Object.equals;
    a = Object.getValueOf(a);
    b = Object.getValueOf(b);
    if (a === b)
      return true;
    if (Object.isObject(a)) {
      memo = memo || new WeakMap();
      if (memo.has(a)) {
        return true;
      }
      memo.set(a, true);
    }
    if (Object.isObject(a) && typeof a.equals === "function") {
      return a.equals(b, equals, memo);
    }
    if (Object.isObject(b) && typeof b.equals === "function") {
      return b.equals(a, equals, memo);
    }
    if (Object.isObject(a) && Object.isObject(b)) {
      if (Object.getPrototypeOf(a) === Object.prototype && Object.getPrototypeOf(b) === Object.prototype) {
        for (var name in a) {
          if (!equals(a[name], b[name], equals, memo)) {
            return false;
          }
        }
        for (var name in b) {
          if (!(name in a) || !equals(b[name], a[name], equals, memo)) {
            return false;
          }
        }
        return true;
      }
    }
    if (a !== a && b !== b)
      return true;
    if (!a || !b)
      return a === b;
    return false;
  };
  Object.compare = function(a, b) {
    a = Object.getValueOf(a);
    b = Object.getValueOf(b);
    if (a === b)
      return 0;
    var aType = typeof a;
    var bType = typeof b;
    if (aType === "number" && bType === "number")
      return a - b;
    if (aType === "string" && bType === "string")
      return a < b ? -Infinity : Infinity;
    if (a && typeof a.compare === "function")
      return a.compare(b);
    if (b && typeof b.compare === "function")
      return -b.compare(a);
    return 0;
  };
  Object.clone = function(value, depth, memo) {
    value = Object.getValueOf(value);
    memo = memo || new WeakMap();
    if (depth === undefined) {
      depth = Infinity;
    } else if (depth === 0) {
      return value;
    }
    if (typeof value === "function") {
      return value;
    } else if (Object.isObject(value)) {
      if (!memo.has(value)) {
        if (value && typeof value.clone === "function") {
          memo.set(value, value.clone(depth, memo));
        } else {
          var prototype = Object.getPrototypeOf(value);
          if (prototype === null || prototype === Object.prototype) {
            var clone = Object.create(prototype);
            memo.set(value, clone);
            for (var key in value) {
              clone[key] = Object.clone(value[key], depth - 1, memo);
            }
          } else {
            throw new Error("Can't clone " + value);
          }
        }
      }
      return memo.get(value);
    }
    return value;
  };
  Object.clear = function(object) {
    if (object && typeof object.clear === "function") {
      object.clear();
    } else {
      var keys = Object.keys(object),
          i = keys.length;
      while (i) {
        i--;
        delete object[keys[i]];
      }
    }
    return object;
  };
  global.define = __define;
  return module.exports;
});



System.register("npm:asap@1.0.0/asap", ["github:jspm/nodelibs@0.0.8/process"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  (function(process) {
    var head = {
      task: void 0,
      next: null
    };
    var tail = head;
    var flushing = false;
    var requestFlush = void 0;
    var isNodeJS = false;
    function flush() {
      while (head.next) {
        head = head.next;
        var task = head.task;
        head.task = void 0;
        var domain = head.domain;
        if (domain) {
          head.domain = void 0;
          domain.enter();
        }
        try {
          task();
        } catch (e) {
          if (isNodeJS) {
            if (domain) {
              domain.exit();
            }
            setTimeout(flush, 0);
            if (domain) {
              domain.enter();
            }
            throw e;
          } else {
            setTimeout(function() {
              throw e;
            }, 0);
          }
        }
        if (domain) {
          domain.exit();
        }
      }
      flushing = false;
    }
    if (typeof process !== "undefined" && process.nextTick) {
      isNodeJS = true;
      requestFlush = function() {
        process.nextTick(flush);
      };
    } else if (typeof setImmediate === "function") {
      if (typeof window !== "undefined") {
        requestFlush = setImmediate.bind(window, flush);
      } else {
        requestFlush = function() {
          setImmediate(flush);
        };
      }
    } else if (typeof MessageChannel !== "undefined") {
      var channel = new MessageChannel();
      channel.port1.onmessage = flush;
      requestFlush = function() {
        channel.port2.postMessage(0);
      };
    } else {
      requestFlush = function() {
        setTimeout(flush, 0);
      };
    }
    function asap(task) {
      tail = tail.next = {
        task: task,
        domain: isNodeJS && process.domain,
        next: null
      };
      if (!flushing) {
        flushing = true;
        requestFlush();
      }
    }
    ;
    module.exports = asap;
  })(require("github:jspm/nodelibs@0.0.8/process"));
  global.define = __define;
  return module.exports;
});



System.register("npm:collections@2.0.1/generic-order", ["npm:collections@2.0.1/shim-object"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var Object = require("npm:collections@2.0.1/shim-object");
  module.exports = GenericOrder;
  function GenericOrder() {
    throw new Error("Can't construct. GenericOrder is a mixin.");
  }
  GenericOrder.prototype.equals = function(that, equals) {
    equals = equals || this.contentEquals || Object.equals;
    if (this === that) {
      return true;
    }
    if (!that) {
      return false;
    }
    var self = this;
    return (this.length === that.length && this.zip(that).every(function(pair) {
      return equals(pair[0], pair[1]);
    }));
  };
  GenericOrder.prototype.compare = function(that, compare) {
    compare = compare || this.contentCompare || Object.compare;
    if (this === that) {
      return 0;
    }
    if (!that) {
      return 1;
    }
    var length = Math.min(this.length, that.length);
    var comparison = this.zip(that).reduce(function(comparison, pair, index) {
      if (comparison === 0) {
        if (index >= length) {
          return comparison;
        } else {
          return compare(pair[0], pair[1]);
        }
      } else {
        return comparison;
      }
    }, 0);
    if (comparison === 0) {
      return this.length - that.length;
    }
    return comparison;
  };
  global.define = __define;
  return module.exports;
});



System.register("npm:asap@1.0.0", ["npm:asap@1.0.0/asap"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:asap@1.0.0/asap");
  global.define = __define;
  return module.exports;
});



System.register("npm:collections@2.0.1/shim-array", ["npm:collections@2.0.1/shim-function", "npm:collections@2.0.1/generic-collection", "npm:collections@2.0.1/generic-order", "npm:collections@2.0.1/iterator", "npm:weak-map@1.0.5"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  "format cjs";
  "use strict";
  var Function = require("npm:collections@2.0.1/shim-function");
  var GenericCollection = require("npm:collections@2.0.1/generic-collection");
  var GenericOrder = require("npm:collections@2.0.1/generic-order");
  var Iterator = require("npm:collections@2.0.1/iterator");
  var WeakMap = require("npm:weak-map@1.0.5");
  module.exports = Array;
  var array_splice = Array.prototype.splice;
  var array_slice = Array.prototype.slice;
  Array.empty = [];
  if (Object.freeze) {
    Object.freeze(Array.empty);
  }
  Array.from = function(values) {
    var array = [];
    array.addEach(values);
    return array;
  };
  Array.unzip = function(table) {
    var transpose = [];
    var length = Infinity;
    for (var i = 0; i < table.length; i++) {
      var row = table[i];
      table[i] = row.toArray();
      if (row.length < length) {
        length = row.length;
      }
    }
    for (var i = 0; i < table.length; i++) {
      var row = table[i];
      for (var j = 0; j < row.length; j++) {
        if (j < length && j in row) {
          transpose[j] = transpose[j] || [];
          transpose[j][i] = row[j];
        }
      }
    }
    return transpose;
  };
  function define(key, value) {
    Object.defineProperty(Array.prototype, key, {
      value: value,
      writable: true,
      configurable: true,
      enumerable: false
    });
  }
  define("addEach", GenericCollection.prototype.addEach);
  define("deleteEach", GenericCollection.prototype.deleteEach);
  define("toArray", GenericCollection.prototype.toArray);
  define("toObject", GenericCollection.prototype.toObject);
  define("min", GenericCollection.prototype.min);
  define("max", GenericCollection.prototype.max);
  define("sum", GenericCollection.prototype.sum);
  define("average", GenericCollection.prototype.average);
  define("only", GenericCollection.prototype.only);
  define("flatten", GenericCollection.prototype.flatten);
  define("zip", GenericCollection.prototype.zip);
  define("enumerate", GenericCollection.prototype.enumerate);
  define("group", GenericCollection.prototype.group);
  define("sorted", GenericCollection.prototype.sorted);
  define("reversed", GenericCollection.prototype.reversed);
  define("constructClone", function(values) {
    var clone = new this.constructor();
    clone.addEach(values);
    return clone;
  });
  define("has", function(value, equals) {
    return this.findValue(value, equals) !== -1;
  });
  define("get", function(index, defaultValue) {
    if (+index !== index)
      throw new Error("Indicies must be numbers");
    if (!index in this) {
      return defaultValue;
    } else {
      return this[index];
    }
  });
  define("set", function(index, value) {
    if (index < this.length) {
      this.splice(index, 1, value);
    } else {
      this.swap(index, 1, [value]);
    }
    return this;
  });
  define("add", function(value) {
    this.push(value);
    return true;
  });
  define("delete", function(value, equals) {
    var index = this.findValue(value, equals);
    if (index !== -1) {
      this.splice(index, 1);
      return true;
    }
    return false;
  });
  define("findValue", function(value, equals) {
    equals = equals || this.contentEquals || Object.equals;
    for (var index = 0; index < this.length; index++) {
      if (index in this && equals(this[index], value)) {
        return index;
      }
    }
    return -1;
  });
  define("findLastValue", function(value, equals) {
    equals = equals || this.contentEquals || Object.equals;
    var index = this.length;
    do {
      index--;
      if (index in this && equals(this[index], value)) {
        return index;
      }
    } while (index > 0);
    return -1;
  });
  define("swap", function(start, minusLength, plus) {
    if (plus) {
      if (!Array.isArray(plus)) {
        plus = array_slice.call(plus);
      }
    } else {
      plus = Array.empty;
    }
    if (start < 0) {
      start = this.length + start;
    } else if (start > this.length) {
      this.length = start;
    }
    if (start + minusLength > this.length) {
      minusLength = this.length - start;
    } else if (minusLength < 0) {
      minusLength = 0;
    }
    var diff = plus.length - minusLength;
    var oldLength = this.length;
    var newLength = this.length + diff;
    if (diff > 0) {
      for (var index = oldLength - 1; index >= start + minusLength; index--) {
        var offset = index + diff;
        if (index in this) {
          this[offset] = this[index];
        } else {
          this[offset] = void 0;
          delete this[offset];
        }
      }
    }
    for (var index = 0; index < plus.length; index++) {
      if (index in plus) {
        this[start + index] = plus[index];
      } else {
        this[start + index] = void 0;
        delete this[start + index];
      }
    }
    if (diff < 0) {
      for (var index = start + plus.length; index < oldLength - diff; index++) {
        var offset = index - diff;
        if (offset in this) {
          this[index] = this[offset];
        } else {
          this[index] = void 0;
          delete this[index];
        }
      }
    }
    this.length = newLength;
  });
  define("peek", function() {
    return this[0];
  });
  define("poke", function(value) {
    if (this.length > 0) {
      this[0] = value;
    }
  });
  define("peekBack", function() {
    if (this.length > 0) {
      return this[this.length - 1];
    }
  });
  define("pokeBack", function(value) {
    if (this.length > 0) {
      this[this.length - 1] = value;
    }
  });
  define("one", function() {
    for (var i in this) {
      if (Object.owns(this, i)) {
        return this[i];
      }
    }
  });
  define("clear", function() {
    this.length = 0;
    return this;
  });
  define("compare", function(that, compare) {
    compare = compare || Object.compare;
    var i;
    var length;
    var lhs;
    var rhs;
    var relative;
    if (this === that) {
      return 0;
    }
    if (!that || !Array.isArray(that)) {
      return GenericOrder.prototype.compare.call(this, that, compare);
    }
    length = Math.min(this.length, that.length);
    for (i = 0; i < length; i++) {
      if (i in this) {
        if (!(i in that)) {
          return -1;
        } else {
          lhs = this[i];
          rhs = that[i];
          relative = compare(lhs, rhs);
          if (relative) {
            return relative;
          }
        }
      } else if (i in that) {
        return 1;
      }
    }
    return this.length - that.length;
  });
  define("equals", function(that, equals, memo) {
    equals = equals || Object.equals;
    var i = 0;
    var length = this.length;
    var left;
    var right;
    if (this === that) {
      return true;
    }
    if (!that || !Array.isArray(that)) {
      return GenericOrder.prototype.equals.call(this, that);
    }
    if (length !== that.length) {
      return false;
    } else {
      for (; i < length; ++i) {
        if (i in this) {
          if (!(i in that)) {
            return false;
          }
          left = this[i];
          right = that[i];
          if (!equals(left, right, equals, memo)) {
            return false;
          }
        } else {
          if (i in that) {
            return false;
          }
        }
      }
    }
    return true;
  });
  define("clone", function(depth, memo) {
    if (depth === undefined) {
      depth = Infinity;
    } else if (depth === 0) {
      return this;
    }
    memo = memo || new WeakMap();
    var clone = [];
    for (var i in this) {
      if (Object.owns(this, i)) {
        clone[i] = Object.clone(this[i], depth - 1, memo);
      }
    }
    ;
    return clone;
  });
  define("iterate", function(start, stop, step) {
    return new Iterator(this, start, stop, step);
  });
  global.define = __define;
  return module.exports;
});



System.register("npm:collections@2.0.1/shim", ["npm:collections@2.0.1/shim-array", "npm:collections@2.0.1/shim-object", "npm:collections@2.0.1/shim-function", "npm:collections@2.0.1/shim-regexp"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var Array = require("npm:collections@2.0.1/shim-array");
  var Object = require("npm:collections@2.0.1/shim-object");
  var Function = require("npm:collections@2.0.1/shim-function");
  var RegExp = require("npm:collections@2.0.1/shim-regexp");
  global.define = __define;
  return module.exports;
});



System.register("npm:q@2.0.2/q", ["npm:collections@2.0.1/shim", "npm:collections@2.0.1/weak-map", "npm:collections@2.0.1/iterator", "npm:asap@1.0.0", "github:jspm/nodelibs@0.0.8/process"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  (function(process) {
    "use strict";
    var hasStacks = false;
    try {
      throw new Error();
    } catch (e) {
      hasStacks = !!e.stack;
    }
    var qStartingLine = captureLine();
    var qFileName;
    require("npm:collections@2.0.1/shim");
    var WeakMap = require("npm:collections@2.0.1/weak-map");
    var Iterator = require("npm:collections@2.0.1/iterator");
    var asap = require("npm:asap@1.0.0");
    function isObject(value) {
      return value === Object(value);
    }
    var STACK_JUMP_SEPARATOR = "From previous event:";
    function makeStackTraceLong(error, promise) {
      if (hasStacks && promise.stack && typeof error === "object" && error !== null && error.stack && error.stack.indexOf(STACK_JUMP_SEPARATOR) === -1) {
        var stacks = [];
        for (var p = promise; !!p && handlers.get(p); p = handlers.get(p).became) {
          if (p.stack) {
            stacks.unshift(p.stack);
          }
        }
        stacks.unshift(error.stack);
        var concatedStacks = stacks.join("\n" + STACK_JUMP_SEPARATOR + "\n");
        error.stack = filterStackString(concatedStacks);
      }
    }
    function filterStackString(stackString) {
      if (Q.isIntrospective) {
        return stackString;
      }
      var lines = stackString.split("\n");
      var desiredLines = [];
      for (var i = 0; i < lines.length; ++i) {
        var line = lines[i];
        if (!isInternalFrame(line) && !isNodeFrame(line) && line) {
          desiredLines.push(line);
        }
      }
      return desiredLines.join("\n");
    }
    function isNodeFrame(stackLine) {
      return stackLine.indexOf("(module.js:") !== -1 || stackLine.indexOf("(node.js:") !== -1;
    }
    function getFileNameAndLineNumber(stackLine) {
      var attempt1 = /at .+ \((.+):(\d+):(?:\d+)\)$/.exec(stackLine);
      if (attempt1) {
        return [attempt1[1], Number(attempt1[2])];
      }
      var attempt2 = /at ([^ ]+):(\d+):(?:\d+)$/.exec(stackLine);
      if (attempt2) {
        return [attempt2[1], Number(attempt2[2])];
      }
      var attempt3 = /.*@(.+):(\d+)$/.exec(stackLine);
      if (attempt3) {
        return [attempt3[1], Number(attempt3[2])];
      }
    }
    function isInternalFrame(stackLine) {
      var fileNameAndLineNumber = getFileNameAndLineNumber(stackLine);
      if (!fileNameAndLineNumber) {
        return false;
      }
      var fileName = fileNameAndLineNumber[0];
      var lineNumber = fileNameAndLineNumber[1];
      return fileName === qFileName && lineNumber >= qStartingLine && lineNumber <= qEndingLine;
    }
    function captureLine() {
      if (!hasStacks) {
        return;
      }
      try {
        throw new Error();
      } catch (e) {
        var lines = e.stack.split("\n");
        var firstLine = lines[0].indexOf("@") > 0 ? lines[1] : lines[2];
        var fileNameAndLineNumber = getFileNameAndLineNumber(firstLine);
        if (!fileNameAndLineNumber) {
          return;
        }
        qFileName = fileNameAndLineNumber[0];
        return fileNameAndLineNumber[1];
      }
    }
    function deprecate(callback, name, alternative) {
      return function Q_deprecate() {
        if (typeof console !== "undefined" && typeof console.warn === "function") {
          if (alternative) {
            console.warn(name + " is deprecated, use " + alternative + " instead.", new Error("").stack);
          } else {
            console.warn(name + " is deprecated.", new Error("").stack);
          }
        }
        return callback.apply(this, arguments);
      };
    }
    var handlers = new WeakMap();
    function Q_getHandler(promise) {
      var handler = handlers.get(promise);
      if (!handler || !handler.became) {
        return handler;
      }
      handler = follow(handler);
      handlers.set(promise, handler);
      return handler;
    }
    function follow(handler) {
      if (!handler.became) {
        return handler;
      } else {
        handler.became = follow(handler.became);
        return handler.became;
      }
    }
    var theViciousCycleError = new Error("Can't resolve a promise with itself");
    var theViciousCycleRejection = Q_reject(theViciousCycleError);
    var theViciousCycle = Q_getHandler(theViciousCycleRejection);
    var thenables = new WeakMap();
    module.exports = Q;
    function Q(value) {
      if (Q_isPromise(value)) {
        return value;
      } else if (isThenable(value)) {
        if (!thenables.has(value)) {
          thenables.set(value, new Promise(new Thenable(value)));
        }
        return thenables.get(value);
      } else {
        return new Promise(new Fulfilled(value));
      }
    }
    Q.longStackSupport = false;
    Q.reject = Q_reject;
    function Q_reject(error) {
      return new Promise(new Rejected(error));
    }
    Q.defer = defer;
    function defer() {
      var handler = new Pending();
      var promise = new Promise(handler);
      var deferred = new Deferred(promise);
      if (Q.longStackSupport && hasStacks) {
        try {
          throw new Error();
        } catch (e) {
          promise.stack = e.stack.substring(e.stack.indexOf("\n") + 1);
        }
      }
      return deferred;
    }
    Q.when = function Q_when(value, fulfilled, rejected, ms) {
      return Q(value).then(fulfilled, rejected, ms);
    };
    Q.all = Q_all;
    function Q_all(questions) {
      if (Q_isPromise(questions)) {
        if (typeof console !== "undefined" && typeof console.warn === "function") {
          console.warn("Q.all no longer directly unwraps a promise. Use Q(array).all()");
        }
        return Q(questions).all();
      }
      var countDown = 0;
      var deferred = defer();
      var answers = Array(questions.length);
      var estimates = [];
      var estimate = -Infinity;
      var setEstimate;
      Array.prototype.forEach.call(questions, function Q_all_each(promise, index) {
        var handler;
        if (Q_isPromise(promise) && (handler = Q_getHandler(promise)).state === "fulfilled") {
          answers[index] = handler.value;
        } else {
          ++countDown;
          promise = Q(promise);
          promise.then(function Q_all_eachFulfilled(value) {
            answers[index] = value;
            if (--countDown === 0) {
              deferred.resolve(answers);
            }
          }, deferred.reject);
          promise.observeEstimate(function Q_all_eachEstimate(newEstimate) {
            var oldEstimate = estimates[index];
            estimates[index] = newEstimate;
            if (newEstimate > estimate) {
              estimate = newEstimate;
            } else if (oldEstimate === estimate && newEstimate <= estimate) {
              computeEstimate();
            }
            if (estimates.length === questions.length && estimate !== setEstimate) {
              deferred.setEstimate(estimate);
              setEstimate = estimate;
            }
          });
        }
      });
      function computeEstimate() {
        estimate = -Infinity;
        for (var index = 0; index < estimates.length; index++) {
          if (estimates[index] > estimate) {
            estimate = estimates[index];
          }
        }
      }
      if (countDown === 0) {
        deferred.resolve(answers);
      }
      return deferred.promise;
    }
    Q.allSettled = Q_allSettled;
    function Q_allSettled(questions) {
      if (Q_isPromise(questions)) {
        if (typeof console !== "undefined" && typeof console.warn === "function") {
          console.warn("Q.allSettled no longer directly unwraps a promise. Use Q(array).allSettled()");
        }
        return Q(questions).allSettled();
      }
      return Q_all(questions.map(function Q_allSettled_each(promise) {
        promise = Q(promise);
        function regardless() {
          return promise.inspect();
        }
        return promise.then(regardless, regardless);
      }));
    }
    Q.delay = function Q_delay(object, timeout) {
      if (timeout === void 0) {
        timeout = object;
        object = void 0;
      }
      return Q(object).delay(timeout);
    };
    Q.timeout = function Q_timeout(object, ms, message) {
      return Q(object).timeout(ms, message);
    };
    Q.spread = Q_spread;
    function Q_spread(value, fulfilled, rejected) {
      return Q(value).spread(fulfilled, rejected);
    }
    Q.join = function Q_join(x, y) {
      return Q.spread([x, y], function Q_joined(x, y) {
        if (x === y) {
          return x;
        } else {
          throw new Error("Can't join: not the same: " + x + " " + y);
        }
      });
    };
    Q.race = Q_race;
    function Q_race(answerPs) {
      return new Promise(function(deferred) {
        answerPs.forEach(function(answerP) {
          Q(answerP).then(deferred.resolve, deferred.reject);
        });
      });
    }
    Q.try = function Q_try(callback) {
      return Q(callback).dispatch("call", [[]]);
    };
    Q.function = Promise_function;
    function Promise_function(wrapped) {
      return function promiseFunctionWrapper() {
        var args = new Array(arguments.length);
        for (var index = 0; index < arguments.length; index++) {
          args[index] = arguments[index];
        }
        return Q(wrapped).apply(this, args);
      };
    }
    Q.promised = function Q_promised(callback) {
      return function promisedMethod() {
        var args = new Array(arguments.length);
        for (var index = 0; index < arguments.length; index++) {
          args[index] = arguments[index];
        }
        return Q_spread([this, Q_all(args)], function Q_promised_spread(self, args) {
          return callback.apply(self, args);
        });
      };
    };
    Q.passByCopy = Q.push = function(value) {
      if (Object(value) === value && !Q_isPromise(value)) {
        passByCopies.set(value, true);
      }
      return value;
    };
    Q.isPortable = function(value) {
      return Object(value) === value && passByCopies.has(value);
    };
    var passByCopies = new WeakMap();
    Q.async = Q_async;
    function Q_async(makeGenerator) {
      return function spawn() {
        function continuer(verb, arg) {
          var iteration;
          try {
            iteration = generator[verb](arg);
          } catch (exception) {
            return Q_reject(exception);
          }
          if (iteration.done) {
            return Q(iteration.value);
          } else {
            return Q(iteration.value).then(callback, errback);
          }
        }
        var generator = makeGenerator.apply(this, arguments);
        var callback = continuer.bind(continuer, "next");
        var errback = continuer.bind(continuer, "throw");
        return callback();
      };
    }
    Q.spawn = Q_spawn;
    function Q_spawn(makeGenerator) {
      Q_async(makeGenerator)().done();
    }
    Q.Promise = Promise;
    function Promise(handler) {
      if (!(this instanceof Promise)) {
        return new Promise(handler);
      }
      if (typeof handler === "function") {
        var setup = handler;
        var deferred = defer();
        handler = Q_getHandler(deferred.promise);
        try {
          setup(deferred.resolve, deferred.reject, deferred.setEstimate);
        } catch (error) {
          deferred.reject(error);
        }
      }
      handlers.set(this, handler);
    }
    Promise.all = Q_all;
    Promise.race = Q_race;
    Promise.resolve = Promise_resolve;
    function Promise_resolve(value) {
      return Q(value);
    }
    Promise.reject = Q_reject;
    Q.isPromise = Q_isPromise;
    function Q_isPromise(object) {
      return isObject(object) && !!handlers.get(object);
    }
    function isThenable(object) {
      return isObject(object) && typeof object.then === "function";
    }
    Promise.prototype.inspect = function Promise_inspect() {
      return Q_getHandler(this).inspect();
    };
    Promise.prototype.isPending = function Promise_isPending() {
      return Q_getHandler(this).state === "pending";
    };
    Promise.prototype.isFulfilled = function Promise_isFulfilled() {
      return Q_getHandler(this).state === "fulfilled";
    };
    Promise.prototype.isRejected = function Promise_isRejected() {
      return Q_getHandler(this).state === "rejected";
    };
    Promise.prototype.toBePassed = function Promise_toBePassed() {
      return Q_getHandler(this).state === "passed";
    };
    Promise.prototype.toString = function Promise_toString() {
      return "[object Promise]";
    };
    Promise.prototype.then = function Promise_then(fulfilled, rejected, ms) {
      var self = this;
      var deferred = defer();
      var _fulfilled;
      if (typeof fulfilled === "function") {
        _fulfilled = function Promise_then_fulfilled(value) {
          try {
            deferred.resolve(fulfilled.call(void 0, value));
          } catch (error) {
            deferred.reject(error);
          }
        };
      } else {
        _fulfilled = deferred.resolve;
      }
      var _rejected;
      if (typeof rejected === "function") {
        _rejected = function Promise_then_rejected(error) {
          try {
            deferred.resolve(rejected.call(void 0, error));
          } catch (newError) {
            deferred.reject(newError);
          }
        };
      } else {
        _rejected = deferred.reject;
      }
      this.done(_fulfilled, _rejected);
      if (ms !== void 0) {
        var updateEstimate = function Promise_then_updateEstimate() {
          deferred.setEstimate(self.getEstimate() + ms);
        };
        this.observeEstimate(updateEstimate);
        updateEstimate();
      }
      return deferred.promise;
    };
    Promise.prototype.done = function Promise_done(fulfilled, rejected) {
      var self = this;
      var done = false;
      asap(function Promise_done_task() {
        var _fulfilled;
        if (typeof fulfilled === "function") {
          if (Q.onerror) {
            _fulfilled = function Promise_done_fulfilled(value) {
              if (done) {
                return;
              }
              done = true;
              try {
                fulfilled.call(void 0, value);
              } catch (error) {
                (Q.onerror || Promise_rethrow)(error);
              }
            };
          } else {
            _fulfilled = function Promise_done_fulfilled(value) {
              if (done) {
                return;
              }
              done = true;
              fulfilled.call(void 0, value);
            };
          }
        }
        var _rejected;
        if (typeof rejected === "function" && Q.onerror) {
          _rejected = function Promise_done_rejected(error) {
            if (done) {
              return;
            }
            done = true;
            makeStackTraceLong(error, self);
            try {
              rejected.call(void 0, error);
            } catch (newError) {
              (Q.onerror || Promise_rethrow)(newError);
            }
          };
        } else if (typeof rejected === "function") {
          _rejected = function Promise_done_rejected(error) {
            if (done) {
              return;
            }
            done = true;
            makeStackTraceLong(error, self);
            rejected.call(void 0, error);
          };
        } else {
          _rejected = Q.onerror || Promise_rethrow;
        }
        if (typeof process === "object" && process.domain) {
          _rejected = process.domain.bind(_rejected);
        }
        Q_getHandler(self).dispatch(_fulfilled, "then", [_rejected]);
      });
    };
    function Promise_rethrow(error) {
      throw error;
    }
    Promise.prototype.thenResolve = function Promise_thenResolve(value) {
      value = Q(value);
      return Q_all([this, value]).then(function Promise_thenResolve_resolved() {
        return value;
      }, null, 0);
    };
    Promise.prototype.thenReject = function Promise_thenReject(error) {
      return this.then(function Promise_thenReject_resolved() {
        throw error;
      }, null, 0);
    };
    Promise.prototype.all = function Promise_all() {
      return this.then(Q_all);
    };
    Promise.prototype.allSettled = function Promise_allSettled() {
      return this.then(Q_allSettled);
    };
    Promise.prototype.catch = function Promise_catch(rejected) {
      return this.then(void 0, rejected);
    };
    Promise.prototype.finally = function Promise_finally(callback, ms) {
      if (!callback) {
        return this;
      }
      callback = Q(callback);
      return this.then(function(value) {
        return callback.call().then(function Promise_finally_fulfilled() {
          return value;
        });
      }, function(reason) {
        return callback.call().then(function Promise_finally_rejected() {
          throw reason;
        });
      }, ms);
    };
    Promise.prototype.observeEstimate = function Promise_observeEstimate(emit) {
      this.rawDispatch(null, "estimate", [emit]);
      return this;
    };
    Promise.prototype.getEstimate = function Promise_getEstimate() {
      return Q_getHandler(this).estimate;
    };
    Promise.prototype.dispatch = function Promise_dispatch(op, args) {
      var deferred = defer();
      this.rawDispatch(deferred.resolve, op, args);
      return deferred.promise;
    };
    Promise.prototype.rawDispatch = function Promise_rawDispatch(resolve, op, args) {
      var self = this;
      asap(function Promise_dispatch_task() {
        Q_getHandler(self).dispatch(resolve, op, args);
      });
    };
    Promise.prototype.get = function Promise_get(name) {
      return this.dispatch("get", [name]);
    };
    Promise.prototype.invoke = function Promise_invoke(name) {
      var args = new Array(arguments.length - 1);
      for (var index = 1; index < arguments.length; index++) {
        args[index - 1] = arguments[index];
      }
      return this.dispatch("invoke", [name, args]);
    };
    Promise.prototype.apply = function Promise_apply(thisp, args) {
      return this.dispatch("call", [args, thisp]);
    };
    Promise.prototype.call = function Promise_call(thisp) {
      var args = new Array(Math.max(0, arguments.length - 1));
      for (var index = 1; index < arguments.length; index++) {
        args[index - 1] = arguments[index];
      }
      return this.dispatch("call", [args, thisp]);
    };
    Promise.prototype.bind = function Promise_bind(thisp) {
      var self = this;
      var args = new Array(Math.max(0, arguments.length - 1));
      for (var index = 1; index < arguments.length; index++) {
        args[index - 1] = arguments[index];
      }
      return function Promise_bind_bound() {
        var boundArgs = args.slice();
        for (var index = 0; index < arguments.length; index++) {
          boundArgs[boundArgs.length] = arguments[index];
        }
        return self.dispatch("call", [boundArgs, thisp]);
      };
    };
    Promise.prototype.keys = function Promise_keys() {
      return this.dispatch("keys", []);
    };
    Promise.prototype.iterate = function Promise_iterate() {
      return this.dispatch("iterate", []);
    };
    Promise.prototype.spread = function Promise_spread(fulfilled, rejected, ms) {
      return this.all().then(function Promise_spread_fulfilled(array) {
        return fulfilled.apply(void 0, array);
      }, rejected, ms);
    };
    Promise.prototype.timeout = function Promsie_timeout(ms, message) {
      var deferred = defer();
      var timeoutId = setTimeout(function Promise_timeout_task() {
        deferred.reject(new Error(message || "Timed out after " + ms + " ms"));
      }, ms);
      this.then(function Promise_timeout_fulfilled(value) {
        clearTimeout(timeoutId);
        deferred.resolve(value);
      }, function Promise_timeout_rejected(error) {
        clearTimeout(timeoutId);
        deferred.reject(error);
      });
      return deferred.promise;
    };
    Promise.prototype.delay = function Promise_delay(ms) {
      return this.then(function Promise_delay_fulfilled(value) {
        var deferred = defer();
        deferred.setEstimate(Date.now() + ms);
        setTimeout(function Promise_delay_task() {
          deferred.resolve(value);
        }, ms);
        return deferred.promise;
      }, null, ms);
    };
    Promise.prototype.pull = function Promise_pull() {
      return this.dispatch("pull", []);
    };
    Promise.prototype.pass = function Promise_pass() {
      if (!this.toBePassed()) {
        return new Promise(new Passed(this));
      } else {
        return this;
      }
    };
    var promises = new WeakMap();
    function Deferred(promise) {
      this.promise = promise;
      promises.set(this, promise);
      var self = this;
      var resolve = this.resolve;
      this.resolve = function(value) {
        resolve.call(self, value);
      };
      var reject = this.reject;
      this.reject = function(error) {
        reject.call(self, error);
      };
    }
    Deferred.prototype.resolve = function Deferred_resolve(value) {
      var handler = Q_getHandler(promises.get(this));
      if (!handler.messages) {
        return;
      }
      handler.become(Q(value));
    };
    Deferred.prototype.reject = function Deferred_reject(reason) {
      var handler = Q_getHandler(promises.get(this));
      if (!handler.messages) {
        return;
      }
      handler.become(Q_reject(reason));
    };
    Deferred.prototype.setEstimate = function Deferred_setEstimate(estimate) {
      estimate = +estimate;
      if (estimate !== estimate) {
        estimate = Infinity;
      }
      if (estimate < 1e12 && estimate !== -Infinity) {
        throw new Error("Estimate values should be a number of miliseconds in the future");
      }
      var handler = Q_getHandler(promises.get(this));
      if (handler.setEstimate) {
        handler.setEstimate(estimate);
      }
    };
    function Fulfilled(value) {
      this.value = value;
      this.estimate = Date.now();
    }
    Fulfilled.prototype.state = "fulfilled";
    Fulfilled.prototype.inspect = function Fulfilled_inspect() {
      return {
        state: "fulfilled",
        value: this.value
      };
    };
    Fulfilled.prototype.dispatch = function Fulfilled_dispatch(resolve, op, operands) {
      var result;
      if (op === "then" || op === "get" || op === "call" || op === "invoke" || op === "keys" || op === "iterate" || op === "pull") {
        try {
          result = this[op].apply(this, operands);
        } catch (exception) {
          result = Q_reject(exception);
        }
      } else if (op === "estimate") {
        operands[0].call(void 0, this.estimate);
      } else {
        var error = new Error("Fulfilled promises do not support the " + op + " operator");
        result = Q_reject(error);
      }
      if (resolve) {
        resolve(result);
      }
    };
    Fulfilled.prototype.then = function Fulfilled_then() {
      return this.value;
    };
    Fulfilled.prototype.get = function Fulfilled_get(name) {
      return this.value[name];
    };
    Fulfilled.prototype.call = function Fulfilled_call(args, thisp) {
      return this.callInvoke(this.value, args, thisp);
    };
    Fulfilled.prototype.invoke = function Fulfilled_invoke(name, args) {
      return this.callInvoke(this.value[name], args, this.value);
    };
    Fulfilled.prototype.callInvoke = function Fulfilled_callInvoke(callback, args, thisp) {
      var waitToBePassed;
      for (var index = 0; index < args.length; index++) {
        if (Q_isPromise(args[index]) && args[index].toBePassed()) {
          waitToBePassed = waitToBePassed || [];
          waitToBePassed.push(args[index]);
        }
      }
      if (waitToBePassed) {
        var self = this;
        return Q_all(waitToBePassed).then(function() {
          return self.callInvoke(callback, args.map(function(arg) {
            if (Q_isPromise(arg) && arg.toBePassed()) {
              return arg.inspect().value;
            } else {
              return arg;
            }
          }), thisp);
        });
      } else {
        return callback.apply(thisp, args);
      }
    };
    Fulfilled.prototype.keys = function Fulfilled_keys() {
      return Object.keys(this.value);
    };
    Fulfilled.prototype.iterate = function Fulfilled_iterate() {
      return new Iterator(this.value);
    };
    Fulfilled.prototype.pull = function Fulfilled_pull() {
      var result;
      if (Object(this.value) === this.value) {
        result = Array.isArray(this.value) ? [] : {};
        for (var name in this.value) {
          result[name] = this.value[name];
        }
      } else {
        result = this.value;
      }
      return Q.push(result);
    };
    function Rejected(reason) {
      this.reason = reason;
      this.estimate = Infinity;
    }
    Rejected.prototype.state = "rejected";
    Rejected.prototype.inspect = function Rejected_inspect() {
      return {
        state: "rejected",
        reason: this.reason
      };
    };
    Rejected.prototype.dispatch = function Rejected_dispatch(resolve, op, operands) {
      var result;
      if (op === "then") {
        result = this.then(resolve, operands[0]);
      } else {
        result = this;
      }
      if (resolve) {
        resolve(result);
      }
    };
    Rejected.prototype.then = function Rejected_then(resolve, rejected) {
      return rejected ? rejected(this.reason) : this;
    };
    function Pending() {
      this.messages = [];
      this.observers = [];
      this.estimate = Infinity;
    }
    Pending.prototype.state = "pending";
    Pending.prototype.inspect = function Pending_inspect() {
      return {state: "pending"};
    };
    Pending.prototype.dispatch = function Pending_dispatch(resolve, op, operands) {
      this.messages.push([resolve, op, operands]);
      if (op === "estimate") {
        this.observers.push(operands[0]);
        var self = this;
        asap(function Pending_dispatch_task() {
          operands[0].call(void 0, self.estimate);
        });
      }
    };
    Pending.prototype.become = function Pending_become(promise) {
      this.became = theViciousCycle;
      var handler = Q_getHandler(promise);
      this.became = handler;
      handlers.set(promise, handler);
      this.promise = void 0;
      this.messages.forEach(function Pending_become_eachMessage(message) {
        asap(function Pending_become_eachMessage_task() {
          var handler = Q_getHandler(promise);
          handler.dispatch.apply(handler, message);
        });
      });
      this.messages = void 0;
      this.observers = void 0;
    };
    Pending.prototype.setEstimate = function Pending_setEstimate(estimate) {
      if (this.observers) {
        var self = this;
        self.estimate = estimate;
        this.observers.forEach(function Pending_eachObserver(observer) {
          asap(function Pending_setEstimate_eachObserver_task() {
            observer.call(void 0, estimate);
          });
        });
      }
    };
    function Thenable(thenable) {
      this.thenable = thenable;
      this.became = null;
      this.estimate = Infinity;
    }
    Thenable.prototype.state = "thenable";
    Thenable.prototype.inspect = function Thenable_inspect() {
      return {state: "pending"};
    };
    Thenable.prototype.cast = function Thenable_cast() {
      if (!this.became) {
        var deferred = defer();
        var thenable = this.thenable;
        asap(function Thenable_cast_task() {
          try {
            thenable.then(deferred.resolve, deferred.reject);
          } catch (exception) {
            deferred.reject(exception);
          }
        });
        this.became = Q_getHandler(deferred.promise);
      }
      return this.became;
    };
    Thenable.prototype.dispatch = function Thenable_dispatch(resolve, op, args) {
      this.cast().dispatch(resolve, op, args);
    };
    function Passed(promise) {
      this.promise = promise;
    }
    Passed.prototype.state = "passed";
    Passed.prototype.inspect = function Passed_inspect() {
      return this.promise.inspect();
    };
    Passed.prototype.dispatch = function Passed_dispatch(resolve, op, args) {
      return this.promise.rawDispatch(resolve, op, args);
    };
    Q.ninvoke = function Q_ninvoke(object, name) {
      var args = new Array(Math.max(0, arguments.length - 1));
      for (var index = 2; index < arguments.length; index++) {
        args[index - 2] = arguments[index];
      }
      var deferred = Q.defer();
      args[index - 2] = deferred.makeNodeResolver();
      Q(object).dispatch("invoke", [name, args]).catch(deferred.reject);
      return deferred.promise;
    };
    Promise.prototype.ninvoke = function Promise_ninvoke(name) {
      var args = new Array(arguments.length);
      for (var index = 1; index < arguments.length; index++) {
        args[index - 1] = arguments[index];
      }
      var deferred = Q.defer();
      args[index - 1] = deferred.makeNodeResolver();
      this.dispatch("invoke", [name, args]).catch(deferred.reject);
      return deferred.promise;
    };
    Q.denodeify = function Q_denodeify(callback, pattern) {
      return function denodeified() {
        var args = new Array(arguments.length + 1);
        var index = 0;
        for (; index < arguments.length; index++) {
          args[index] = arguments[index];
        }
        var deferred = Q.defer();
        args[index] = deferred.makeNodeResolver(pattern);
        Q(callback).apply(this, args).catch(deferred.reject);
        return deferred.promise;
      };
    };
    Deferred.prototype.makeNodeResolver = function(unpack) {
      var resolve = this.resolve;
      if (unpack === true) {
        return function variadicNodebackToResolver(error) {
          if (error) {
            resolve(Q_reject(error));
          } else {
            var value = new Array(Math.max(0, arguments.length - 1));
            for (var index = 1; index < arguments.length; index++) {
              value[index - 1] = arguments[index];
            }
            resolve(value);
          }
        };
      } else if (unpack) {
        return function namedArgumentNodebackToResolver(error) {
          if (error) {
            resolve(Q_reject(error));
          } else {
            var value = {};
            for (var index in unpack) {
              value[unpack[index]] = arguments[index + 1];
            }
            resolve(value);
          }
        };
      } else {
        return function nodebackToResolver(error, value) {
          if (error) {
            resolve(Q_reject(error));
          } else {
            resolve(value);
          }
        };
      }
    };
    Promise.prototype.nodeify = function Promise_nodeify(nodeback) {
      if (nodeback) {
        this.done(function(value) {
          nodeback(null, value);
        }, nodeback);
      } else {
        return this;
      }
    };
    Q.nextTick = deprecate(asap, "nextTick", "asap package");
    Q.resolve = deprecate(Q, "resolve", "Q");
    Q.fulfill = deprecate(Q, "fulfill", "Q");
    Q.isPromiseAlike = deprecate(isThenable, "isPromiseAlike", "(not supported)");
    Q.fail = deprecate(function(value, rejected) {
      return Q(value).catch(rejected);
    }, "Q.fail", "Q(value).catch");
    Q.fin = deprecate(function(value, regardless) {
      return Q(value).finally(regardless);
    }, "Q.fin", "Q(value).finally");
    Q.progress = deprecate(function(value) {
      return value;
    }, "Q.progress", "no longer supported");
    Q.thenResolve = deprecate(function(promise, value) {
      return Q(promise).thenResolve(value);
    }, "thenResolve", "Q(value).thenResolve");
    Q.thenReject = deprecate(function(promise, reason) {
      return Q(promise).thenResolve(reason);
    }, "thenResolve", "Q(value).thenResolve");
    Q.isPending = deprecate(function(value) {
      return Q(value).isPending();
    }, "isPending", "Q(value).isPending");
    Q.isFulfilled = deprecate(function(value) {
      return Q(value).isFulfilled();
    }, "isFulfilled", "Q(value).isFulfilled");
    Q.isRejected = deprecate(function(value) {
      return Q(value).isRejected();
    }, "isRejected", "Q(value).isRejected");
    Q.master = deprecate(function(value) {
      return value;
    }, "master", "no longer necessary");
    Q.makePromise = function() {
      throw new Error("makePromise is no longer supported");
    };
    Q.dispatch = deprecate(function(value, op, operands) {
      return Q(value).dispatch(op, operands);
    }, "dispatch", "Q(value).dispatch");
    Q.get = deprecate(function(object, name) {
      return Q(object).get(name);
    }, "get", "Q(value).get");
    Q.keys = deprecate(function(object) {
      return Q(object).keys();
    }, "keys", "Q(value).keys");
    Q.post = deprecate(function(object, name, args) {
      return Q(object).post(name, args);
    }, "post", "Q(value).invoke (spread arguments)");
    Q.mapply = deprecate(function(object, name, args) {
      return Q(object).post(name, args);
    }, "post", "Q(value).invoke (spread arguments)");
    Q.send = deprecate(function(object, name) {
      return Q(object).post(name, Array.prototype.slice.call(arguments, 2));
    }, "send", "Q(value).invoke");
    Q.set = function() {
      throw new Error("Q.set no longer supported");
    };
    Q.delete = function() {
      throw new Error("Q.delete no longer supported");
    };
    Q.nearer = deprecate(function(value) {
      if (Q_isPromise(value) && value.isFulfilled()) {
        return value.inspect().value;
      } else {
        return value;
      }
    }, "nearer", "inspect().value (+nuances)");
    Q.fapply = deprecate(function(callback, args) {
      return Q(callback).dispatch("call", [args]);
    }, "fapply", "Q(callback).apply(thisp, args)");
    Q.fcall = deprecate(function(callback) {
      return Q(callback).dispatch("call", [Array.prototype.slice.call(arguments, 1)]);
    }, "fcall", "Q(callback).call(thisp, ...args)");
    Q.fbind = deprecate(function(object) {
      var promise = Q(object);
      var args = Array.prototype.slice.call(arguments, 1);
      return function fbound() {
        return promise.dispatch("call", [args.concat(Array.prototype.slice.call(arguments)), this]);
      };
    }, "fbind", "bind with thisp");
    Q.promise = deprecate(Promise, "promise", "Promise");
    Promise.prototype.fapply = deprecate(function(args) {
      return this.dispatch("call", [args]);
    }, "fapply", "apply with thisp");
    Promise.prototype.fcall = deprecate(function() {
      return this.dispatch("call", [Array.prototype.slice.call(arguments)]);
    }, "fcall", "try or call with thisp");
    Promise.prototype.fail = deprecate(function(rejected) {
      return this.catch(rejected);
    }, "fail", "catch");
    Promise.prototype.fin = deprecate(function(regardless) {
      return this.finally(regardless);
    }, "fin", "finally");
    Promise.prototype.set = function() {
      throw new Error("Promise set no longer supported");
    };
    Promise.prototype.delete = function() {
      throw new Error("Promise delete no longer supported");
    };
    Deferred.prototype.notify = deprecate(function() {}, "notify", "no longer supported");
    Promise.prototype.progress = deprecate(function() {
      return this;
    }, "progress", "no longer supported");
    Promise.prototype.mapply = deprecate(function(name, args) {
      return this.dispatch("invoke", [name, args]);
    }, "mapply", "invoke");
    Promise.prototype.fbind = deprecate(function() {
      return Q.fbind.apply(Q, [void 0].concat(Array.prototype.slice.call(arguments)));
    }, "fbind", "bind(thisp, ...args)");
    Promise.prototype.send = deprecate(function() {
      return this.dispatch("invoke", [name, Array.prototype.slice.call(arguments, 1)]);
    }, "send", "invoke");
    Promise.prototype.mcall = deprecate(function() {
      return this.dispatch("invoke", [name, Array.prototype.slice.call(arguments, 1)]);
    }, "mcall", "invoke");
    Promise.prototype.passByCopy = deprecate(function(value) {
      return value;
    }, "passByCopy", "Q.passByCopy");
    Q.nfapply = deprecate(function(callback, args) {
      var deferred = Q.defer();
      var nodeArgs = Array.prototype.slice.call(args);
      nodeArgs.push(deferred.makeNodeResolver());
      Q(callback).apply(this, nodeArgs).catch(deferred.reject);
      return deferred.promise;
    }, "nfapply");
    Promise.prototype.nfapply = deprecate(function(args) {
      return Q.nfapply(this, args);
    }, "nfapply");
    Q.nfcall = deprecate(function(callback) {
      var args = Array.prototype.slice.call(arguments, 1);
      return Q.nfapply(callback, args);
    }, "nfcall");
    Promise.prototype.nfcall = deprecate(function() {
      var args = new Array(arguments.length);
      for (var index = 0; index < arguments.length; index++) {
        args[index] = arguments[index];
      }
      return Q.nfapply(this, args);
    }, "nfcall");
    Q.nfbind = deprecate(function(callback) {
      var baseArgs = Array.prototype.slice.call(arguments, 1);
      return function() {
        var nodeArgs = baseArgs.concat(Array.prototype.slice.call(arguments));
        var deferred = Q.defer();
        nodeArgs.push(deferred.makeNodeResolver());
        Q(callback).apply(this, nodeArgs).catch(deferred.reject);
        return deferred.promise;
      };
    }, "nfbind", "denodeify (with caveats)");
    Promise.prototype.nfbind = deprecate(function() {
      var args = new Array(arguments.length);
      for (var index = 0; index < arguments.length; index++) {
        args[index] = arguments[index];
      }
      return Q.nfbind(this, args);
    }, "nfbind", "denodeify (with caveats)");
    Q.nbind = deprecate(function(callback, thisp) {
      var baseArgs = Array.prototype.slice.call(arguments, 2);
      return function() {
        var nodeArgs = baseArgs.concat(Array.prototype.slice.call(arguments));
        var deferred = Q.defer();
        nodeArgs.push(deferred.makeNodeResolver());
        function bound() {
          return callback.apply(thisp, arguments);
        }
        Q(bound).apply(this, nodeArgs).catch(deferred.reject);
        return deferred.promise;
      };
    }, "nbind", "denodeify (with caveats)");
    Q.npost = deprecate(function(object, name, nodeArgs) {
      var deferred = Q.defer();
      nodeArgs.push(deferred.makeNodeResolver());
      Q(object).dispatch("invoke", [name, nodeArgs]).catch(deferred.reject);
      return deferred.promise;
    }, "npost", "ninvoke (with spread arguments)");
    Promise.prototype.npost = deprecate(function(name, args) {
      return Q.npost(this, name, args);
    }, "npost", "Q.ninvoke (with caveats)");
    Q.nmapply = deprecate(Q.nmapply, "nmapply", "q/node nmapply");
    Promise.prototype.nmapply = deprecate(Promise.prototype.npost, "nmapply", "Q.nmapply");
    Q.nsend = deprecate(Q.ninvoke, "nsend", "q/node ninvoke");
    Q.nmcall = deprecate(Q.ninvoke, "nmcall", "q/node ninvoke");
    Promise.prototype.nsend = deprecate(Promise.prototype.ninvoke, "nsend", "q/node ninvoke");
    Promise.prototype.nmcall = deprecate(Promise.prototype.ninvoke, "nmcall", "q/node ninvoke");
    var qEndingLine = captureLine();
  })(require("github:jspm/nodelibs@0.0.8/process"));
  global.define = __define;
  return module.exports;
});



System.register("npm:q@2.0.2", ["npm:q@2.0.2/q"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:q@2.0.2/q");
  global.define = __define;
  return module.exports;
});



System.register("build/src/Train", ["npm:q@2.0.2"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var Q = require("npm:q@2.0.2");
  var Train = {};
  var FN_ARGS = /^function\s*[^\(]*\(\s*([^\)]*)\)/m;
  var FN_ARG_SPLIT = /,/;
  var STRIP_COMMENTS = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/mg;
  function getParamNames(fn) {
    var fnText,
        argDecl,
        paramNames;
    if (typeof fn === 'function') {
      if (!(paramNames = fn.$params)) {
        paramNames = [];
        fnText = fn.toString().replace(STRIP_COMMENTS, '');
        argDecl = fnText.match(FN_ARGS);
        var list = argDecl[1].split(FN_ARG_SPLIT);
        for (var i = 0; i < list.length; i++) {
          paramNames.push(list[i].trim());
        }
      }
    }
    return paramNames;
  }
  function makeObjectChainable(target) {
    if (!target || target.__mix) {
      return;
    }
    target.__mix = {
      deferredStack: [],
      deferreds: [],
      cleanQueue: function() {
        var self = target;
        while (self.__mix.deferreds.length > 0 && self.__mix.deferreds[0].promise.isFulfilled()) {
          self.__mix.deferreds.shift();
        }
      },
      reset: function() {
        var self = target;
        var len = self.__mix.deferreds.length;
        for (var i = 0; i < len; ++i) {
          self.__mix.deferreds[i].resolve(this);
        }
        self.__mix.deferreds.length = 0;
      },
      toString: function() {
        var self = target;
        var result = '',
            s,
            d;
        var len = self.__mix.deferreds.length;
        for (var i = 0; i < len; ++i) {
          d = self.__mix.deferreds[i];
          s = d.promise.inspect();
          result += ' ' + String(d.NAME) + ':' + String(s.state);
        }
        return result.trim();
      }
    };
  }
  Train.mixFunctionInto = function(target, name, func) {
    if (!target || !name || !func) {
      return false;
    }
    if (target[name]) {
      return false;
    }
    makeObjectChainable(target);
    var params = getParamNames(func);
    target[name] = function() {
      var self = this;
      var d = Q.defer();
      d.NAME = name;
      function done() {
        if (d.queue && d.queue.length) {
          Q.all(d.queue).then(function() {
            d.resolve();
            setTimeout(function() {
              self.__mix.cleanQueue();
            }, 0);
          });
        } else {
          d.resolve();
          setTimeout(function() {
            self.__mix.cleanQueue();
          }, 0);
        }
      }
      var args = [];
      var matchedDone = false;
      for (var i = 0; i < func.length; i++) {
        if (params[i] === 'done') {
          matchedDone = true;
          args[i] = done;
        } else {
          args[i] = arguments[i];
        }
      }
      function task() {
        self.__mix.deferredStack.push(d);
        func.apply(self, args);
        if (func.length < args.length || !matchedDone) {
          done();
        }
        self.__mix.deferredStack.pop();
      }
      self.__mix.cleanQueue.call(self);
      var taskQueue = self.__mix.deferreds;
      if (self.__mix.deferredStack.length > 0) {
        var top = self.__mix.deferredStack[self.__mix.deferredStack.length - 1];
        top.queue = top.queue || [];
        taskQueue = top.queue;
      }
      var lastDeferred = taskQueue[taskQueue.length - 1];
      taskQueue.push(d);
      if (lastDeferred && d !== lastDeferred) {
        lastDeferred.promise.then(task);
      } else {
        task();
      }
      return self;
    };
    target[name].$params = params;
    target[name].$orig = func;
    return true;
  };
  Train.mixObjectInto = function(target, source) {
    if (!source || typeof source !== 'object') {
      return false;
    }
    var keys = Object.keys(source);
    var len = keys.length;
    var i = 0;
    var key = '';
    for (; i < len; ++i) {
      key = keys[i];
      if (typeof source[key] === 'function') {
        Train.mixFunctionInto(target, key, source[key]);
      }
    }
    return true;
  };
  Train.create = function() {
    var result = function() {};
    var len = arguments.length;
    var i = 0;
    var arg;
    for (; i < len; ++i) {
      arg = arguments[i];
      if (typeof arg === 'object') {
        Train.mixObjectInto(result, arg);
      }
    }
    return result;
  };
  module.exports = Train;
  global.define = __define;
  return module.exports;
});



System.register("build/src/PawGlobal", ["build/src/WheelEventSimulator", "build/src/ViewportRelative", "build/src/Gestures", "build/src/Train", "build/src/Paw"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var WheelEventSimulator = require("build/src/WheelEventSimulator");
  var ViewportRelative = require("build/src/ViewportRelative");
  var Gestures = require("build/src/Gestures");
  var Train = require("build/src/Train");
  var Paw = require("build/src/Paw");
  window.WheelEventSimulator = WheelEventSimulator;
  window.ViewportRelative = ViewportRelative;
  window.Gestures = Gestures;
  window.Train = Train;
  window.Paw = Paw;
  global.define = __define;
  return module.exports;
});




});
//# sourceMappingURL=PawGlobal.bundle.js.map