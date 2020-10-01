// Used for debugging
// requires 'webRequest' permission & URL filter in manifest (als BG script must be persistent)
//chrome.webRequest.onErrorOccurred.addListener((details) => {
//  console.error(JSON.stringify(details));
//}, { urls: ["<all_urls>"] })
//chrome.webRequest.onCompleted.addListener((details) => {
//  console.log(JSON.stringify(details));
//}, { urls: ["<all_urls>"] });

// Handle monitor popup
var monitorID = -1;
chrome.browserAction.onClicked.addListener(function () {
  if (monitorID === -1) {
    monitorID = 0;
    chrome.windows.create({
      'url': 'monitor.html',
      'type': 'popup',
      'width': 1400,
      'height': 800,
      'left': (screen.width / 2) - (1400 / 2),
      'top': (screen.height / 2) - (800 / 2),
      'focused': true
    }, function (win) {
      monitorID = win.id;
    });
  } else {
    alert("The monitor window is already open.");
  }
});

chrome.windows.onRemoved.addListener(function (winId) {
  if (monitorID === winId) {
    monitorID = -1;
  }
});

// Registry of all open tabs
class TabInfo {
  constructor(tabId, tabURL, tabTitle) {
    this.tabId = tabId;
    this.tabURL = tabURL;
    this.tabTitle = tabTitle;
    this.calls = [];
  }
}

var tabRegistry = (() => {
  this.tabs = [];

  // Active tab is the one currently monitored.
  this.activeTabId = -1;
  this.tabs.push(new TabInfo(-1, -1, "", "No monitoring session found"));

  return {
    push: function (tabId, tabURL, tabTitle) { tabs.push(new TabInfo(tabId, tabURL, tabTitle)); },
    byTabId: function (tabId) { return tabs.find(s => s.tabId === tabId); },
    pop: function (tabId) {
      var idx = tabs.findIndex(s => s.tabId === tabId);
      if (idx >= 0) tabs.splice(idx, 0);
    },
    register: function (tabId, tabURL, tabTitle) {
      var tab = this.byTabId(tabId);
      if (!tab) {
        this.push(tabId, tabURL, tabTitle);
      } else {
        tab.tabURL = tabURL;
        tab.tabTitle = tabTitle;
        tab.calls.length = 0;
      };
      //     console.log("Registered new session for tab " + tabId);
    },
    unregister: function (tabId) {
      this.pop(tabId);
      //   console.log("Unregistered tab " + tabId);
    },

    makeActive: function (tabId) {
      var tab = this.byTabId(tabId);
      if (tab) {
        if (activeTabId !== tab.tabId) {
          activeTabId = tab.tabId;
          //     console.log("Activated tab " + tabId);
          chrome.runtime.sendMessage({ type: "AJXMON_REFRESHDATA" });
        }
      } else {
        activeTabId = -1;
        // console.log("Tab " + tabId + " is not monitored, activeTabId = -1");
      }
    },
    getActiveTabInfo: function () { return this.byTabId(activeTabId); },
    isActive: function (tabId) { return activeTabId === tabId; },
    logCallStart: function (tabId, callInfo) {
      let tab = this.byTabId(tabId);
      if (tab) {
        tab.calls.push(callInfo);
        if (this.isActive(tabId))
          chrome.runtime.sendMessage({ type: "AJXMON_ADDCALL", callInfo: callInfo });
      }
    },
    logCallEnd: function (tabId, callInfo) {
      let tab = this.byTabId(tabId);
      if (tab) {
        let call = tab.calls.find(call => call.id === callInfo.id);
        if (!call) {
          // console.error("call not found! ID=" + theCall.id);
          return;
        }
        Object.assign(call, callInfo);
        if (this.isActive(tabId))
          chrome.runtime.sendMessage({ type: "AJXMON_UPDATECALL", callInfo: call });
      }
    }
  }
})();

chrome.runtime.onMessage.addListener(
  function (request, sender) {
    switch (request.type) {
      case "AJXMON_CALLSTART":
        //     console.log(Date.now()+" BG received: " + request.type + " - " + request.callInfo.id);
        tabRegistry.logCallStart(sender.tab.id, request.callInfo);
        break;

      case "AJXMON_CALLEND":
        //      console.log(Date.now()+" BG received: " + request.type + " - " + request.callInfo.id);
        tabRegistry.logCallEnd(sender.tab.id, request.callInfo);
        break;

      case "AJXMON_SESSIONSTARTED":
        //              console.log("Session started in tab " + sender.tab.id);
        tabRegistry.register(sender.tab.id, sender.tab.url, sender.tab.title);
        if (tabRegistry.isActive(sender.tab.id))
          chrome.runtime.sendMessage({ type: "AJXMON_REFRESHDATA" });
        break;
    }
  //  console.log(Date.now() + " call handled");
  }
);

chrome.tabs.onRemoved.addListener(function (tabId, removeInfo) {
  //  console.log("onRemove: " + tabId);
  if (monitorID === 0 || monitorID === removeInfo.windowId)
    return; // monitor popup
  tabRegistry.unregister(tabId);
});

chrome.tabs.onActivated.addListener(function (activeInfo) {
  //console.log("onActivated: " + activeInfo.tabId);
  if (monitorID === 0 || monitorID === activeInfo.windowId)
    return; // monitor popup
  tabRegistry.makeActive(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  if (monitorID === 0 || monitorID === tab.windowId)
    return; // monitor popup
  // console.log("onUpdating: " + tabId);
  if (changeInfo.title) {
    let tab = tabRegistry.byTabId(tabId);
    if (tab) tab.tabTitle = changeInfo.title;
  }
  if (changeInfo.status === "complete") {
    tabRegistry.makeActive(tabId);
  }
});

chrome.windows.onFocusChanged.addListener(function (windowId) {
  // console.log("onFocusChanged: " + windowId);
  if (monitorID === 0 || monitorID === windowId)
    return; // monitor popup
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    return; // workaround for chrome issue (https://bugs.chromium.org/p/chromium/issues/detail?id=523892)
  }
  chrome.tabs.query({ active: true, windowId: windowId }, tabs => {
    if (tabs && tabs.length > 0) {
      //tabs.forEach(tab => console.log(JSON.stringify(tab)))
      tabRegistry.makeActive(tabs[0].id);
    }
  });
});
