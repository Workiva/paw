// Injected into the page being recorded
var port = chrome.runtime.connect(chrome.runtime.id, {name: 'recorder'});

document.body.appendChild(document.createElement('ludacris'));

// function addScript(src) {
//     var url = chrome.extension.getURL(src);
//     var el = document.createElement('script');
//     el.src = url;
//     document.body.appendChild('el');
// }

// Handle messages sent to us
port.onMessage.addListener(function(msg) {

    if (msg.type && (msg.type === "TOGGLE_RECORDING")) {
        console.log("Content script received: ", msg);
        //port.postMessage(event.data.text);
        toggleEventListeners(msg.value);
    }
});

function cancelEvent(event) {
    event.preventDefault();
}

function record(event) {
    console.log('Recording', event);
}

function toggleEventListeners(enable) {
    var fnToCall = enable ? 'addEventListener' : 'removeEventListener';
    console.log('toggle', fnToCall);

    if (enable) {
        window.addEventListener('touchmove', cancelEvent);
    } else {
        window.removeEventListener('touchmove', cancelEvent);
    }

    for (var i = 0; i < eventsToRecord.length; i++) {
        var key = eventsToRecord[i];
        window[fnToCall](key, record);
    }
}

// MAIN
// addScript('src/Train.js');
// addScript('src/ViewportRelative.js');
// addScript('src/WheelEventSimulator.js');
// addScript('src/Gestures.js');
// addScript('src/Paw.js');