'use strict';
var eachSupportedBrowser = require('./util').eachSupportedBrowser,
    Calibrator = require('../../lib/calibrator');

describe('calibrator', function() {
    eachSupportedBrowser(function(browserId) {
        if (browserId === 'android4.4') { //In SauseLabs calibration image for android 4.4 is not monocolor.
            return;
        }

        beforeEach(function() {
            return this.browser.initSession();
        });

        afterEach(function() {
            return this.browser.quit();
        });

        it('should not fail', function() {
            var calibrator = new Calibrator();
            return assert.isFulfilled(calibrator.calibrate(this.browser));
        });
    });
});
