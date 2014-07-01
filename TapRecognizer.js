/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * @license MPL 2.0
 * @copyright Daniel Zaner 2014
 */
define(function(require, exports, module) {
    var EventHandler    = require('famous/core/EventHandler');
    var Timer           = require('famous/utilities/Timer');

    // Tap thresholds in miliseconds
    TapRecognizer.TAP_THRESHOLD         = 100;
    TapRecognizer.DOUBLE_TAP_THRESHOLD  = 300;
    TapRecognizer.PRESS_THRESHOLD       = 500;

    // States for .tapState, .lastTapState
    TapRecognizer.INVALID_TAP   = 0;
    TapRecognizer.STARTED       = 1;
    TapRecognizer.TAP           = 2;
    TapRecognizer.DOUBLE_TAP    = 3;
    TapRecognizer.PRESS         = 4;
        

    /**
     * Handles piped in touch events. Emits 'tap', 'doubletap',
     * and 'press' events. Note: While the option 'emitEveryTap'
     * can be set to 'false' for convenience to eliminate 'tap'
     * events for taps that are the first half of a 'doubletap', 
     * the TapRecognizer will be rate-limited and can not emit very
     * fast sequences of taps. Set 'emitEveryTap' to 'true' if
     * user input will be very fast and filter instead in the 
     * event listener.
     *
     * @class TapRecognizer
     * @constructor
     * @param {Object} options default options overrides
     * @param {boolean} [options.emitEveryTap=true] true: emit every tap or false: suppress the 'tap' before a 'doubletap'
     */
    function TapRecognizer(options) {
        this.eventInput = new EventHandler();
        this.eventOutput = new EventHandler();

        // default options
        this.options = {
            emitEveryTap: 'true'
        };

        this.pendingTap     = undefined;                    // tap payload that will be emited next
        this.lastTap        = undefined;                    // last tap payload emited with 'timestamp'
        this.lastTrackstart = undefined;                    // last 'trackstart' data with 'timestamp'
        this.lastTrackend   = undefined;                    // last 'trackend' data with 'timestamp'
        this.tapState       = TapRecognizer.INVALID_TAP;    // state of current touch sequence
        this.lastTapState   = TapRecognizer.INVALID_TAP;    // final state of the previous touch sequence
        this.touchHistory   = {};                           // holds last X touch objects
        this.historyQueue   = [];                           // used to prune .touchHistory

        if (options) this.setOptions(options);
        else this.setOptions(this.options);

        EventHandler.setInputHandler(this, this.eventInput);
        EventHandler.setOutputHandler(this, this.eventOutput);

        this.eventInput.on('touchstart', _handleStart.bind(this));
        this.eventInput.on('touchmove', _handleMove.bind(this));
        this.eventInput.on('touchend', _handleEnd.bind(this));
        this.eventInput.on('touchcancel', _handleEnd.bind(this));
        this.eventInput.on('unpipe', _handleUnpipe.bind(this));
    }

    function _buildPayload(event) {
        var payload = {};
        payload.timeStamp = event.timeStamp;
        if (!event.changedTouches || (event.changedTouches.length === 0)) return payload;
        var data = event.changedTouches[0];
        payload.clientX   = data.clientX;
        payload.clientY   = data.clientY;
        payload.touch     = data.identifier;
        return payload;
    }

    // handle 'trackstart'
    function _handleStart(data) {
        this.tapState = TapRecognizer.STARTED;
        this.lastTrackstart = data;
    }

    // handle 'trackmove'
    function _handleMove(data) {
        var now = data.timeStamp;
        if ((this.tapState === TapRecognizer.STARTED) &&
            this.lastTrackstart &&
            (now - this.lastTrackstart.timeStamp > TapRecognizer.PRESS_THRESHOLD)) {
                this.tapState = TapRecognizer.PRESS;
                this.pendingTap = _buildPayload.call(this, data);
                _broadcast.call(this);
        }
    }

    // handle 'trackend'
    function _handleEnd(data) {
        _updateHistory.call(this, data);
        var now = data.timeStamp;
        this.lastTrackend = data;
        var emitEveryTap = (this.options.emitEveryTap === "true");

        if (emitEveryTap) {
            if ((this.tapState === TapRecognizer.STARTED) && this.lastTapState &&
                (this.lastTapState !== TapRecognizer.DOUBLE_TAP) && this.lastTap &&
                (now - this.lastTap.timeStamp < TapRecognizer.DOUBLE_TAP_THRESHOLD)) {
                    this.tapState = TapRecognizer.DOUBLE_TAP;
                    this.pendingTap = _buildPayload.call(this, data);
                    _broadcast.call(this);
            }
        } else {
            if ((this.tapState === TapRecognizer.STARTED) && this.pendingTap &&
                (now - this.pendingTap.timeStamp < TapRecognizer.DOUBLE_TAP_THRESHOLD)) {
                    this.tapState = TapRecognizer.DOUBLE_TAP;
                    this.pendingTap = _buildPayload.call(this, data);
            }
        }

        if ((this.tapState === TapRecognizer.STARTED) && this.lastTrackstart &&
            (now - this.lastTrackstart.timeStamp < TapRecognizer.TAP_THRESHOLD)) {
                this.tapState = TapRecognizer.TAP;
                this.pendingTap = _buildPayload.call(this, data);
                if (emitEveryTap) {
                    _broadcast.call(this);
                } else {
                    Timer.setTimeout(_broadcast.bind(this), TapRecognizer.DOUBLE_TAP_THRESHOLD);
                }
        }

        if ((this.tapState === TapRecognizer.STARTED) && this.lastTrackstart &&
            (now - this.lastTrackstart.timeStamp > TapRecognizer.PRESS_THRESHOLD)) {
                this.tapState = TapRecognizer.PRESS;
                this.pendingTap = _buildPayload.call(this, data);
                _broadcast.call(this);
        }
    }

    function _handleUnpipe() {
        this.pendingTap = undefined;
        this.tapState = INVALID_TAP;
    }

    function _updateHistory(data) {
        if (!data.changedTouches || (data.changedTouches.length === 0)) return;
        while (this.historyQueue.length < 5) {
            this.historyQueue.push(0);                                        // ensure a five touch 'TTL' in the history
        }
        this.touchHistory[data.changedTouches[0].identifier] = data;
        this.historyQueue.push(data.changedTouches[0].identifier);
        delete this.touchHistory[this.historyQueue.shift()];
    }

    function _broadcast() {
        if ((this.tapState === TapRecognizer.STARTED) || (this.tapState === TapRecognizer.TAP)) {
            this.eventOutput.emit('tap', this.pendingTap);
        } else if (this.tapState === TapRecognizer.DOUBLE_TAP) {
            this.eventOutput.emit('doubletap', this.pendingTap);
        } else if (this.tapState === TapRecognizer.PRESS) {
            this.eventOutput.emit('press', this.pendingTap);
        }
        if (this.tapState !== TapRecognizer.STARTED) {
            this.lastTapState = this.tapState;
            this.tapState = TapRecognizer.INVALID_TAP;          // we've handled the current tap
        }
        this.lastTap = this.pendingTap;
        this.pendingTap = undefined;
    }



    /**
     * Set internal options, overriding any default options
     *
     * @method setOptions
     *
     * @param {Object} [options] overrides of default options
     * @param {String} [options.emitEveryTap] true: emit every tap or false: supress the 'tap' before a 'doubletap'
     */
    TapRecognizer.prototype.setOptions = function setOptions(options) {
        if (options.emitEveryTap !== undefined) this.options.emitEveryTap = options.emitEveryTap;
    };

    /**
     * Return entire options dictionary, including defaults.
     *
     * @method getOptions
     * @return {Object} configuration options
     */
    TapRecognizer.prototype.getOptions = function getOptions() {
        return this.options;
    };

    /**
     * Convenience accessor to TapIdentifier's eventOutput EventHandler
     *
     * @method on
     * @param {string} type event type key (for example, 'tap')
     * @param {function(string, Object)} handler callback
     * @return {EventHandler} this
     */
    TapRecognizer.prototype.on = function on(type, handler) {
        return this.eventOutput.on(type, handler);
    };

    /**
     * Convenience accessor to call event handlers with this set to owner.
     *
     * @method bindThis
     * @param {Object} owner object this EventEmitter belongs to
     */
    TapRecognizer.prototype.bindThis = function bindThis(owner) {
        this.eventOutput.bindThis(owner);
    };

    /**
     * Return a 'touchend' event from the history, if it exists
     * in the touchHistory
     *
     * @method getTouchEventByIdentifier
     * @return {TouchEvent} a TouchEvent
     */
    TapRecognizer.prototype.getTouchEventByIdentifier = function getTouchEventByIdentifier(identifier) {
        return this.touchHistory[identifier];
    };

    /**
     * Convenience method to return the origin object of a 'touchend' 
     * event from the history, if it exists in the touchHistory
     *
     * @method getOriginByTouchIdentifier
     * @return {Object} the origin object of a TouchEvent
     */
    TapRecognizer.prototype.getOriginByTouchIdentifier = function getOriginByTouchIdentifier(identifier) {
        var event = this.touchHistory[identifier];
        if (event) {
            return event.origin;
        } else {
            return null;
        }
    };

    module.exports = TapRecognizer;
});
