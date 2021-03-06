/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
/**
 * @fileoverview
 * @suppress {missingRequire}
 */

import {attachOriginToPatched, zoneSymbol} from './utils';

export const TRUE_STR = 'true';
export const FALSE_STR = 'false';

export interface EventTaskData extends TaskData { readonly isUsingGlobalCallback?: boolean; }

// an identifier to tell ZoneTask do not create a new invoke closure
export const OPTIMIZED_ZONE_EVENT_TASK_DATA: EventTaskData = {
  isUsingGlobalCallback: true
};

export const zoneSymbolEventNames: any = {};
export const globalSources: any = {};

export const CONSTRUCTOR_NAME = 'name';

export const FUNCTION_TYPE = 'function';
export const OBJECT_TYPE = 'object';

export const ZONE_SYMBOL_PREFIX = '__zone_symbol__';

const EVENT_NAME_SYMBOL_REGX = /^__zone_symbol__(\w+)(true|false)$/;

const IMMEDIATE_PROPAGATION_SYMBOL = ('__zone_symbol__propagationStopped');

export interface PatchEventTargetOptions {
  validateHandler?: (nativeDelegate: any, delegate: any, target: any, args: any) => boolean;
  addEventListenerFnName?: string;
  removeEventListenerFnName?: string;
  prependEventListenerFnName?: string;
  listenersFnName?: string;
  removeAllFnName?: string;
  useGlobalCallback?: boolean;
  checkDuplicate?: boolean;
  returnTarget?: boolean;
  compareTaskCallbackVsDelegate?: (task: any, delegate: any) => boolean;
}

