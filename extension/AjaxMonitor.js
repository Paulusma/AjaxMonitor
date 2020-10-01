'use strict';

chrome.runtime.sendMessage({ type: "AJXMON_SESSIONSTARTED" });

const pageScript = () => {

  const sessionStart = performance.now();
  const callIdGenerator = (() => {
    this.nextId = 0;
    return {
      next: function () { return nextId++; }
    }
  })();

  ajaxFinalize = function (callInfo) {
    //    console.log("finalizing: "+JSON.stringify(callInfo));
    let data = callInfo.result;
    data = (data.length > 10003) ? data.substring(0, 10000) + "..." : data;
    callInfo.result = data;
    data = callInfo.body || "";
    data = (data.length > 10003) ? data.substring(0, 10000) + "..." : data;
    callInfo.body = data;

    window.postMessage({
      type: "AJXMON_CALLEND",
      callInfo: callInfo
    }, "*");
  };

  extractFormdata = function (callInfo, formData) {
    let rep = "FORMDATA[";
    let firstKey = true;
    for (let pair of formData.entries()) {
      rep += (firstKey ? "" : "; ") + pair[0] + ":"
        + ((typeof pair[1] === 'object') ? pair[1].constructor.name : pair[1]);
      firstKey = false;
    };
    callInfo.body = rep + "]";
  };


  // override to obtain a copy of the request header      
  (function (setRequestHeader) {
    XMLHttpRequest.prototype.setRequestHeader = function (header, value) {
      try {
        if (this._callInfo.init === "")
          this._callInfo.init = header + ":" + value;
        else
          this._callInfo.init += "; " + header + ":" + value;
      } catch (error) {
        this._callInfo.result = "AJAXMONITOR ERROR setting header " + header + "=" + value + ": " + JSON.stringify(error.message || "<no further details>");
        ajaxFinalize(this._callInfo);
      }
      try {
        setRequestHeader.apply(this, arguments);
      } catch (error) {
        this._callInfo.result = "AJAX ERROR setting header " + header + "=" + value + ": " + JSON.stringify(error.message || "<no further details>");
        ajaxFinalize(this._callInfo);
        throw error;
      }
    };
  })(XMLHttpRequest.prototype.setRequestHeader);

  // override to ontain a copy of the request body     
  (function (send) {
    XMLHttpRequest.prototype.send = function (body) {
      try {
        if (body && body.constructor) {
          switch (body.constructor.name) {
            case "String":
              this._callInfo.body = body;
              break;
            case "FormData":
              extractFormdata(this._callInfo, body);
              break;
            case "ArrayBuffer":
              const utf8Decoder = new TextDecoder("utf-8");
              this._callInfo.body = utf8Decoder.decode(body);
              break;
            case "Blob":
              var reader = new FileReader();
              reader.addEventListener('loadend', (e) => {
                // convoluted & code duplication but there is no way around async reading blobs...
                let text = e.target.result;
                if (text.includes(';base64,')) {
                  let ndx = text.indexOf(';base64,') + 8;
                  let decoded = atob(text.substring(ndx));
                  this._callInfo.body = text.substring(0, ndx) + decoded;
                } else
                  this._callInfo.body = text;
                try {
                  this._callInfo.startTime = performance.now() - sessionStart;
                  window.postMessage({
                    type: "AJXMON_CALLSTART",
                    callInfo: this._callInfo
                  }, "*");
                  send.apply(this, arguments);

                } catch (error) {
                  this._callInfo.result = "XHR ERROR sending request : " + JSON.stringify(error.message || "<no further details>");
                  ajaxFinalize(this._callInfo);
                  throw error;
                }
              });
              reader.readAsDataURL(body);
              return;
            default:
              this._callInfo.body = "(" + body.constructor.name + ")"
          }
        } else if (body)
          this._callInfo.body = body;
      } catch (error) {
        this._callInfo.result = "AJAXMONITOR ERROR sending request : " + JSON.stringify(error.message || "<no further details>");
        ajaxFinalize(this._callInfo);
      }
      try {
        this._callInfo.startTime = performance.now() - sessionStart;
        window.postMessage({
          type: "AJXMON_CALLSTART",
          callInfo: this._callInfo
        }, "*");
        send.apply(this, arguments);

      } catch (error) {
        this._callInfo.result = "XHR ERROR sending request : " + JSON.stringify(error.message || "<no further details>");
        ajaxFinalize(this._callInfo);
        throw error;
      }
    };
  })(XMLHttpRequest.prototype.send);


  // Override to capture the rest of the request cycle
  (function (open) {

    XMLHttpRequest.prototype.open = function (method, url, async, user, password) {
      this._callInfo = {
        id: callIdGenerator.next(),
        type: "XHR",
        method: method,
        url: url,
        result: "... pending ...",
        startTime: performance.now() - sessionStart,
        duration: 0,
        init: "",
        body: "",
        responseType: "(not supplied)",
        responseHeaders: "(not supplied)"
      };

      function handleResult(event) {
        //      console.log(this._callInfo.url + ": load");
        this._callInfo.duration = performance.now() - sessionStart - this._callInfo.startTime;
        this._callInfo.responseType = this.responseType;
        this._callInfo.responseHeaders = this.getAllResponseHeaders() || "";
        let data = "";
        try {
          switch (this.responseType) {
            case "json":
              data = JSON.stringify(this.response);
              break;
            case "document":
              data = this.response.documentElement.innerHTML;
              break;
            case "arraybuffer":
              const utf8Decoder = new TextDecoder("utf-8");
              data = utf8Decoder.decode(this.response);
              break;
            case "blob":
              // convoluted & code duplication but there is no way around async reading blobs...
              var reader = new FileReader();
              reader.addEventListener('loadend', (e) => {
                let text = e.target.result;
                if (text.includes(';base64,')) {
                  let ndx = text.indexOf(';base64,') + 8;
                  let decoded = atob(text.substring(ndx));
                  this._callInfo.result = text.substring(0, ndx) + decoded;
                } else
                  this._callInfo.result = text;
                ajaxFinalize(this._callInfo);
              });
              reader.readAsDataURL(this.response);
              return;

            default:
              let type = this.getResponseHeader("Content-Type");
              type = type ? type.split(";")[0] : "";
              this._callInfo.responseType = (type ? type : "(Content-Type missing in header)");
              data = this.responseText;
          }
        } catch (error) {
          data = "AJAXMONITOR ERROR reading response (" + this.responseType + "):" + JSON.stringify(error.message || "<no further details>");
        }
        this._callInfo.result = data;

        ajaxFinalize(this._callInfo);
      };

      // Additional intercepts, providing not very usefull information though...
      function handleError(error) {
        //       console.log(this._callInfo.url + ": error");
        this._callInfo.duration = performance.now() - sessionStart - this._callInfo.startTime;
        this._callInfo.result = "XHR ERROR: " + JSON.stringify(error.message || "<no further details>");
        ajaxFinalize(this._callInfo);
      };

      this.addEventListener('load', handleResult);
      this.addEventListener('error', handleError);
      this.addEventListener('abort', handleError);
      this.addEventListener('timeout', handleError);
      /*
      this.addEventListener('loadend', function(){
        console.log(this._callInfo.url+": loadend");
      });
      this.onreadystatechange = function () {
        console.log(this._callInfo.url + ": " + this.readyState);
      };
*/
      try {
        open.apply(this, arguments);
      } catch (error) {
        handleError(error);
        throw error;
      }
    };
  })(XMLHttpRequest.prototype.open);

  // Inject code that overrides each fetch
  (function (oldFetch) {
    // Wrapper class that holds call details for each invocation 
    class FetchLogger {
      constructor() {
        this.callInfo = {
          type: "Fetch",
          method: "GET",
          url: "<undefined>",
          result: "... pending ...                                                        ",
          startTime: performance.now() - sessionStart,
          duration: 0,
          init: "",
          body: "",
          responseType: "(not supplied)",
          responseHeaders: "(not supplied)"
        };
      }

      oldFetchChain(resource, init) {
        return oldFetch(resource, init)
          .then(response => {
            this.callInfo.duration = performance.now() - sessionStart - this.callInfo.startTime;
            try {
              let theResponse = response.clone(); // response is one-time use...

              if (theResponse.headers) {
                let type = theResponse.headers.get("Content-Type");
                type = type ? type.split(";")[0] : "";
                this.callInfo.responseType = (type ? type : "(Content-Type missing in header)");
                let headers = "";
                let first = true;
                for (var pair of theResponse.headers.entries()) {
                  headers += (first ? "" : "; ") + (pair[0] + ': ' + pair[1]);
                  first = false;
                }
                this.callInfo.responseHeaders = headers;
              }

              // Using body interface like below sometimes throws 'The user aborted a request'...
              /*
              theResponse.text()
              .then(result => {
                this.callInfo.result = result;
                ajaxFinalize(this.callInfo);
              })
              */
              // ... bypassing body interface and directly accessing stream seems to work though:
              if (theResponse.body) {
                this.callInfo.result = ""; // clear ... pending ...
                let theFetchLogger = this; // note: 'this' changes in then's
                const reader = theResponse.body.getReader();
                reader.read().then(function processText({ done, value }) {
                  if (done) {
                    ajaxFinalize(theFetchLogger.callInfo);
                    return;
                  }
                  const utf8Decoder = new TextDecoder("utf-8");
                  theFetchLogger.callInfo.result += utf8Decoder.decode(value);
                  return reader.read().then(processText).catch(error => {
                    theFetchLogger.callInfo.result = "AJAXMONITOR ERROR reading response body: "
                      + JSON.stringify(error.message || "<no further details>");
                    ajaxFinalize(thitheFetchLoggers.callInfo);
                  });
                }).catch(error => {
                  theFetchLogger.callInfo.result = "AJAXMONITOR ERROR reading response body: "
                    + JSON.stringify(error.message || "<no further details>");
                  ajaxFinalize(theFetchLogger.callInfo);
                });
              } else {
                theResponse.text()
                  .then(result => {
                    this.callInfo.result = result;
                    ajaxFinalize(this.callInfo);
                  }).catch(error => {
                    theFetchLogger.callInfo.result = "AJAXMONITOR ERROR reading response as text: "
                      + JSON.stringify(error.message || "<no further details>");
                    ajaxFinalize(theFetchLogger.callInfo);
                  });
              }
            } catch (error) {
              this.callInfo.result = "AJAXMONITOR ERROR reading request: "
                + JSON.stringify(error.message || "<no further details>");
              ajaxFinalize(this.callInfo);
            }
            return response; // for next in chain
          })
          .catch(error => {
            this.callInfo.duration = performance.now() - sessionStart - this.callInfo.startTime;
            this.callInfo.result = "Fetch ERROR: " + JSON.stringify(error.message || "<no further details>");
            ajaxFinalize(this.callInfo);
            throw error;
          })
      }


      fetch(resource, init) {
        try {
          if (init && init.method)
            this.callInfo.method = init.method;
          else if (typeof resource !== "string")
            this.callInfo.method = resource.method;
          this.callInfo.url = (typeof resource === "string") ? resource : resource.url; // cf Fetch api spec
          this.callInfo.id = callIdGenerator.next();
          if (init) {
            if (init.body && init.body.constructor) {
              switch (init.body.constructor.name) {
                case "String":
                  this.callInfo.body = JSON.stringify(init.body);
                  break;
                case "FormData":
                  extractFormdata(this.callInfo, init.body);
                  break;
                case "ArrayBuffer":
                  const utf8Decoder = new TextDecoder("utf-8");
                  this.callInfo.body = utf8Decoder.decode(init.body);
                  break;
                case "Blob":
                  var reader = new FileReader();
                  reader.addEventListener('loadend', (e) => {
                    // convoluted & code duplication but there is no way around async reading blobs...
                    let text = e.target.result;
                    if (text.includes(';base64,')) {
                      let ndx = text.indexOf(';base64,') + 8;
                      let decoded = atob(text.substring(ndx));
                      this.callInfo.body = text.substring(0, ndx) + decoded;
                    } else
                      this.callInfo.body = text;
                    this.callInfo.startTime = performance.now() - sessionStart;
                    window.postMessage({
                      type: "AJXMON_CALLSTART",
                      callInfo: this.callInfo
                    }, "*");
                    return this.oldFetchChain(resource, init);
                  });
                  reader.readAsDataURL(init.body);
                  return;

                default:
                  this.callInfo.body = "(" + init.body.constructor.name + ")"
              }
            } else if (init.body)
              this.callInfo.body = JSON.stringify(init.body);
            this.callInfo.init = JSON.stringify(init);
          } else if (typeof resource !== "string") {
            this.callInfo.init = "(Request object)";
          }
        } catch (error) {
          this.callInfo.body = "AJAXMONITOR ERROR reading body: "
            + JSON.stringify(error.message || "<no further details>");
        }

        this.callInfo.startTime = performance.now() - sessionStart;
        window.postMessage({
          type: "AJXMON_CALLSTART",
          callInfo: this.callInfo
        }, "*");

        return this.oldFetchChain(resource, init);
      };

    }

    // Replace global fetch
    window.fetch = function (resource, init) {
      return new FetchLogger().fetch(resource, init);
    }

  })(window.fetch);

}

