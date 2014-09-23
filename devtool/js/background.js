'use strict';

// Has access to extensions APIs
// communicates with content.js and panel.js

chrome.devtools.panels.create("Recorder",
    "images/icon-128.png",
    "devtool/panel.html",
    function(panel) {
      // code invoked on panel creation
      // nothing here yet, obviously
    }
);
