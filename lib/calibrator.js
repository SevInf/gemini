'use strict';
var q = require('q'),
    fs = require('fs'),
    path = require('path'),
    _ = require('lodash'),

    GeminiError = require('./errors/gemini-error'),
    looksSame = require('looks-same'),
    clientScriptCalibrate = fs.readFileSync(path.join(__dirname, 'browser', 'client-scripts', 'gemini.calibrate.min.js'), 'utf8'),
    SEARCH_COLOR = {R: 148, G: 250, B: 0};

/**
 * @constructor
 */
function Calibrator() {
    this._cache = {};
}

/**
 * @param {Browser} browser
 * @returns {Promise.<CalibrationResult>}
 */
Calibrator.prototype.calibrate = function(browser) {
    var _this = this;
    if (this._cache[browser.id]) {
        return q(this._cache[browser.id]);
    }
    return browser.open('about:blank')
        .then(function() {
            return browser.evalScript(clientScriptCalibrate);
        })
        .then(function(features) {
            return [features, browser.captureFullscreenImage()];
        })
        .spread(function(features, image) {
            var innerWidth = features.innerWidth,
                imageFeatures = _this._detectImageFeatures(image, innerWidth);

            if (!imageFeatures) {
                return q.reject(new GeminiError(
                    'Could not calibrate. This could be due to calibration page has failed to open properly'
                ));
            }

            _.extend(features, {
                top: imageFeatures.viewportStart.y,
                left: imageFeatures.viewportStart.x,
                usePixelRatio: (features.pixelRatio &&
                    features.pixelRatio > 1.0 &&
                    imageFeatures.colorLength > innerWidth
                )
            });

            _this._cache[browser.id] = features;
            return features;
        });
};

Calibrator.prototype._detectImageFeatures = function(image, innerWidth) {
    var imageHeight = image.getSize().height;

    for (var y = 0; y < imageHeight; y++) {
        var result = inspectRow(y, image, innerWidth);

        if (result) {
            return result;
        }
    }

    return null;
};

function inspectRow(row, image, innerWidth) {
    var markerStart = findMarkerStart(row, image);

    if (markerStart === -1) {
        return null;
    }

    var currentLength = 0,
        imageWidth = image.getSize().width,
        start = {x: markerStart, y: row};

    for (var x = markerStart; x < imageWidth; x++) {
        var color = pickRGB(image.getRGBA(x, row));

        if (looksSame.colors(color, SEARCH_COLOR)) {
            currentLength++;
        } else if (currentLength >= innerWidth) {
            return {viewportStart: start, colorLength: currentLength};
        } else {
            return null;
        }
    }

    return {viewportStart: start, colorLength: currentLength};
}

function findMarkerStart(row, image) {
    var imageWidth = image.getSize().width;

    for (var x = 0; x < imageWidth; x++) {
        var color = pickRGB(image.getRGBA(x, row));

        if (looksSame.colors(color, SEARCH_COLOR)) {
            return x;
        }
    }

    return -1;
}

function pickRGB(rgba) {
    return {
        R: rgba.r,
        G: rgba.g,
        B: rgba.b
    };
}

/**
 * @typedef {Object} CalibrationResult
 * @property {Number} top
 * @property {Number} left
 * @property {Number} right
 * @property {Number} bottom
 */

module.exports = Calibrator;
