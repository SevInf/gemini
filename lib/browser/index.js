'use strict';

var path = require('path'),
    util = require('util'),
    inherit = require('inherit'),
    debug = require('debug'),
    wd = require('wd'),
    _ = require('lodash'),
    q = require('q'),
    chalk = require('chalk'),
    browserify = require('browserify'),
    Image = require('../image'),
    Actions = require('./actions'),

    ClientBridge = require('./client-bridge'),

    GeminiError = require('../errors/gemini-error');

var Browser = inherit({
    __constructor: function(config) {
        this.config = config;
        this.id = config.id;
        this._browser = wd.promiseRemote(config.gridUrl);
        this.log = debug('gemini:browser:' + this.id);

        var wdLog = debug('gemini:webdriver:' + this.id);

        this._browser.on('connection', function(code, message, error) {
            wdLog('Error: code %d, %s', code, message);
        });

        this._browser.on('status', function(info) {
            wdLog(info);
        });
        this._browser.on('command', function(eventType, command, response) {
            if (eventType === 'RESPONSE' && command === 'takeScreenshot()') {
                response = '<binary-data>';
            }
            if (typeof response !== 'string') {
                response = JSON.stringify(response);
            }
            wdLog(chalk.cyan(eventType), command, chalk.grey(response || ''));
        });
    },

    launch: function(calibrator) {
        var _this = this;
        return this.initSession()
            .then(function() {
                return _this._setDefaultSize();
            })
            .then(function() {
                if (!_this.config.calibrate  || _this._calibration) {
                    return;
                }
                return calibrator.calibrate(_this)
                    .then(function(result) {
                        _this._calibration = result;
                    });
            })
            .then(function() {
                return _this.buildScripts();
            })
            .fail(function(e) {
                if (e.code === 'ECONNREFUSED') {
                    return q.reject(new GeminiError(
                        'Unable to connect to ' + _this.config.gridUrl,
                        'Make sure that URL in config file is correct and selenium\nserver is running.'
                    ));
                }

                var error = new GeminiError(
                    util.format('Cannot launch browser %s:\n%s', _this.id, e.message)
                );

                error.browserId = _this.id;
                error.browserSessionId = _this.sessionId;
                // sadly, selenium does not provide a way to distinguish different
                // reasons of failure
                return q.reject(error);
            });
    },

    initSession: function() {
        var _this = this;

        return this._browser
            .configureHttp({
                retries: 'never',
                timeout: this.config.httpTimeout
            })
            .then(function() {
                return _this._browser.init(_this.capabilities);
            })
            .spread(function(sessionId, actualCapabilities) {
                _this.sessionId = sessionId;
                _this.log('launched session %o', _this);
            });
    },

    _setDefaultSize: function() {
        var size = this.config.windowSize;
        if (!size) {
            return;
        }
        return this._browser.setWindowSize(size.width, size.height);
    },

    openRelative: function(relativeURL) {
        return this.open(this.config.getAbsoluteUrl(relativeURL));
    },

    // Zoom reset should be skipped before calibration cause we're unable to build client scripts before
    // calibration done. Reset will be executed as 1 of calibration steps.
    open: function(url, params) {
        params = _.defaults(params || {}, {
            resetZoom: true
        });

        var _this = this;
        return this._browser.get(url)
            .then(function(result) {
                return params.resetZoom
                    ? _this._clientBridge.call('resetZoom').thenResolve(result)
                    : result;
            });
    },

    injectScript: function(script) {
        return this._browser.execute(script);
    },

    evalScript: function(script) {
        /*jshint evil:true*/
        return this._browser.eval(script);
    },

    buildScripts: function() {
        var script = browserify({
                entries: './gemini',
                basedir: path.join(__dirname, 'client-scripts')
            });

        if (!this.config.system.coverage.enabled) {
            script.exclude('./gemini.coverage');
        }

        script.transform({sourcemap: false, global: true}, 'uglifyify');
        var _this = this;

        return q.nfcall(script.bundle.bind(script))
            .then(function(buf) {
                var scripts = _this._polyfill + '\n' + buf.toString();
                _this._clientBridge = new ClientBridge(_this, scripts);
                return scripts;
            });
    },

    reset: function() {
        var _this = this;
        // We can't use findElement here because it requires page with body tag
        return this.evalScript('document.body')
            .then(function(body) {
                // Selenium IEDriver doesn't move cursor to (0, 0) first time
                // https://github.com/SeleniumHQ/selenium/issues/672
                // So we do it in two steps: -> (1, 1) -> (0, 0)
                return _this._browser.moveTo(body, 1, 1)
                    .then(_this._browser.moveTo.bind(_this._browser, body, 0, 0));
            })
            .fail(function(e) {
                return q.reject(_.extend(e || {}, {
                    browserId: _this.id,
                    sessionId: _this.sessionId
                }));
            });
    },

    get browserName() {
        return this.capabilities.browserName;
    },

    get version() {
        return this.capabilities.version;
    },

    get capabilities() {
        return this.config.desiredCapabilities;
    },

    findElement: function(selector) {
        return this._browser.elementByCssSelector(selector)
            .fail(function(error) {
                if (error.status === Browser.ELEMENT_NOT_FOUND) {
                    error.selector = selector;
                }
                return q.reject(error);
            });
    },

    prepareScreenshot: function(selectors, opts) {
        return this._clientBridge.call('prepareScreenshot', [selectors, opts || {}]);
    },

    captureFullscreenImage: function() {
        var _this = this;
        return this._tryScreenshotMethod('_takeScreenshot')
            .fail(function(originalError) {
                return _this._tryScreenshotMethod('_takeScreenshotWithNativeContext')
                    .fail(function() {
                        // if _takeScreenshotWithNativeContext fails too, the original error
                        // most likely was not related to the different Appium contexts and
                        // it is more useful to report it instead of second one
                        return q.reject(originalError);
                    });
            });
    },

    _tryScreenshotMethod: function(method) {
        var _this = this;
        return this[method]()
            .then(function(screenshot) {
                _this.captureFullscreenImage = _this[method];
                return screenshot;
            });
    },

    _takeScreenshot: function() {
        var _this = this;
        return this._browser.takeScreenshot()
            .then(function(base64) {
                var image = new Image(new Buffer(base64, 'base64'));
                if (_this._calibration) {
                    image = image.crop({
                        left: _this._calibration.left,
                        top: _this._calibration.top,
                        width: image.getSize().width - _this._calibration.left,
                        height: image.getSize().height - _this._calibration.top
                    });
                }

                return image;
            });
    },

    _takeScreenshotWithNativeContext: function() {
        var _this = this;
        return this._browser.currentContext()
            .then(function(oldContext) {
                return _this._browser.context('NATIVE_APP')
                    .then(_this._takeScreenshot.bind(_this))
                    .fin(function() {
                        return _this._browser.context(oldContext);
                    });
            });
    },

    get usePixelRatio() {
        return this._calibration && this._calibration.usePixelRatio;
    },

    quit: function() {
        if (!this.sessionId) {
            return q();
        }

        var _this = this;
        return this._browser
            .quit()
            .then(function() {
                _this.log('kill browser %o', _this);
            });
    },

    createActionSequence: function() {
        return new Actions(this);
    },

    inspect: function() {
        return util.format('[%s (%s)]', this.id, this.sessionId);
    }

}, {
    ELEMENT_NOT_FOUND: 7
});

module.exports = Browser;