const runInPageContext = (method, ...args) => {
  const stringifiedMethod = method instanceof Function
    ? method.toString() : `() => { ${method} }`;
  const stringifiedArgs = JSON.stringify(args);

  const scriptContent = `
  (${stringifiedMethod})(...${stringifiedArgs});
    document.currentScript.parentElement.removeChild(document.currentScript);
  `;

  // Create a script tag and inject it into the document.
  const scriptElement = document.createElement('script');
  scriptElement.innerHTML = scriptContent;
  document.documentElement.prepend(scriptElement);
};
runInPageContext(pageScript);


function xssEscape(s) {
  s = s.replace(/&/g, "&amp;");
  s = s.replace(/</g, "&lt;");
  s = s.replace(/>/g, "&gt;");
  s = s.replace(/'/g, "&#27;");
  s = s.replace(/"/g, "&quot;");
  return s;
}

// Communication with browser window
window.addEventListener("message", function (event) {
  // We only accept messages from ourselves
  if (event.source != window)
    return;

  //  console.log(Date.now() + ": AjaxMonitor received '" + event.data.type + "':" + event.data.callInfo);
  if (event.data.type) {
    let callInfo = event.data.callInfo;
    switch (event.data.type) {
      case "AJXMON_CALLSTART":
        callInfo.url = xssEscape(callInfo.url);
        chrome.runtime.sendMessage({
          type: "AJXMON_CALLSTART", callInfo: callInfo
        });
        break;

      case "AJXMON_CALLEND":
        callInfo.body = xssEscape(callInfo.body);
        callInfo.result = xssEscape(callInfo.result);
        chrome.runtime.sendMessage({
          type: "AJXMON_CALLEND", callInfo: callInfo
        });
        break;
    }
  }
}, false);