export function patchEventTarget(
    _global: any, apis: any[], patchOptions?: PatchEventTargetOptions) {
  const ADD_EVENT_LISTENER =
      (patchOptions && patchOptions.addEventListenerFnName) || 'addEventListener';
  const REMOVE_EVENT_LISTENER =
      (patchOptions && patchOptions.removeEventListenerFnName) || 'removeEventListener';

  const LISTENERS_EVENT_LISTENER =
      (patchOptions && patchOptions.listenersFnName) || 'eventListeners';
  const REMOVE_ALL_LISTENERS_EVENT_LISTENER =
      (patchOptions && patchOptions.removeAllFnName) || 'removeAllListeners';

  const zoneSymbolAddEventListener = zoneSymbol(ADD_EVENT_LISTENER);

  const ADD_EVENT_LISTENER_SOURCE = '.' + ADD_EVENT_LISTENER + ':';

  const PREPEND_EVENT_LISTENER = 'prependListener';
  const PREPEND_EVENT_LISTENER_SOURCE = '.' + PREPEND_EVENT_LISTENER + ':';

  const invokeTask = function(task: any, target: any, event: Event) {
    // for better performance, check isRemoved which is set
    // by removeEventListener
    if (task.isRemoved) {
      return;
    }
    const delegate = task.callback;
    if (typeof delegate === OBJECT_TYPE && delegate.handleEvent) {
      // create the bind version of handleEvent when invoke
      task.callback = (event: Event) => delegate.handleEvent(event);
      task.originalDelegate = delegate;
    }
    // invoke static task.invoke
    task.invoke(task, target, [event]);
    const options = task.options;
    if (options && typeof options === 'object' && options.once) {
      // if options.once is true, after invoke once remove listener here
      // only browser need to do this, nodejs eventEmitter will cal removeListener
      // inside EventEmitter.once
      const delegate = task.originalDelegate ? task.originalDelegate : task.callback;
      target[REMOVE_EVENT_LISTENER].apply(target, [event.type, delegate, options]);
    }
  };

  // global shared zoneAwareCallback to handle all event callback with capture = false
  const globalZoneAwareCallback = function(event: Event) {
    // https://github.com/angular/zone.js/issues/911, in IE, sometimes
    // event will be undefined, so we need to use window.event
    event = event || _global.event;
    if (!event) {
      return;
    }
    // event.target is needed for Samusung TV and SourceBuffer
    // || global is needed https://github.com/angular/zone.js/issues/190
    const target: any = this || event.target || _global;
    const tasks = target[zoneSymbolEventNames[event.type][FALSE_STR]];
    if (tasks) {
      // invoke all tasks which attached to current target with given event.type and capture = false
      // for performance concern, if task.length === 1, just invoke
      if (tasks.length === 1) {
        invokeTask(tasks[0], target, event);
      } else {
        // https://github.com/angular/zone.js/issues/836
        // copy the tasks array before invoke, to avoid
        // the callback will remove itself or other listener
        const copyTasks = tasks.slice();
        for (let i = 0; i < copyTasks.length; i++) {
          if (event && (event as any)[IMMEDIATE_PROPAGATION_SYMBOL] === true) {
            break;
          }
          invokeTask(copyTasks[i], target, event);
        }
      }
    }
  };

  // global shared zoneAwareCallback to handle all event callback with capture = true
  const globalZoneAwareCaptureCallback = function(event: Event) {
    // https://github.com/angular/zone.js/issues/911, in IE, sometimes
    // event will be undefined, so we need to use window.event
    event = event || _global.event;
    if (!event) {
      return;
    }
    // event.target is needed for Samusung TV and SourceBuffer
    // || global is needed https://github.com/angular/zone.js/issues/190
    const target: any = this || event.target || _global;
    const tasks = target[zoneSymbolEventNames[event.type][TRUE_STR]];
    if (tasks) {
      // invoke all tasks which attached to current target with given event.type and capture = false
      // for performance concern, if task.length === 1, just invoke
      if (tasks.length === 1) {
        invokeTask(tasks[0], target, event);
      } else {
        // https://github.com/angular/zone.js/issues/836
        // copy the tasks array before invoke, to avoid
        // the callback will remove itself or other listener
        const copyTasks = tasks.slice();
        for (let i = 0; i < copyTasks.length; i++) {
          if (event && (event as any)[IMMEDIATE_PROPAGATION_SYMBOL] === true) {
            break;
          }
          invokeTask(copyTasks[i], target, event);
        }
      }
    }
  };

  function patchEventTargetMethods(obj: any, patchOptions?: PatchEventTargetOptions) {
    if (!obj) {
      return false;
    }

    let useGlobalCallback = true;
    if (patchOptions && patchOptions.useGlobalCallback !== undefined) {
      useGlobalCallback = patchOptions.useGlobalCallback;
    }
    const validateHandler = patchOptions && patchOptions.validateHandler;

    let checkDuplicate = true;
    if (patchOptions && patchOptions.checkDuplicate !== undefined) {
      checkDuplicate = patchOptions.checkDuplicate;
    }

    let returnTarget = false;
    if (patchOptions && patchOptions.returnTarget !== undefined) {
      returnTarget = patchOptions.returnTarget;
    }

    let proto = obj;
    while (proto && !proto.hasOwnProperty(ADD_EVENT_LISTENER)) {
      proto = Object.getPrototypeOf(proto);
    }
    if (!proto && obj[ADD_EVENT_LISTENER]) {
      // somehow we did not find it, but we can see it. This happens on IE for Window properties.
      proto = obj;
    }

    if (!proto) {
      return false;
    }
    if (proto[zoneSymbolAddEventListener]) {
      return false;
    }

    // a shared global taskData to pass data for scheduleEventTask
    // so we do not need to create a new object just for pass some data
    const taskData: any = {};

    const nativeAddEventListener = proto[zoneSymbolAddEventListener] = proto[ADD_EVENT_LISTENER];
    const nativeRemoveEventListener = proto[zoneSymbol(REMOVE_EVENT_LISTENER)] =
        proto[REMOVE_EVENT_LISTENER];

    const nativeListeners = proto[zoneSymbol(LISTENERS_EVENT_LISTENER)] =
        proto[LISTENERS_EVENT_LISTENER];
    const nativeRemoveAllListeners = proto[zoneSymbol(REMOVE_ALL_LISTENERS_EVENT_LISTENER)] =
        proto[REMOVE_ALL_LISTENERS_EVENT_LISTENER];

    let nativePrependEventListener: any;
    if (patchOptions && patchOptions.prependEventListenerFnName) {
      nativePrependEventListener = proto[zoneSymbol(patchOptions.prependEventListenerFnName)] =
          proto[patchOptions.prependEventListenerFnName];
    }

    const customScheduleGlobal = function(task: Task) {
      // if there is already a task for the eventName + capture,
      // just return, because we use the shared globalZoneAwareCallback here.
      if (taskData.isExisting) {
        return;
      }
      return nativeAddEventListener.apply(taskData.target, [
        taskData.eventName,
        taskData.capture ? globalZoneAwareCaptureCallback : globalZoneAwareCallback,
        taskData.options
      ]);
    };

    const customCancelGlobal = function(task: any) {
      // if task is not marked as isRemoved, this call is directly
      // from Zone.prototype.cancelTask, we should remove the task
      // from tasksList of target first
      if (!task.isRemoved) {
        const symbolEventNames = zoneSymbolEventNames[task.eventName];
        let symbolEventName;
        if (symbolEventNames) {
          symbolEventName = symbolEventNames[task.capture ? TRUE_STR : FALSE_STR];
        }
        const existingTasks = symbolEventName && task.target[symbolEventName];
        if (existingTasks) {
          for (let i = 0; i < existingTasks.length; i++) {
            const existingTask = existingTasks[i];
            if (existingTask === task) {
              existingTasks.splice(i, 1);
              // set isRemoved to data for faster invokeTask check
              task.isRemoved = true;
              if (existingTasks.length === 0) {
                // all tasks for the eventName + capture have gone,
                // remove globalZoneAwareCallback and remove the task cache from target
                task.allRemoved = true;
                task.target[symbolEventName] = null;
              }
              break;
            }
          }
        }
      }
      // if all tasks for the eventName + capture have gone,
      // we will really remove the global event callback,
      // if not, return
      if (!task.allRemoved) {
        return;
      }
      return nativeRemoveEventListener.apply(task.target, [
        task.eventName, task.capture ? globalZoneAwareCaptureCallback : globalZoneAwareCallback,
        task.options
      ]);
    };

    const customScheduleNonGlobal = function(task: Task) {
      return nativeAddEventListener.apply(
          taskData.target, [taskData.eventName, task.invoke, taskData.options]);
    };

    const customSchedulePrepend = function(task: Task) {
      return nativePrependEventListener.apply(
          taskData.target, [taskData.eventName, task.invoke, taskData.options]);
    };

    const customCancelNonGlobal = function(task: any) {
      return nativeRemoveEventListener.apply(
          task.target, [task.eventName, task.invoke, task.options]);
    };

    const customSchedule = useGlobalCallback ? customScheduleGlobal : customScheduleNonGlobal;
    const customCancel = useGlobalCallback ? customCancelGlobal : customCancelNonGlobal;

    const compareTaskCallbackVsDelegate = function(task: any, delegate: any) {
      const typeOfDelegate = typeof delegate;
      if ((typeOfDelegate === FUNCTION_TYPE && task.callback === delegate) ||
          (typeOfDelegate === OBJECT_TYPE && task.originalDelegate === delegate)) {
        // same callback, same capture, same event name, just return
        return true;
      }
      return false;
    };

    const compare = (patchOptions && patchOptions.compareTaskCallbackVsDelegate) ?
        patchOptions.compareTaskCallbackVsDelegate :
        compareTaskCallbackVsDelegate;

    const makeAddListener = function(
        nativeListener: any, addSource: string, customScheduleFn: any, customCancelFn: any,
        returnTarget = false, prepend = false) {
      return function() {
        const target = this || _global;
        const targetZone = Zone.current;
        let delegate = arguments[1];
        if (!delegate) {
          return nativeListener.apply(this, arguments);
        }

        // don't create the bind delegate function for handleEvent
        // case here to improve addEventListener performance
        // we will create the bind delegate when invoke
        let isHandleEvent = false;
        if (typeof delegate !== FUNCTION_TYPE) {
          if (!delegate.handleEvent) {
            return nativeListener.apply(this, arguments);
          }
          isHandleEvent = true;
        }

        if (validateHandler && !validateHandler(nativeListener, delegate, target, arguments)) {
          return;
        }

        const eventName = arguments[0];
        const options = arguments[2];

        let capture;
        let once = false;
        if (options === undefined) {
          capture = false;
        } else if (options === true) {
          capture = true;
        } else if (options === false) {
          capture = false;
        } else {
          capture = options ? !!options.capture : false;
          once = options ? !!options.once : false;
        }

        const zone = Zone.current;
        const symbolEventNames = zoneSymbolEventNames[eventName];
        let symbolEventName;
        if (!symbolEventNames) {
          // the code is duplicate, but I just want to get some better performance
          const falseEventName = eventName + FALSE_STR;
          const trueEventName = eventName + TRUE_STR;
          const symbol = ZONE_SYMBOL_PREFIX + falseEventName;
          const symbolCapture = ZONE_SYMBOL_PREFIX + trueEventName;
          zoneSymbolEventNames[eventName] = {};
          zoneSymbolEventNames[eventName][FALSE_STR] = symbol;
          zoneSymbolEventNames[eventName][TRUE_STR] = symbolCapture;
          symbolEventName = capture ? symbolCapture : symbol;
        } else {
          symbolEventName = symbolEventNames[capture ? TRUE_STR : FALSE_STR];
        }
        let existingTasks = target[symbolEventName];
        let isExisting = false;
        if (existingTasks) {
          // already have task registered
          isExisting = true;
          if (checkDuplicate) {
            for (let i = 0; i < existingTasks.length; i++) {
              if (compare(existingTasks[i], delegate)) {
                // same callback, same capture, same event name, just return
                return;
              }
            }
          }
        } else {
          existingTasks = target[symbolEventName] = [];
        }
        let source;
        const constructorName = target.constructor[CONSTRUCTOR_NAME];
        const targetSource = globalSources[constructorName];
        if (targetSource) {
          source = targetSource[eventName];
        }
        if (!source) {
          source = constructorName + addSource + eventName;
        }
        // do not create a new object as task.data to pass those things
        // just use the global shared one
        taskData.options = options;
        if (once) {
          // if addEventListener with once options, we don't pass it to
          // native addEventListener, instead we keep the once setting
          // and handle ourselves.
          taskData.options.once = false;
        }
        taskData.target = target;
        taskData.capture = capture;
        taskData.eventName = eventName;
        taskData.isExisting = isExisting;

        const data = useGlobalCallback ? OPTIMIZED_ZONE_EVENT_TASK_DATA : null;
        const task: any =
            zone.scheduleEventTask(source, delegate, data, customScheduleFn, customCancelFn);

        // have to save those information to task in case
        // application may call task.zone.cancelTask() directly
        if (once) {
          options.once = true;
        }
        task.options = options;
        task.target = target;
        task.capture = capture;
        task.eventName = eventName;
        if (isHandleEvent) {
          // save original delegate for compare to check duplicate
          (task as any).originalDelegate = delegate;
        }
        if (!prepend) {
          existingTasks.push(task);
        } else {
          existingTasks.unshift(task);
        }

        if (returnTarget) {
          return target;
        }
      };
    };

    proto[ADD_EVENT_LISTENER] = makeAddListener(
        nativeAddEventListener, ADD_EVENT_LISTENER_SOURCE, customSchedule, customCancel,
        returnTarget);
    if (nativePrependEventListener) {
      proto[PREPEND_EVENT_LISTENER] = makeAddListener(
          nativePrependEventListener, PREPEND_EVENT_LISTENER_SOURCE, customSchedulePrepend,
          customCancel, returnTarget, true);
    }

    proto[REMOVE_EVENT_LISTENER] = function() {
      const target = this || _global;
      const eventName = arguments[0];
      const options = arguments[2];

      let capture;
      if (options === undefined) {
        capture = false;
      } else if (options === true) {
        capture = true;
      } else if (options === false) {
        capture = false;
      } else {
        capture = options ? !!options.capture : false;
      }

      const delegate = arguments[1];
      if (!delegate) {
        return nativeRemoveEventListener.apply(this, arguments);
      }

      if (validateHandler &&
          !validateHandler(nativeRemoveEventListener, delegate, target, arguments)) {
        return;
      }

      const symbolEventNames = zoneSymbolEventNames[eventName];
      let symbolEventName;
      if (symbolEventNames) {
        symbolEventName = symbolEventNames[capture ? TRUE_STR : FALSE_STR];
      }
      const existingTasks = symbolEventName && target[symbolEventName];
      if (existingTasks) {
        for (let i = 0; i < existingTasks.length; i++) {
          const existingTask = existingTasks[i];
          const typeOfDelegate = typeof delegate;
          if (compare(existingTask, delegate)) {
            existingTasks.splice(i, 1);
            // set isRemoved to data for faster invokeTask check
            (existingTask as any).isRemoved = true;
            if (existingTasks.length === 0) {
              // all tasks for the eventName + capture have gone,
              // remove globalZoneAwareCallback and remove the task cache from target
              (existingTask as any).allRemoved = true;
              target[symbolEventName] = null;
            }
            existingTask.zone.cancelTask(existingTask);
            return;
          }
        }
      }
    };

    proto[LISTENERS_EVENT_LISTENER] = function() {
      const target = this || _global;
      const eventName = arguments[0];

      const listeners: any[] = [];
      const tasks = findEventTasks(target, eventName);

      for (let i = 0; i < tasks.length; i++) {
        const task: any = tasks[i];
        let delegate = task.originalDelegate ? task.originalDelegate : task.callback;
        listeners.push(delegate);
      }
      return listeners;
    };

    proto[REMOVE_ALL_LISTENERS_EVENT_LISTENER] = function() {
      const target = this || _global;

      const eventName = arguments[0];
      if (!eventName) {
        const keys = Object.keys(target);
        for (let i = 0; i < keys.length; i++) {
          const prop = keys[i];
          const match = EVENT_NAME_SYMBOL_REGX.exec(prop);
          let evtName = match && match[1];
          // in nodejs EventEmitter, removeListener event is
          // used for monitoring the removeListener call,
          // so just keep removeListener eventListener until
          // all other eventListeners are removed
          if (evtName && evtName !== 'removeListener') {
            this[REMOVE_ALL_LISTENERS_EVENT_LISTENER].apply(this, [evtName]);
          }
        }
        // remove removeListener listener finally
        this[REMOVE_ALL_LISTENERS_EVENT_LISTENER].apply(this, ['removeListener']);
      } else {
        const symbolEventNames = zoneSymbolEventNames[eventName];
        if (symbolEventNames) {
          const symbolEventName = symbolEventNames[FALSE_STR];
          const symbolCaptureEventName = symbolEventNames[TRUE_STR];

          const tasks = target[symbolEventName];
          const captureTasks = target[symbolCaptureEventName];

          if (tasks) {
            const removeTasks = tasks.slice();
            for (let i = 0; i < removeTasks.length; i++) {
              const task = removeTasks[i];
              let delegate = task.originalDelegate ? task.originalDelegate : task.callback;
              this[REMOVE_EVENT_LISTENER].apply(this, [eventName, delegate, task.options]);
            }
          }

          if (captureTasks) {
            const removeTasks = captureTasks.slice();
            for (let i = 0; i < removeTasks.length; i++) {
              const task = removeTasks[i];
              let delegate = task.originalDelegate ? task.originalDelegate : task.callback;
              this[REMOVE_EVENT_LISTENER].apply(this, [eventName, delegate, task.options]);
            }
          }
        }
      }
    };

    // for native toString patch
    attachOriginToPatched(proto[ADD_EVENT_LISTENER], nativeAddEventListener);
    attachOriginToPatched(proto[REMOVE_EVENT_LISTENER], nativeRemoveEventListener);
    if (nativeRemoveAllListeners) {
      attachOriginToPatched(proto[REMOVE_ALL_LISTENERS_EVENT_LISTENER], nativeRemoveAllListeners);
    }
    if (nativeListeners) {
      attachOriginToPatched(proto[LISTENERS_EVENT_LISTENER], nativeListeners);
    }
    return true;
  }

  let results: any[] = [];
  for (let i = 0; i < apis.length; i++) {
    results[i] = patchEventTargetMethods(apis[i], patchOptions);
  }

  return results;
}

export function findEventTasks(target: any, eventName: string): Task[] {
  const foundTasks: any[] = [];
  for (let prop in target) {
    const match = EVENT_NAME_SYMBOL_REGX.exec(prop);
    let evtName = match && match[1];
    if (evtName && (!eventName || evtName === eventName)) {
      const tasks: any = target[prop];
      if (tasks) {
        for (let i = 0; i < tasks.length; i++) {
          foundTasks.push(tasks[i]);
        }
      }
    }
  }
  return foundTasks;
}

export function patchEventPrototype(global: any, api: _ZonePrivate) {
  const Event = global['Event'];
  if (Event && Event.prototype) {
    api.patchMethod(
        Event.prototype, 'stopImmediatePropagation',
        (delegate: Function) => function(self: any, args: any[]) {
          self[IMMEDIATE_PROPAGATION_SYMBOL] = true;
        });
  }
}
