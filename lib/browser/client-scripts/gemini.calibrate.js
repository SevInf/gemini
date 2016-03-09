(function(window) {
    'use strict';

    function resetZoom() {
        var meta = document.createElement('meta');
        meta.name = 'viewport';
        meta.content = 'width=device-width,initial-scale=1.0,user-scalable=no';
        document.getElementsByTagName('head')[0].appendChild(meta);
    }

    function createPattern() {
        var bodyStyle = document.body.style;
        bodyStyle.margin = 0;
        bodyStyle.padding = 0;

        var img = document.createElement('div');
        img.style.width = '6px';
        img.style.height = '6px';
        img.style.margin = '0';
        img.style.padding = '0';

        // 1px high image with 6 * 6 #96fa00 square
        img.style.background = 'url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAYAAAAGCAIAAABvrngfAAAAEElEQVR4AWOc8osBDdBYCABfQQlbthabtgAAAABJRU5ErkJggg==)';
        document.body.appendChild(img);
    }

    function getBrowserFeatures() {
        return {
            pixelRatio: window.devicePixelRatio
        };
    }

    resetZoom();
    createPattern();
    return getBrowserFeatures();
}(window));
