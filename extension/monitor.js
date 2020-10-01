var table;
var tableDef;
var tabInfo;
function refreshData() {
  let newTabInfo = chrome.extension.getBackgroundPage().tabRegistry.getActiveTabInfo();
  tabInfo = JSON.parse(JSON.stringify(newTabInfo)); //quick-and-dirty way to make a copy of a simple object
  $("body").html(tableDef);
  $("title").text(newTabInfo.tabTitle);
  table = $('#callist').DataTable({
    "order": [[3, 'asc']],
    "paging": true,
    deferRender: true,
    scrollY: 600,
    stateSave: true,
    data: tabInfo.calls,
    buttons: ['copy'],
    rowId: "id",
    columnDefs: [
      { className: "dt-head-left", targets: [0, 1, 2, 3, 4, 5, 6] }],
    columns: [
      {
        "className": 'details-control',
        "orderable": false,
        "data": null,
        "defaultContent": ''
      },
      { "data": "type" },
      { "data": "method" },
      {
        "data": "startTime"
        , render: function (data, type, row) { return Math.round(data) / 1000; }
      },
      {
        "data": "duration"
        , render: function (data, type, row) { return data === 0 ? "?" : Math.round(data) / 1000; }
      },
      {
        "data": "url"
        , render: function (data, type, row) {
          return '<span  style="overflow:hidden;white-space: nowrap;text-overflow:ellipsis">'
            + (data.length > 100 ? data.substring(0, 60) + " ( ... ) " + data.substring(data.length - 30) : data) + '</span>';
        }
      },
      {
        "data": "result",
        "width": "40%"
        , render: function (data, type, row) {
          if (data.startsWith("... pending ..."))
            return '<span style="color:orange" >' + data + "</span>";
          else if (data.startsWith("AJAXMONITOR ERROR"))
            return '<span style="color:orange;font-weight: bold" >' + data + "</span>";
          else
            return '<textarea style="border-style:none;resize:none;overflow:hidden;width:100% " rows="1" disabled=yes readonly=true>'
              + data + "</textarea>";
        }
      }
    ]
  });

  table.buttons(0, null).container().prependTo(
    table.table().container()
  );


  // Add event listener for opening and closing details
  $('#callist tbody').on('click', 'td.details-control', function () {
    var tr = $(this).closest('tr');
    var row = table.row(tr);

    if (row.child.isShown()) {
      // This row is already open - close it
      row.child.hide();
      tr.removeClass('details');
    }
    else {
      // Open this row
      row.child(formatDetails(row.data())).show();
      tr.addClass('details');
    }
  });
};
//setInterval(refreshData, 1000);

function formatDetails(call) {
  var rowsURL = parseInt(1 + call.url.length / 150);
  var rowsInit = Math.max(call.init.split(/\r\n|\r|\n/).length + 1, parseInt(1 + call.init.length / 150));
  rowsInit = Math.min(rowsInit, 20);
  var rowsResponseHeaders = Math.max(call.responseHeaders.split(/\r\n|\r|\n/).length + 1, parseInt(1 + call.responseHeaders.length / 150));
  rowsResponseHeaders = Math.min(rowsResponseHeaders, 20);
  var rowsResult = Math.max(call.result.split(/\r\n|\r|\n/).length + 1, parseInt(1 + call.result.length / 150));
  rowsResult = Math.min(rowsResult, 20);
  var rowsBody = Math.max(call.body.split(/\r\n|\r|\n/).length + 1, parseInt(1 + call.body.length / 150));
  rowsBody = Math.min(rowsBody, 20);
  return '<table style="width:100%;cursor:default;background:white" disabled=yes readonly=true>'
    + '<tr><td valign="top"><strong>Request</strong></td><td width="100%"></td></tr>'
    + '<tr><td valign="top">URL:</td><td width="100%"><textarea rows="' + rowsURL
    + '" style="resize:none;width:100%" disabled=yes readonly=true>' + call.url + '</textarea></td></tr>'
    + '<tr><td valign="top">Init:</td><td width="100%"><textarea rows="' + rowsInit
    + '" style="resize:none;width:100%" disabled=yes readonly=true>' + call.init + '</textarea></td></tr>'
    + '<tr><td valign="top">Body:</td><td><textarea rows="' + rowsBody
    + '" style="resize:none;width:100%" disabled=yes readonly=true>' + call.body + '</textarea></td></tr>'
    + '<tr><td valign="top"><strong>Response</strong></td><td width="100%"></td></tr>'
    + '<tr><td valign="top">Type:</td><td width="100%">' + call.responseType + '</td></tr>'
    + '<tr><td valign="top">Headers:</td><td width="100%"><textarea rows="' + rowsResponseHeaders
    + '" style="resize:none;width:100%" disabled=yes readonly=true>' + call.responseHeaders + '</textarea></td></tr>'
    + '<tr><td valign="top">Body:</td><td width="100%">'
    + ((call.result.startsWith("AJAXMONITOR ERROR")) ?
      '<span style="color:orange;font-weight: bold" >' + call.result + '</span>'
      : '<textarea rows="' + rowsResult
      + '" style="resize:none;width:100%" disabled=yes readonly=true>' + call.result + '</textarea>') + '</td></tr>'
    + '</table> ';
};

chrome.runtime.onMessage.addListener(function (message, sender) {
  let call;
  if (message.type) {
    switch (message.type) {
      case undefined:
        break;

      case "AJXMON_ADDCALL":
        //             console.log("ReceivNew row " + message.callInfo.id + "");
        if (!tabInfo) return;
        call = message.callInfo;
        if (tabInfo.calls.find(tiCall => tiCall.id === call.id))
          return;
        tabInfo.calls.push(call);
        table.row.add(call).draw(false);
        if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 10) {
          $(window).scrollTop($(document).height());
        }
        break;

      case "AJXMON_UPDATECALL":
        //        console.log(Date.now()+" Update row " + message.callInfo.id + "");
        if (!tabInfo) return;
        call = tabInfo.calls.find(call => call.id === message.callInfo.id);
        if (call) {
          call.duration = message.callInfo.duration;
          call.result = message.callInfo.result;
          table.row("#" + call.id).data(call);
        }
        break;

      case "AJXMON_REFRESHDATA":
        //           console.log("Received '" + message.type + "'");
        refreshData();
        break;

      default:
    }
  }
});

$(document).ready(function () {
  tableDef = $("body").html();
  refreshData();
});