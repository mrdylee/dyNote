"""Inspect a document already opened by Windows, optionally edit it and save it in place."""
import os
import sys
import time

import uno

filename, operation = sys.argv[1:]
endpoint = "uno:pipe,name=" + os.environ["DYNOTE_OFFICE_PIPE"] + ";urp;StarOffice.ComponentContext"
local = uno.getComponentContext()
resolver = local.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local)
deadline = time.monotonic() + 40
doc = None
desktop = None
while time.monotonic() < deadline and doc is None:
    if desktop is None:
        try:
            remote = resolver.resolve(endpoint)
            desktop = remote.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", remote)
        except uno.getClass("com.sun.star.connection.NoConnectException"):
            time.sleep(0.25)
            continue
    components = desktop.getComponents().createEnumeration()
    while components.hasMoreElements():
        item = components.nextElement()
        url = getattr(item, "URL", "")
        if url.startswith("file:") and os.path.normcase(os.path.normpath(uno.fileUrlToSystemPath(url))) == os.path.normcase(filename):
            doc = item
            break
    if doc is None:
        time.sleep(0.25)
if doc is None:
    raise RuntimeError("Windows did not open the expected original document in LibreOffice: " + filename)
if filename.lower().endswith(".xlsx"):
    assert doc.supportsService("com.sun.star.sheet.SpreadsheetDocument")
    if operation == "edit":
        doc.Sheets.getByIndex(0).getCellRangeByName("D3").String = "승인 완료"
        doc.Sheets.getByIndex(1).getCellRangeByName("B3").String = "승인 완료"
else:
    assert doc.supportsService("com.sun.star.presentation.PresentationDocument")
    if operation == "edit":
        slide = doc.DrawPages.getByIndex(1)
        title = next(shape for shape in slide if getattr(shape, "String", "") == "시험 결과")
        title.String = "Windows 저장 확인"
if operation == "edit":
    assert not doc.isReadonly()
    doc.store()
doc.close(True)
print("PASS native editor " + operation + " " + os.path.basename(filename))
